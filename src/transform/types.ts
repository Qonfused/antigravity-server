/** @file
  Transform Types

  Shared types for request/response transformation.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

// =============================================================================
// OpenAI Types (Target Interface)
// =============================================================================

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; // JSON Schema
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
}

// =============================================================================
// Antigravity Types (Internal API)
// =============================================================================

export interface AntigravityPart {
  text?: string;
  thought?: boolean; // For thinking blocks
  thoughtSignature?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface AntigravityContent {
  role: "user" | "model" | "system"; // Mapped from OpenAI roles
  parts: AntigravityPart[];
}

export interface AntigravityTool {
  functionDeclarations?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }[];
  googleSearch?: Record<string, unknown>; // For grounding
}

export interface AntigravityRequest {
  contents: AntigravityContent[];
  systemInstruction?: { parts: AntigravityPart[] };
  tools?: AntigravityTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode: "ANY" | "NONE" | "AUTO";
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    stopSequences?: string[];
    candidateCount?: number;
    thinkingConfig?: {
      includeThoughts?: boolean;
      thinkingLevel?: "low" | "medium" | "high"; // Gemini 3
      thinkingBudget?: number; // Gemini 2.5 / Claude
    };
  };
}
