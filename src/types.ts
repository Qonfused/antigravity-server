/** @file
  OAuth Types

  Copyright (c) 2026, Cory Bennett. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
**/

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  projectId?: string;
  managedProjectId?: string;
}

export interface AuthorizationResult {
  url: string;
  verifier: string;
  state: string;
}

export interface TokenExchangeSuccess {
  type: "success";
  data: TokenData;
}

export interface TokenExchangeFailure {
  type: "failed";
  error: string;
}

export type TokenExchangeResult = TokenExchangeSuccess | TokenExchangeFailure;

export interface RefreshResult {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string; // May be rotated
}

/**
 * Quota Types
 */

export interface QuotaModel {
  modelId: string;
  displayName?: string;
  remainingFraction: number;
  resetTime?: string;
}

export interface QuotaSummary {
  models: QuotaModel[];
  error?: string;
}

/**
 * Project Types
 */

export interface ProjectContext {
  projectId: string;
  managedProjectId?: string;
  tierId?: string;
}
