# Code Quality & Maintainability Report
## T2J AI Email Assistant - Phased Refactoring Plan

**Prepared for**: CTO / Technical Leadership
**Date**: December 6, 2025
**Scope**: Full codebase analysis (~35,600 LOC server, ~11,000 LOC frontend)

---

## Executive Summary

This report presents a comprehensive analysis of the T2J codebase, identifying key areas for improvement in code quality, maintainability, and architectural patterns. The analysis focuses on practical, incremental refactoring opportunities well-suited for autonomous agent execution.

### Key Findings
- **125+ uses of `any` type** requiring type safety improvements
- **69 instances** of duplicated user ID extraction pattern
- **20+ route handlers** with identical error handling code
- **5 files exceeding 500 lines** that need decomposition
- **9 major abstraction opportunities** for service extraction

### Recommended Approach
A 5-phase refactoring plan, each phase delivering concrete improvements while maintaining system stability. All tasks are designed for Claude Code execution with clear before/after patterns.

---

## Table of Contents

1. [Phase 1: Quick Wins - DRY Violations](#phase-1-quick-wins---dry-violations-week-1-2)
2. [Phase 2: Type Safety Foundation](#phase-2-type-safety-foundation-week-3-4)
3. [Phase 3: Service Layer Extraction](#phase-3-service-layer-extraction-week-5-7)
4. [Phase 4: Large File Decomposition](#phase-4-large-file-decomposition-week-8-10)
5. [Phase 5: Visibility & Encapsulation](#phase-5-visibility--encapsulation-week-11-12)

---

## Phase 1: Quick Wins - DRY Violations (Week 1-2)

**Goal**: Eliminate the most pervasive code duplication patterns with minimal risk.

### Task 1.1: Extract Typed Authentication Request Interface

**Problem**: 69 occurrences of `(req as any).user.id` across all route files.

**Files Impacted**:
- `server/src/routes/*.ts` (20+ files)
- `server/src/middleware/auth.ts`

**Current Pattern**:
```typescript
// Appears 69 times across the codebase
router.get('/profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;  // Type unsafe, repeated
  const emailAccountId = (req as any).user.emailAccountId;
  // ...
});
```

**Refactored Pattern**:
```typescript
// server/src/types/express.ts (NEW FILE)
import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  emailAccountId?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

// server/src/middleware/auth.ts (UPDATED)
import { AuthenticatedRequest } from '../types/express';

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // ... existing logic
  req.user = { id: session.userId, email: session.email };
  next();
}

// server/src/routes/settings.ts (UPDATED)
import { AuthenticatedRequest } from '../types/express';

router.get('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user.id;  // Now type-safe, no cast needed
  // ...
});
```

**Agent Instructions**:
1. Create `server/src/types/express.ts` with `AuthenticatedRequest` interface
2. Update `server/src/middleware/auth.ts` to use the new type
3. Search and replace all `(req as any).user` patterns in route files
4. Run `npm run server:build` to verify type safety

---

### Task 1.2: Create Route Error Handler Wrapper

**Problem**: 20+ route handlers have identical try/catch error handling.

**Files Impacted**:
- `server/src/routes/tone-profile.ts`
- `server/src/routes/training.ts`
- `server/src/routes/settings.ts`
- `server/src/routes/relationships.ts`
- `server/src/routes/inbox-draft.ts`
- `server/src/routes/dashboard-analytics.ts`
- (and 14+ more route files)

**Current Pattern**:
```typescript
// Repeated 20+ times with slight variations
router.get('/profile', requireAuth, async (req, res) => {
  try {
    // ... business logic
    res.json(result);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      error: 'Failed to fetch profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
```

**Refactored Pattern**:
```typescript
// server/src/middleware/async-handler.ts (NEW FILE)
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

export function asyncHandler(
  handler: AsyncRouteHandler,
  errorContext: string
): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error(`Error ${errorContext}:`, error);
      res.status(500).json({
        error: `Failed to ${errorContext}`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

// server/src/routes/tone-profile.ts (UPDATED)
import { asyncHandler } from '../middleware/async-handler';

router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const result = await toneProfileService.getProfile(userId);
  res.json(result);
}, 'fetch tone profile'));
```

**Agent Instructions**:
1. Create `server/src/middleware/async-handler.ts`
2. Apply to routes with simple error patterns first (tone-profile.ts, inbox-draft.ts)
3. Gradually expand to all route files
4. Verify no behavior changes with existing tests

---

### Task 1.3: Extract Dashboard Time Period Query Helper

**Problem**: 4 identical database queries with only the time interval changing.

**Files Impacted**:
- `server/src/routes/dashboard-analytics.ts`

**Current Pattern** (lines 16-53):
```typescript
// Repeated 4 times with different intervals
const result15m = await pool.query(`
  SELECT action_taken, COUNT(*)::int as count
  FROM email_received
  WHERE user_id = $1 AND updated_at >= NOW() - INTERVAL '15 minutes'
  GROUP BY action_taken
`, [userId]);

const result1h = await pool.query(`
  SELECT action_taken, COUNT(*)::int as count
  FROM email_received
  WHERE user_id = $1 AND updated_at >= NOW() - INTERVAL '1 hour'
  GROUP BY action_taken
`, [userId]);

// ... same for '24 hours' and '30 days'
```

**Refactored Pattern**:
```typescript
// server/src/routes/dashboard-analytics.ts (UPDATED)

type TimeInterval = '15 minutes' | '1 hour' | '24 hours' | '30 days';

async function getActionCountsByInterval(
  userId: string,
  interval: TimeInterval
): Promise<Array<{ action_taken: string; count: number }>> {
  const result = await pool.query(`
    SELECT action_taken, COUNT(*)::int as count
    FROM email_received
    WHERE user_id = $1 AND updated_at >= NOW() - INTERVAL '${interval}'
    GROUP BY action_taken
  `, [userId]);
  return result.rows;
}

// Usage
router.get('/action-summary', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [result15m, result1h, result24h, result30d] = await Promise.all([
    getActionCountsByInterval(userId, '15 minutes'),
    getActionCountsByInterval(userId, '1 hour'),
    getActionCountsByInterval(userId, '24 hours'),
    getActionCountsByInterval(userId, '30 days')
  ]);

  res.json({ result15m, result1h, result24h, result30d });
}, 'fetch action summary'));
```

**Agent Instructions**:
1. Create the `getActionCountsByInterval` helper function
2. Replace all 4 duplicate queries with the helper
3. Use `Promise.all` for parallel execution (performance improvement)
4. Verify response format unchanged

---

### Task 1.4: Consolidate API Error Parsing Logic

**Problem**: Identical error parsing code in `apiGet` and `apiPost` functions.

**Files Impacted**:
- `src/lib/api.ts`

**Current Pattern** (lines 48-61 and 76-90):
```typescript
// Duplicated in both apiGet and apiPost
if (!response.ok) {
  const bodyText = await response.text();
  let code: string | undefined;
  let message: string | undefined;
  try {
    const data = JSON.parse(bodyText);
    code = data.error;
    message = data.message || data.error;
  } catch {
    // not JSON
  }
  const err = new Error(message || bodyText || `API error: ${response.status}`) as Error & { code?: string; status: number };
  if (code) err.code = code;
  err.status = response.status;
  throw err;
}
```

**Refactored Pattern**:
```typescript
// src/lib/api.ts (UPDATED)

interface ApiError extends Error {
  code?: string;
  status: number;
}

async function parseApiError(response: Response): Promise<never> {
  const bodyText = await response.text();
  let code: string | undefined;
  let message: string | undefined;

  try {
    const data = JSON.parse(bodyText);
    code = data.error;
    message = data.message || data.error;
  } catch {
    // Response is not JSON
  }

  const err = new Error(
    message || bodyText || `API error: ${response.status}`
  ) as ApiError;

  if (code) err.code = code;
  err.status = response.status;
  throw err;
}

export async function apiGet<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}

export async function apiPost<T>(endpoint: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}
```

**Agent Instructions**:
1. Create the `parseApiError` helper function
2. Create the `ApiError` interface
3. Update both `apiGet` and `apiPost` to use the helper
4. Verify frontend API calls still work

---

### Task 1.5: Standardize User Preferences Query Pattern

**Problem**: 5+ places query user preferences with identical patterns.

**Files Impacted**:
- `server/src/routes/training.ts`
- `server/src/routes/settings.ts`
- `server/src/lib/email-processing/email-mover.ts`
- `server/src/lib/email-processing/inbox-processor.ts`

**Current Pattern**:
```typescript
// Repeated in 5+ locations
const userResult = await pool.query(
  `SELECT preferences FROM "user" WHERE id = $1`,
  [userId]
);
const preferences = userResult.rows[0]?.preferences || {};
```

**Refactored Pattern**:
```typescript
// server/src/lib/repositories/user-repository.ts (NEW FILE)
import pool from '../db';

export interface UserPreferences {
  name?: string;
  nicknames?: string[];
  signatureBlock?: string;
  workDomains?: string[];
  familyEmails?: string[];
  spouseEmails?: string[];
  typedNamePrefs?: {
    removeTypedNames: boolean;
    detectAutomatically: boolean;
  };
}

export class UserRepository {
  async getPreferences(userId: string): Promise<UserPreferences> {
    const result = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.preferences || {};
  }

  async updatePreferences(
    userId: string,
    updates: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const current = await this.getPreferences(userId);
    const merged = { ...current, ...updates };

    await pool.query(
      `UPDATE "user" SET preferences = $2 WHERE id = $1`,
      [userId, JSON.stringify(merged)]
    );

    return merged;
  }
}

export const userRepository = new UserRepository();

// Usage in routes:
import { userRepository } from '../lib/repositories/user-repository';

const preferences = await userRepository.getPreferences(userId);
```

**Agent Instructions**:
1. Create `server/src/lib/repositories/user-repository.ts`
2. Define `UserPreferences` interface based on existing usage
3. Replace all direct preference queries with repository calls
4. Ensure all merge logic uses the repository's `updatePreferences`

---

## Phase 2: Type Safety Foundation (Week 3-4)

**Goal**: Eliminate critical `any` usage and establish type safety patterns.

### Task 2.1: Create Core Type Files

**Problem**: Types scattered across implementation files, 125+ uses of `any`.

**New Files to Create**:
```
server/src/types/
├── express.ts          # Express request extensions (from Task 1.1)
├── imap.ts             # IMAP connection, folder, message types
├── email-storage.ts    # Email save params, results
├── websocket.ts        # WebSocket message types
├── errors.ts           # Custom error classes
└── pipeline.ts         # Writing pattern types (consolidated)
```

**Example: server/src/types/imap.ts**:
```typescript
// server/src/types/imap.ts (NEW FILE)

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: ImapAuthConfig;
  tls?: {
    rejectUnauthorized: boolean;
    servername?: string;
  };
}

export interface ImapAuthConfig {
  user: string;
  pass?: string;
  accessToken?: string;
}

export interface ImapFolder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  specialUse?: string;
  listed: boolean;
  subscribed: boolean;
}

export interface ImapMessage {
  uid: number;
  flags: string[];
  envelope: ImapEnvelope;
  bodyStructure?: any;  // Complex IMAP structure
  source?: Buffer;
}

export interface ImapEnvelope {
  date: Date;
  subject: string;
  from: ImapAddress[];
  to: ImapAddress[];
  cc?: ImapAddress[];
  bcc?: ImapAddress[];
  replyTo?: ImapAddress[];
  messageId: string;
  inReplyTo?: string;
}

export interface ImapAddress {
  name?: string;
  address: string;
}

export interface ImapSearchCriteria {
  since?: Date;
  before?: Date;
  from?: string;
  to?: string;
  subject?: string;
  uid?: number | number[];
  seen?: boolean;
  unseen?: boolean;
  flagged?: boolean;
}

// Type guard for search criteria
export function isValidSearchCriteria(obj: unknown): obj is ImapSearchCriteria {
  if (typeof obj !== 'object' || obj === null) return false;
  const criteria = obj as Record<string, unknown>;

  // Validate known fields
  if (criteria.since !== undefined && !(criteria.since instanceof Date)) return false;
  if (criteria.before !== undefined && !(criteria.before instanceof Date)) return false;
  if (criteria.from !== undefined && typeof criteria.from !== 'string') return false;

  return true;
}
```

**Agent Instructions**:
1. Create each type file with proper interfaces
2. Move inline type definitions from implementation files
3. Update imports in all affected files
4. Run `npm run server:build` to verify

---

### Task 2.2: Replace `error: any` with Unknown Type Pattern

**Problem**: 16+ catch blocks use `error: any`, losing type safety.

**Files Impacted**:
- `server/src/routes/relationships.ts` (8 instances)
- `server/src/routes/generate.ts`
- `server/src/routes/training.ts`
- (and more)

**Current Pattern**:
```typescript
} catch (error: any) {
  console.error('Error:', error);
  res.status(500).json({
    error: 'Operation failed',
    message: error.message  // Unsafe access
  });
}
```

**Refactored Pattern**:
```typescript
// server/src/lib/error-utils.ts (NEW FILE)

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code);
  }
  return undefined;
}

export function isErrorWithCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}

// Usage in routes:
import { getErrorMessage, isErrorWithCode } from '../lib/error-utils';

} catch (error: unknown) {
  console.error('Error:', error);

  if (isErrorWithCode(error, 'AUTHENTICATIONFAILED')) {
    res.status(401).json({ error: 'Authentication failed' });
    return;
  }

  res.status(500).json({
    error: 'Operation failed',
    message: getErrorMessage(error)
  });
}
```

**Agent Instructions**:
1. Create `server/src/lib/error-utils.ts`
2. Replace all `catch (error: any)` with `catch (error: unknown)`
3. Use helper functions for safe error property access
4. Run type checks to verify no unsafe access remains

---

### Task 2.3: Type Critical Service Interfaces

**Problem**: Core services use `any` for critical data structures.

**Files Impacted**:
- `server/src/lib/email-storage-service.ts` - `meta: any`, `spamAnalysis: any`
- `server/src/types/llm-provider.ts` - `nlp_features: any`, `relationship: any`

**Current Pattern**:
```typescript
// email-storage-service.ts
interface SaveEmailParamsBase {
  // ...
  meta: any;              // UNSAFE
  spamAnalysis: any;      // UNSAFE
}

// llm-provider.ts
export interface LLMGenerateFromPipelineRequest {
  // ...
  nlp_features: any;       // UNSAFE
  relationship: any;       // UNSAFE
  enhanced_profile: any;   // UNSAFE
}
```

**Refactored Pattern**:
```typescript
// server/src/types/email-storage.ts (NEW FILE)

export interface DraftMetadata {
  generatedAt: string;
  providerId: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  processingTimeMs?: number;
}

export interface SpamAnalysisResult {
  isSpam: boolean;
  confidence: number;
  reasons: string[];
  whitelisted: boolean;
  analysisMethod: 'llm' | 'rule-based' | 'whitelist';
}

export interface SaveEmailParamsBase {
  userId: string;
  emailAccountId: string;
  messageId: string;
  inReplyTo?: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  textContent: string;
  htmlContent?: string;
  receivedAt: Date;
  meta?: DraftMetadata;
  spamAnalysis?: SpamAnalysisResult;
}

// server/src/types/llm-provider.ts (UPDATED)

import { EmailFeatures } from './nlp';
import { RelationshipInfo } from './relationships';
import { EnhancedToneProfile } from './pipeline';

export interface LLMGenerateFromPipelineRequest {
  incoming_email: {
    subject: string;
    body: string;
    from: string;
    to: string;
    cc?: string;
    received_at: string;
  };
  nlp_features: EmailFeatures;
  relationship: RelationshipInfo;
  enhanced_profile: EnhancedToneProfile;
  // ...
}
```

**Agent Instructions**:
1. Create proper interfaces for all `any` fields
2. Update `email-storage-service.ts` imports
3. Update `llm-provider.ts` imports
4. Fix any downstream type errors

---

### Task 2.4: Add Return Type Annotations to Async Methods

**Problem**: 50+ async functions lack explicit return types.

**Files Impacted**:
- `server/src/routes/*.ts` - Route handlers
- `server/src/lib/imap-connection.ts` - `Promise<any>` returns
- `server/src/lib/relationships/*.ts` - Service methods

**Current Pattern**:
```typescript
// Missing return type
router.get('/profile', requireAuth, async (req, res) => {
  // ...
});

// Returns Promise<any>
async selectFolder(folderName: string): Promise<any> {
  // ...
}

// Returns Promise<any[]>
async getRelationshipSuggestions(): Promise<any[]> {
  // ...
}
```

**Refactored Pattern**:
```typescript
// Route handlers with explicit return type
router.get('/profile', requireAuth, async (req, res): Promise<void> => {
  // ...
});

// Properly typed return
async selectFolder(folderName: string): Promise<ImapMailbox> {
  // ...
}

// Properly typed array return
async getRelationshipSuggestions(): Promise<RelationshipSuggestion[]> {
  // ...
}

// New type definition
interface RelationshipSuggestion {
  email: string;
  name?: string;
  suggestedCategory: string;
  confidence: number;
  reason: string;
}
```

**Agent Instructions**:
1. Add `: Promise<void>` to all route handlers
2. Replace `Promise<any>` with specific types
3. Create new interfaces as needed
4. Run `npm run server:build` to catch missing types

---

## Phase 3: Service Layer Extraction (Week 5-7)

**Goal**: Extract business logic from routes into reusable services.

### Task 3.1: Create LLMProviderRepository

**Problem**: Provider configuration queries duplicated in 3+ locations.

**Files Impacted**:
- `server/src/routes/generate.ts` (lines 17-55)
- `server/src/routes/llm-providers.ts` (lines 106-132)
- `server/src/lib/email-processing/spam-detector.ts` (lines 39-64)

**Current Pattern**:
```typescript
// Repeated in multiple files
async function getProviderConfig(userId: string, providerId?: string): Promise<LLMProviderConfig | null> {
  let query: string;
  let params: any[];

  if (providerId) {
    query = `
      SELECT id, provider_type, api_key_encrypted, api_endpoint, model_name
      FROM llm_providers
      WHERE user_id = $1 AND id = $2 AND is_active = true
    `;
    params = [userId, providerId];
  } else {
    query = `
      SELECT id, provider_type, api_key_encrypted, api_endpoint, model_name
      FROM llm_providers
      WHERE user_id = $1 AND is_default = true AND is_active = true
      LIMIT 1
    `;
    params = [userId];
  }

  const result = await pool.query(query, params);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    providerType: row.provider_type,
    apiKey: decryptPassword(row.api_key_encrypted),
    apiEndpoint: row.api_endpoint,
    modelName: row.model_name
  };
}
```

**Refactored Pattern**:
```typescript
// server/src/lib/repositories/llm-provider-repository.ts (NEW FILE)
import pool from '../db';
import { decryptPassword } from '../crypto';
import { LLMProviderConfig, LLMProviderResponse } from '../../types/llm-provider';

export class LLMProviderRepository {
  async getActiveConfig(
    userId: string,
    providerId?: string
  ): Promise<LLMProviderConfig | null> {
    const query = providerId
      ? `SELECT id, provider_type, api_key_encrypted, api_endpoint, model_name
         FROM llm_providers
         WHERE user_id = $1 AND id = $2 AND is_active = true`
      : `SELECT id, provider_type, api_key_encrypted, api_endpoint, model_name
         FROM llm_providers
         WHERE user_id = $1 AND is_default = true AND is_active = true
         LIMIT 1`;

    const params = providerId ? [userId, providerId] : [userId];
    const result = await pool.query(query, params);

    if (result.rows.length === 0) return null;

    return this._mapToConfig(result.rows[0]);
  }

  async getDefaultConfig(userId: string): Promise<LLMProviderConfig | null> {
    return this.getActiveConfig(userId);
  }

  async getAllActive(userId: string): Promise<LLMProviderResponse[]> {
    const result = await pool.query(
      `SELECT id, provider_name, provider_type, api_endpoint, model_name,
              is_active, is_default, created_at, updated_at
       FROM llm_providers
       WHERE user_id = $1 AND is_active = true
       ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return result.rows.map(this._mapToResponse);
  }

  async create(
    userId: string,
    data: CreateLLMProviderRequest
  ): Promise<LLMProviderResponse> {
    const encryptedKey = encryptPassword(data.api_key);

    const result = await pool.query(
      `INSERT INTO llm_providers
       (user_id, provider_name, provider_type, api_key_encrypted,
        api_endpoint, model_name, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING *`,
      [userId, data.provider_name, data.provider_type, encryptedKey,
       data.api_endpoint, data.model_name, data.is_default]
    );

    return this._mapToResponse(result.rows[0]);
  }

  private _mapToConfig(row: any): LLMProviderConfig {
    return {
      id: row.id,
      providerType: row.provider_type,
      apiKey: decryptPassword(row.api_key_encrypted),
      apiEndpoint: row.api_endpoint,
      modelName: row.model_name
    };
  }

  private _mapToResponse(row: any): LLMProviderResponse {
    return {
      id: row.id,
      provider_name: row.provider_name,
      provider_type: row.provider_type,
      api_endpoint: row.api_endpoint,
      model_name: row.model_name,
      is_active: row.is_active,
      is_default: row.is_default,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString()
    };
  }
}

export const llmProviderRepository = new LLMProviderRepository();

// Usage in routes/generate.ts:
import { llmProviderRepository } from '../lib/repositories/llm-provider-repository';

router.post('/draft', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { providerId } = req.body;

  const config = await llmProviderRepository.getActiveConfig(userId, providerId);
  if (!config) {
    res.status(404).json({ error: 'No active LLM provider configured' });
    return;
  }

  // ... rest of logic
}, 'generate draft'));
```

**Agent Instructions**:
1. Create `server/src/lib/repositories/llm-provider-repository.ts`
2. Remove `getProviderConfig` function from `routes/generate.ts`
3. Update all files that query llm_providers to use repository
4. Verify existing tests pass

---

### Task 3.2: Create UserPreferencesService

**Problem**: Complex preference merging logic mixed with HTTP handling.

**Files Impacted**:
- `server/src/routes/settings.ts` (368 lines → ~100 lines after refactor)

**Current Pattern** (settings.ts lines 65-137):
```typescript
router.post('/profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { name, nicknames, signatureBlock, workDomainsCSV, familyEmailsCSV, spouseEmailsCSV } = req.body;

  // CSV parsing logic inline
  const parseCSV = (csv: string | undefined): string[] => {
    if (!csv || csv.trim().length === 0) return [];
    return csv.split(',').map((item: string) => item.trim().toLowerCase()).filter(...);
  };

  // Fetch current preferences
  const currentResult = await pool.query(
    `SELECT preferences FROM "user" WHERE id = $1`,
    [userId]
  );
  const currentPrefs = currentResult.rows[0].preferences || {};

  // Complex merge logic
  const updatedPrefs = {
    ...currentPrefs,
    ...(name !== undefined && { name }),
    ...(nicknames !== undefined && { nicknames }),
    ...(signatureBlock !== undefined && { signatureBlock }),
    ...(workDomainsCSV !== undefined && { workDomains: parseCSV(workDomainsCSV) }),
    ...(familyEmailsCSV !== undefined && { familyEmails: parseCSV(familyEmailsCSV) }),
    ...(spouseEmailsCSV !== undefined && { spouseEmails: parseCSV(spouseEmailsCSV) }),
  };

  // Update with merged preferences
  const result = await pool.query(
    `UPDATE "user" SET preferences = $2 WHERE id = $1 RETURNING preferences`,
    [userId, JSON.stringify(updatedPrefs)]
  );

  // If relationship domains were provided, clear cache and re-categorize
  if (workDomainsCSV !== undefined || familyEmailsCSV !== undefined || spouseEmailsCSV !== undefined) {
    relationshipDetector.clearConfigCache(userId);
    // ... recategorization logic (30+ more lines)
  }

  res.json({ preferences: result.rows[0].preferences });
});
```

**Refactored Pattern**:
```typescript
// server/src/lib/user-preferences-service.ts (NEW FILE)
import pool from './db';
import { relationshipDetector } from './relationships/relationship-detector';
import { relationshipService } from './relationships/relationship-service';

export interface ProfileUpdateRequest {
  name?: string;
  nicknames?: string[];
  signatureBlock?: string;
  workDomainsCSV?: string;
  familyEmailsCSV?: string;
  spouseEmailsCSV?: string;
}

export interface ProfileUpdateResult {
  preferences: UserPreferences;
  recategorizedCount?: number;
}

export class UserPreferencesService {
  async getProfile(userId: string): Promise<UserPreferences> {
    const result = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.preferences || {};
  }

  async updateProfile(
    userId: string,
    updates: ProfileUpdateRequest
  ): Promise<ProfileUpdateResult> {
    const current = await this.getProfile(userId);
    const merged = this._mergePreferences(current, updates);

    await pool.query(
      `UPDATE "user" SET preferences = $2 WHERE id = $1`,
      [userId, JSON.stringify(merged)]
    );

    // Handle recategorization if domain settings changed
    let recategorizedCount: number | undefined;
    if (this._domainSettingsChanged(updates)) {
      recategorizedCount = await this._recategorizeRelationships(userId);
    }

    return { preferences: merged, recategorizedCount };
  }

  private _parseCSV(csv: string | undefined): string[] {
    if (!csv || csv.trim().length === 0) return [];
    return csv
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length > 0);
  }

  private _mergePreferences(
    current: UserPreferences,
    updates: ProfileUpdateRequest
  ): UserPreferences {
    return {
      ...current,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.nicknames !== undefined && { nicknames: updates.nicknames }),
      ...(updates.signatureBlock !== undefined && { signatureBlock: updates.signatureBlock }),
      ...(updates.workDomainsCSV !== undefined && {
        workDomains: this._parseCSV(updates.workDomainsCSV)
      }),
      ...(updates.familyEmailsCSV !== undefined && {
        familyEmails: this._parseCSV(updates.familyEmailsCSV)
      }),
      ...(updates.spouseEmailsCSV !== undefined && {
        spouseEmails: this._parseCSV(updates.spouseEmailsCSV)
      }),
    };
  }

  private _domainSettingsChanged(updates: ProfileUpdateRequest): boolean {
    return updates.workDomainsCSV !== undefined ||
           updates.familyEmailsCSV !== undefined ||
           updates.spouseEmailsCSV !== undefined;
  }

  private async _recategorizeRelationships(userId: string): Promise<number> {
    relationshipDetector.clearConfigCache(userId);

    const relationships = await relationshipService.getAllForUser(userId);
    let recategorizedCount = 0;

    for (const rel of relationships) {
      const newCategory = await relationshipDetector.detectRelationshipType(
        userId,
        rel.email
      );
      if (newCategory !== rel.category) {
        await relationshipService.updateCategory(rel.id, newCategory);
        recategorizedCount++;
      }
    }

    return recategorizedCount;
  }
}

export const userPreferencesService = new UserPreferencesService();

// Usage in routes/settings.ts (NOW MUCH SIMPLER):
import { userPreferencesService } from '../lib/user-preferences-service';

router.post('/profile', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const result = await userPreferencesService.updateProfile(userId, req.body);
  res.json(result);
}, 'update profile'));
```

**Agent Instructions**:
1. Create `server/src/lib/user-preferences-service.ts`
2. Move all preference logic from settings.ts to the service
3. Simplify route handler to just call service
4. Ensure recategorization still works correctly

---

### Task 3.3: Create ToneProfileService

**Problem**: Data transformation and business logic in route handler.

**Files Impacted**:
- `server/src/routes/tone-profile.ts` (97 lines → ~20 lines after refactor)

**Current Pattern** (tone-profile.ts lines 13-78):
```typescript
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    const result = await pool.query(
      `SELECT preference_type, target_identifier, profile_data, emails_analyzed, updated_at
       FROM tone_preferences
       WHERE user_id = $1 AND ...`,
      [userId]
    );

    // Transform rows into object with target identifiers as keys
    const profiles: any = {};
    result.rows.forEach(row => {
      const writingPatterns = row.profile_data.writingPatterns || {};
      profiles[row.target_identifier] = {
        sentencePatterns: writingPatterns.sentencePatterns || null,
        paragraphPatterns: writingPatterns.paragraphPatterns || [],
        openingPatterns: writingPatterns.openingPatterns || [],
        valedictionPatterns: writingPatterns.valedictionPatterns || [],
        // ... 15 more fields
        meta: { ... },
        emails_analyzed: row.emails_analyzed,
        updated_at: row.updated_at,
        preference_type: row.preference_type
      };
    });

    // Calculate totals
    const aggregateProfile = result.rows.find(row => row.target_identifier === 'aggregate');
    const totalEmailsAnalyzed = aggregateProfile ? aggregateProfile.emails_analyzed : 0;

    const emailCountResult = await pool.query(
      'SELECT COUNT(*) as total FROM email_sent WHERE user_id = $1',
      [userId]
    );
    const totalEmailsLoaded = parseInt(emailCountResult.rows[0]?.total || '0');

    res.json({
      profiles,
      totalEmailsAnalyzed,
      totalEmailsLoaded,
      lastUpdated: result.rows.length > 0 ? ... : null,
    });
  } catch (error) {
    // error handling
  }
});
```

**Refactored Pattern**:
```typescript
// server/src/lib/tone-profile-service.ts (NEW FILE)
import pool from './db';

export interface ToneProfileData {
  sentencePatterns: SentencePatterns | null;
  paragraphPatterns: ParagraphPattern[];
  openingPatterns: OpeningPattern[];
  valedictionPatterns: ValedictionPattern[];
  negativePatterns: NegativePattern[];
  responsePatterns: ResponsePatterns | null;
  punctuationPatterns: PunctuationPatterns | null;
  uniqueExpressions: UniqueExpression[];
  vocabularyMetrics: VocabularyMetrics | null;
  meta: ProfileMeta;
  emails_analyzed: number;
  updated_at: string;
  preference_type: string;
}

export interface ToneProfileResponse {
  profiles: Record<string, ToneProfileData>;
  totalEmailsAnalyzed: number;
  totalEmailsLoaded: number;
  lastUpdated: string | null;
}

export class ToneProfileService {
  async getUserProfile(userId: string): Promise<ToneProfileResponse> {
    const [profileResult, countResult] = await Promise.all([
      this._fetchProfiles(userId),
      this._fetchEmailCount(userId)
    ]);

    const profiles = this._transformProfiles(profileResult.rows);
    const aggregateProfile = profileResult.rows.find(
      row => row.target_identifier === 'aggregate'
    );

    return {
      profiles,
      totalEmailsAnalyzed: aggregateProfile?.emails_analyzed ?? 0,
      totalEmailsLoaded: parseInt(countResult.rows[0]?.total || '0'),
      lastUpdated: this._getLastUpdated(profileResult.rows)
    };
  }

  async getProfileByTarget(
    userId: string,
    targetIdentifier: string
  ): Promise<ToneProfileData | null> {
    const result = await pool.query(
      `SELECT * FROM tone_preferences
       WHERE user_id = $1 AND target_identifier = $2`,
      [userId, targetIdentifier]
    );

    if (result.rows.length === 0) return null;

    return this._transformSingleProfile(result.rows[0]);
  }

  async deleteProfile(userId: string, targetIdentifier: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM tone_preferences
       WHERE user_id = $1 AND target_identifier = $2`,
      [userId, targetIdentifier]
    );
    return result.rowCount > 0;
  }

  private async _fetchProfiles(userId: string) {
    return pool.query(
      `SELECT preference_type, target_identifier, profile_data,
              emails_analyzed, updated_at
       FROM tone_preferences
       WHERE user_id = $1`,
      [userId]
    );
  }

  private async _fetchEmailCount(userId: string) {
    return pool.query(
      'SELECT COUNT(*) as total FROM email_sent WHERE user_id = $1',
      [userId]
    );
  }

  private _transformProfiles(rows: any[]): Record<string, ToneProfileData> {
    const profiles: Record<string, ToneProfileData> = {};

    for (const row of rows) {
      profiles[row.target_identifier] = this._transformSingleProfile(row);
    }

    return profiles;
  }

  private _transformSingleProfile(row: any): ToneProfileData {
    const writingPatterns = row.profile_data?.writingPatterns || {};

    return {
      sentencePatterns: writingPatterns.sentencePatterns || null,
      paragraphPatterns: writingPatterns.paragraphPatterns || [],
      openingPatterns: writingPatterns.openingPatterns || [],
      valedictionPatterns: writingPatterns.valedictionPatterns || [],
      negativePatterns: writingPatterns.negativePatterns || [],
      responsePatterns: writingPatterns.responsePatterns || null,
      punctuationPatterns: writingPatterns.punctuationPatterns || null,
      uniqueExpressions: writingPatterns.uniqueExpressions || [],
      vocabularyMetrics: writingPatterns.vocabularyMetrics || null,
      meta: {
        styleClusterName: writingPatterns.meta?.styleClusterName,
        relationship: writingPatterns.meta?.relationship
      },
      emails_analyzed: row.emails_analyzed,
      updated_at: row.updated_at,
      preference_type: row.preference_type
    };
  }

  private _getLastUpdated(rows: any[]): string | null {
    if (rows.length === 0) return null;

    const dates = rows.map(r => new Date(r.updated_at));
    return new Date(Math.max(...dates.map(d => d.getTime()))).toISOString();
  }
}

export const toneProfileService = new ToneProfileService();

// Usage in routes/tone-profile.ts (NOW SIMPLE):
import { toneProfileService } from '../lib/tone-profile-service';

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const result = await toneProfileService.getUserProfile(req.user.id);
  res.json(result);
}, 'fetch tone profile'));

router.delete('/:targetIdentifier', requireAuth, asyncHandler(async (req, res) => {
  const deleted = await toneProfileService.deleteProfile(
    req.user.id,
    req.params.targetIdentifier
  );

  if (!deleted) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  res.json({ success: true });
}, 'delete tone profile'));
```

**Agent Instructions**:
1. Create `server/src/lib/tone-profile-service.ts`
2. Define all necessary types for profile data
3. Move transformation logic from route to service
4. Simplify route handlers to just call service methods

---

## Phase 4: Large File Decomposition (Week 8-10)

**Goal**: Break down files exceeding 500 lines into focused, single-responsibility modules.

### Task 4.1: Decompose WritingPatternAnalyzer (1,495 lines)

**Current State**: `server/src/lib/pipeline/writing-pattern-analyzer.ts`
- 1,495 lines
- 87 conditional branches
- 7+ distinct responsibilities

**Proposed Decomposition**:
```
server/src/lib/pipeline/
├── writing-pattern-analyzer.ts     (orchestrator, ~200 lines)
├── analyzers/
│   ├── sentence-stats-calculator.ts    (~250 lines)
│   ├── paragraph-analyzer.ts           (~150 lines)
│   ├── opening-pattern-extractor.ts    (~100 lines)
│   ├── valediction-extractor.ts        (~100 lines)
│   └── expression-aggregator.ts        (~150 lines)
├── persistence/
│   ├── pattern-cache.ts               (~100 lines)
│   └── pattern-repository.ts          (~150 lines)
└── concurrency/
    └── advisory-lock-manager.ts       (~80 lines)
```

**Example: Extracting SentenceStatsCalculator**

**Current Pattern** (lines 200-420):
```typescript
// Inside WritingPatternAnalyzer class
async calculateSentenceStats(
  userId: string,
  relationship: string,
  styleClusterName?: string
): Promise<SentencePatterns> {
  // Cache checking
  const cached = await this.loadSentenceStats(userId, relationship);
  if (cached) return cached;

  // Advisory lock acquisition
  const lockKey = this._generateLockKey(userId, relationship);
  const lockResult = await db.query('SELECT pg_try_advisory_lock($1)', [lockKey]);
  if (!lockResult.rows[0].pg_try_advisory_lock) {
    // Wait and retry...
  }

  try {
    // Database fetching
    const emails = await this._fetchEmailsFromPostgres(userId, relationship, styleClusterName);

    // Statistical calculations (150+ lines)
    const wordCountsPerSentence: number[] = [];
    for (const email of emails) {
      const sentences = this._splitIntoSentences(email.text);
      for (const sentence of sentences) {
        wordCountsPerSentence.push(sentence.split(/\s+/).length);
      }
    }

    const sortedCounts = [...wordCountsPerSentence].sort((a, b) => a - b);
    const avgLength = ss.mean(wordCountsPerSentence);
    const medianLength = ss.median(sortedCounts);
    const stdDev = ss.standardDeviation(wordCountsPerSentence);
    // ... 50+ more lines of statistics

    const result: SentencePatterns = {
      averageLength: avgLength,
      medianLength: medianLength,
      standardDeviation: stdDev,
      // ... more fields
    };

    // Persistence
    await this.storeSentenceStats(userId, relationship, result);

    return result;
  } finally {
    // Lock release
    await db.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
}
```

**Refactored Pattern**:
```typescript
// server/src/lib/pipeline/analyzers/sentence-stats-calculator.ts (NEW FILE)
import * as ss from 'simple-statistics';
import { SentencePatterns } from '../types';

export interface SentenceAnalysisInput {
  text: string;
  subject?: string;
}

export class SentenceStatsCalculator {
  calculate(emails: SentenceAnalysisInput[]): SentencePatterns {
    const wordCountsPerSentence = this._collectWordCounts(emails);

    if (wordCountsPerSentence.length === 0) {
      return this._emptyPatterns();
    }

    return {
      averageLength: ss.mean(wordCountsPerSentence),
      medianLength: ss.median(wordCountsPerSentence),
      standardDeviation: ss.standardDeviation(wordCountsPerSentence),
      minLength: Math.min(...wordCountsPerSentence),
      maxLength: Math.max(...wordCountsPerSentence),
      percentile25: ss.quantile(wordCountsPerSentence, 0.25),
      percentile75: ss.quantile(wordCountsPerSentence, 0.75),
      totalSentences: wordCountsPerSentence.length,
      distribution: this._calculateDistribution(wordCountsPerSentence)
    };
  }

  private _collectWordCounts(emails: SentenceAnalysisInput[]): number[] {
    const counts: number[] = [];

    for (const email of emails) {
      const sentences = this._splitIntoSentences(email.text);
      for (const sentence of sentences) {
        counts.push(this._countWords(sentence));
      }
    }

    return counts;
  }

  private _splitIntoSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  private _countWords(sentence: string): number {
    return sentence.split(/\s+/).filter(w => w.length > 0).length;
  }

  private _calculateDistribution(counts: number[]): Record<string, number> {
    const distribution: Record<string, number> = {
      short: 0,    // 1-5 words
      medium: 0,   // 6-15 words
      long: 0,     // 16-25 words
      veryLong: 0  // 26+ words
    };

    for (const count of counts) {
      if (count <= 5) distribution.short++;
      else if (count <= 15) distribution.medium++;
      else if (count <= 25) distribution.long++;
      else distribution.veryLong++;
    }

    // Convert to percentages
    const total = counts.length;
    for (const key of Object.keys(distribution)) {
      distribution[key] = Math.round((distribution[key] / total) * 100);
    }

    return distribution;
  }

  private _emptyPatterns(): SentencePatterns {
    return {
      averageLength: 0,
      medianLength: 0,
      standardDeviation: 0,
      minLength: 0,
      maxLength: 0,
      percentile25: 0,
      percentile75: 0,
      totalSentences: 0,
      distribution: { short: 0, medium: 0, long: 0, veryLong: 0 }
    };
  }
}

export const sentenceStatsCalculator = new SentenceStatsCalculator();


// server/src/lib/pipeline/concurrency/advisory-lock-manager.ts (NEW FILE)
import pool from '../../db';

export class AdvisoryLockManager {
  private readonly maxWaitMs = 5000;
  private readonly retryIntervalMs = 100;

  async withLock<T>(
    lockKey: number,
    operation: () => Promise<T>
  ): Promise<T> {
    const acquired = await this._acquireLock(lockKey);

    if (!acquired) {
      throw new Error(`Failed to acquire advisory lock ${lockKey}`);
    }

    try {
      return await operation();
    } finally {
      await this._releaseLock(lockKey);
    }
  }

  async tryWithLock<T>(
    lockKey: number,
    operation: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    const acquired = await this._tryAcquireLock(lockKey);

    if (!acquired) {
      return fallback();
    }

    try {
      return await operation();
    } finally {
      await this._releaseLock(lockKey);
    }
  }

  private async _acquireLock(lockKey: number): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.maxWaitMs) {
      const result = await pool.query(
        'SELECT pg_try_advisory_lock($1)',
        [lockKey]
      );

      if (result.rows[0].pg_try_advisory_lock) {
        return true;
      }

      await this._sleep(this.retryIntervalMs);
    }

    return false;
  }

  private async _tryAcquireLock(lockKey: number): Promise<boolean> {
    const result = await pool.query(
      'SELECT pg_try_advisory_lock($1)',
      [lockKey]
    );
    return result.rows[0].pg_try_advisory_lock;
  }

  private async _releaseLock(lockKey: number): Promise<void> {
    await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const advisoryLockManager = new AdvisoryLockManager();


// server/src/lib/pipeline/writing-pattern-analyzer.ts (SIMPLIFIED ORCHESTRATOR)
import { sentenceStatsCalculator } from './analyzers/sentence-stats-calculator';
import { paragraphAnalyzer } from './analyzers/paragraph-analyzer';
import { openingPatternExtractor } from './analyzers/opening-pattern-extractor';
import { valedictionExtractor } from './analyzers/valediction-extractor';
import { expressionAggregator } from './analyzers/expression-aggregator';
import { patternRepository } from './persistence/pattern-repository';
import { patternCache } from './persistence/pattern-cache';
import { advisoryLockManager } from './concurrency/advisory-lock-manager';
import { emailRepository } from '../repositories/email-repository';

export class WritingPatternAnalyzer {
  async analyzeWritingPatterns(
    userId: string,
    relationship: string,
    styleClusterName?: string
  ): Promise<WritingPatterns> {
    // Check cache first
    const cached = await patternCache.get(userId, relationship);
    if (cached) return cached;

    // Generate lock key
    const lockKey = this._generateLockKey(userId, relationship);

    // Perform analysis with lock
    return advisoryLockManager.withLock(lockKey, async () => {
      // Fetch emails once
      const emails = await emailRepository.getSentEmails(
        userId,
        relationship,
        styleClusterName
      );

      // Run all analyzers in parallel where possible
      const [
        sentencePatterns,
        paragraphPatterns,
        openingPatterns,
        valedictionPatterns
      ] = await Promise.all([
        sentenceStatsCalculator.calculate(emails),
        paragraphAnalyzer.analyze(emails),
        openingPatternExtractor.extract(emails),
        valedictionExtractor.extract(emails)
      ]);

      // Aggregate unique expressions (depends on above)
      const uniqueExpressions = await expressionAggregator.aggregate(
        emails,
        { sentencePatterns, paragraphPatterns }
      );

      const result: WritingPatterns = {
        sentencePatterns,
        paragraphPatterns,
        openingPatterns,
        valedictionPatterns,
        uniqueExpressions
      };

      // Persist and cache
      await Promise.all([
        patternRepository.save(userId, relationship, result),
        patternCache.set(userId, relationship, result)
      ]);

      return result;
    });
  }

  private _generateLockKey(userId: string, relationship: string): number {
    // Generate deterministic lock key from userId and relationship
    const str = `${userId}:${relationship}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}

export const writingPatternAnalyzer = new WritingPatternAnalyzer();
```

**Agent Instructions**:
1. Create the new directory structure under `server/src/lib/pipeline/`
2. Extract `SentenceStatsCalculator` first (pure calculation, easy to test)
3. Extract `AdvisoryLockManager` (reusable across codebase)
4. Create remaining analyzer classes one at a time
5. Update orchestrator to use extracted classes
6. Run tests to verify behavior unchanged

---

### Task 4.2: Decompose ImapOperations (1,227 lines)

**Current State**: `server/src/lib/imap-operations.ts`
- 1,227 lines
- Single class managing all IMAP operations
- 6+ distinct responsibilities

**Proposed Decomposition**:
```
server/src/lib/imap/
├── index.ts                      (barrel exports)
├── imap-operations.ts            (facade, ~150 lines)
├── connection-manager.ts         (~200 lines)
├── message-fetcher.ts            (~250 lines)
├── message-searcher.ts           (~150 lines)
├── folder-manager.ts             (~150 lines)
├── message-mover.ts              (~150 lines)
├── uid-tracker.ts                (~100 lines)
└── types.ts                      (shared types)
```

**Example: Extracting MessageFetcher**

**Refactored Pattern**:
```typescript
// server/src/lib/imap/message-fetcher.ts (NEW FILE)
import { ImapConnection } from '../imap-connection';
import { ImapMessage, FetchOptions, EmailMessage } from './types';
import { uidTracker } from './uid-tracker';

export interface MessageFetchResult {
  messages: EmailMessage[];
  newHighestUid: number;
}

export class MessageFetcher {
  constructor(
    private connection: ImapConnection,
    private accountId: string
  ) {}

  async fetchMessages(
    folderName: string,
    options: FetchOptions = {}
  ): Promise<MessageFetchResult> {
    const {
      limit = 50,
      since,
      includeBody = true,
      onlyNew = false
    } = options;

    // Get last processed UID if fetching only new
    let lastUid = 0;
    if (onlyNew) {
      lastUid = await uidTracker.getLastProcessedUid(this.accountId, folderName);
    }

    // Build search criteria
    const searchCriteria = this._buildSearchCriteria(since, lastUid);

    // Search for matching UIDs
    const uids = await this.connection.search(searchCriteria);

    if (uids.length === 0) {
      return { messages: [], newHighestUid: lastUid };
    }

    // Sort and limit
    const sortedUids = uids.sort((a, b) => b - a);
    const targetUids = sortedUids.slice(0, limit);

    // Fetch messages
    const messages = await this._fetchByUids(targetUids, includeBody);

    // Track highest UID
    const newHighestUid = Math.max(...targetUids, lastUid);
    if (onlyNew) {
      await uidTracker.updateLastProcessedUid(
        this.accountId,
        folderName,
        newHighestUid
      );
    }

    return { messages, newHighestUid };
  }

  async fetchSingleMessage(
    folderName: string,
    uid: number
  ): Promise<EmailMessage | null> {
    await this.connection.selectFolder(folderName);

    const messages = await this._fetchByUids([uid], true);
    return messages[0] || null;
  }

  private async _fetchByUids(
    uids: number[],
    includeBody: boolean
  ): Promise<EmailMessage[]> {
    const fetchOptions = {
      envelope: true,
      flags: true,
      bodyStructure: true,
      ...(includeBody && { source: true })
    };

    const rawMessages = await this.connection.fetch(uids, fetchOptions);

    return rawMessages.map(msg => this._parseMessage(msg));
  }

  private _buildSearchCriteria(since?: Date, afterUid?: number): any[] {
    const criteria: any[] = [];

    if (since) {
      criteria.push(['SINCE', since]);
    }

    if (afterUid && afterUid > 0) {
      criteria.push(['UID', `${afterUid + 1}:*`]);
    }

    return criteria.length > 0 ? criteria : [['ALL']];
  }

  private _parseMessage(raw: ImapMessage): EmailMessage {
    return {
      uid: raw.uid,
      flags: raw.flags,
      subject: raw.envelope?.subject || '',
      from: this._parseAddresses(raw.envelope?.from),
      to: this._parseAddresses(raw.envelope?.to),
      cc: this._parseAddresses(raw.envelope?.cc),
      date: raw.envelope?.date,
      messageId: raw.envelope?.messageId,
      inReplyTo: raw.envelope?.inReplyTo,
      source: raw.source
    };
  }

  private _parseAddresses(addresses?: any[]): string[] {
    if (!addresses) return [];
    return addresses.map(addr =>
      addr.name ? `${addr.name} <${addr.address}>` : addr.address
    );
  }
}


// server/src/lib/imap/imap-operations.ts (SIMPLIFIED FACADE)
import { ImapConnection } from '../imap-connection';
import { MessageFetcher } from './message-fetcher';
import { MessageSearcher } from './message-searcher';
import { FolderManager } from './folder-manager';
import { MessageMover } from './message-mover';
import { ConnectionManager } from './connection-manager';

export class ImapOperations {
  private fetcher: MessageFetcher;
  private searcher: MessageSearcher;
  private folders: FolderManager;
  private mover: MessageMover;

  constructor(
    private connectionManager: ConnectionManager,
    private accountId: string
  ) {
    const connection = connectionManager.getConnection();

    this.fetcher = new MessageFetcher(connection, accountId);
    this.searcher = new MessageSearcher(connection);
    this.folders = new FolderManager(connection);
    this.mover = new MessageMover(connection);
  }

  static async fromAccountId(
    accountId: string,
    userId: string
  ): Promise<ImapOperations> {
    const connectionManager = await ConnectionManager.create(accountId, userId);
    return new ImapOperations(connectionManager, accountId);
  }

  // Delegate to specialized classes
  fetchMessages = this.fetcher.fetchMessages.bind(this.fetcher);
  fetchSingleMessage = this.fetcher.fetchSingleMessage.bind(this.fetcher);

  searchMessages = this.searcher.search.bind(this.searcher);
  searchUids = this.searcher.searchUidsOnly.bind(this.searcher);

  listFolders = this.folders.list.bind(this.folders);
  findFolder = this.folders.find.bind(this.folders);
  createFolder = this.folders.create.bind(this.folders);

  moveMessage = this.mover.move.bind(this.mover);
  copyMessage = this.mover.copy.bind(this.mover);
  deleteMessage = this.mover.delete.bind(this.mover);
  appendMessage = this.mover.append.bind(this.mover);

  async release(): Promise<void> {
    await this.connectionManager.release();
  }
}
```

**Agent Instructions**:
1. Create `server/src/lib/imap/` directory
2. Create types.ts with shared IMAP types
3. Extract each manager class one at a time
4. Create facade that delegates to specialized classes
5. Update all imports to use new structure
6. Verify IMAP operations still work correctly

---

### Task 4.3: Decompose NlpFeatureExtractor (1,189 lines)

**Current State**: `server/src/lib/nlp-feature-extractor.ts`
- 1,189 lines
- 20+ helper functions at module scope
- 139 conditional branches

**Proposed Decomposition**:
```
server/src/lib/nlp/
├── index.ts                         (public API)
├── email-feature-extractor.ts       (orchestrator, ~100 lines)
├── analyzers/
│   ├── sentiment-analyzer.ts        (~200 lines)
│   ├── tonal-qualities-analyzer.ts  (~200 lines)
│   ├── linguistic-style-analyzer.ts (~150 lines)
│   ├── relationship-hints-extractor.ts (~150 lines)
│   ├── action-item-extractor.ts     (~100 lines)
│   └── context-type-inferencer.ts   (~100 lines)
└── types.ts                         (NLP types)
```

**Example: Converting to Class-Based Architecture**

**Refactored Pattern**:
```typescript
// server/src/lib/nlp/email-feature-extractor.ts (NEW ORCHESTRATOR)
import { sentimentAnalyzer } from './analyzers/sentiment-analyzer';
import { tonalQualitiesAnalyzer } from './analyzers/tonal-qualities-analyzer';
import { linguisticStyleAnalyzer } from './analyzers/linguistic-style-analyzer';
import { relationshipHintsExtractor } from './analyzers/relationship-hints-extractor';
import { actionItemExtractor } from './analyzers/action-item-extractor';
import { contextTypeInferencer } from './analyzers/context-type-inferencer';
import { EmailFeatures, RecipientInfo } from './types';
import nlp from 'compromise';

export class EmailFeatureExtractor {
  analyze(
    emailText: string,
    recipientInfo?: RecipientInfo
  ): EmailFeatures {
    // Parse once, share across analyzers
    const doc = nlp(emailText);

    // Run independent analyzers in parallel (conceptually)
    const sentiment = sentimentAnalyzer.analyze(emailText, doc);
    const tonalQualities = tonalQualitiesAnalyzer.analyze(emailText, doc);
    const linguisticStyle = linguisticStyleAnalyzer.analyze(emailText, doc);
    const actionItems = actionItemExtractor.extract(emailText, doc);

    // These depend on previous results
    const relationshipHints = relationshipHintsExtractor.extract(
      emailText,
      doc,
      recipientInfo,
      tonalQualities
    );

    const contextType = contextTypeInferencer.infer(
      emailText,
      tonalQualities,
      actionItems
    );

    // Calculate basic stats
    const stats = this._calculateStats(emailText, doc);

    return {
      sentiment,
      tonalQualities,
      linguisticStyle,
      relationshipHints,
      actionItems,
      contextType,
      stats
    };
  }

  private _calculateStats(text: string, doc: any) {
    const sentences = doc.sentences().out('array');
    const words = doc.terms().out('array');

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      averageWordsPerSentence: sentences.length > 0
        ? Math.round(words.length / sentences.length)
        : 0,
      paragraphCount: text.split(/\n\n+/).filter(p => p.trim()).length
    };
  }
}

export const emailFeatureExtractor = new EmailFeatureExtractor();

// Backward-compatible function export
export function extractEmailFeatures(
  emailText: string,
  recipientInfo?: RecipientInfo
): EmailFeatures {
  return emailFeatureExtractor.analyze(emailText, recipientInfo);
}


// server/src/lib/nlp/analyzers/sentiment-analyzer.ts (NEW FILE)
import Sentiment from 'wink-sentiment';
import { SentimentResult, EmotionScores } from '../types';

export class SentimentAnalyzer {
  private sentiment = Sentiment();

  analyze(text: string, doc: any): SentimentResult {
    const winkResult = this.sentiment.analyze(text);

    const emotions = this._extractEmotions(winkResult);
    const primarySentiment = this._determinePrimary(winkResult.score);
    const confidence = this._calculateConfidence(winkResult);

    return {
      score: winkResult.score,
      comparative: winkResult.comparative,
      primary: primarySentiment,
      emotions,
      confidence,
      emojis: this._extractEmojis(text)
    };
  }

  private _extractEmotions(winkResult: any): EmotionScores {
    const emotions: EmotionScores = {
      joy: 0,
      sadness: 0,
      anger: 0,
      fear: 0,
      surprise: 0,
      trust: 0
    };

    // Map wink tokens to emotions
    for (const token of winkResult.tokens) {
      if (token.score > 0) {
        // Positive words contribute to joy/trust
        emotions.joy += token.score * 0.5;
        emotions.trust += token.score * 0.3;
      } else if (token.score < 0) {
        // Negative words contribute to sadness/anger
        const absScore = Math.abs(token.score);
        emotions.sadness += absScore * 0.4;
        emotions.anger += absScore * 0.3;
      }
    }

    // Normalize to 0-1 range
    const max = Math.max(...Object.values(emotions), 1);
    for (const emotion of Object.keys(emotions) as Array<keyof EmotionScores>) {
      emotions[emotion] = emotions[emotion] / max;
    }

    return emotions;
  }

  private _determinePrimary(score: number): 'positive' | 'negative' | 'neutral' {
    if (score > 2) return 'positive';
    if (score < -2) return 'negative';
    return 'neutral';
  }

  private _calculateConfidence(winkResult: any): number {
    // More tokens analyzed = higher confidence
    const tokenCount = winkResult.tokens?.length || 0;
    const scoredTokenCount = winkResult.tokens?.filter(
      (t: any) => t.score !== 0
    ).length || 0;

    if (tokenCount === 0) return 0;

    // Base confidence on ratio of scored tokens
    const ratio = scoredTokenCount / tokenCount;
    return Math.min(ratio * 1.5, 1); // Cap at 1
  }

  private _extractEmojis(text: string): string[] {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    return text.match(emojiRegex) || [];
  }
}

export const sentimentAnalyzer = new SentimentAnalyzer();
```

**Agent Instructions**:
1. Create `server/src/lib/nlp/` directory structure
2. Create shared types in `types.ts`
3. Extract each analyzer as a separate class
4. Create orchestrator that uses all analyzers
5. Keep backward-compatible function export
6. Verify NLP features output unchanged

---

## Phase 5: Visibility & Encapsulation (Week 11-12)

**Goal**: Reduce public surface area, hide implementation details.

### Task 5.1: Convert ReplyExtractor to Use Private Methods

**Problem**: Many public methods are internal implementation details.

**Files Impacted**:
- `server/src/lib/reply-extractor.ts`

**Current Pattern**:
```typescript
export class ReplyExtractor {
  // These are internal helpers but publicly accessible
  extractUserText(emailBody: string, subject?: string): string { ... }
  extractWithMetadata(emailBody: string, subject?: string): ReplyExtractionResult { ... }
  splitReply(emailBody: string, subject?: string): SplitReplyResult { ... }
  extractFromHtml(htmlContent: string, subject?: string): string { ... }
  preprocessQuotePatterns(emailBody: string, subject?: string): string { ... }
  mergeCodeContinuations(fragments: any[]): any[] { ... }
  isQuotePattern(content: string): boolean { ... }
  // ... many more
}
```

**Refactored Pattern**:
```typescript
export class ReplyExtractor {
  // PUBLIC API - only what external consumers need
  parse(emailBody: string, subject?: string): ReplyExtractionResult {
    return this._extractWithMetadata(emailBody, subject);
  }

  parseHtml(htmlContent: string, subject?: string): string {
    return this._extractFromHtml(htmlContent, subject);
  }

  // PRIVATE METHODS - implementation details
  private _extractUserText(emailBody: string, subject?: string): string { ... }

  private _extractWithMetadata(
    emailBody: string,
    subject?: string
  ): ReplyExtractionResult { ... }

  private _splitReply(
    emailBody: string,
    subject?: string
  ): SplitReplyResult { ... }

  private _extractFromHtml(
    htmlContent: string,
    subject?: string
  ): string { ... }

  private _preprocessQuotePatterns(
    emailBody: string,
    subject?: string
  ): string { ... }

  private _mergeCodeContinuations(fragments: any[]): any[] { ... }

  private _isQuotePattern(content: string): boolean { ... }
}

export const replyExtractor = new ReplyExtractor();
```

**Agent Instructions**:
1. Identify which methods are called externally (grep for usages)
2. Keep only truly public methods as public
3. Rename internal methods with `_` prefix and `private` modifier
4. Update any external callers to use new public API
5. Verify tests pass

---

### Task 5.2: Remove Redundant Export Aliases

**Problem**: Files export both functions and aliases.

**Files Impacted**:
- `server/src/lib/crypto.ts`

**Current Pattern**:
```typescript
export function encryptPassword(password: string): string { ... }
export function decryptPassword(encryptedData: string): string { ... }

// Redundant aliases add confusion
export const encrypt = encryptPassword;
export const decrypt = decryptPassword;
```

**Refactored Pattern**:
```typescript
// Remove aliases, keep only explicit names
export function encryptPassword(password: string): string { ... }
export function decryptPassword(encryptedData: string): string { ... }

// If any code uses `encrypt`/`decrypt`, update those imports to use full names
```

**Agent Instructions**:
1. Search for usages of `encrypt` and `decrypt` aliases
2. Update all imports to use `encryptPassword` and `decryptPassword`
3. Remove alias exports
4. Verify no broken imports

---

### Task 5.3: Create Proper Barrel Exports for Modules

**Problem**: Inconsistent exports across modules, some leak internals.

**Files Impacted**:
- Create or update `index.ts` barrel files in key directories

**Example: server/src/lib/repositories/index.ts**
```typescript
// server/src/lib/repositories/index.ts (NEW FILE)

// Export only public interfaces and singletons
export {
  EmailRepository,
  emailRepository
} from './email-repository';

export {
  LLMProviderRepository,
  llmProviderRepository
} from './llm-provider-repository';

export {
  UserRepository,
  userRepository
} from './user-repository';

// Types
export type {
  EmailQueryParams,
  EmailSearchResult
} from './email-repository';

export type {
  CreateLLMProviderRequest,
  LLMProviderConfig
} from './llm-provider-repository';
```

**Example: server/src/lib/nlp/index.ts**
```typescript
// server/src/lib/nlp/index.ts (NEW FILE)

// Public API only
export {
  extractEmailFeatures,
  emailFeatureExtractor
} from './email-feature-extractor';

// Types
export type {
  EmailFeatures,
  SentimentResult,
  TonalQualities,
  LinguisticStyle,
  RelationshipHints,
  ActionItem
} from './types';

// DO NOT export individual analyzers - they're implementation details
```

**Agent Instructions**:
1. Create barrel files for major directories
2. Export only public API (classes, singletons, functions consumers need)
3. Export types separately for type-only imports
4. Update imports throughout codebase to use barrel imports
5. Verify no broken imports

---

## Summary & Metrics

### Expected Outcomes by Phase

| Phase | Lines Removed | Lines Added | Net Change | Risk Level |
|-------|--------------|-------------|------------|------------|
| Phase 1 | ~500 | ~300 | -200 | Low |
| Phase 2 | ~200 | ~400 | +200 | Low |
| Phase 3 | ~800 | ~600 | -200 | Medium |
| Phase 4 | ~3000 | ~2500 | -500 | Medium |
| Phase 5 | ~100 | ~50 | -50 | Low |

### Key Metrics to Track

**Before Refactoring**:
- `any` usage: 125+ occurrences
- Files >500 lines: 5
- Duplicate code patterns: 69+ (userId extraction alone)
- Route handler avg. length: 80+ lines
- Cyclomatic complexity (max): 87 branches

**Target After Refactoring**:
- `any` usage: <10 (legitimate uses only)
- Files >500 lines: 0
- Duplicate code patterns: 0 (all abstracted)
- Route handler avg. length: <20 lines
- Cyclomatic complexity (max): <15 branches

### Agent Execution Guidelines

Each task is designed for autonomous Claude Code execution:

1. **Clear Before/After Patterns**: Every task shows exact code transformations
2. **Incremental Changes**: Each task can be completed independently
3. **Verification Steps**: Run `npm run server:build` and `npm test` after each task
4. **Rollback Path**: Git commit after each successful task

### Recommended Execution Order

1. **Week 1**: Tasks 1.1, 1.2, 1.3 (highest impact, lowest risk)
2. **Week 2**: Tasks 1.4, 1.5 (completes Phase 1)
3. **Week 3**: Tasks 2.1, 2.2 (type safety foundation)
4. **Week 4**: Tasks 2.3, 2.4 (completes Phase 2)
5. **Week 5-6**: Tasks 3.1, 3.2, 3.3 (service extraction)
6. **Week 7-9**: Tasks 4.1, 4.2, 4.3 (large file decomposition)
7. **Week 10-12**: Tasks 5.1, 5.2, 5.3 (polish and encapsulation)

---

*Report generated by codebase analysis on December 6, 2025*
