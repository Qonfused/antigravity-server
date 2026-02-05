/** @file
  Debug Quota CLI

  Raw debug output from Antigravity quota endpoints.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { loadTokens } from "../auth/storage.js";
import { ensureValidToken } from "../auth/token.js";
import {
  ANTIGRAVITY_ENDPOINTS,
  ANTIGRAVITY_HEADERS,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
} from "../constants.js";

async function main(): Promise<void> {
  console.log("\n🔍 Debug: Fetching raw Antigravity responses...\n");

  const tokens = await loadTokens();
  if (!tokens) {
    console.error("❌ Not authenticated. Run: bun run auth");
    process.exit(1);
  }

  const validTokens = await ensureValidToken(tokens);
  const projectId =
    validTokens.projectId || validTokens.managedProjectId || ANTIGRAVITY_DEFAULT_PROJECT_ID;

  console.log(`📧 Account: ${validTokens.email}`);
  console.log(`📁 Project: ${projectId}`);
  console.log(`🔑 Token: ${validTokens.accessToken.slice(0, 20)}...`);
  console.log("");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${validTokens.accessToken}`,
    "Content-Type": "application/json",
    ...ANTIGRAVITY_HEADERS,
  };

  // Try each endpoint
  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 Endpoint: ${endpoint}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Try fetchAvailableModels
    try {
      console.log("\n1️⃣  v1internal:fetchAvailableModels");
      const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
      });
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        console.log(`   Response: ${JSON.stringify(data, null, 2).slice(0, 2000)}`);
      } catch {
        console.log(`   Response: ${text.slice(0, 500)}`);
      }
    } catch (err) {
      console.log(`   Error: ${err}`);
    }

    // Try retrieveUserQuota
    try {
      console.log("\n2️⃣  v1internal:retrieveUserQuota");
      const response = await fetch(`${endpoint}/v1internal:retrieveUserQuota`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project: projectId }),
      });
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        console.log(`   Response: ${JSON.stringify(data, null, 2).slice(0, 2000)}`);
      } catch {
        console.log(`   Response: ${text.slice(0, 500)}`);
      }
    } catch (err) {
      console.log(`   Error: ${err}`);
    }

    // Try loadCodeAssist
    try {
      console.log("\n3️⃣  v1internal:loadCodeAssist");
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
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
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        console.log(`   Response: ${JSON.stringify(data, null, 2).slice(0, 2000)}`);
      } catch {
        console.log(`   Response: ${text.slice(0, 500)}`);
      }
    } catch (err) {
      console.log(`   Error: ${err}`);
    }

    // Break after first successful endpoint
    break;
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
