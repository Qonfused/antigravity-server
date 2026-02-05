/** @file
  Token Management Module

  Handles token refresh and expiry checking.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ACCESS_TOKEN_EXPIRY_BUFFER_MS,
} from "../constants.js";
import type { RefreshResult, TokenData } from "../types.js";

/**
 * Check if a token is expired (with buffer for clock skew).
 */
export function isTokenExpired(expiresAt: number): boolean {
  return expiresAt <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Refresh an access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const startTime = Date.now();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Token refresh failed (${response.status})`;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error === "invalid_grant") {
        throw new Error("Refresh token has been revoked. Please re-authenticate.");
      }
      if (errorJson.error_description) {
        errorMessage += `: ${errorJson.error_description}`;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("revoked")) throw e;
    }

    throw new Error(errorMessage);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  return {
    accessToken: payload.access_token,
    expiresAt: startTime + payload.expires_in * 1000,
    refreshToken: payload.refresh_token, // May be rotated
  };
}

/**
 * Ensure we have a valid access token, refreshing if necessary.
 */
export async function ensureValidToken(tokenData: TokenData): Promise<TokenData> {
  if (!isTokenExpired(tokenData.expiresAt)) {
    return tokenData;
  }

  console.log("Access token expired, refreshing...");
  const refreshed = await refreshAccessToken(tokenData.refreshToken);

  return {
    ...tokenData,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshed.refreshToken ?? tokenData.refreshToken,
  };
}
