/** @file
  Antigravity Server Constants

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

// =============================================================================
// OAuth Configuration
// =============================================================================

export const ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_CLIENT_SECRET = "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";
export const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";

export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
] as const;

// =============================================================================
// API Endpoints
// =============================================================================

export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

/** Endpoint fallback order (daily → autopush → prod) */
export const ANTIGRAVITY_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
] as const;

/** Default project ID for accounts without a managed project */
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

// =============================================================================
// Request Headers
// =============================================================================

export const ANTIGRAVITY_VERSION = "1.15.8";

export const ANTIGRAVITY_HEADERS = {
  "User-Agent": `antigravity/${ANTIGRAVITY_VERSION} linux/amd64`,
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata":
    '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
} as const;

// =============================================================================
// Token Configuration
// =============================================================================

/** Buffer time before token expiry to trigger refresh (1 minute) */
export const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

/** Fetch timeout for API calls */
export const FETCH_TIMEOUT_MS = 10_000;

// =============================================================================
// Soft Quota Protection
// =============================================================================

/**
 * Stop using a model when usage exceeds this threshold (default: 90%).
 * This prevents hitting 0% quota, which can trigger stricter rate limits.
 */
export const SOFT_QUOTA_THRESHOLD_PERCENT = 90;

/** How long quota cache is considered fresh (5 minutes) */
export const QUOTA_CACHE_TTL_MS = 5 * 60 * 1000;
