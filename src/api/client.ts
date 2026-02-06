/** @file
  Antigravity API Client

  Makes authenticated requests to the Antigravity (Google Code Assist) API.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { loadTokens, saveTokens } from "../auth/storage.js";
import { refreshAccessToken, isTokenExpired } from "../auth/token.js";
import type { AntigravityRequest } from "../transform/types.js";
import { ANTIGRAVITY_ENDPOINTS, ANTIGRAVITY_HEADERS, FETCH_TIMEOUT_MS, ANTIGRAVITY_API_VERSION } from "../constants.js";

export interface APIClientOptions {
  stream?: boolean;
}

/**
 * Get valid access token, refreshing if needed.
 */
async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error("Not authenticated. Run 'bun run auth' first.");
  }

  if (isTokenExpired(tokens.expiresAt)) {
    console.log("[api] Refreshing expired token...");
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    await saveTokens({
      ...tokens,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  }

  return tokens.accessToken;
}

/**
 * Build request headers for Antigravity API.
 */
function buildHeaders(accessToken: string, options: APIClientOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...ANTIGRAVITY_HEADERS,
  };

  if (options.stream) {
    headers["Accept"] = "text/event-stream";
  }

  return headers;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a chat completion request to Antigravity.
 * Uses v1internal:generateContent or v1internal:streamGenerateContent?alt=sse
 */
export async function sendChatRequest(
  model: string,
  request: AntigravityRequest,
  options: APIClientOptions = {}
): Promise<Response> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error("Not authenticated");
  }

  const accessToken = await getValidAccessToken();
  const projectId = tokens.projectId;

  if (!projectId) {
    throw new Error("Missing project ID. Run 'bun run auth' to re-authenticate.");
  }

  const headers = buildHeaders(accessToken, options);

  // Antigravity API request envelope
  const body = {
    project: projectId,
    model: model,
    request: request,
    userAgent: "antigravity-server",
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };

  const action = options.stream ? "streamGenerateContent" : "generateContent";
  const queryString = options.stream ? "?alt=sse" : "";

  // Try endpoints in priority order (daily → autopush → prod)
  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const url = `${endpoint}/${ANTIGRAVITY_API_VERSION}:${action}${queryString}`;
      console.log(`[api] Trying ${endpoint}/${action}...`);

      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        options.stream ? 300_000 : FETCH_TIMEOUT_MS // 5 min timeout for streaming
      );

      // Return first successful response
      if (response.ok || response.status === 429) {
        return response;
      }

      // Log the error for debugging
      const errorText = await response.text().catch(() => "");
      console.log(`[api] ${endpoint} returned ${response.status}: ${errorText.slice(0, 200)}`);
    } catch (error) {
      console.log(`[api] ${endpoint} failed: ${error}, trying next...`);
      continue;
    }
  }

  throw new Error("All Antigravity endpoints failed");
}

/**
 * Fetch available models from Antigravity.
 */
export async function fetchModels(): Promise<any> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error("Not authenticated");
  }

  const accessToken = await getValidAccessToken();
  const projectId = tokens.projectId;

  if (!projectId) {
    throw new Error("Missing project ID. Run 'bun run auth' to re-authenticate.");
  }

  const headers = buildHeaders(accessToken);

  // Try each endpoint
  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const url = `${endpoint}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;
      console.log(`[models] Trying ${endpoint}...`);

      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
      });

      if (!response.ok) {
        console.log(`[models] ${endpoint} returned ${response.status}, trying next...`);
        continue;
      }

      return response.json();
    } catch (error) {
      console.log(`[models] ${endpoint} failed: ${error}, trying next...`);
      continue;
    }
  }

  throw new Error("All Antigravity endpoints failed");
}
