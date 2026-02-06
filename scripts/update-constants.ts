/** @file
  Script to update constants.ts with the latest Antigravity version

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

const API_URL = "https://antigravity-auto-updater-974169037036.us-central1.run.app/releases";
const CONSTANTS_PATH = path.join(process.cwd(), 'src', 'constants.ts');

interface Release {
  version: string;
  execution_id: string;
}

// -----------------------------------------------------------------------------
// Dynamic Regex Patterns
// -----------------------------------------------------------------------------

// Regex patterns for extraction
const REGEX_CLIENT_ID = /[0-9]+-[a-zA-Z0-9]+\.apps\.googleusercontent\.com/;
const REGEX_CLIENT_SECRET = /GOCSPX-[a-zA-Z0-9]+/;

// Search for anything starting with the auth base URL
const REGEX_SCOPES = /https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9.\-_]+/g;

// Search for Antigravity-specific endpoints (heuristic: *cloudcode-pa.googleapis.com)
// We look for optional https:// + (subdomain with dots) + cloudcode-pa + .googleapis.com
const REGEX_ENDPOINTS = /(https:\/\/)?([a-zA-Z0-9.-]*cloudcode-pa[a-zA-Z0-9.-]*\.googleapis\.com)/g;

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-update-'));
  console.log(`Created temp directory: ${tempDir}`);

  try {
    // 1. Fetch Version
    console.log("Fetching latest Antigravity version...");
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`Failed to fetch releases: ${response.statusText}`);
    const releases = await response.json() as Release[];
    if (!releases.length) throw new Error("No releases found.");
    const latest = releases[0];
    console.log(`Latest version: ${latest.version}`);

    // 2. Download and Extract
    // We only need resources/app/out/main.js to find constants
    const downloadUrl = `https://edgedl.me.gvt1.com/edgedl/release2/j0qc3/antigravity/stable/${latest.version}-${latest.execution_id}/linux-x64/Antigravity.tar.gz`;
    const tarballPath = path.join(tempDir, 'Antigravity.tar.gz');

    console.log(`Downloading tarball from ${downloadUrl}...`);
    execSync(`curl -s -L -o "${tarballPath}" "${downloadUrl}"`);

    console.log("Extracting main.js...");
    // We try to extract just the file we need. The path inside tarball might vary slightly but usually:
    // Antigravity/resources/app/out/main.js
    // We'll use wildcards to be safe or list headers first if strict.
    // Usually it extracts to a directory named after the app.
    // Let's just extract the specific file we know contains the secrets.
    // Using --wildcards for tar to match the path pattern
    execSync(`tar -xf "${tarballPath}" --directory "${tempDir}" --wildcards "*/resources/app/out/main.js"`);

    // Find the extracted file
    const findResult = execSync(`find "${tempDir}" -name "main.js"`, { encoding: 'utf-8' }).trim();
    if (!findResult) throw new Error("Could not find main.js in extracted files");
    console.log(`Found main.js at: ${findResult}`);

    // 3. Scan for Constants
    console.log("Scanning main.js for constants...");
    const mainJsContent = fs.readFileSync(findResult, 'utf-8');

    // Client ID
    const clientIdMatch = mainJsContent.match(REGEX_CLIENT_ID);
    const foundClientId = clientIdMatch ? clientIdMatch[0] : null;
    if (foundClientId) console.log(`Found Client ID: ${foundClientId}`);
    else console.warn("WARNING: Client ID not found in binary!");

    // Client Secret
    const clientSecretMatch = mainJsContent.match(REGEX_CLIENT_SECRET);
    const foundClientSecret = clientSecretMatch ? clientSecretMatch[0] : null;
    if (foundClientSecret) console.log(`Found Client Secret: ${foundClientSecret}`);
    else console.warn("WARNING: Client Secret not found in binary!");

    // Scopes
    console.log("Extracting scopes...");
    const scopesMatches = mainJsContent.match(REGEX_SCOPES);
    const uniqueScopes = [...new Set(scopesMatches || [])].sort();

    if (uniqueScopes.length > 0) {
      console.log(`Found ${uniqueScopes.length} scopes:`);
      uniqueScopes.forEach(s => console.log(`  - ${s}`));
    } else {
      console.warn("WARNING: No scopes found in binary!");
    }

    // Endpoints
    console.log("Extracting endpoints...");
    // matchAll returns iterator of matches, we want group 0 (full match) or group 2 (domain if https missing)
    // But simple .match() with global flag only returns full matches (group 0).
    // If we use global flag, it returns array of full matches.
    // Our regex has groups, but match() with /g doesn't return groups.
    // Let's rely on full match, assuming https:// is present or we add it. if it's optional, the match might be just domain.
    const endpointMatches = mainJsContent.match(REGEX_ENDPOINTS);

    // Normalize: ensure https:// prefix
    const uniqueEndpoints = [...new Set(endpointMatches || [])].map(e => e.startsWith('http') ? e : `https://${e}`).sort();

    let dailyEndpoint: string | null = null;
    let autopushEndpoint: string | null = null;
    let prodEndpoint: string | null = null;

    if (uniqueEndpoints.length > 0) {
      console.log(`Found ${uniqueEndpoints.length} endpoints:`);
      uniqueEndpoints.forEach(e => {
        console.log(`  - ${e}`);
        if (e.includes('daily')) dailyEndpoint = e;
        else if (e.includes('autopush')) autopushEndpoint = e;
        else if (e.includes('cloudcode-pa.googleapis.com')) prodEndpoint = e; // fallthrough for prod
      });
    } else {
      console.warn("WARNING: No endpoints found in binary!");
    }

    // 4. Update constants.ts
    console.log(`Updating ${CONSTANTS_PATH}...`);
    if (!fs.existsSync(CONSTANTS_PATH)) throw new Error(`File not found: ${CONSTANTS_PATH}`);

    let content = fs.readFileSync(CONSTANTS_PATH, 'utf-8');
    let updated = false;

    // Update Version
    const versionRegex = /export const ANTIGRAVITY_VERSION = "([^"]+)";/;
    const currentVersionMatch = content.match(versionRegex);
    if (currentVersionMatch && currentVersionMatch[1] !== latest.version) {
      content = content.replace(versionRegex, `export const ANTIGRAVITY_VERSION = "${latest.version}";`);
      console.log(`Updated Version: ${currentVersionMatch[1]} -> ${latest.version}`);
      updated = true;
    } else {
      console.log("Version is already up to date.");
    }

    // Update Client ID if found and different
    if (foundClientId) {
      const clientIdRegex = /export const ANTIGRAVITY_CLIENT_ID =\n\s+"([^"]+)";/;
      const currentClientIdMatch = content.match(clientIdRegex);
      if (currentClientIdMatch && currentClientIdMatch[1] !== foundClientId) {
        content = content.replace(clientIdRegex, `export const ANTIGRAVITY_CLIENT_ID =\n  "${foundClientId}";`);
        console.log(`Updated Client ID: ${currentClientIdMatch[1]} -> ${foundClientId}`);
        updated = true;
      }
    }

    // Update Client Secret if found and different
    if (foundClientSecret) {
      const clientSecretRegex = /export const ANTIGRAVITY_CLIENT_SECRET = "([^"]+)";/;
      const currentClientSecretMatch = content.match(clientSecretRegex);
      if (currentClientSecretMatch && currentClientSecretMatch[1] !== foundClientSecret) {
        content = content.replace(clientSecretRegex, `export const ANTIGRAVITY_CLIENT_SECRET = "${foundClientSecret}";`);
        console.log(`Updated Client Secret: ${currentClientSecretMatch[1]} -> ${foundClientSecret}`);
        updated = true;
      }
    }

    // Update Scopes
    if (uniqueScopes.length > 0) {
      // Logic to replace the array content
      // We look for "export const ANTIGRAVITY_SCOPES = [" ... "] as const;"
      const scopesRegex = /export const ANTIGRAVITY_SCOPES = \[\n([\s\S]*?)\] as const;/;
      const scopesMatch = content.match(scopesRegex);

      if (scopesMatch) {
        const currentScopesBlock = scopesMatch[1];
        const newScopesBlock = uniqueScopes.map(s => `  "${s}",`).join('\n');

        // Compare (ignoring whitespace for check)
        if (currentScopesBlock.replace(/\s/g, '') !== newScopesBlock.replace(/\s/g, '')) {
          content = content.replace(scopesRegex, `export const ANTIGRAVITY_SCOPES = [\n${newScopesBlock}\n] as const;`);
          console.log("Updated Scopes list.");
          updated = true;
        }
      } else {
        console.warn("Could not find ANTIGRAVITY_SCOPES block to update.");
      }
    }

    // Update Endpoints
    // Only update if we distinctly identified them from the binary
    if (dailyEndpoint) {
      const regex = /export const ANTIGRAVITY_ENDPOINT_DAILY = "([^"]+)";/;
      if (content.match(regex)?.[1] !== dailyEndpoint) {
        content = content.replace(regex, `export const ANTIGRAVITY_ENDPOINT_DAILY = "${dailyEndpoint}";`);
        console.log(`Updated Daily Endpoint to ${dailyEndpoint}`);
        updated = true;
      }
    }
    if (autopushEndpoint) {
      const regex = /export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "([^"]+)";/;
      if (content.match(regex)?.[1] !== autopushEndpoint) {
        content = content.replace(regex, `export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "${autopushEndpoint}";`);
        console.log(`Updated Autopush Endpoint to ${autopushEndpoint}`);
        updated = true;
      }
    }
    if (prodEndpoint) {
      const regex = /export const ANTIGRAVITY_ENDPOINT_PROD = "([^"]+)";/;
      if (content.match(regex)?.[1] !== prodEndpoint) {
        content = content.replace(regex, `export const ANTIGRAVITY_ENDPOINT_PROD = "${prodEndpoint}";`);
        console.log(`Updated Prod Endpoint to ${prodEndpoint}`);
        updated = true;
      }
    }

    // Update API Version
    // Strategy 1: Look for usage like "/v1internal:"
    let apiVersionMatch = mainJsContent.match(/\/(v1[a-z0-9]+):/);
    let foundApiVersion = apiVersionMatch ? apiVersionMatch[1] : null;

    // Strategy 2: Look for quoted string "v1internal" if known
    if (!foundApiVersion) {
      // We know it is "v1internal", let's see if it exists as a standalone string
      if (mainJsContent.includes("v1internal")) {
        foundApiVersion = "v1internal";
      }
    }

    if (foundApiVersion) {
      console.log(`Found API Version: ${foundApiVersion}`);
      const regex = /export const ANTIGRAVITY_API_VERSION = "([^"]+)";/;
      const currentMatch = content.match(regex);

      if (currentMatch && currentMatch[1] !== foundApiVersion) {
        content = content.replace(regex, `export const ANTIGRAVITY_API_VERSION = "${foundApiVersion}";`);
        console.log(`Updated API Version: ${currentMatch[1]} -> ${foundApiVersion}`);
        updated = true;
      }
    } else {
      console.warn("WARNING: API Version (e.g. v1internal) not found in binary!");
    }

    if (updated) {
      fs.writeFileSync(CONSTANTS_PATH, content);
      console.log("Successfully updated constants.ts");
      console.log("No changes needed in constants.ts");
    }

  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  } finally {
    // 5. Cleanup
    try {
      console.log(`Cleaning up ${tempDir}...`);
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log("Cleanup complete.");
    } catch (cleanupError) {
      console.error("Failed to clean up temp dir:", cleanupError);
    }
  }
}

main();
