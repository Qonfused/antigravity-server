/** @file
  Schema Cleaner

  Transforms standard JSON Schemas (OpenAI style) into the strict subset
  accepted by Antigravity (Gemini Code Assist) API.

  Key restrictions handled:
  - No $ref, $id, $comment
  - No additionalProperties, patternProperties
  - No anyOf, oneOf, allOf, not (flattened with type hints)
  - No const (converted to enum)
  - Limited type keywords (converted to description hints)
  - Types uppercased (STRING, OBJECT, etc.)
  - Empty object schemas get placeholder property

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

const MAX_DEPTH = 20;

// Placeholder for empty schemas (Claude VALIDATED mode requires at least one property)
const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";

// Unsupported constraint keywords - will be moved to description hints
const UNSUPPORTED_CONSTRAINTS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "format",
] as const;

// Keywords that cause errors in Antigravity API - removed entirely after hints
const UNSUPPORTED_KEYWORDS = [
  ...UNSUPPORTED_CONSTRAINTS,
  "$schema",
  "$defs",
  "definitions",
  "$ref",
  "$id",
  "$comment",
  "const",
  "additionalProperties",
  "title",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
  "contentEncoding",
  "contentMediaType",
  "if",
  "then",
  "else",
  "not",
  "dependentSchemas",
  "dependentRequired",
  "patternProperties",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "minContains",
  "maxContains",
] as const;

// =============================================================================
// Phase 1: Add Hints (preserve semantic information in descriptions)
// =============================================================================

function appendDescriptionHint(schema: any, hint: string): any {
  const currentDesc = typeof schema.description === "string" ? schema.description : "";
  const formattedHint = `(${hint})`;

  if (currentDesc.includes(formattedHint)) return schema;

  return {
    ...schema,
    description: currentDesc ? `${currentDesc} ${formattedHint}` : formattedHint,
  };
}

/**
 * Phase 1a: Converts $ref to description hints.
 * { $ref: "#/$defs/Foo" } → { type: "object", description: "(See: Foo)" }
 */
function convertRefsToHints(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(convertRefsToHints);

  let result: any = { ...schema };

  if (typeof result.$ref === "string") {
    const refName = result.$ref.split("/").pop() || "ref";
    delete result.$ref;
    result.type = result.type || "object";
    result = appendDescriptionHint(result, `See: ${refName}`);
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = convertRefsToHints(value);
    }
  }

  return result;
}

/**
 * Phase 1b: Converts const to enum.
 * { const: "foo" } → { type: "string", enum: ["foo"] }
 */
function convertConstToEnum(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(convertConstToEnum);

  let result: any = { ...schema };

  if (result.const !== undefined) {
    result.enum = [String(result.const)];
    result.type = result.type || "string";
    delete result.const;
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = convertConstToEnum(value);
    }
  }

  return result;
}

/**
 * Phase 1c: Adds enum hints to description.
 * { enum: ["a", "b"] } → { ..., description: "(Allowed: a, b)" }
 */
function addEnumHints(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(addEnumHints);

  let result: any = { ...schema };

  if (Array.isArray(result.enum) && result.enum.length > 0) {
    const values = result.enum.slice(0, 10).join(", ");
    const suffix = result.enum.length > 10 ? ", ..." : "";
    result = appendDescriptionHint(result, `Allowed: ${values}${suffix}`);
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = addEnumHints(value);
    }
  }

  return result;
}

/**
 * Phase 1d: Adds additionalProperties hints.
 * { additionalProperties: false } → adds "(no extra properties)" to description
 */
function addAdditionalPropertiesHints(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(addAdditionalPropertiesHints);

  let result: any = { ...schema };

  if (result.additionalProperties === false) {
    result = appendDescriptionHint(result, "no extra properties");
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = addAdditionalPropertiesHints(value);
    }
  }

  return result;
}

/**
 * Phase 1e: Moves unsupported constraints to description hints.
 * { minLength: 1 } → { ..., description: "(minLength: 1)" }
 */
function moveConstraintsToDescription(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(moveConstraintsToDescription);

  let result: any = { ...schema };

  for (const constraint of UNSUPPORTED_CONSTRAINTS) {
    if (result[constraint] !== undefined) {
      result = appendDescriptionHint(result, `${constraint}: ${result[constraint]}`);
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = moveConstraintsToDescription(value);
    }
  }

  return result;
}

// =============================================================================
// Phase 2: Flatten Complex Structures
// =============================================================================

/**
 * Phase 2a: Merges allOf schemas into a single object.
 */
function mergeAllOf(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(mergeAllOf);

  let result: any = { ...schema };

  if (Array.isArray(result.allOf) && result.allOf.length > 0) {
    const merged: any = {};
    const allRequired: string[] = [];

    for (const sub of result.allOf) {
      const processed = mergeAllOf(sub);
      if (processed.properties) {
        merged.properties = { ...merged.properties, ...processed.properties };
      }
      if (Array.isArray(processed.required)) {
        allRequired.push(...processed.required);
      }
      if (!merged.type && processed.type) {
        merged.type = processed.type;
      }
      if (processed.description && !merged.description) {
        merged.description = processed.description;
      }
    }

    const { allOf: _, ...rest } = result;
    result = { ...rest, ...merged };

    if (allRequired.length > 0) {
      result.required = [...new Set([...(result.required || []), ...allRequired])];
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = mergeAllOf(value);
    }
  }

  return result;
}

/**
 * Scores a schema option for selection in anyOf/oneOf flattening.
 */
function scoreSchemaOption(schema: any): { score: number; typeName: string } {
  if (!schema || typeof schema !== "object") {
    return { score: 0, typeName: "unknown" };
  }

  const type = schema.type;

  if (type === "object" || schema.properties) return { score: 3, typeName: "object" };
  if (type === "array" || schema.items) return { score: 2, typeName: "array" };
  if (type && type !== "null") return { score: 1, typeName: type };

  return { score: 0, typeName: type || "null" };
}

/**
 * Checks if anyOf/oneOf represents enum choices.
 */
function tryMergeEnumFromUnion(options: any[]): string[] | null {
  if (!Array.isArray(options) || options.length === 0) return null;

  const enumValues: string[] = [];

  for (const option of options) {
    if (!option || typeof option !== "object") return null;

    if (option.const !== undefined) {
      enumValues.push(String(option.const));
      continue;
    }

    if (Array.isArray(option.enum) && option.enum.length >= 1) {
      for (const val of option.enum) {
        enumValues.push(String(val));
      }
      continue;
    }

    if (option.properties || option.items || option.anyOf || option.oneOf || option.allOf) {
      return null;
    }

    if (option.type && !option.const && !option.enum) {
      return null;
    }
  }

  return enumValues.length > 0 ? enumValues : null;
}

/**
 * Phase 2b: Flattens anyOf/oneOf to the best option with type hints.
 */
function flattenAnyOfOneOf(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(flattenAnyOfOneOf);

  let result: any = { ...schema };

  for (const unionKey of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(result[unionKey]) && result[unionKey].length > 0) {
      const options = result[unionKey];
      const parentDesc = typeof result.description === "string" ? result.description : "";

      // Check for enum pattern
      const mergedEnum = tryMergeEnumFromUnion(options);
      if (mergedEnum !== null) {
        const { [unionKey]: _, ...rest } = result;
        result = { ...rest, type: "string", enum: mergedEnum };
        if (parentDesc) result.description = parentDesc;
        continue;
      }

      // Select best option
      let bestIdx = 0;
      let bestScore = -1;
      const allTypes: string[] = [];

      for (let i = 0; i < options.length; i++) {
        const { score, typeName } = scoreSchemaOption(options[i]);
        if (typeName) allTypes.push(typeName);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      let selected = flattenAnyOfOneOf(options[bestIdx]) || { type: "string" };

      if (parentDesc) {
        const childDesc = typeof selected.description === "string" ? selected.description : "";
        if (childDesc && childDesc !== parentDesc) {
          selected = { ...selected, description: `${parentDesc} (${childDesc})` };
        } else if (!childDesc) {
          selected = { ...selected, description: parentDesc };
        }
      }

      if (allTypes.length > 1) {
        const uniqueTypes = Array.from(new Set(allTypes));
        selected = appendDescriptionHint(selected, `Accepts: ${uniqueTypes.join(" | ")}`);
      }

      const { [unionKey]: _, description: __, ...rest } = result;
      result = { ...rest, ...selected };
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = flattenAnyOfOneOf(value);
    }
  }

  return result;
}

/**
 * Phase 2c: Flattens type arrays to single type with hints.
 * { type: ["string", "null"] } → { type: "string", description: "(nullable)" }
 */
function flattenTypeArrays(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(flattenTypeArrays);

  let result: any = { ...schema };

  if (Array.isArray(result.type)) {
    const types = result.type as string[];
    const hasNull = types.includes("null");
    const nonNullTypes = types.filter((t: string) => t !== "null" && t);

    result.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";

    if (nonNullTypes.length > 1) {
      result = appendDescriptionHint(result, `Accepts: ${nonNullTypes.join(" | ")}`);
    }

    if (hasNull) {
      result = appendDescriptionHint(result, "nullable");
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = flattenTypeArrays(value);
    }
  }

  return result;
}

// =============================================================================
// Phase 3: Cleanup
// =============================================================================

/**
 * Phase 3a: Removes unsupported keywords after hints extracted.
 */
function removeUnsupportedKeywords(schema: any, insideProperties = false): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((item) => removeUnsupportedKeywords(item, false));

  const result: any = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!insideProperties && (UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) {
      continue;
    }

    if (typeof value === "object" && value !== null) {
      if (key === "properties") {
        const propertiesResult: any = {};
        for (const [propName, propSchema] of Object.entries(value as object)) {
          propertiesResult[propName] = removeUnsupportedKeywords(propSchema, false);
        }
        result[key] = propertiesResult;
      } else {
        result[key] = removeUnsupportedKeywords(value, false);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Phase 3b: Cleans up required fields - removes entries that don't exist in properties.
 */
function cleanupRequiredFields(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(cleanupRequiredFields);

  let result: any = { ...schema };

  if (
    Array.isArray(result.required) &&
    result.properties &&
    typeof result.properties === "object"
  ) {
    const validRequired = result.required.filter((req: string) =>
      Object.prototype.hasOwnProperty.call(result.properties, req)
    );
    if (validRequired.length === 0) {
      delete result.required;
    } else if (validRequired.length !== result.required.length) {
      result.required = validRequired;
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = cleanupRequiredFields(value);
    }
  }

  return result;
}

// =============================================================================
// Phase 4: Empty Schema Placeholder
// =============================================================================

/**
 * Phase 4: Adds placeholder property for empty object schemas.
 */
function addEmptySchemaPlaceholder(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(addEmptySchemaPlaceholder);

  let result: any = { ...schema };

  const isObjectType = result.type === "object" || result.type === "OBJECT";

  if (isObjectType) {
    const hasProperties =
      result.properties &&
      typeof result.properties === "object" &&
      Object.keys(result.properties).length > 0;

    if (!hasProperties) {
      result.properties = {
        [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
          type: "BOOLEAN",
          description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
        },
      };
      result.required = [EMPTY_SCHEMA_PLACEHOLDER_NAME];
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "object" && value !== null) {
      result[key] = addEmptySchemaPlaceholder(value);
    }
  }

  return result;
}

// =============================================================================
// Phase 5: Gemini Format (Type Uppercasing)
// =============================================================================

/**
 * Phase 5: Convert to Gemini format (uppercase types, ensure array items).
 */
function toGeminiFormat(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiFormat);

  const result: any = {};

  // Collect property names for required validation
  const propertyNames = new Set<string>();
  if (schema.properties && typeof schema.properties === "object") {
    for (const propName of Object.keys(schema.properties)) {
      propertyNames.add(propName);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") {
      result[key] = value.toUpperCase();
    } else if (key === "properties" && typeof value === "object" && value !== null) {
      const props: any = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = toGeminiFormat(propSchema);
      }
      result[key] = props;
    } else if (key === "items" && typeof value === "object") {
      result[key] = toGeminiFormat(value);
    } else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      // Should have been flattened already, but handle just in case
      result[key] = value.map(toGeminiFormat);
    } else if (key === "required" && Array.isArray(value)) {
      // Filter required to only include existing properties
      if (propertyNames.size > 0) {
        const validRequired = value.filter(
          (prop: string) => typeof prop === "string" && propertyNames.has(prop)
        );
        if (validRequired.length > 0) {
          result[key] = validRequired;
        }
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  // Ensure array schemas have items field
  if (result.type === "ARRAY" && !result.items) {
    result.items = { type: "STRING" };
  }

  return result;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main entry point to clean a schema for Antigravity API compatibility.

 */
export function cleanSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "STRING" };
  }

  let result = schema;

  // Phase 1: Convert and add hints
  result = convertRefsToHints(result);
  result = convertConstToEnum(result);
  result = addEnumHints(result);
  result = addAdditionalPropertiesHints(result);
  result = moveConstraintsToDescription(result);

  // Phase 2: Flatten complex structures
  result = mergeAllOf(result);
  result = flattenAnyOfOneOf(result);
  result = flattenTypeArrays(result);

  // Phase 3: Cleanup
  result = removeUnsupportedKeywords(result);
  result = cleanupRequiredFields(result);

  // Phase 4: Add placeholder for empty object schemas
  result = addEmptySchemaPlaceholder(result);

  // Phase 5: Convert to Gemini format (uppercase types)
  result = toGeminiFormat(result);

  return result as Record<string, unknown>;
}

/**
 * Alias for compatibility with import paths
 */
export const cleanJSONSchemaForAntigravity = cleanSchema;
