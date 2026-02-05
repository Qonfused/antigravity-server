/** @file
  Antigravity Server

  vLLM-compatible proxy server for Google Antigravity (Code Assist) API.
  Exposes OpenAI-compatible endpoints.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import chat from "./routes/chat.js";
import models from "./routes/models.js";
import quota from "./routes/quota.js";
import tools from "./routes/tools.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    server: "antigravity-server",
    version: "0.1.0",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy" });
});

// OpenAI-compatible routes
app.route("/v1/chat/completions", chat);
app.route("/v1/models", models);
app.route("/v1/quota", quota);
app.route("/v1/tools", tools);

// Error handling
app.onError((err, c) => {
  console.error("[server] Unhandled error:", err);
  return c.json(
    {
      error: {
        message: err.message || "Internal server error",
        type: "server_error",
        code: "internal_error",
      },
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `Not found: ${c.req.path}`,
        type: "invalid_request_error",
        code: "not_found",
      },
    },
    404
  );
});

// Start server
const PORT = parseInt(process.env.PORT || "8080", 10);

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    Antigravity Server                         ║
║                                                               ║
║  OpenAI-compatible proxy for Google Antigravity (Code Assist) ║
╚═══════════════════════════════════════════════════════════════╝

🚀 Server starting on http://localhost:${PORT}

Available endpoints:
  GET  /                      - Server info
  GET  /health                - Health check
  GET  /v1/models             - List available models
  GET  /v1/quota              - Model quota information
  POST /v1/chat/completions   - Chat completions (streaming supported)
  POST /v1/tools/search       - Google Search grounding
  POST /v1/tools/analyze-url  - URL context analysis

Usage with OpenAI SDK:
  OPENAI_BASE_URL=http://localhost:${PORT}/v1
  OPENAI_API_KEY=dummy

`);

export default {
  port: PORT,
  fetch: app.fetch,
};
