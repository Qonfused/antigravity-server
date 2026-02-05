/** @file
  Quota Route

  Exposes quota information via API endpoint.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { Hono } from "hono";
import { loadTokens } from "../auth/storage.js";
import { refreshAccessToken, isTokenExpired } from "../auth/token.js";
import { fetchQuotaSummary } from "../api/quota.js";

const quota = new Hono();

/**
 * GET /v1/quota
 * Returns model quota information for the authenticated account.
 */
quota.get("/", async (c) => {
  try {
    const tokens = await loadTokens();
    if (!tokens) {
      return c.json(
        {
          error: {
            message: "Not authenticated. Run 'bun run auth' first.",
            type: "auth_error",
            code: "unauthenticated",
          },
        },
        401
      );
    }

    // Refresh token if needed
    let accessToken = tokens.accessToken;
    if (isTokenExpired(tokens.expiresAt)) {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      accessToken = refreshed.accessToken;
    }

    const projectId = tokens.projectId;
    if (!projectId) {
      return c.json(
        {
          error: {
            message: "Missing project ID",
            type: "auth_error",
            code: "missing_project",
          },
        },
        400
      );
    }

    // Fetch quota summary
    const summary = await fetchQuotaSummary(accessToken, projectId);

    // Transform to API response format
    const models: Record<
      string,
      {
        remainingFraction: number;
        resetTime: string | null;
        displayName: string;
      }
    > = {};

    for (const model of summary.models) {
      models[model.modelId] = {
        remainingFraction: model.remainingFraction,
        resetTime: model.resetTime || null,
        displayName: model.displayName || model.modelId,
      };
    }

    return c.json({
      object: "quota",
      account: tokens.email || "unknown",
      project: projectId,
      models,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[quota] Error:", error);
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Failed to fetch quota",
          type: "server_error",
          code: "internal_error",
        },
      },
      500
    );
  }
});

export default quota;
