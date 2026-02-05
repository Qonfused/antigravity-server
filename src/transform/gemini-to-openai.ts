/** @file
  Gemini to OpenAI Response Transformer (Non-streaming)

  Converts Antigravity API responses into OpenAI Chat Completion responses.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { cleanSchema } from "./schema-cleaner.js";
import type { OpenAIStreamChunk } from "./streaming.js";

// OpenAI Response Types
export interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Transform a full non-streaming response.
 */
export function transformResponse(antigravityResponse: any, model: string): OpenAIResponse {
  // Antigravity wraps response: { response: { candidates: [...] }, traceId: "..." }
  const inner = antigravityResponse.response || antigravityResponse;
  const candidate = inner.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let content = "";
  const toolCalls: any[] = [];

  for (const part of parts) {
    if (part.text) {
      content += part.text;
    }

    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      });
    }
  }

  const finishReason = mapFinishReason(candidate?.finishReason);

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: finishReason,
      },
    ],
    // Usage is not typically provided by Antigravity v1internal
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function mapFinishReason(reason: string): string | null {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    case "RECITATION":
      return "content_filter";
    case "OTHER":
      return "stop";
    default:
      return "stop"; // Default to stop if unknown
  }
}
