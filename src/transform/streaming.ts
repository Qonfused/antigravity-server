/** @file
  Streaming Transformer

  Handles SSE response parsing and transformation from Antigravity -> OpenAI.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import type { AntigravityPart } from "./types.js";

// =============================================================================
// SSE Parser
// =============================================================================

export interface SSEParsedEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export function parseSSEChunk(chunk: string): SSEParsedEvent[] {
  const events: SSEParsedEvent[] = [];
  const lines = chunk.split(/\r?\n/);

  let currentEvent: Partial<SSEParsedEvent> = {};

  for (const line of lines) {
    if (line.trim() === "") {
      // Empty line = dispatch event
      if (currentEvent.data) {
        events.push(currentEvent as SSEParsedEvent);
      }
      currentEvent = {};
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const field = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trimStart();

    if (field === "data") {
      currentEvent.data = (currentEvent.data ? currentEvent.data + "\n" : "") + value;
    } else if (field === "event") {
      currentEvent.event = value;
    } else if (field === "id") {
      currentEvent.id = value;
    }
  }

  // Handle trailing event without empty line
  if (currentEvent.data) {
    events.push(currentEvent as SSEParsedEvent);
  }

  return events;
}

// =============================================================================
// Output Transformer
// =============================================================================

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: string | null;
  }[];
}

export interface TransformState {
  id: string;
  created: number;
  model: string;
  hasEmittedRole: boolean;
  toolCallIndex: number;
  lastThoughtSignature?: string;
}

export function createTransformState(model: string): TransformState {
  return {
    id: `chatcmpl-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model,
    hasEmittedRole: false,
    toolCallIndex: 0,
  };
}

export function transformAntigravityEvent(
  event: SSEParsedEvent,
  state: TransformState
): OpenAIStreamChunk[] {
  // Antigravity sends JSON data usually: { candidates: [...] }
  // or specialized event types
  if (!event.data || event.data === "[DONE]") return [];

  let payload: any;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return [];
  }

  const chunks: OpenAIStreamChunk[] = [];

  // Antigravity wraps streaming in response object: { response: { candidates: [...] }, traceId }
  const inner = payload.response || payload;
  const candidate = inner.candidates?.[0];

  if (!candidate) return [];

  // 1. Emit Role if needed
  if (!state.hasEmittedRole) {
    chunks.push({
      id: state.id,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    });
    state.hasEmittedRole = true;
  }

  // 2. Process Parts
  if (candidate.content && candidate.content.parts) {
    for (const part of candidate.content.parts) {
      // Text content (thoughts are emitted as regular content since OpenAI has no native thinking field)
      if (part.text) {
        chunks.push({
          id: state.id,
          object: "chat.completion.chunk",
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: { content: part.text },
              finish_reason: null,
            },
          ],
        });
      }

      // Capture thinking signature for potential cache restoration (not emitted to client)
      if (part.thoughtSignature) {
        state.lastThoughtSignature = part.thoughtSignature;
      }

      // Function Calls
      if (part.functionCall) {
        chunks.push({
          id: state.id,
          object: "chat.completion.chunk",
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: state.toolCallIndex,
                    id: `call_${Date.now()}_${state.toolCallIndex}`,
                    type: "function",
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        state.toolCallIndex++;
      }
    }
  }

  // 3. Finish Reason
  if (candidate.finishReason) {
    const reason = mapFinishReason(candidate.finishReason);
    chunks.push({
      id: state.id,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: reason,
        },
      ],
    });
  }

  return chunks;
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
      return "stop"; // Fallback
    default:
      return null;
  }
}
