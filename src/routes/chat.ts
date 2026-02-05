/** @file
  Chat Completions Route

  POST /v1/chat/completions - OpenAI-compatible chat completions endpoint.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { sendChatRequest } from "../api/client.js";
import { checkModelQuota } from "../api/quota-protection.js";
import { loadTokens } from "../auth/storage.js";
import { transformRequest } from "../transform/openai-to-gemini.js";
import { transformResponse } from "../transform/gemini-to-openai.js";
import {
  parseSSEChunk,
  transformAntigravityEvent,
  createTransformState,
} from "../transform/streaming.js";
import type { OpenAIRequest } from "../transform/types.js";

const chat = new Hono();

// Model name mapping from OpenAI-style to Antigravity internal names
const MODEL_MAPPINGS: Record<string, string> = {
  // Claude models
  "claude-3-5-sonnet-20241022": "claude-3-5-sonnet@20241022",
  "claude-3-5-sonnet-v2-20241022": "claude-3-5-sonnet-v2@20241022",
  "claude-sonnet-4-20250514": "claude-sonnet-4@20250514",
  "claude-sonnet-4.5-20250514": "claude-sonnet-4-5@20250514",
  "claude-opus-4.5-20250514": "claude-opus-4-5-20250514",
  // Convenience aliases
  "claude-sonnet-4.5": "claude-sonnet-4-5@20250514",
  "claude-sonnet-4": "claude-sonnet-4@20250514",
  "claude-opus-4.5": "claude-opus-4-5-20250514",
  // Gemini models (pass through)
  "gemini-2.5-flash": "gemini-2.5-flash",
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-3-flash": "gemini-3-flash",
  "gemini-3-pro": "gemini-3-pro-high",
};

function resolveModel(model: string): string {
  return MODEL_MAPPINGS[model] || model;
}

chat.post("/", async (c) => {
  try {
    const body = await c.req.json<OpenAIRequest>();

    // Resolve model name
    const antigravityModel = resolveModel(body.model);

    // 🛡️ Soft Quota Protection: Check if model is over threshold
    const tokens = await loadTokens();
    if (tokens?.accessToken && tokens?.projectId) {
      const quotaCheck = await checkModelQuota(
        antigravityModel,
        tokens.accessToken,
        tokens.projectId
      );

      if (!quotaCheck.allowed) {
        return c.json(
          {
            error: {
              message: quotaCheck.reason || "Quota exceeded",
              type: "quota_exceeded",
              code: "soft_quota_protection",
              reset_time: quotaCheck.resetTime,
              remaining_percent: quotaCheck.remainingPercent,
            },
          },
          429
        );
      }
    }

    // Transform request to Antigravity format
    const antigravityRequest = transformRequest({
      ...body,
      model: antigravityModel,
    });

    // Handle streaming vs non-streaming
    if (body.stream) {
      return handleStreamingRequest(c, antigravityModel, antigravityRequest, body.model);
    } else {
      return handleNonStreamingRequest(c, antigravityModel, antigravityRequest, body.model);
    }
  } catch (error: any) {
    console.error("[chat] Error:", error);
    return c.json(
      {
        error: {
          message: error.message || "Internal server error",
          type: "server_error",
          code: "internal_error",
        },
      },
      500
    );
  }
});

async function handleNonStreamingRequest(
  c: any,
  model: string,
  request: any,
  originalModel: string
) {
  const response = await sendChatRequest(model, request, { stream: false });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[chat] API error:", response.status, errorBody);
    return c.json(
      {
        error: {
          message: `Antigravity API error: ${response.status}`,
          type: "api_error",
          code: "upstream_error",
        },
      },
      response.status as any
    );
  }

  const antigravityResponse = await response.json();
  const openaiResponse = transformResponse(antigravityResponse, originalModel);

  return c.json(openaiResponse);
}

async function handleStreamingRequest(c: any, model: string, request: any, originalModel: string) {
  const response = await sendChatRequest(model, request, { stream: true });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[chat] Streaming API error:", response.status, errorBody);
    return c.json(
      {
        error: {
          message: `Antigravity API error: ${response.status}`,
          type: "api_error",
          code: "upstream_error",
        },
      },
      response.status as any
    );
  }

  // Set SSE headers
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (streamWriter) => {
    const state = createTransformState(originalModel);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    if (!reader) {
      await streamWriter.write("data: [DONE]\n\n");
      return;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Flush any remaining buffer
          if (buffer.trim()) {
            const events = parseSSEChunk(buffer);
            for (const event of events) {
              const chunks = transformAntigravityEvent(event, state);
              for (const chunk of chunks) {
                await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete events (split by double newline)
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || ""; // Keep incomplete part in buffer

        for (const part of parts) {
          if (!part.trim()) continue;

          const events = parseSSEChunk(part + "\n\n");
          for (const event of events) {
            const chunks = transformAntigravityEvent(event, state);
            for (const chunk of chunks) {
              await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }
        }
      }
    } catch (error) {
      console.error("[chat] Stream error:", error);
    } finally {
      await streamWriter.write("data: [DONE]\n\n");
      reader.releaseLock();
    }
  });
}

export default chat;
