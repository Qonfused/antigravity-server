/** @file
  Google Search Tool

  Enables Gemini models to access real-time web information via Google Search grounding.

  IMPORTANT LIMITATIONS:
  - googleSearch tool CANNOT be combined with functionDeclarations in the same request
  - This requires a SEPARATE API call when other tools are present
  - Only works with Gemini models (not Claude)

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { loadTokens } from "../auth/storage.js";
import { refreshAccessToken, isTokenExpired } from "../auth/token.js";
import { ANTIGRAVITY_ENDPOINTS, ANTIGRAVITY_HEADERS } from "../constants.js";

// =============================================================================
// Constants
// =============================================================================

const SEARCH_MODEL = "gemini-3-flash";
const SEARCH_TIMEOUT_MS = 60000;

const SEARCH_SYSTEM_INSTRUCTION = `You are an expert web search assistant with access to Google Search and URL analysis tools.

Your capabilities:
- Use google_search to find real-time information from the web
- Use url_context to fetch and analyze content from specific URLs when provided

Guidelines:
- Always provide accurate, well-sourced information
- Cite your sources when presenting facts
- If analyzing URLs, extract the most relevant information
- Be concise but comprehensive in your responses
- If information is uncertain or conflicting, acknowledge it
- Focus on answering the user's question directly`;

// =============================================================================
// Types
// =============================================================================

export interface SearchRequest {
  query: string;
  urls?: string[]; // Optional URLs to analyze alongside search
  model?: string; // Default: gemini-3-flash
  thinking?: boolean; // Enable deep thinking (default: true)
}

export interface SearchResult {
  text: string;
  sources: { title: string; url: string }[];
  searchQueries: string[];
  urlsRetrieved: { url: string; status: string }[];
}

interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface UrlMetadata {
  retrieved_url?: string;
  url_retrieval_status?: string;
}

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GroundingChunk[];
  searchEntryPoint?: {
    renderedContent?: string;
  };
}

interface UrlContextMetadata {
  url_metadata?: UrlMetadata[];
}

interface AntigravitySearchResponse {
  response?: {
    candidates?: {
      content?: {
        parts?: { text?: string }[];
      };
      groundingMetadata?: GroundingMetadata;
      urlContextMetadata?: UrlContextMetadata;
    }[];
    error?: {
      code?: number;
      message?: string;
    };
  };
  error?: {
    code?: number;
    message?: string;
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

let sessionCounter = 0;
const sessionPrefix = `search-${Date.now().toString(36)}`;

function generateRequestId(): string {
  return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSessionId(): string {
  sessionCounter++;
  return `${sessionPrefix}-${sessionCounter}`;
}

// =============================================================================
// Search Implementation
// =============================================================================

/**
 * Execute a Google Search grounding request.
 * This makes a dedicated API call with only the googleSearch tool.
 */
export async function executeGoogleSearch(request: SearchRequest): Promise<SearchResult> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error("Not authenticated");
  }

  // Refresh token if needed
  let accessToken = tokens.accessToken;
  if (isTokenExpired(tokens.expiresAt)) {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    accessToken = refreshed.accessToken;
  }

  const projectId = tokens.projectId;
  if (!projectId) {
    throw new Error("Missing project ID");
  }

  const model = request.model || SEARCH_MODEL;
  const thinking = request.thinking !== false; // Default to true

  // Build prompt with optional URLs
  let prompt = request.query;
  if (request.urls && request.urls.length > 0) {
    const urlList = request.urls.join("\n");
    prompt = `${request.query}\n\nURLs to analyze:\n${urlList}`;
  }

  // Build tools array - only grounding tools, no function declarations
  const tools: Record<string, unknown>[] = [{ googleSearch: {} }];
  if (request.urls && request.urls.length > 0) {
    tools.push({ urlContext: {} });
  }

  // Build the request payload matching the reference implementation
  const requestPayload = {
    systemInstruction: {
      parts: [{ text: SEARCH_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    tools,
    generationConfig: {
      thinkingConfig: {
        thinkingLevel: thinking ? "high" : "low",
        includeThoughts: false,
      },
    },
  };

  // Wrap in Antigravity format
  const body = {
    project: projectId,
    model: model,
    userAgent: "antigravity-server",
    requestId: generateRequestId(),
    request: {
      ...requestPayload,
      sessionId: getSessionId(),
    },
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...ANTIGRAVITY_HEADERS,
  };

  // Try each endpoint
  let lastError = "";
  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      console.log(`[search] Trying ${endpoint}...`);
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.log(`[search] ${endpoint} returned ${response.status}: ${errorText.slice(0, 300)}`);
        lastError = `${response.status}: ${errorText.slice(0, 200)}`;
        continue;
      }

      const data = (await response.json()) as AntigravitySearchResponse;
      return parseSearchResponse(data);
    } catch (err) {
      console.log(`[search] ${endpoint} failed: ${err}`);
      lastError = String(err);
      continue;
    }
  }

  throw new Error(`All Antigravity endpoints failed for search. Last error: ${lastError}`);
}

/**
 * Parse the Antigravity response and extract search results.
 */
function parseSearchResponse(data: AntigravitySearchResponse): SearchResult {
  const result: SearchResult = {
    text: "",
    sources: [],
    searchQueries: [],
    urlsRetrieved: [],
  };

  const response = data.response;
  if (!response || !response.candidates || response.candidates.length === 0) {
    if (data.error) {
      result.text = `Error: ${data.error.message ?? "Unknown error"}`;
    } else if (response?.error) {
      result.text = `Error: ${response.error.message ?? "Unknown error"}`;
    }
    return result;
  }

  const candidate = response.candidates[0];
  if (!candidate) {
    return result;
  }

  // Extract text content
  if (candidate.content?.parts) {
    result.text = candidate.content.parts
      .map((p) => p.text ?? "")
      .filter(Boolean)
      .join("\n");
  }

  // Extract grounding metadata
  if (candidate.groundingMetadata) {
    const gm = candidate.groundingMetadata;

    if (gm.webSearchQueries) {
      result.searchQueries = gm.webSearchQueries;
    }

    if (gm.groundingChunks) {
      for (const chunk of gm.groundingChunks) {
        if (chunk.web?.uri && chunk.web?.title) {
          result.sources.push({
            title: chunk.web.title,
            url: chunk.web.uri,
          });
        }
      }
    }
  }

  // Extract URL context metadata
  if (candidate.urlContextMetadata?.url_metadata) {
    for (const meta of candidate.urlContextMetadata.url_metadata) {
      if (meta.retrieved_url) {
        result.urlsRetrieved.push({
          url: meta.retrieved_url,
          status: meta.url_retrieval_status ?? "UNKNOWN",
        });
      }
    }
  }

  return result;
}

/**
 * Format search results as markdown for display.
 */
export function formatSearchAsMarkdown(result: SearchResult): string {
  const lines: string[] = [];

  lines.push("## Search Results\n");
  lines.push(result.text);
  lines.push("");

  if (result.sources.length > 0) {
    lines.push("### Sources");
    for (const source of result.sources) {
      lines.push(`- [${source.title}](${source.url})`);
    }
    lines.push("");
  }

  if (result.urlsRetrieved.length > 0) {
    lines.push("### URLs Retrieved");
    for (const urlInfo of result.urlsRetrieved) {
      const status = urlInfo.status === "URL_RETRIEVAL_STATUS_SUCCESS" ? "✓" : "✗";
      lines.push(`- ${status} ${urlInfo.url}`);
    }
    lines.push("");
  }

  if (result.searchQueries.length > 0) {
    lines.push("### Search Queries Used");
    for (const q of result.searchQueries) {
      lines.push(`- "${q}"`);
    }
  }

  return lines.join("\n");
}
