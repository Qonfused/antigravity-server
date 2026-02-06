/** @file
  OpenAI to Gemini Request Transformer

  Converts OpenAI Chat Completions requests into Antigravity API requests.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { cleanSchema } from "./schema-cleaner.js";
import type {
  OpenAIRequest,
  OpenAIMessage,
  OpenAITool,
  AntigravityRequest,
  AntigravityContent,
  AntigravityPart,
  AntigravityTool,
} from "./types.js";

/**
 * Main entry point to transform a request.
 */
export function transformRequest(request: OpenAIRequest): AntigravityRequest {
  const result: AntigravityRequest = {
    contents: [],
  };

  // Extract system message into separate field
  const systemMessage = request.messages.find((m) => m.role === "system");
  if (systemMessage) {
    result.systemInstruction = {
      parts: [{ text: extractText(systemMessage.content) }],
    };
  }

  // Transform conversation messages (Antigravity requires alternating user/model roles)
  for (const msg of request.messages) {
    if (msg.role === "system") continue;
    const content = transformMessage(msg);
    if (content) {
      // If the last message has the same role, merge parts
      const last = result.contents[result.contents.length - 1];
      if (last && last.role === content.role) {
        last.parts.push(...content.parts);
      } else {
        result.contents.push(content);
      }
    }
  }

  // Transform function/tool declarations
  if (request.tools && request.tools.length > 0) {
    result.tools = transformTools(request.tools);
  }

  // Map tool_choice: OpenAI uses "auto"/"none"/"required", Antigravity uses "AUTO"/"NONE"/"ANY"
  if (request.tool_choice) {
    if (!result.toolConfig) {
      result.toolConfig = {};
    }

    if (request.tool_choice === "auto") {
      result.toolConfig.functionCallingConfig = { mode: "AUTO" };
    } else if (request.tool_choice === "none") {
      result.toolConfig.functionCallingConfig = { mode: "NONE" };
    } else if (request.tool_choice === "required") {
      result.toolConfig.functionCallingConfig = { mode: "ANY" };
    } else if (typeof request.tool_choice === "object" && request.tool_choice.type === "function") {
      // Specific function
      result.toolConfig.functionCallingConfig = {
        mode: "ANY",
        allowedFunctionNames: [request.tool_choice.function.name],
      };
    }
  }

  // Build generation config
  result.generationConfig = {
    temperature: request.temperature,
    maxOutputTokens: request.max_tokens,
    topP: request.top_p,
    stopSequences: Array.isArray(request.stop)
      ? request.stop
      : request.stop
        ? [request.stop]
        : undefined,
    candidateCount: 1,
  };

  // Enable thinking for supported models (Gemini 3 uses thinkingLevel, Gemini 2.5/Claude use thinkingBudget)
  const lowerModel = request.model.toLowerCase();
  const isThinkingModel =
    lowerModel.includes("thinking") ||
    lowerModel.includes("gemini-3") ||
    lowerModel.includes("opus");
  const isGemini3 = lowerModel.includes("gemini-3");
  const isGemini25 = lowerModel.includes("gemini-2.5");

  if (isThinkingModel && !result.generationConfig.thinkingConfig) {
    if (isGemini3) {
      // Gemini 3 uses thinkingLevel string
      result.generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: "medium" as any, // Default thinking level
      };
    } else if (isGemini25) {
      // Gemini 2.5 uses numeric thinkingBudget
      result.generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: 16000 as any, // Default budget
      };
    } else {
      // Claude or other thinking models
      result.generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: 16000 as any,
      };
    }

    // Boost token limit for thinking if low
    if (
      !result.generationConfig.maxOutputTokens ||
      result.generationConfig.maxOutputTokens < 8192
    ) {
      result.generationConfig.maxOutputTokens = 65535;
    }
  }

  return result;
}

function transformMessage(msg: OpenAIMessage): AntigravityContent | null {
  const parts: AntigravityPart[] = [];

  // Handle Text/Image Content
  if (msg.content) {
    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text });
        }
        // TODO: Image support (requires base64 conversion)
      }
    }
  }

  // Handle Tool Calls (Assistant requesting execution)
  if (msg.role === "assistant" && msg.tool_calls) {
    for (const call of msg.tool_calls) {
      if (call.type === "function") {
        try {
          parts.push({
            functionCall: {
              name: call.function.name,
              args: JSON.parse(call.function.arguments),
            },
          });
        } catch {
          // Fallback if args are invalid JSON
          parts.push({
            functionCall: {
              name: call.function.name,
              args: {},
            },
          });
        }
      }
    }
  }

  // Handle Tool Responses
  // The Antigravity API expects functionResponse inside a "user" role message.
  // OpenAI's "tool" role maps to this pattern. We require msg.name to be set since
  // Antigravity needs the function name but OpenAI only provides tool_call_id.
  if (msg.role === "tool" && msg.tool_call_id) {
    const name = msg.name || "unknown_tool";

    let responseObj: Record<string, unknown> = {};
    try {
      if (typeof msg.content === "string") {
        responseObj = JSON.parse(msg.content);
      } else {
        responseObj = { content: msg.content };
      }
    } catch {
      responseObj = { content: msg.content };
    }

    parts.push({
      functionResponse: {
        name: name,
        response: responseObj,
      },
    });

    return { role: "user", parts };
  }

  // Map Roles
  // user -> user
  // assistant -> model
  // system -> handled separately (but if appears mid-stream, map to user or system?)
  // tool -> user (with functionResponse)

  let role: "user" | "model" | "system" = "user";
  if (msg.role === "assistant") role = "model";
  if (msg.role === "system") role = "system";

  if (parts.length === 0) return null;

  return { role, parts };
}

function transformTools(tools: OpenAITool[]): AntigravityTool[] {
  const declarations = tools
    .map((tool) => {
      if (tool.type !== "function") return null;
      return {
        name: tool.function.name,
        description: tool.function.description,
        parameters: cleanSchema(tool.function.parameters),
      };
    })
    .filter((t) => t !== null) as NonNullable<(typeof tools)[0]["function"]>[];

  if (declarations.length === 0) return [];

  return [
    {
      functionDeclarations: declarations,
    },
  ];
}

function extractText(content: string | any[] | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => p.text || "").join("\n");
  }
  return "";
}
