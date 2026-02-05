/** @file
  Auth CLI

  Interactive script to authenticate with Google Antigravity.

  Usage: npm run auth

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import * as http from "node:http";
import { buildAuthorizationUrl, exchangeCode } from "../auth/oauth.js";
import { saveTokens, loadTokens, clearTokens } from "../auth/storage.js";
import { isTokenExpired, ensureValidToken } from "../auth/token.js";

const CALLBACK_PORT = 51121;

/**
 * Start a local HTTP server to receive the OAuth callback.
 */
function startCallbackServer(): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === "/oauth-callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<html><body><h1>❌ Authentication Failed</h1><p>${error}</p></body></html>`);
          server.close();
          reject(new Error(error));
          return;
        }

        if (code && state) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
              <head><title>Antigravity Auth</title></head>
              <body style="font-family: system-ui; padding: 2rem; text-align: center;">
                <h1>✅ Authentication Successful!</h1>
                <p>You can close this tab and return to your terminal.</p>
              </body>
            </html>
          `);
          server.close();
          resolve({ code, state });
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<html><body><h1>❌ Missing code or state</h1></body></html>");
          server.close();
          reject(new Error("Missing code or state in callback"));
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`📡 Callback server listening on port ${CALLBACK_PORT}`);
    });

    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Close other auth processes.`));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error("Authentication timeout - no callback received"));
      },
      5 * 60 * 1000
    );
  });
}

/**
 * Display token status.
 */
async function showStatus(): Promise<void> {
  const tokens = await loadTokens();

  if (!tokens) {
    console.log("\n❌ Not authenticated. Run: npm run auth");
    return;
  }

  console.log("\n📋 Token Status");
  console.log("────────────────────────────────────");
  console.log(`Email:      ${tokens.email || "(unknown)"}`);
  console.log(`Project:    ${tokens.projectId || tokens.managedProjectId || "(none)"}`);
  console.log(`Expires:    ${new Date(tokens.expiresAt).toLocaleString()}`);
  console.log(`Expired:    ${isTokenExpired(tokens.expiresAt) ? "⚠️  YES" : "✅ No"}`);
  console.log("────────────────────────────────────");
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "login";

  switch (command) {
    case "status": {
      await showStatus();
      break;
    }

    case "logout":
    case "clear": {
      await clearTokens();
      console.log("✅ Logged out successfully.");
      break;
    }

    case "refresh": {
      const tokens = await loadTokens();
      if (!tokens) {
        console.log("❌ No stored tokens. Run: npm run auth");
        process.exit(1);
      }

      console.log("🔄 Refreshing token...");
      const refreshed = await ensureValidToken(tokens);
      await saveTokens(refreshed);
      console.log("✅ Token refreshed successfully!");
      await showStatus();
      break;
    }

    case "login":
    default: {
      console.log("\n🔐 Antigravity Authentication\n");

      // Check for existing tokens
      const existing = await loadTokens();
      if (existing && !isTokenExpired(existing.expiresAt)) {
        console.log("✅ Already authenticated!");
        await showStatus();
        console.log("\nRun 'npm run auth clear' to logout first.");
        return;
      }

      // Build auth URL
      console.log("📎 Building authorization URL...");
      const auth = await buildAuthorizationUrl();

      // Start callback server
      const callbackPromise = startCallbackServer();

      // Open browser
      console.log("\n🌐 Open this URL in your browser:\n");
      console.log(`   ${auth.url}\n`);

      // Try to open browser automatically
      try {
        const { exec } = await import("node:child_process");
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${openCmd} "${auth.url}"`);
        console.log("(Browser should open automatically)");
      } catch {
        console.log("(Open the URL manually in your browser)");
      }

      console.log("\n⏳ Waiting for authentication...\n");

      // Wait for callback
      const { code, state } = await callbackPromise;

      console.log("🔄 Exchanging code for tokens...");
      const result = await exchangeCode(code, state);

      if (result.type === "failed") {
        console.error(`\n❌ Token exchange failed: ${result.error}`);
        process.exit(1);
      }

      // Save tokens
      await saveTokens(result.data);

      console.log("\n✅ Authentication successful!\n");
      await showStatus();
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
