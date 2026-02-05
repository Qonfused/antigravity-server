/** @file
  Quota CLI

  Check quota limits for available models.

  Usage: npm run quota

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { loadTokens } from "../auth/storage.js";
import { ensureValidToken } from "../auth/token.js";
import { fetchQuotaSummary, printQuotaSummary } from "../api/quota.js";
import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from "../constants.js";

async function main(): Promise<void> {
  console.log("\n🔍 Checking Antigravity Quota...\n");

  // Load stored tokens
  const tokens = await loadTokens();
  if (!tokens) {
    console.error("❌ Not authenticated. Run: npm run auth");
    process.exit(1);
  }

  // Ensure token is valid
  let validTokens = tokens;
  try {
    validTokens = await ensureValidToken(tokens);
  } catch (error) {
    console.error(`❌ Token refresh failed: ${error instanceof Error ? error.message : error}`);
    console.error("   Run: npm run auth");
    process.exit(1);
  }

  // Get project ID
  const projectId =
    validTokens.projectId || validTokens.managedProjectId || ANTIGRAVITY_DEFAULT_PROJECT_ID;

  console.log(`📧 Account: ${validTokens.email || "(unknown)"}`);
  console.log(`📁 Project: ${projectId}`);

  // Fetch and display quota
  const summary = await fetchQuotaSummary(validTokens.accessToken, projectId);
  printQuotaSummary(summary);

  if (summary.models.length > 0) {
    console.log("\n✅ API connection verified!");
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
