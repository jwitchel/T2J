# T2J Consolidated Refactoring Plan
## Technical Implementation Guide for Claude Code

**Date**: December 6, 2025
**Scope**: Server-side codebase (~35,600 LOC)
**Estimated Total Savings**: ~400-500 lines of code reduction

---

## Design Principles

All refactoring follows these established patterns:

1. **Trust the caller** - Remove all defensive validation on typed parameters
2. **Throw hard** - Let errors propagate naturally; NO wrapper functions for error handling
3. **Named types** - Replace anonymous objects with well-defined interfaces
4. **Private method extraction** - Extract helpers within existing files (no new module decomposition)
5. **Remove ALL defensive defaults** - Trust the database schema; if data is missing, that's a bug
6. **Always look for an existing method to use before creating a new one** - Most common functions already exist

---

## Phase 1: Type Safety Foundation
**Estimated Savings: 69 occurrences simplified | Risk: Low**

### Task 1.1: Create Typed Express Request Extension

**Problem**: 69 occurrences of `(req as any).user.id` across all routes.

**New File**: `server/src/types/express.d.ts`

```typescript
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        email?: string;
        emailAccountId?: string;
      };
    }
  }
}

export {};
```

**Agent Instructions**:
1. Create `server/src/types/express.d.ts` with the declaration above
2. Search and replace all `(req as any).user.id` with `req.user.id`
3. Search and replace all `(req as any).user` with `req.user`
4. Run `npm run server:build` to verify type safety

**Files Impacted**:
- All files in `server/src/routes/*.ts` (~20 files)

---

### Task 1.2: Create Response Type Interfaces

**Problem**: 23+ instances of anonymous object returns reduce type safety.

**New File**: `server/src/types/responses.ts`

```typescript
// ===== Common Response Types =====

export interface FolderInfo {
  name: string;
  path: string;
  flags?: string[];
  total?: number;
  unseen?: number;
  existing?: string[];
  missing?: string[];
  allFolders?: FolderInfo[];
}

// ===== Pipeline Response Types =====
export interface IngestResult {
  processed: number;
  errors: number;
  duration?: number;
  relationshipDistribution?: Record<string, number>;
}

export interface AIPipelineResult {
  body: string;
  meta: LLMMetadata;
  relationship: RelationshipResult;
}

// ===== Training Response Types =====
export interface TrainingLoadResponse {
  success: boolean;
  processed: number;
  saved: number;
  errors: number;
  duration: number;
}

// ===== Tokenization Types =====
export interface TokenizationResult {
  inputIds: number[];
  attentionMask: number[];
}
```

**Files to Update**:

| File | Anonymous Pattern | Replace With |
|------|-------------------|--------------|
| `lib/imap-operations.ts:242` | `Promise<{ total, unseen }>` | `Promise<FolderInfo>` (with `total` and `unseen` fields) |
| `lib/email-action-router.ts:138` | `Promise<{ existing, missing, allFolders }>` | `Promise<FolderInfo>` (with `existing`, `missing`, and `allFolders` fields) |
| `lib/pipeline/tone-learning-orchestrator.ts:82` | `Promise<{ processed, errors, ... }>` | `Promise<IngestResult>` |
| `lib/email-processing/draft-generator.ts:174` | `Promise<{ body, meta, relationship }>` | `Promise<AIPipelineResult>` |
| `lib/vector/bpe-tokenizer.ts:174` | `{ inputIds, attentionMask }` | `TokenizationResult` |

**Agent Instructions**:
1. Create `server/src/types/responses.ts` with all interfaces
2. Update each file to import and use the named type
3. Replace inline `Promise<{ ... }>` with `Promise<TypeName>`
4. Run `npm run server:build` to verify

---

### Task 1.3: Replace `any` Types with Proper Interfaces

**Problem**: Critical service interfaces use `any`, defeating TypeScript's value.

**Files Impacted**:
- `server/src/lib/email-storage-service.ts` (lines 50, 59)
- `server/src/types/llm-provider.ts` (lines 55-57)

**Current Pattern** (email-storage-service.ts):
```typescript
interface SaveEmailParamsBase {
  // ...
  meta: any;              // UNSAFE
  spamAnalysis: any;      // UNSAFE
}
```

**Refactored Pattern**:
```typescript
export interface DraftMetadata {
  generatedAt: string;
  providerId: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  processingTimeMs?: number;
}

export enum SpamAnalysisMethod {
  LLM = 'llm',
  RULE_BASED = 'rule-based',
  WHITELIST = 'whitelist'
}

export interface SpamAnalysisResult {
  isSpam: boolean;
  confidence: number;
  reasons: string[];
  whitelisted: boolean;
  analysisMethod: SpamAnalysisMethod;
}

interface SaveEmailParamsBase {
  // ...
  meta?: DraftMetadata;
  spamAnalysis?: SpamAnalysisResult;
}
```

**Agent Instructions**:
1. Create proper interfaces for all `any` fields
2. Update `email-storage-service.ts` to use typed metadata
3. Update `llm-provider.ts` to type `nlp_features`, `relationship`, `enhanced_profile`
4. Run `npm run server:build`

---

## Phase 2: Remove Defensive Anti-Patterns
**Estimated Savings: ~95 lines | Risk: Low**

### Task 2.1: Remove Unnecessary Parameter Validation

**Problem**: Methods validate typed parameters that the caller is responsible for providing.

**Files Impacted**:
- `server/src/lib/relationships/person-service.ts` (3 occurrences)
- `server/src/lib/job-scheduler-manager.ts` (3 occurrences)

**Current Pattern** (person-service.ts:300-302):
```typescript
async addEmailToPerson(personId: string, emailAddress: string, userId: string): Promise<PersonWithDetails> {
  // REMOVE THIS - caller provides typed string, not optional
  if (!userId) {
    throw new ValidationError('User ID is required');
  }
  // ... rest of method
}
```

**Refactored Pattern**:
```typescript
async addEmailToPerson(personId: string, emailAddress: string, userId: string): Promise<PersonWithDetails> {
  // Trust caller - userId is typed as string, not string | undefined
  const result = await pool.query(
    `INSERT INTO person_emails (person_id, email_address) VALUES ($1, $2)`,
    [personId, emailAddress.toLowerCase()]
  );
  // ... rest of method
}
```

**Agent Instructions**:
1. Remove `if (!userId) throw` blocks from person-service.ts:
   - `addEmailToPerson()` (line 300)
   - `findPersonByEmail()` (line 513)
   - `getPersonById()` (line 610)
2. Remove `if (!config) throw` blocks from job-scheduler-manager.ts:
   - `enableScheduler()` (line 92)
   - `disableScheduler()` (line 130)
   - `getSchedulerState()` (line 156)
3. Run `npm run server:build` to verify no type errors

**Lines Removed**: ~18 lines

---

### Task 2.2: Remove ALL Defensive Defaults

**Problem**: Using `|| {}` and `|| []` masks data quality issues. Trust the schema.

**Files Impacted**:
- `server/src/routes/tone-profile.ts` (7 occurrences)
- `server/src/lib/relationships/relationship-detector.ts` (4 occurrences)
- `server/src/routes/settings.ts` (1 occurrence)

**Current Pattern** (tone-profile.ts:26-40):
```typescript
const writingPatterns = row.profile_data.writingPatterns || {};

profiles[row.target_identifier] = {
  sentencePatterns: writingPatterns.sentencePatterns || null,
  paragraphPatterns: writingPatterns.paragraphPatterns || [],
  openingPatterns: writingPatterns.openingPatterns || [],
  valedictionPatterns: writingPatterns.valedictionPatterns || [],
  negativePatterns: writingPatterns.negativePatterns || [],
  uniqueExpressions: writingPatterns.uniqueExpressions || [],
  // ...
};
```

**Refactored Pattern**:
```typescript
// Trust the database schema - if data is missing, that's a bug we want to see
const writingPatterns = row.profile_data.writingPatterns;

profiles[row.target_identifier] = {
  sentencePatterns: writingPatterns.sentencePatterns,
  paragraphPatterns: writingPatterns.paragraphPatterns,
  openingPatterns: writingPatterns.openingPatterns,
  valedictionPatterns: writingPatterns.valedictionPatterns,
  negativePatterns: writingPatterns.negativePatterns,
  uniqueExpressions: writingPatterns.uniqueExpressions,
  // ...
};
```

**Agent Instructions**:
1. Remove ALL `|| {}` and `|| []` fallbacks from tone-profile.ts
2. Remove ALL `|| {}` and `|| []` fallbacks from relationship-detector.ts
3. Remove defensive fallback from settings.ts
4. Run tests to identify any actual schema gaps (fix at data creation, not retrieval)

**Lines Removed**: ~15 lines

---

## Phase 3: Remove Unnecessary Try-Catch
**Estimated Savings: ~85 lines | Risk: Low**

### Task 3.1: Remove Log-and-Rethrow Anti-Pattern

**Problem**: Catch blocks that only log and rethrow add noise without value. THROW HARD.

**Files Impacted**:
- `server/src/lib/email-processing/draft-generator.ts` (lines 151-156)
- `server/src/lib/email-processing/inbox-processor.ts` (lines 421-424)
- `server/src/lib/pipeline/writing-pattern-analyzer.ts` (lines 507-511)

**Current Pattern** (draft-generator.ts:151-156):
```typescript
try {
  const result = await this._runAIPipeline(/* ... */);
  return result;
} catch (error: unknown) {
  console.error('[DraftGenerator] Error generating draft:', error);
  // Re-throw - let caller handle errors
  throw error;
}
```

**Refactored Pattern**:
```typescript
// THROW HARD - no try-catch needed, let error propagate naturally
const result = await this._runAIPipeline(/* ... */);
return result;
```

**Agent Instructions**:
1. Remove try-catch from `draft-generator.ts:151-156` - pure log-rethrow
2. Remove inner try-catch from `inbox-processor.ts:421-424` - redundant with outer catch
3. In `writing-pattern-analyzer.ts:507-511`, let database errors throw instead of returning `[]`
4. Run tests to verify error propagation still works

**Lines Removed**: ~20 lines

---

### Task 3.2: Remove Silent Error Swallowing

**Problem**: Catch blocks that swallow errors hide real problems.

**Files Impacted**:
- `server/src/lib/imap-operations.ts` (lines 1096-1109, 1183-1185)
- `server/src/lib/email-processing/inbox-processor.ts` (lines 147-155)

**Current Pattern** (imap-operations.ts:1096-1109):
```typescript
try {
  const headerMsgs = await conn.fetch(uid.toString(), { ... });
  if (headerMsgs.length > 0) {
    const msg = headerMsgs[0] as any;
    const midArr = msg.headers?.messageId;
    messageId = Array.isArray(midArr) ? midArr[0] : undefined;
  }
} catch {
  // Non-fatal: continue without verification
}
```

**Refactored Pattern**:
```typescript
// Let errors throw - if verification fails, we want to know
const headerMsgs = await conn.fetch(uid.toString(), { ... });
if (headerMsgs.length > 0) {
  const msg = headerMsgs[0] as any;
  const midArr = msg.headers?.messageId;
  messageId = Array.isArray(midArr) ? midArr[0] : undefined;
}
```

**Agent Instructions**:
1. Remove empty catch blocks from `imap-operations.ts`
2. Remove silent database query failure from `inbox-processor.ts:147-155`
3. If a value is truly optional, make it explicit without try-catch
4. Run integration tests to verify IMAP operations

**Lines Removed**: ~25 lines

---

### Task 3.3: Use withTransaction Utility

**Problem**: Manual BEGIN/COMMIT/ROLLBACK duplicated in 7 files.

**Files Impacted**:
- `server/src/routes/llm-providers.ts` (lines 136-156)
- `server/src/routes/oauth-email.ts`
- `server/src/routes/oauth-direct.ts`
- `server/src/lib/relationships/person-service.ts`

**Current Pattern** (llm-providers.ts:136-156):
```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... operations ...
  if (existing.rows.length > 0) {
    await client.query('ROLLBACK');
    res.status(409).json({ ... });
    return;
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**Refactored Pattern**:
```typescript
import { withTransaction } from '../lib/db/transaction-utils';

await withTransaction(async (client) => {
  const existing = await client.query(/* ... */);
  if (existing.rows.length > 0) {
    throw new ConflictError('Provider already exists');
  }
  // ... remaining operations ...
});
```

**Agent Instructions**:
1. Import `withTransaction` from `lib/db/transaction-utils`
2. Replace manual transaction management with utility
3. Convert early returns to thrown errors (utility handles rollback)
4. Remove manual `client.release()` calls

**Lines Removed**: ~40 lines across 7 files

---

## Phase 4: Consolidate Duplicated Code
**Estimated Savings: ~75 lines | Risk: Medium**

### Task 4.1: Extract Email Normalization Utility

**Problem**: Email ID normalization implemented in 5 different places.

**New File**: `server/src/lib/utils/email-normalization.ts`

```typescript
/**
 * Normalizes RFC 5322 Message-ID by removing angle brackets.
 * Example: "<abc123@domain.com>" -> "abc123@domain.com"
 */
export function normalizeMessageId(messageId: string): string {
  return messageId.trim().replace(/^<|>$/g, '');
}

/**
 * Normalizes email address for consistent comparison.
 * Example: "  John@Example.COM  " -> "john@example.com"
 */
export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}
```

**Files to Update**:
- `server/src/lib/repositories/email-repository.ts` - remove `normalizeEmailId`
- `server/src/lib/message-id-utils.ts` - consolidate or remove
- `server/src/lib/relationships/person-service.ts` - use shared utility

**Agent Instructions**:
1. Create `server/src/lib/utils/email-normalization.ts`
2. Replace local implementations with imports
3. Remove duplicate `normalizeEmailId` and `_normalizeEmail` methods
4. Run tests to verify normalization behavior

**Lines Removed**: ~20 lines

---

### Task 4.2: Extract IMAP Error Handler

**Problem**: Same IMAP error-to-HTTP mapping in 3 routes.

**New File**: `server/src/lib/imap-error-handler.ts`

```typescript
export interface ImapErrorResponse {
  status: number;
  code: string;
  message: string;
}

export function mapImapError(error: unknown): ImapErrorResponse {
  if (!(error instanceof Error)) {
    return { status: 500, code: 'UNKNOWN', message: 'Unknown error' };
  }

  const errorCode = (error as any).code;
  const errorMessage = error.message;

  if (errorCode === 'AUTHENTICATIONFAILED' || errorMessage.includes('Authentication')) {
    return {
      status: 401,
      code: 'AUTHENTICATIONFAILED',
      message: 'Invalid email credentials'
    };
  }

  if (errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT' || errorMessage.includes('connect')) {
    return {
      status: 400,
      code: 'CONNECTION_FAILED',
      message: 'Unable to connect to IMAP server'
    };
  }

  return {
    status: 500,
    code: 'IMAP_ERROR',
    message: errorMessage
  };
}

export function sendImapError(res: Response, error: unknown): void {
  const { status, code, message } = mapImapError(error);
  res.status(status).json({ error: code, message });
}
```

**Files to Update**:
- `server/src/routes/email-accounts.ts` (lines 51-60, 156-170, 270-282)

**Agent Instructions**:
1. Create `server/src/lib/imap-error-handler.ts`
2. Replace inline error mapping with `sendImapError(res, error)`
3. Remove duplicate error mapping code from routes

**Lines Removed**: ~30 lines

---

### Task 4.3: Extract Dashboard Time Period Query Helper

**Problem**: 4 identical database queries with only the time interval changing.

**File**: `server/src/routes/dashboard-analytics.ts`

**Current Pattern** (lines 16-53):
```typescript
// Repeated 4 times with different intervals
const result15m = await pool.query(`
  SELECT action_taken, COUNT(*)::int as count
  FROM email_received
  WHERE user_id = $1 AND updated_at >= NOW() - INTERVAL '15 minutes'
  GROUP BY action_taken
`, [userId]);

const result1h = await pool.query(`...`);
const result24h = await pool.query(`...`);
const result30d = await pool.query(`...`);
```

**Refactored Pattern**:
```typescript
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

// Usage - parallel execution for performance
const [result15m, result1h, result24h, result30d] = await Promise.all([
  getActionCountsByInterval(userId, '15 minutes'),
  getActionCountsByInterval(userId, '1 hour'),
  getActionCountsByInterval(userId, '24 hours'),
  getActionCountsByInterval(userId, '30 days')
]);
```

**Agent Instructions**:
1. Create the `getActionCountsByInterval` helper function
2. Replace all 4 duplicate queries with the helper
3. Use `Promise.all` for parallel execution (performance improvement)
4. Verify response format unchanged

**Lines Removed**: ~25 lines

---

## Phase 5: Service Layer Extraction
**Estimated Savings: ~200 lines from routes | Risk: Medium**

### Task 5.1: Create UserPreferencesService

**Problem**: Complex preference merging logic mixed with HTTP handling.

**Files Impacted**:
- `server/src/routes/settings.ts` (368 lines -> ~100 lines after refactor)

**New File**: `server/src/lib/user-preferences-service.ts`

```typescript
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
    return result.rows[0].preferences;
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
```

**Route Handler After Refactor** (settings.ts):
```typescript
import { userPreferencesService } from '../lib/user-preferences-service';

router.post('/profile', requireAuth, async (req, res) => {
  const result = await userPreferencesService.updateProfile(req.user.id, req.body);
  res.json(result);
});
```

**Agent Instructions**:
1. Create `server/src/lib/user-preferences-service.ts`
2. Move all preference logic from settings.ts to the service
3. Simplify route handler to just call service
4. Ensure recategorization still works correctly

---

### Task 5.2: Create ToneProfileService

**Problem**: Data transformation and business logic in route handler.

**Files Impacted**:
- `server/src/routes/tone-profile.ts` (97 lines -> ~20 lines after refactor)

**New File**: `server/src/lib/tone-profile-service.ts`

```typescript
import pool from './db';

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
    const writingPatterns = row.profile_data.writingPatterns;
    return {
      sentencePatterns: writingPatterns.sentencePatterns,
      paragraphPatterns: writingPatterns.paragraphPatterns,
      openingPatterns: writingPatterns.openingPatterns,
      valedictionPatterns: writingPatterns.valedictionPatterns,
      negativePatterns: writingPatterns.negativePatterns,
      responsePatterns: writingPatterns.responsePatterns,
      punctuationPatterns: writingPatterns.punctuationPatterns,
      uniqueExpressions: writingPatterns.uniqueExpressions,
      vocabularyMetrics: writingPatterns.vocabularyMetrics,
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
```

**Route Handler After Refactor** (tone-profile.ts):
```typescript
import { toneProfileService } from '../lib/tone-profile-service';

router.get('/', requireAuth, async (req, res) => {
  const result = await toneProfileService.getUserProfile(req.user.id);
  res.json(result);
});

router.delete('/:targetIdentifier', requireAuth, async (req, res) => {
  const deleted = await toneProfileService.deleteProfile(
    req.user.id,
    req.params.targetIdentifier
  );

  if (!deleted) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  res.json({ success: true });
});
```

**Agent Instructions**:
1. Create `server/src/lib/tone-profile-service.ts`
2. Define all necessary types for profile data
3. Move transformation logic from route to service
4. Simplify route handlers to just call service methods
5. NOTE: No defensive defaults in `_transformSingleProfile` - trust the schema

---

## Phase 6: Extract Private Helper Methods
**Estimated Savings: Complexity reduction (same LOC) | Risk: Low**

### Task 6.1: Decompose WritingPatternAnalyzer.calculateSentenceStats()

**Problem**: 219-line method with 5 distinct responsibilities.

**File**: `server/src/lib/pipeline/writing-pattern-analyzer.ts`

**Approach**: Extract private methods WITHIN the existing class (no new files).

**Current Method Structure** (lines 200-419):
```
calculateSentenceStats() {
  - Load from cache or acquire lock (40 lines)
  - Fetch emails from PostgreSQL (10 lines)
  - Extract and process sentences (30 lines)
  - Calculate statistics (35 lines)
  - Select example sentences (30 lines)
  - Store to database (10 lines)
}
```

**Refactored Structure**:
```typescript
async calculateSentenceStats(
  userId: string,
  relationship: string,
  styleClusterName?: string
): Promise<SentencePatterns> {
  const cached = await this._loadCachedStats(userId, relationship);
  if (cached) return cached;

  return this._withAdvisoryLock(userId, relationship, async () => {
    const emails = await this._fetchEmailsForAnalysis(userId, relationship, styleClusterName);
    const sentences = this._extractSentences(emails);
    const metrics = this._calculateMetrics(sentences);
    const examples = this._selectExamples(sentences, metrics);

    const result = { ...metrics, examples };
    await this._persistStats(userId, relationship, result);
    return result;
  });
}

private async _loadCachedStats(userId: string, relationship: string): Promise<SentencePatterns | null> {
  // Cache loading logic (~15 lines)
}

private async _withAdvisoryLock<T>(
  userId: string,
  relationship: string,
  operation: () => Promise<T>
): Promise<T> {
  // Lock acquisition, operation execution, lock release (~25 lines)
}

private _extractSentences(emails: ProcessedEmail[]): string[] {
  // NLP sentence extraction (~20 lines)
}

private _calculateMetrics(sentences: string[]): SentenceMetrics {
  // Statistical calculations (~30 lines)
}

private _selectExamples(sentences: string[], metrics: SentenceMetrics): string[] {
  // Example selection logic (~25 lines)
}

private async _persistStats(userId: string, relationship: string, stats: SentencePatterns): Promise<void> {
  // Database storage (~10 lines)
}
```

**Agent Instructions**:
1. Extract each distinct operation into a private method within the same class
2. Use descriptive names with underscore prefix
3. Keep the public method as orchestrator
4. Ensure each private method has single responsibility
5. Do NOT create new files - keep everything in writing-pattern-analyzer.ts

---

### Task 6.2: Decompose EmailStorageService.saveEmail()

**Problem**: 192-line method handling parsing, embedding, and persistence.

**File**: `server/src/lib/email-storage-service.ts`

**Approach**: Extract private methods WITHIN the existing class (no new files).

**Current Method Structure** (lines 439-631):
```
saveEmail() {
  - Parse and extract content (25 lines)
  - Generate embeddings (30 lines)
  - Extract recipients/sender (70 lines)
  - Save email entries (50 lines)
  - Track draft metadata (25 lines)
}
```

**Refactored Structure**:
```typescript
async saveEmail(params: SaveEmailParams): Promise<SaveEmailResult> {
  const content = await this._extractContent(params);
  const embeddings = await this._generateEmbeddings(content);
  const parties = this._extractParties(params, content);

  return this._persistEmail(params, content, embeddings, parties);
}

private async _extractContent(params: SaveEmailParams): Promise<ExtractedContent> {
  // Content parsing logic (~25 lines)
}

private async _generateEmbeddings(content: ExtractedContent): Promise<Embeddings> {
  // Embedding generation (~30 lines)
}

private _extractParties(params: SaveEmailParams, content: ExtractedContent): PartyInfo {
  // Extract unique recipients (~40 lines)
}

private async _persistEmail(
  params: SaveEmailParams,
  content: ExtractedContent,
  embeddings: Embeddings,
  parties: PartyInfo
): Promise<SaveEmailResult> {
  // Database persistence (~50 lines)
}
```

**Also extract the duplicated recipient logic**:
```typescript
private _extractUniqueRecipients(parsedEmail: PostalMimeEmail): EmailAddress[] {
  const getAddresses = (field: AddressObject | AddressObject[] | undefined): EmailAddress[] => {
    if (!field) return [];
    const fields = Array.isArray(field) ? field : [field];
    return fields.flatMap(f => f.value || []);
  };

  const allRecipients = [
    ...getAddresses(parsedEmail.to),
    ...getAddresses(parsedEmail.cc),
    ...getAddresses(parsedEmail.bcc)
  ];

  return Array.from(
    new Map(allRecipients.map(r => [r.address?.toLowerCase(), r])).values()
  );
}
```

**Agent Instructions**:
1. Extract content processing into `_extractContent`
2. Extract embedding generation into `_generateEmbeddings`
3. Extract party extraction into `_extractParties`
4. Keep persistence as separate `_persistEmail` method
5. Replace both inline recipient extraction implementations with `_extractUniqueRecipients`
6. Do NOT create new files - keep everything in email-storage-service.ts

---

### Task 6.3: Decompose NlpFeatureExtractor.extractLinguisticMarkers()

**Problem**: 144-line function with 5 distinct analysis types.

**File**: `server/src/lib/nlp-feature-extractor.ts`

**Approach**: Extract private helper functions (module-level with underscore prefix).

**Refactored Structure**:
```typescript
function extractLinguisticMarkers(doc: any, text: string): LinguisticMarkers {
  return {
    endearments: _extractEndearments(doc),
    professionalPhrases: _extractProfessionalPhrases(doc),
    informalLanguage: _detectInformalLanguage(text),
    contractionDensity: _analyzeContractionDensity(doc),
    structuralInformality: _detectStructuralInformality(text)
  };
}

function _extractEndearments(doc: any): string[] {
  // ~25 lines
}

function _extractProfessionalPhrases(doc: any): string[] {
  // ~30 lines
}

function _detectInformalLanguage(text: string): InformalMarkers {
  // ~35 lines
}

function _analyzeContractionDensity(doc: any): number {
  // ~20 lines
}

function _detectStructuralInformality(text: string): StructuralMarkers {
  // ~25 lines
}
```

**Agent Instructions**:
1. Extract each analysis type into a module-level private function
2. Use underscore prefix for internal functions
3. Keep the public `extractLinguisticMarkers` as orchestrator
4. Do NOT export the private helper functions

---

## Implementation Summary

### Phase Execution Order

| Phase | Name | Lines Saved | Risk | Effort |
|-------|------|-------------|------|--------|
| 1 | Type Safety Foundation | ~0 (quality) | Low | 3 hours |
| 2 | Remove Defensive Anti-Patterns | ~95 | Low | 2 hours |
| 3 | Remove Unnecessary Try-Catch | ~85 | Low | 2 hours |
| 4 | Consolidate Duplicated Code | ~75 | Medium | 3 hours |
| 5 | Service Layer Extraction | ~200 | Medium | 4 hours |
| 6 | Extract Private Helpers | ~0 (complexity) | Low | 3 hours |
| **Total** | | **~455** | | **~17 hours** |

### Key Files Impacted

| File | Changes |
|------|---------|
| All `routes/*.ts` | Remove `(req as any)`, use `req.user.id` |
| `routes/tone-profile.ts` | Remove ALL defensive defaults, extract to service |
| `routes/settings.ts` | Extract to UserPreferencesService |
| `lib/relationships/person-service.ts` | Remove validation, use shared utilities |
| `lib/email-storage-service.ts` | Extract private helpers, add types |
| `lib/pipeline/writing-pattern-analyzer.ts` | Extract 6 private methods |
| `lib/imap-operations.ts` | Remove silent catches |
| `routes/llm-providers.ts` | Use withTransaction utility |

### Verification Steps

After each phase:
1. Run `npm run server:build` - verify TypeScript compiles
2. Run `npm test` - verify tests pass
3. Run `npm run lint` - verify code style
4. Manual smoke test of affected features

### Agent Execution Guidelines

Each task is designed for autonomous Claude Code execution:

1. **Clear Before/After Patterns**: Every task shows exact code transformations
2. **Incremental Changes**: Each task can be completed independently
3. **Verification Steps**: Run `npm run server:build` and `npm test` after each task
4. **Rollback Path**: Git commit after each successful task
5. **NO NEW MODULE DECOMPOSITION**: Keep helpers in existing files as private methods

---

*Consolidated from CODE_QUALITY_REPORT.md and REFACTORING_PLAN.md on December 6, 2025*
