/** @file
  OAuth Module

  Implements PKCE OAuth flow for Google Antigravity.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import * as crypto from "node:crypto";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_ENDPOINTS,
  ANTIGRAVITY_HEADERS,
  FETCH_TIMEOUT_MS,
  ANTIGRAVITY_API_VERSION,
} from "../constants.js";
import type { AuthorizationResult, TokenExchangeResult, TokenData } from "../types.js";

// =============================================================================
// PKCE Helpers
// =============================================================================

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(hash);
}

// =============================================================================
// State Encoding
// =============================================================================

interface AuthState {
  verifier: string;
  projectId: string;
}

function encodeState(payload: AuthState): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state: string): AuthState {
  // Normalize base64url to base64
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(json);

  if (typeof parsed.verifier !== "string") {
    throw new Error("Missing PKCE verifier in state");
  }

  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
  };
}

// =============================================================================
// OAuth Flow
// =============================================================================

/**
 * Build the OAuth authorization URL for Antigravity.
 */
export async function buildAuthorizationUrl(projectId = ""): Promise<AuthorizationResult> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = encodeState({ verifier, projectId });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return {
    url: url.toString(),
    verifier,
    state,
  };
}

// =============================================================================
// Token Exchange
// =============================================================================

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
 * Fetch the managed project ID from Antigravity.
 */
async function fetchProjectId(accessToken: string): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...ANTIGRAVITY_HEADERS,
  };

  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(`${endpoint}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as any;

      // Handle both string and object responses
      if (typeof data.cloudaicompanionProject === "string") {
        return data.cloudaicompanionProject;
      }
      if (data.cloudaicompanionProject?.id) {
        return data.cloudaicompanionProject.id;
      }
    } catch {
      continue;
    }
  }

  return "";
}

/**
 * Fetch user email from Google userinfo API.
 */
async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...ANTIGRAVITY_HEADERS,
      },
    });

    if (!response.ok) return undefined;
    const data = (await response.json()) as any;
    return data.email;
  } catch {
    return undefined;
  }
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(code: string, state: string): Promise<TokenExchangeResult> {
  try {
    const { verifier, projectId: stateProjectId } = decodeState(state);
    const startTime = Date.now();

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "*/*",
        ...ANTIGRAVITY_HEADERS,
      },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: ANTIGRAVITY_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { type: "failed", error: errorText };
    }

    const payload = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token: string;
    };

    if (!payload.refresh_token) {
      return { type: "failed", error: "Missing refresh token in response" };
    }

    // Fetch user info and project ID in parallel
    const [email, projectId] = await Promise.all([
      fetchUserEmail(payload.access_token),
      stateProjectId || fetchProjectId(payload.access_token),
    ]);

    const tokenData: TokenData = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: startTime + payload.expires_in * 1000,
      email,
      projectId,
    };

    return { type: "success", data: tokenData };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
