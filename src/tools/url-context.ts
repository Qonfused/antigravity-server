/** @file
  URL Context Tool

  Enables Gemini models to analyze specific URLs for contextual information.
  This is a convenience wrapper around executeGoogleSearch with URLs.

  IMPORTANT LIMITATIONS:
  - urlContext tool CANNOT be combined with functionDeclarations in the same request
  - Only works with Gemini models (not Claude)

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import { executeGoogleSearch, formatSearchAsMarkdown } from "./google-search.js";
import type { SearchResult } from "./google-search.js";

// =============================================================================
// Types
// =============================================================================

export interface URLContextRequest {
  urls: string[];
  query: string;
  model?: string; // Default: gemini-3-flash
  includeSearch?: boolean; // Default: true (Google Search is always included)
}

export interface URLContextResult {
  text: string;
  analyzedUrls: { url: string; status: string }[];
  sources: { title: string; url: string }[];
  searchQueries: string[];
}

// =============================================================================
// URL Context Implementation
// =============================================================================

/**
 * Analyze specific URLs using Gemini's URL context feature.
 * This internally uses the Google Search tool with URL context enabled.
 */
export async function analyzeURLs(request: URLContextRequest): Promise<URLContextResult> {
  if (!request.urls || request.urls.length === 0) {
    throw new Error("At least one URL is required");
  }

  if (!request.query) {
    throw new Error("Query is required");
  }

  // Use the unified search function with URLs
  const searchResult = await executeGoogleSearch({
    query: request.query,
    urls: request.urls,
    model: request.model,
    thinking: true,
  });

  // Transform to URLContextResult format
  return {
    text: searchResult.text,
    analyzedUrls: searchResult.urlsRetrieved,
    sources: searchResult.sources,
    searchQueries: searchResult.searchQueries,
  };
}

/**
 * Format URL analysis results as markdown for display.
 */
export function formatURLAnalysisAsMarkdown(result: URLContextResult): string {
  // Reuse the search formatter since format is similar
  const searchResult: SearchResult = {
    text: result.text,
    sources: result.sources,
    searchQueries: result.searchQueries,
    urlsRetrieved: result.analyzedUrls,
  };
  return formatSearchAsMarkdown(searchResult);
}
