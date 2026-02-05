/** @file
  Tools Routes

  API routes for Google Search and URL Context tools.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { Hono } from "hono";
import { executeGoogleSearch, formatSearchAsMarkdown } from "../tools/google-search.js";
import { analyzeURLs, formatURLAnalysisAsMarkdown } from "../tools/url-context.js";

const tools = new Hono();

/**
 * POST /v1/tools/search
 * Execute a Google Search grounding request.
 *
 * Request body:
 * {
 *   "query": "What is the latest news about AI?",
 *   "model": "gemini-3-flash",  // optional
 *   "thinking": false,          // optional
 *   "format": "json"            // optional: "json" or "markdown"
 * }
 */
tools.post("/search", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.query) {
      return c.json(
        {
          error: {
            message: "Query is required",
            type: "invalid_request",
            code: "missing_query",
          },
        },
        400
      );
    }

    const result = await executeGoogleSearch({
      query: body.query,
      urls: body.urls,
      model: body.model,
      thinking: body.thinking,
    });

    if (body.format === "markdown") {
      return c.json({
        object: "search_result",
        content: formatSearchAsMarkdown(result),
        format: "markdown",
      });
    }

    return c.json({
      object: "search_result",
      text: result.text,
      sources: result.sources,
      searchQueries: result.searchQueries,
      urlsRetrieved: result.urlsRetrieved,
    });
  } catch (error) {
    console.error("[tools/search] Error:", error);
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Search failed",
          type: "server_error",
          code: "search_error",
        },
      },
      500
    );
  }
});

/**
 * POST /v1/tools/analyze-url
 * Analyze specific URLs for contextual information.
 *
 * Request body:
 * {
 *   "urls": ["https://example.com"],
 *   "query": "Summarize the main points from this page",
 *   "model": "gemini-3-flash",  // optional
 *   "includeSearch": false,     // optional: also enable web search
 *   "format": "json"            // optional: "json" or "markdown"
 * }
 */
tools.post("/analyze-url", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      return c.json(
        {
          error: {
            message: "At least one URL is required",
            type: "invalid_request",
            code: "missing_urls",
          },
        },
        400
      );
    }

    if (!body.query) {
      return c.json(
        {
          error: {
            message: "Query is required",
            type: "invalid_request",
            code: "missing_query",
          },
        },
        400
      );
    }

    const result = await analyzeURLs({
      urls: body.urls,
      query: body.query,
      model: body.model,
      includeSearch: body.includeSearch,
    });

    if (body.format === "markdown") {
      return c.json({
        object: "url_analysis_result",
        content: formatURLAnalysisAsMarkdown(result),
        format: "markdown",
      });
    }

    return c.json({
      object: "url_analysis_result",
      text: result.text,
      analyzedUrls: result.analyzedUrls,
      sources: result.sources,
      searchQueries: result.searchQueries,
    });
  } catch (error) {
    console.error("[tools/analyze-url] Error:", error);
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "URL analysis failed",
          type: "server_error",
          code: "analysis_error",
        },
      },
      500
    );
  }
});

export default tools;
