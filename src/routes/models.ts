/** @file
  Models Route

  GET /v1/models - List available models in OpenAI format.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { Hono } from "hono";
import { fetchModels } from "../api/client.js";

const models = new Hono();

// Model name mapping from Antigravity to OpenAI-style IDs
const MODEL_MAPPINGS: Record<string, string> = {
  "claude-3-5-sonnet@20241022": "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-v2@20241022": "claude-3-5-sonnet-v2-20241022",
  "claude-sonnet-4@20250514": "claude-sonnet-4-20250514",
  "claude-sonnet-4-5@20250514": "claude-sonnet-4.5-20250514",
  "claude-opus-4-5-20250514": "claude-opus-4.5-20250514",
};

interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

models.get("/", async (c) => {
  try {
    const response = await fetchModels();
    const antigravityModels = response.models || {};

    const openaiModels: OpenAIModel[] = Object.entries(antigravityModels).map(
      ([modelId, modelData]: [string, any]) => {
        // Use mapping if available, otherwise clean up the ID
        const cleanId = MODEL_MAPPINGS[modelId] || modelId.replace(/@/g, "-");

        return {
          id: cleanId,
          object: "model" as const,
          created: Math.floor(Date.now() / 1000),
          owned_by: modelData.displayName?.includes("Claude") ? "anthropic" : "google",
        };
      }
    );

    return c.json({
      object: "list",
      data: openaiModels,
    });
  } catch (error: any) {
    console.error("[models] Error fetching models:", error);
    return c.json(
      {
        error: {
          message: error.message || "Failed to fetch models",
          type: "server_error",
          code: "internal_error",
        },
      },
      500
    );
  }
});

export default models;
