# T2J Code Quality & Refactoring Plan
## Technical Report for CTO

**Date**: December 6, 2025
**Scope**: Server-side codebase (~35,600 LOC)
**Focus**: DRY principles, fail-fast patterns, type safety, service architecture

---

## Executive Summary

This report identifies **6 major categories** of refactoring opportunities totaling an estimated **~450-550 lines of code reduction** and significant complexity improvements. All tasks are designed for autonomous Claude Code execution with clear before/after patterns.

### Key Design Principles Applied
1. **Trust the caller** - Remove defensive validation on typed parameters
2. **Throw hard** - Let errors propagate naturally; only catch expected errors
3. **Named types** - Replace anonymous objects with well-defined interfaces
4. **Single responsibility** - Extract complex methods into private helpers

---

## Phase 1: Remove Defensive Anti-Patterns
**Estimated Savings: ~80 lines | Risk: Low | Complexity: Simple**

### Task 1.1: Remove Unnecessary Parameter Validation

**Problem**: Methods validate typed parameters that the caller is responsible for providing.

**Files Impacted**:
- `server/src/lib/relationships/person-service.ts` (3 occurrences)
- `server/src/lib/job-scheduler-manager.ts` (3 occurrences)

**Current Pattern** (person-service.ts:300-302):
```typescript
async addEmailToPerson(personId: string, emailAddress: string, userId: string): Promise<PersonWithDetails> {
  // Validate inputs
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
  // If caller passes invalid data, that's a type error at compile time

  const result = await pool.query(
    `INSERT INTO person_emails (person_id, email_address) VALUES ($1, $2)`,
    [personId, emailAddress.toLowerCase()]
  );
  // ... rest of method
}
```

**Agent Instructions**:
1. Remove `if (!userId) throw` blocks from:
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

### Task 1.2: Remove Defensive Defaults That Hide Schema Problems

**Problem**: Using `|| {}` and `|| []` masks data quality issues instead of failing fast.

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

**Note**: If empty arrays are genuinely valid, use explicit initialization at data creation time, not defensive retrieval.

**Agent Instructions**:
1. Audit each `|| {}` and `|| []` usage
2. If the field should never be null/undefined, remove the fallback
3. If empty is valid, document why and consider initializing at creation
4. Run tests to identify any actual schema gaps

**Lines Removed**: ~15 lines

---

## Phase 2: Define Named Types for Anonymous Objects
**Estimated Savings: ~0 lines (net neutral) | Quality: High | Complexity: Simple**

### Task 2.1: Create Response Type Interfaces

**Problem**: 23 instances of anonymous object returns reduce type safety and IDE support.

**New File**: `server/src/types/responses.ts`

```typescript
// ===== IMAP Response Types =====

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

export interface FolderCreationResult {
  created: string[];
  failed: FolderCreationError[];
}

export interface FolderCreationError {
  folder: string;
  error: string;
}

// ===== Pipeline Response Types =====
export interface IngestResult {
  processed: number;
  errors: number;
  duration?: number;
  relationshipDistribution?: Record<string, number>;
}

export interface BatchProcessResult {
  results: ProcessedEmail[];
  metrics: PipelineMetrics;
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
| `lib/email-action-router.ts:169` | `Promise<{ created, failed }>` | `Promise<FolderCreationResult>` |
| `lib/pipeline/tone-learning-orchestrator.ts:82` | `Promise<{ processed, errors, ... }>` | `Promise<IngestResult>` |
| `lib/email-processing/draft-generator.ts:174` | `Promise<{ body, meta, relationship }>` | `Promise<AIPipelineResult>` |
| `lib/vector/bpe-tokenizer.ts:174` | `{ inputIds, attentionMask }` | `TokenizationResult` |

**Agent Instructions**:
1. Create `server/src/types/responses.ts` with all interfaces
2. Update each file to import and use the named type
3. Replace inline `Promise<{ ... }>` with `Promise<TypeName>`
4. Run `npm run server:build` to verify

---

### Task 2.2: Replace `any` Types with Proper Interfaces

**Problem**: Critical service interfaces use `any`, defeating TypeScript's value.

**Files Impacted**:
- `server/src/lib/email-storage-service.ts` (lines 50, 59)
- `server/src/types/llm-provider.ts` (lines 55-57)
- `server/src/lib/email-processing/email-processing-service.ts` (line 45)

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

export interface SpamAnalysisResult {
  isSpam: boolean;
  confidence: number;
  reasons: string[];
  whitelisted: boolean;
  analysisMethod: 'llm' | 'rule-based' | 'whitelist';
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
4. Remove `any` from `email-processing-service.ts` ParsedEmailData

---

## Phase 3: Remove Unnecessary Try-Catch Blocks
**Estimated Savings: ~60 lines | Risk: Low | Complexity: Simple**

### Task 3.1: Remove Log-and-Rethrow Anti-Pattern

**Problem**: Catch blocks that only log and rethrow add noise without value.

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
  // Re-throw - let caller handle errors (already marked as permanent if applicable)
  throw error;
}
```

**Refactored Pattern**:
```typescript
// No try-catch needed - let error propagate naturally
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
**Estimated Savings: ~150-200 lines | Risk: Medium | Complexity: Moderate**

### Task 4.1: Create Typed Request Helper

**Problem**: 69 occurrences of `(req as any).user.id` across all routes.

**New File**: `server/src/types/express.d.ts`

```typescript
import { User } from './user';

declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        email?: string;
      };
    }
  }
}
```

**Current Pattern** (appears 69 times):
```typescript
router.get('/profile', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  // ...
});
```

**Refactored Pattern**:
```typescript
router.get('/profile', requireAuth, async (req, res) => {
  const userId = req.user.id;  // Now type-safe
  // ...
});
```

**Agent Instructions**:
1. Create `server/src/types/express.d.ts` with Request extension
2. Search and replace all `(req as any).user.id` with `req.user.id`
3. Search and replace all `(req as any).user` with `req.user`
4. Run `npm run server:build` to verify

**Lines Simplified**: 69 occurrences, ~30 characters saved each

---

### Task 4.2: Extract Email Normalization Utility

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

### Task 4.3: Extract IMAP Error Handler

**Problem**: Same IMAP error-to-HTTP mapping in 3 routes.

**New File**: `server/src/lib/imap-error-handler.ts`

```typescript
import { ImapConnectionError } from '../types/email-account';

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

### Task 4.4: Extract Recipient Parsing Utility

**Problem**: Identical recipient extraction logic duplicated in EmailStorageService.

**Current Pattern** (email-storage-service.ts, appears twice):
```typescript
const getAddresses = (field: any) => {
  if (!field) return [];
  if (Array.isArray(field)) {
    return field.flatMap(f => f.value || []);
  }
  return field.value || [];
};

const allRecipients = [
  ...getAddresses(parsedEmail.to),
  ...getAddresses(parsedEmail.cc),
  ...getAddresses(parsedEmail.bcc)
];

const uniqueRecipients = Array.from(
  new Map(allRecipients.map(r => [r.address?.toLowerCase(), r])).values()
);
```

**Refactored Pattern**:
```typescript
// Add to EmailStorageService as private method
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
1. Create `_extractUniqueRecipients` private method
2. Replace both inline implementations (lines 337-353 and 501-518)
3. Type the method properly (no `any`)

**Lines Removed**: ~25 lines

---

## Phase 5: Extract Private Helper Methods
**Estimated Savings: Complexity reduction (same LOC) | Risk: Low | Complexity: Moderate**

### Task 5.1: Decompose WritingPatternAnalyzer.calculateSentenceStats()

**Problem**: 219-line method with 5 distinct responsibilities.

**File**: `server/src/lib/pipeline/writing-pattern-analyzer.ts`

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
  // Cache loading logic
}

private async _withAdvisoryLock<T>(
  userId: string,
  relationship: string,
  operation: () => Promise<T>
): Promise<T> {
  // Lock acquisition, operation execution, lock release
}

private _extractSentences(emails: ProcessedEmail[]): string[] {
  // NLP sentence extraction
}

private _calculateMetrics(sentences: string[]): SentenceMetrics {
  // Statistical calculations
}

private _selectExamples(sentences: string[], metrics: SentenceMetrics): string[] {
  // Example selection logic
}

private async _persistStats(userId: string, relationship: string, stats: SentencePatterns): Promise<void> {
  // Database storage
}
```

**Agent Instructions**:
1. Extract each distinct operation into a private method
2. Use descriptive names with underscore prefix
3. Keep the public method as orchestrator
4. Ensure each private method has single responsibility

---

### Task 5.2: Decompose EmailStorageService.saveEmail()

**Problem**: 192-line method handling parsing, embedding, and persistence.

**File**: `server/src/lib/email-storage-service.ts`

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

**Proposed Extraction**:
```typescript
async saveEmail(params: SaveEmailParams): Promise<SaveEmailResult> {
  const content = await this._extractContent(params);
  const embeddings = await this._generateEmbeddings(content);
  const parties = this._extractParties(params, content);

  return this._persistEmail(params, content, embeddings, parties);
}

private async _extractContent(params: SaveEmailParams): Promise<ExtractedContent> { ... }
private async _generateEmbeddings(content: ExtractedContent): Promise<Embeddings> { ... }
private _extractParties(params: SaveEmailParams, content: ExtractedContent): PartyInfo { ... }
private async _persistEmail(...): Promise<SaveEmailResult> { ... }
```

**Agent Instructions**:
1. Extract content processing into `_extractContent`
2. Extract embedding generation into `_generateEmbeddings`
3. Extract party extraction into `_extractParties`
4. Keep persistence as separate `_persistEmail` method

---

### Task 5.3: Decompose NlpFeatureExtractor.extractLinguisticMarkers()

**Problem**: 144-line function with 5 distinct analysis types.

**File**: `server/src/lib/nlp-feature-extractor.ts`

**Proposed Extraction**:
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

function _extractEndearments(doc: any): string[] { ... }
function _extractProfessionalPhrases(doc: any): string[] { ... }
function _detectInformalLanguage(text: string): InformalMarkers { ... }
function _analyzeContractionDensity(doc: any): number { ... }
function _detectStructuralInformality(text: string): StructuralMarkers { ... }
```

---

## Phase 6: Reduce Public Surface Area
**Estimated Savings: ~10 lines | Risk: Low | Complexity: Simple**

### Task 6.1: Make Internal Helpers Private

**Files to Update**:

| File | Function | Action |
|------|----------|--------|
| `email-storage-service.ts` | `validateRawMessage` | Rename to `_validateRawMessage`, remove export |
| `pipeline/retry-utils.ts` | `isRetryableError` | Remove export (only used internally) |
| `db/transaction-utils.ts` | `safeRollback`, `commitAndRelease` | Remove (unused) |

**Agent Instructions**:
1. Search for usages of each function
2. If only used internally, remove export and add underscore prefix
3. If unused entirely, delete the function
4. Run `npm run server:build` to verify no broken imports

---

## Implementation Summary

### Phase Execution Order

| Phase | Name | Lines Saved | Risk | Effort |
|-------|------|-------------|------|--------|
| 1 | Remove Defensive Anti-Patterns | ~80 | Low | 2 hours |
| 2 | Define Named Types | +50 (types) | Low | 3 hours |
| 3 | Remove Unnecessary Try-Catch | ~60 | Low | 2 hours |
| 4 | Consolidate Duplicated Code | ~150 | Medium | 4 hours |
| 5 | Extract Private Helpers | 0 (complexity) | Low | 4 hours |
| 6 | Reduce Public Surface | ~10 | Low | 1 hour |
| **Total** | | **~250-300** | | **~16 hours** |

### Key Files Impacted

| File | Changes |
|------|---------|
| `lib/relationships/person-service.ts` | Remove validation, use shared utilities |
| `lib/email-storage-service.ts` | Extract helpers, add types, remove duplication |
| `lib/pipeline/writing-pattern-analyzer.ts` | Extract 6 private methods |
| `lib/imap-operations.ts` | Remove silent catches, extract helpers |
| `routes/email-accounts.ts` | Use shared IMAP error handler |
| `routes/llm-providers.ts` | Use withTransaction utility |
| `routes/tone-profile.ts` | Remove defensive defaults |

### Verification Steps

After each phase:
1. Run `npm run server:build` - verify TypeScript compiles
2. Run `npm test` - verify tests pass
3. Run `npm run lint` - verify code style
4. Manual smoke test of affected features

---

*Report generated December 6, 2025*
