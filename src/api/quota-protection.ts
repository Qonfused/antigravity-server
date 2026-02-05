/** @file
  Soft Quota Protection Module

  Prevents exhausting model quotas by blocking requests when usage
  exceeds a configurable threshold (default: 90%).

  This protects against hitting 0% quota, which can trigger stricter
  rate limits from Google.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import {
  ANTIGRAVITY_ENDPOINTS,
  ANTIGRAVITY_HEADERS,
  SOFT_QUOTA_THRESHOLD_PERCENT,
  QUOTA_CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
} from "../constants.js";

// =============================================================================
// Types
// =============================================================================

export interface QuotaInfo {
  remainingFraction: number;
  resetTime?: string;
}

export interface QuotaCache {
  models: Map<string, QuotaInfo>;
  updatedAt: number;
}

export type ModelFamily = "claude" | "gemini-pro" | "gemini-flash" | "unknown";

// =============================================================================
// Module State
// =============================================================================

let quotaCache: QuotaCache | null = null;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine model family from model ID.
 */
export function getModelFamily(modelId: string): ModelFamily {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini-3") || lower.includes("gemini-2.5-pro")) {
    if (lower.includes("flash")) return "gemini-flash";
    return "gemini-pro";
  }
  if (lower.includes("gemini")) {
    if (lower.includes("flash")) return "gemini-flash";
    return "gemini-pro";
  }
  return "unknown";
}

/**
 * Format reset time as human-readable duration.
 */
function formatResetTime(resetTime?: string): string {
  if (!resetTime) return "unknown";

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
// Quota Cache Management
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
 * Fetch available models from v1internal:fetchAvailableModels
 */
async function fetchModels(
  accessToken: string,
  projectId: string
): Promise<Record<string, QuotaInfo>> {
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

      const data = (await response.json()) as { models?: Record<string, any> };
      if (!data.models) continue;

      const models: Record<string, QuotaInfo> = {};
      const result: Record<string, QuotaInfo> = {};

      for (const [modelId, info] of Object.entries(data.models)) {
        if (modelId.startsWith("chat_")) continue;
        if (modelId === "gemini-3-pro") continue;
        const quotaInfo = info.quotaInfo as
          | { remainingFraction?: number; resetTime?: string }
          | undefined;
        result[modelId] = {
          remainingFraction: quotaInfo?.remainingFraction ?? 1.0,
          resetTime: quotaInfo?.resetTime,
        };
      }
      return result;
    } catch {
      continue;
    }
  }
  return {};
}

/**
 * Fetch user quota buckets from v1internal:retrieveUserQuota
 */
async function fetchUserQuota(
  accessToken: string,
  projectId: string
): Promise<Array<{ modelId: string; remainingFraction: number; resetTime?: string }>> {
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

      const data = (await response.json()) as { buckets?: any[] };
      if (!data.buckets) continue;

      return data.buckets
        .filter((b) => b.tokenType === "REQUESTS" && b.modelId)
        .map((b) => ({
          modelId: b.modelId,
          remainingFraction: b.remainingFraction ?? 1.0,
          resetTime: b.resetTime,
        }));
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Refresh the quota cache by fetching latest data from Antigravity.
 */
export async function refreshQuotaCache(accessToken: string, projectId: string): Promise<void> {
  // Fetch both endpoints in parallel
  const [modelsMap, quotaBuckets] = await Promise.all([
    fetchModels(accessToken, projectId),
    fetchUserQuota(accessToken, projectId),
  ]);

  const mergedModels = new Map<string, QuotaInfo>();

  // 1. Populate from models endpoint
  for (const [modelId, info] of Object.entries(modelsMap)) {
    mergedModels.set(modelId, info);
  }

  // 2. Overlay with more accurate bucket data
  for (const bucket of quotaBuckets) {
    const existing = mergedModels.get(bucket.modelId.toLowerCase());

    // If we have existing data, take the minimum remaining fraction (pessimistic)
    // or prioritize the bucket if it has specific quota info
    const remainingFraction = existing
      ? Math.min(existing.remainingFraction, bucket.remainingFraction)
      : bucket.remainingFraction;

    const resetTime = bucket.resetTime || existing?.resetTime;

    mergedModels.set(bucket.modelId.toLowerCase(), {
      remainingFraction,
      resetTime,
    });

    // Also set for original case if needed
    if (existing && bucket.modelId !== bucket.modelId.toLowerCase()) {
      mergedModels.set(bucket.modelId, { remainingFraction, resetTime });
    }
  }

  quotaCache = {
    models: mergedModels,
    updatedAt: Date.now(),
  };

  console.log(`[quota-protection] Cache refreshed: ${mergedModels.size} models loaded`);
}

/**
 * Check if quota cache is still fresh.
 */
function isCacheFresh(): boolean {
  if (!quotaCache) return false;
  return Date.now() - quotaCache.updatedAt < QUOTA_CACHE_TTL_MS;
}

// =============================================================================
// Quota Protection API
// =============================================================================

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  resetTime?: string;
  remainingPercent?: number;
}

/**
 * Check if a model is over the soft quota threshold.
 *
 * @param modelId - The model to check
 * @param accessToken - Access token for refreshing cache if needed
 * @param projectId - Project ID for refreshing cache
 * @param thresholdPercent - Optional custom threshold (default: 90%)
 */
export async function checkModelQuota(
  modelId: string,
  accessToken: string,
  projectId: string,
  thresholdPercent: number = SOFT_QUOTA_THRESHOLD_PERCENT
): Promise<QuotaCheckResult> {
  // Refresh cache if stale
  if (!isCacheFresh()) {
    await refreshQuotaCache(accessToken, projectId);
  }

  // If still no cache, allow the request (fail open)
  if (!quotaCache) {
    console.log("[quota-protection] No cache available, allowing request");
    return { allowed: true };
  }

  // Look up the specific model
  const quotaInfo = quotaCache.models.get(modelId);

  // Also check by model family if exact match not found
  const family = getModelFamily(modelId);
  let familyMinQuota: QuotaInfo | undefined;

  if (!quotaInfo && family !== "unknown") {
    // Find the minimum quota in this family
    for (const [id, info] of quotaCache.models) {
      if (getModelFamily(id) === family) {
        if (!familyMinQuota || info.remainingFraction < familyMinQuota.remainingFraction) {
          familyMinQuota = info;
        }
      }
    }
  }

  const effectiveQuota = quotaInfo || familyMinQuota;

  if (!effectiveQuota) {
    // Unknown model, allow the request
    return { allowed: true };
  }

  const remainingPercent = effectiveQuota.remainingFraction * 100;
  const usedPercent = 100 - remainingPercent;
  const resetTimeFormatted = formatResetTime(effectiveQuota.resetTime);

  // Check if over threshold
  if (usedPercent >= thresholdPercent) {
    const reason =
      `Model ${modelId} is at ${usedPercent.toFixed(0)}% usage (threshold: ${thresholdPercent}%). ` +
      `Quota resets in ${resetTimeFormatted}. ` +
      `Blocking request to prevent hitting 0% quota.`;

    console.log(`[quota-protection] BLOCKED: ${reason}`);

    return {
      allowed: false,
      reason,
      resetTime: resetTimeFormatted,
      remainingPercent,
    };
  }

  // Under threshold, allow
  return {
    allowed: true,
    remainingPercent,
  };
}

/**
 * Get cached quota info for a model (without refreshing).
 */
export function getCachedQuota(modelId: string): QuotaInfo | undefined {
  return quotaCache?.models.get(modelId);
}

/**
 * Force clear the quota cache (e.g., after authentication).
 */
export function clearQuotaCache(): void {
  quotaCache = null;
}
