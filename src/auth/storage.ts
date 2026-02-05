/** @file
  Token Storage Module

  Simple file-based storage for credentials.

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TokenData } from "../types.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "antigravity-server");
const TOKEN_FILE = path.join(CONFIG_DIR, "tokens.json");

/**
 * Ensure config directory exists.
 */
async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * Save token data to disk.
 */
export async function saveTokens(tokens: TokenData): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf-8");
  console.log(`Tokens saved to ${TOKEN_FILE}`);
}

/**
 * Load token data from disk.
 */
export async function loadTokens(): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(data) as TokenData;
  } catch {
    return null;
  }
}

/**
 * Clear stored tokens.
 */
export async function clearTokens(): Promise<void> {
  try {
    await fs.unlink(TOKEN_FILE);
    console.log("Tokens cleared.");
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Get the config directory path.
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}
