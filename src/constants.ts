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
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

// =============================================================================
// API Endpoints
// =============================================================================

export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

/** Endpoint fallback order (daily → autopush → prod) */
export const ANTIGRAVITY_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
] as const;

// =============================================================================
// Request Headers
// =============================================================================

export const ANTIGRAVITY_VERSION = "1.16.5";
export const ANTIGRAVITY_API_VERSION = "v1internal";

export const ANTIGRAVITY_API_USER_AGENT = "google-api-nodejs-client/9.15.1";
export const ANTIGRAVITY_API_CLIENT = "google-cloud-sdk vscode_cloudshelleditor/0.1";
export const ANTIGRAVITY_CLIENT_METADATA = '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}';

export const ANTIGRAVITY_HEADERS = {
  "User-Agent": ANTIGRAVITY_API_USER_AGENT,
  "X-Goog-Api-Client": ANTIGRAVITY_API_CLIENT,
  "Client-Metadata": ANTIGRAVITY_CLIENT_METADATA,
} as const;

/** Default project ID for accounts without a managed project */
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

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
