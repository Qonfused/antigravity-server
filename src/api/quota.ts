/** @file
  Quota Module

  Fetches available models and quota information from Antigravity.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { ANTIGRAVITY_ENDPOINTS, ANTIGRAVITY_HEADERS, FETCH_TIMEOUT_MS } from "../constants.js";
import type { QuotaModel, QuotaSummary } from "../types.js";

// =============================================================================
// Types
// =============================================================================

interface ModelInfo {
  displayName?: string;
  remainingFraction?: number;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
  supportsThinking?: boolean;
  supportsImages?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
}

interface FetchAvailableModelsResponse {
  models?: Record<string, ModelInfo>;
}

interface QuotaBucket {
  modelId?: string;
  tokenType?: string;
  remainingFraction?: number;
  resetTime?: string;
}

interface RetrieveUserQuotaResponse {
  buckets?: QuotaBucket[];
}

// =============================================================================
// API Helpers
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

// =============================================================================
// Quota Fetching
// =============================================================================

/**
 * Fetch available models from v1internal:fetchAvailableModels
 */
async function fetchAvailableModels(
  accessToken: string,
  projectId: string
): Promise<Record<string, ModelInfo>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...ANTIGRAVITY_HEADERS,
  };

  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as FetchAvailableModelsResponse;
      if (data.models && typeof data.models === "object") {
        return data.models;
      }
    } catch {
      continue;
    }
  }

  return {};
}

/**
 * Fetch user quota from v1internal:retrieveUserQuota
 */
async function fetchUserQuota(accessToken: string, projectId: string): Promise<QuotaBucket[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...ANTIGRAVITY_HEADERS,
  };

  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(`${endpoint}/v1internal:retrieveUserQuota`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as RetrieveUserQuotaResponse;
      if (data.buckets && data.buckets.length > 0) {
        return data.buckets;
      }
    } catch {
      continue;
    }
  }

  return [];
}

// =============================================================================
// Model Categorization
// =============================================================================

function getModelFamily(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini-3")) return "gemini-3";
  if (lower.includes("gemini-2.5")) return "gemini-2.5";
  if (lower.includes("chat_")) return "internal";
  return "other";
}

function formatResetTime(resetTime?: string): string | undefined {
  if (!resetTime) return undefined;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 0) return "now";

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  } catch {
    return resetTime;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch quota information for all available models.
 */
export async function fetchQuotaSummary(
  accessToken: string,
  projectId: string
): Promise<QuotaSummary> {
  try {
    // Fetch both endpoints in parallel
    const [modelsMap, quotaBuckets] = await Promise.all([
      fetchAvailableModels(accessToken, projectId),
      fetchUserQuota(accessToken, projectId),
    ]);

    // Build a map of model IDs to quota info from buckets
    const bucketMap = new Map<string, QuotaBucket>();
    for (const bucket of quotaBuckets) {
      if (bucket.modelId && bucket.tokenType === "REQUESTS") {
        bucketMap.set(bucket.modelId.toLowerCase(), bucket);
      }
    }

    // Process models
    const result: QuotaModel[] = [];
    const seenModels = new Set<string>();

    // First add models from the models endpoint
    for (const [modelId, info] of Object.entries(modelsMap)) {
      // Skip internal models and bare gemini-3-pro (use high/low variants)
      if (modelId.startsWith("chat_")) continue;
      if (modelId === "gemini-3-pro") continue;
      if (modelId === "gemini-3-pro-low") continue;
      if (seenModels.has(modelId)) continue;
      seenModels.add(modelId);

      // Rename gemini-3-pro-high to Gemini 3 Pro
      let displayName = info.displayName ?? modelId;
      let displayModelId = modelId;
      if (modelId === "gemini-3-pro-high") {
        displayName = "Gemini 3 Pro";
        displayModelId = "gemini-3-pro";
      }

      // Get quota from model info or bucket
      let remainingFraction = info.quotaInfo?.remainingFraction ?? 1.0;
      let resetTime = info.quotaInfo?.resetTime;

      // Check bucket for more accurate data
      const bucket = bucketMap.get(modelId.toLowerCase());
      if (bucket) {
        remainingFraction = bucket.remainingFraction ?? remainingFraction;
        resetTime = bucket.resetTime ?? resetTime;
      }

      result.push({
        modelId: displayModelId,
        displayName: displayName,
        remainingFraction,
        resetTime: formatResetTime(resetTime),
      });
    }

    // Then add any models from buckets that weren't in models
    for (const bucket of quotaBuckets) {
      if (!bucket.modelId || bucket.tokenType !== "REQUESTS") continue;
      if (bucket.modelId.startsWith("chat_")) continue;
      if (bucket.modelId === "gemini-3-pro") continue;
      if (bucket.modelId === "gemini-3-pro-low") continue;
      if (seenModels.has(bucket.modelId)) continue;
      seenModels.add(bucket.modelId);

      result.push({
        modelId: bucket.modelId,
        displayName: bucket.modelId,
        remainingFraction: bucket.remainingFraction ?? 1.0,
        resetTime: formatResetTime(bucket.resetTime),
      });
    }

    // Sort by family then by name
    result.sort((a, b) => {
      const aFamily = getModelFamily(a.modelId);
      const bFamily = getModelFamily(b.modelId);
      if (aFamily !== bFamily) return aFamily.localeCompare(bFamily);
      return a.modelId.localeCompare(b.modelId);
    });

    return { models: result };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Print quota summary to console.
 */
export function printQuotaSummary(summary: QuotaSummary): void {
  if (summary.error) {
    console.error(`\n❌ Error fetching quota: ${summary.error}`);
    return;
  }

  if (summary.models.length === 0) {
    console.log("\n⚠️  No models found.");
    return;
  }

  console.log("\n📊 Model Quota Summary\n");
  console.log("┌────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Model                                      │ Quota   │ Resets In     │");
  console.log("├────────────────────────────────────────────────────────────────────────┤");

  for (const model of summary.models) {
    const name = (model.displayName || model.modelId).slice(0, 42).padEnd(42);
    const pct = Math.round(model.remainingFraction * 100);
    const quotaBar = getQuotaBar(pct);
    const reset = (model.resetTime || "-").padEnd(13);

    console.log(`│ ${name} │ ${quotaBar} │ ${reset} │`);
  }

  console.log("└────────────────────────────────────────────────────────────────────────┘");
}

function getQuotaBar(pct: number): string {
  if (pct >= 75) return `🟢 ${pct.toString().padStart(3)}%`;
  if (pct >= 25) return `🟡 ${pct.toString().padStart(3)}%`;
  if (pct > 0) return `🟠 ${pct.toString().padStart(3)}%`;
  return `🔴   0%`;
}
