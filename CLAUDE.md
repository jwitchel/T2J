# AI Email Assistant Project - Claude Instructions

## Project Overview
This is an AI Email Assistant application that generates email reply drafts matching the user's personal writing tone. The project is managed through GitHub Issues and Projects.

## GitHub CLI Reference

**IMPORTANT**: The `gh project list` command does NOT accept --repo flag. Only use --owner flag.

### Finding Projects and Issues
```bash
# List all projects for an owner (CORRECT)
gh project list --owner jwitchel

# View project details (replace PROJECT_NUMBER with actual number)
gh project view PROJECT_NUMBER --owner jwitchel

# List all issues in the repository
gh issue list --repo jwitchel/test-repo --limit 100

# View specific issue details
gh issue view ISSUE_NUMBER --repo jwitchel/test-repo

# List all issues with specific label
gh issue list --repo jwitchel/test-repo --label "bug"

# Export issues to JSON
gh issue list --repo jwitchel/test-repo --json number,title,body,labels --limit 100 > issues.json
```

### Managing Tasks

**🚨 IMPORTANT: Always add new issues to the project!**
When creating a new issue, you MUST also add it to project 3. The `--project` flag on `gh issue create` does not reliably add issues to projects, so always follow up with `gh project item-add`:

```bash
# Create a new issue
gh issue create --repo jwitchel/T2J --title "Task Title" --body "Task description"

# REQUIRED: Add the issue to project 3 (issues not in the project won't appear in the backlog!)
gh project item-add 3 --owner jwitchel --url https://github.com/jwitchel/T2J/issues/ISSUE_NUMBER

# Edit issue body/description (preferred method for updating subtasks)
gh issue edit ISSUE_NUMBER --repo jwitchel/T2J --body "New content here"

# Add comments ONLY when explicitly requested by user
gh issue comment ISSUE_NUMBER --repo jwitchel/T2J --body "Progress update..."
```

### Project Management
```bash
# List project fields (to get field IDs)
gh project field-list PROJECT_NUMBER --owner jwitchel

# List items in project
gh project item-list PROJECT_NUMBER --owner jwitchel --limit 100

# Move task to "In Progress"
gh project item-edit --owner jwitchel --id ITEM_ID --field-id STATUS_FIELD_ID --project-id PROJECT_ID --text "In Progress"

# Mark task as completed
gh project item-edit --owner jwitchel --id ITEM_ID --field-id STATUS_FIELD_ID --project-id PROJECT_ID --text "Done"

# Archive completed items
gh project item-archive PROJECT_NUMBER --owner jwitchel --id ITEM_ID
```

## Important Configuration Notes
- **Docker Ports** (non-standard to avoid conflicts):
  - PostgreSQL: 5434 (instead of 5432)
  - Redis: 6380 (instead of 6379)
- **Application Ports**:
  - Next.js frontend: 3001 (instead of 3000)
  - Express backend: 3002
- Project structure: Next.js app at repository root (not in subdirectory)
- Express server in `/server` directory

## Working with Subtasks

**IMPORTANT**: Subtasks are the individual checkboxes (- [ ]) in the issue description. They should be performed ONE AT A TIME unless otherwise instructed by the user. Complete each subtask fully before moving to the next one.

**IMPORTANT**: NEVER add comments to issues unless specifically instructed by the user. Always update subtask checkboxes directly in the main issue body using `gh issue edit`.

## Key Architecture Decisions

### Technology Stack
- **Frontend**: Next.js (port 3001) with shadcn/ui
- **Backend**: Express (port 3002) with better-auth
- **Database**: PostgreSQL (port 5434) - includes vector columns
- **Cache/Queue**: Redis (port 6380) - sessions + BullMQ
- **Vector Search**: Vectra in-memory
- **LLM**: Multi-provider via Vercel AI SDK (OpenAI, Anthropic, Google, Ollama)
- **Email**: IMAP with connection pooling, OAuth support, 60s polling

### Development Setup
- Docker runs PostgreSQL, Redis, and the test mail server (node-imap) only
- Next.js and Express run locally (not in Docker) 
- Authentication is centralized in Express API
- Frontend and backend communicate via CORS-enabled API

### Important Architecture Notes
1. **Authentication**: better-auth with scrypt password hashing, httpOnly cookies, OAuth support
2. **Database**: PostgreSQL stores all data including dual vectors (semantic 384d + style 768d)
3. **Email Processing**: BullMQ job IDs + database action tracking prevent duplicates (no external locking)
4. **Vector Storage**: PostgreSQL + Vectra in-memory search (no external vector database)
5. **LLM Integration**: Multi-provider with timeout protection (40s default) and retry logic (3 attempts)
6. **Background Jobs**: Worker pause/resume, deterministic job IDs, stalled job cleanup
7. **IMAP Monitoring**: Polling-based (60s interval via JobSchedulerManager creates BullMQ jobs). IMAP IDLE exists but is opt-in via API - TODO: auto-enable for real-time push

## Development Best Practices

### 🚨 MANDATORY Design Principles - READ THIS FIRST 🚨

**These six principles govern ALL code in this project. Violations are treated as bugs.**

| # | Principle | Rule |
|---|-----------|------|
| 1 | **Trust the Caller** | NEVER validate typed parameters. If the type is `string`, don't check `if (!param)`. |
| 2 | **Throw Hard** | NO try/catch for safety. Let errors propagate. Only catch when you can actually handle it. |
| 3 | **Named Types** | NEVER return anonymous objects. NEVER use `any`. Define interfaces for everything. |
| 4 | **Private Extraction** | Extract helpers WITHIN existing files. Do NOT create new modules for helpers. |
| 5 | **No Defensive Defaults** | NEVER use `|| {}` or `|| []`. If data is missing, that's a bug to fix at the source. |
| 6 | **Search Before Creating** | ALWAYS search the codebase before writing new code. The solution likely exists. |

---

### Fail-Fast Patterns

**Trust your callers. Type your parameters. Let runtime errors throw naturally.**

**Principles:**
- **Assume good parameters** - The caller passed you valid data
- **Use strong typing** - Avoid `any`, use explicit types to catch errors at compile time
- **No defensive validation** - Don't check if a month is between 1-12 if the type is already `number`
- **No try/catch for logic** - Only catch when you can actually handle the error (e.g., network retry)
- **Let hard errors throw** - If something truly unexpected happens, let the runtime throw the error

**Pattern to follow:**
```typescript
// ✅ Good - trust typed parameters
private _isFebruary(month: number): boolean {
  return month === 2;
}

// ❌ Bad - defensive validation of typed parameters
private _isFebruary(month: number): boolean {
  if (month < 1 || month > 12) {
    throw new Error('Invalid month');
  }
  return month === 2;
}

// ✅ Good - let errors throw naturally
async function saveToDatabase(email: Email): Promise<void> {
  await pool.query('INSERT INTO emails VALUES ($1, $2)', [email.id, email.subject]);
  // If query fails, let it throw - caller should handle database errors
}

// ❌ Bad - unnecessary error wrapping
async function saveToDatabase(email: Email): Promise<void> {
  try {
    await pool.query('INSERT INTO emails VALUES ($1, $2)', [email.id, email.subject]);
  } catch (error) {
    throw new Error(`Failed to save email: ${error.message}`);
    // Why? The original error was fine. Just let it throw.
  }
}

// ✅ Good - typed result object for expected outcomes
export interface SaveEmailResult {
  success: boolean;
  skipped: boolean;
  saved?: number;
  error?: string;
}

async function processEmail(email: Email): Promise<SaveEmailResult> {
  // Check for expected conditions (not validation errors)
  if (!email.text && !email.html) {
    return { success: false, skipped: true, error: 'No content' };
  }

  // Trust the data is good, let unexpected errors throw
  const saved = await saveToDatabase(email);
  return { success: true, skipped: false, saved };
}
```

**When to use try/catch:**
- Network operations with retry logic
- External API calls where you can fallback to another provider
- Resource cleanup (finally blocks)
- API entry points where an end-user could force inject malicious or bad inputs 

**When NOT to use try/catch:**
- Parameter validation (use types instead)
- Expected logic paths (use result objects instead)
- "Just in case" error wrapping (let it throw)

**No defensive fallbacks - let missing values fail:**
```typescript
// ❌ Bad - defensive fallback hides missing config
const LIMIT = parseInt(process.env.EMAIL_LIMIT || '1000');
const timeout = config.timeout || 5000;

// ✅ Good - fail immediately if missing
const LIMIT = parseInt(process.env.EMAIL_LIMIT!);
const timeout = config.timeout;
```
If a value is required for the system to operate correctly, let it throw when missing. Don't hide configuration errors with fallback values.

**🚨 NEVER use `|| {}` or `|| []` on database results:**
```typescript
// ❌ BAD - hides schema bugs, masks data issues
const writingPatterns = row.profile_data.writingPatterns || {};
const emails = result.rows || [];
const preferences = user.preferences || {};

// ✅ GOOD - trust the schema, let bugs surface
const writingPatterns = row.profile_data.writingPatterns;
const emails = result.rows;
const preferences = user.preferences;
```
If data is missing from the database, that's a bug in the data creation code. Fix it at the source, don't paper over it at retrieval time.

**Use `??` for protocol-defined optional fields:**
```typescript
// RFC 5322: To, Cc, Reply-To are optional headers in valid emails.
// Marketing emails often use Bcc (empty To), and most emails lack Cc/Reply-To.
// This is NOT a defensive default - these are legitimately optional per protocol.

// ✅ Good - nullish coalescing for protocol-optional fields
const to = (parsed.to ?? []).map(addr => addr.address);
const cc = (parsed.cc ?? []).map(addr => addr.address);
const replyTo = (parsed.replyTo ?? []).map(addr => addr.address);

// ❌ Bad - using || which also triggers on empty arrays
const to = (parsed.to || []).map(addr => addr.address);
```
Use `??` (nullish coalescing) instead of `||` when the field is legitimately optional per protocol/spec. The `??` operator only triggers on `null`/`undefined`, not on empty strings, empty arrays, or `0`.

### DRY Principles - CRITICAL

**🚨 BEFORE WRITING NEW CODE: SEARCH THE CODEBASE FIRST 🚨**

This is the most important rule: **The codebase likely already has a solution to your problem.**

**Required workflow:**
1. **Search first**: Use Grep/Glob to find existing implementations
2. **Reuse existing code**: Favor using existing functions/services over writing new ones
3. **Extend existing types**: Modify existing interfaces rather than creating new ones
4. **Follow established patterns**: Match the style and approach of similar features

**How to search effectively:**

```bash
# Looking to send email? Search first:
grep -r "sendEmail\|send.*mail" server/src/lib/

# Need to fetch from database? Search first:
grep -r "pool.query\|SELECT.*FROM" server/src/

# Need LLM integration? Search first:
grep -r "generateText\|llm.*generate" server/src/

# Need vector search? Search first:
grep -r "vectorSearch\|similarity" server/src/lib/vector/
```

**Examples of existing solutions:**

```typescript
// ✅ Good - use existing LLMClient
import { LLMClient } from '@/lib/llm-client';
const client = new LLMClient(providerId, model);
const result = await client.generateText(prompt);

// ❌ Bad - reimplementing LLM calls
import { generateText } from 'ai';
const result = await generateText({ model, prompt }); // Missing timeout, retry, provider abstraction

// ✅ Good - use existing EmailStorageService
import { emailStorageService } from '@/lib/email-storage-service';
await emailStorageService.saveEmail(email);

// ❌ Bad - direct database calls
await pool.query('INSERT INTO email_sent...'); // Missing validation, vectors, deduplication

// ✅ Good - use existing SpamDetector
import { getSpamDetector } from '@/lib/spam-detector';
const detector = await getSpamDetector(providerId);
const result = await detector.isSpam(email);

// ❌ Bad - reimplementing spam detection
const hasReplied = await checkReplies(email.from);
if (!hasReplied) { /* duplicate logic */ }
```

**Services that already exist (USE THESE):**
- **EmailStorageService** - Save emails with vectors and validation
- **LLMClient** - All LLM calls (timeout, retry, multi-provider)
- **SpamDetector** - Spam detection with auto-whitelist
- **DraftGenerator** - Draft generation with tone learning
- **EmailMover** - IMAP operations (upload drafts, move emails)
- **VectorSearchService** - Dual vector search with filtering
- **RelationshipDetector** - Detect email relationship types
- **EmailActionTracker** - Track email processing actions

**Anti-patterns to avoid:**
- ❌ Copying code from one service to another (extract shared logic instead)
- ❌ Creating similar functions with different names (consolidate under one name)
- ❌ Reimplementing database queries (use repository pattern)
- ❌ Writing custom LLM calls (use LLMClient)
- ❌ Duplicating validation logic (create shared validators)

### Private Methods (NO New Module Decomposition)

**CRITICAL: Extract helpers WITHIN existing files. Do NOT create new files/modules for helper functions.**

Use private methods to hide implementation details and expose clean public APIs.

**When to use private methods:**
- Internal helper functions not meant for external use
- Step-by-step breakdown of complex public methods
- Functions that depend on internal state
- Implementation details that might change

**What NOT to do:**
- ❌ Create `server/src/lib/utils/my-helper.ts` for a one-off helper
- ❌ Create `server/src/lib/helpers/` directories
- ❌ Extract a private method into a separate module "for reuse"
- ❌ Create new files just to reduce line count in existing files

**Pattern:**

```typescript
export class EmailProcessor {
  // Public API - clean interface
  public async processEmail(email: Email): Promise<ProcessingResult> {
    const validated = this._validateEmail(email);
    if (!validated.success) return validated;

    const parsed = await this._parseContent(email);
    const enhanced = await this._enhanceMetadata(parsed);

    return this._finalizeProcessing(enhanced);
  }

  // Private helpers - implementation details
  private _validateEmail(email: Email): ValidationResult {
    // Validation logic
  }

  private async _parseContent(email: Email): Promise<ParsedEmail> {
    // Parsing logic
  }

  private async _enhanceMetadata(parsed: ParsedEmail): Promise<EnhancedEmail> {
    // Enhancement logic
  }

  private _finalizeProcessing(enhanced: EnhancedEmail): ProcessingResult {
    // Finalization logic
  }
}
```

**Benefits:**
- Public methods show what the class does (contract)
- Private methods show how it does it (implementation)
- Easy to refactor private methods without breaking users
- Clear separation between API and internals

**Naming convention:**
- Prefix private methods with `_` (e.g., `_parseContent`)
- Use descriptive names that explain the internal step
- Keep private methods focused on single responsibility

### Well-Defined Types

**CRITICAL: Strongly typed code. No `any`. Use compiler hints. Trust your types.**

**Core Principles:**
1. **Never use `any`** - Use proper types or `unknown` if truly dynamic
2. **Use non-null assertions when you know the value exists** - `email!.subject!` not defensive checks
3. **Trust your types** - If the type says it's there, it's there
4. **Reuse existing types** - The codebase has comprehensive type definitions
5. **Extend existing types** - Modify existing interfaces rather than creating new ones
6. **Never use anonymous objects** - Always define interfaces for return values and parameters
7. **Use explicit return types** - Document what functions return

**Type assertions and compiler hints:**

```typescript
// ✅ Good - use non-null assertion when you know it exists
function processEmail(email: Email): void {
  const subject = email!.subject!;  // Email always has subject
  const sender = email!.from!;      // Email always has sender
  console.log(`Processing: ${subject} from ${sender}`);
}

// ❌ Bad - defensive checks when type already guarantees it
function processEmail(email: Email): void {
  if (!email || !email.subject || !email.from) {
    return;  // Why? Type says Email has these fields
  }
  console.log(`Processing: ${email.subject} from ${email.from}`);
}

// ✅ Good - type narrowing when truly optional
function processEmail(email: Email): void {
  const subject = email.subject ?? 'No Subject';  // If subject is Email['subject'] | undefined
  console.log(`Processing: ${subject}`);
}

// ❌ Bad - using any
function processEmail(email: any): void {
  console.log(email.subject);  // No type safety
}

// ✅ Good - use unknown for truly dynamic data
function parseJson(json: string): unknown {
  return JSON.parse(json);
}

// Then narrow it
const data = parseJson(jsonString);
if (isEmail(data)) {
  processEmail(data);  // Now typed as Email
}
```

**Avoid defensive null checks:**

```typescript
// ✅ Good - trust the parameter type
private _isFebruary(month: number): boolean {
  return month === 2;
}

// ❌ Bad - unnecessary null check
private _isFebruary(month: number | null | undefined): boolean {
  if (month === null || month === undefined) {
    throw new Error('Month is required');
  }
  return month === 2;
}

// ✅ Good - trust array methods
function getFirstEmail(emails: Email[]): Email {
  return emails[0]!;  // Caller ensures non-empty array
}

// ❌ Bad - defensive check when type says it's an array
function getFirstEmail(emails: Email[]): Email | undefined {
  if (!emails || emails.length === 0) {
    return undefined;
  }
  return emails[0];
}
```

**Never use `any`:**

```typescript
// ✅ Good - proper typing
function saveToCache(key: string, value: EmailData): void {
  cache.set(key, value);
}

// ❌ Bad - any destroys type safety
function saveToCache(key: string, value: any): void {
  cache.set(key, value);
}

// ✅ Good - use generics for flexible types
function saveToCache<T>(key: string, value: T): void {
  cache.set(key, value);
}

// ✅ Good - use unknown for truly unknown data
function handleWebhook(payload: unknown): void {
  if (isEmailWebhook(payload)) {
    processEmail(payload.email);  // Type narrowed
  }
}
```

**Type locations:**

```typescript
// Server types
server/src/types/email.ts         // Email-related types
server/src/types/llm.ts           // LLM provider types
server/src/types/express.d.ts     // Express Request extensions (user, session, isServiceToken)
server/src/lib/vector/types.ts    // Vector search types
server/src/lib/email-processing/types.ts  // Processing result types
```

### Extending Express Request Type

The Express Request type is extended globally in `server/src/types/express.d.ts` to add typed properties set by auth middleware:

```typescript
// server/src/types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      user: { id: string; };      // Always set by requireAuth middleware
      session?: unknown;          // Set for session-based auth only
      isServiceToken?: boolean;   // Set for service token auth only
    }
  }
}
export {};
```

**Usage in route handlers:**
```typescript
// ✅ Good - use typed req.user directly
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;  // Typed!
});

// ❌ Bad - casting to any
router.get('/', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;  // Loses type safety
});
```

**Important:** Files that set these properties (like `server/src/middleware/auth.ts`) must include a triple-slash reference to ensure ts-node picks up the type declaration at runtime:
```typescript
/// <reference path="../types/express.d.ts" />
import express from 'express';
```

The `server/tsconfig.json` includes `typeRoots` configuration to make these types available:
```json
{
  "compilerOptions": {
    "typeRoots": ["../node_modules/@types", "./src/types"]
  }
}
```

**Examples:**

```typescript
// ✅ Good - well-defined types
export interface SaveEmailResult {
  success: boolean;
  skipped: boolean;
  saved?: number;
  error?: string;
}

export async function saveEmail(email: Email): Promise<SaveEmailResult> {
  // Implementation
}

// ❌ Bad - anonymous return type
export async function saveEmail(email: Email): Promise<{
  success: boolean;
  skipped?: boolean;
  saved?: number;
  error?: string;
}> {
  // Type exists but isn't reusable
}

// ❌ Bad - no return type
export async function saveEmail(email: Email) {
  return { success: true, saved: 1 }; // What else can this return?
}
```

**Pattern for extending types:**

```typescript
// ✅ Good - extend existing type
import { VectorSearchParams } from '@/lib/vector/types';

export interface ExtendedSearchParams extends VectorSearchParams {
  includeMetadata: boolean;
  minConfidence: number;
}

// ❌ Bad - redefine everything
export interface MySearchParams {
  userId: string;           // Already in VectorSearchParams
  queryText: string;        // Already in VectorSearchParams
  limit: number;            // Already in VectorSearchParams
  includeMetadata: boolean; // New field
  minConfidence: number;    // New field
}
```

**Always define interfaces for:**
- Function return values (especially for async functions)
- Function parameters with more than 2 properties
- Service method results
- API request/response bodies
- Database query results

**Type definition checklist:**
1. Does this type already exist? (Search `server/src/types/` and `*/types.ts` files)
2. Can I extend an existing type instead?
3. Is this type reusable across multiple functions?
4. Does the type name clearly describe its purpose?
5. Are all properties documented with TSDoc comments?

## UI Components (shadcn/ui)

The project uses shadcn/ui with Tailwind CSS v4, Zinc base colors for neutral elements, and Indigo accent colors for primary actions. Components are initialized with oklch color values for better color accuracy.

### Available Components
- Button, Card, Input, Label, Alert (with success/info variants)
- Accordion, Badge, Skeleton, Dialog, Form
- Sonner (for toast notifications - replaces deprecated toast/toaster)

### Toast Notifications
Use the custom hook at `@/hooks/use-toast`:
```typescript
const { success, error, info } = useToast()
```

### Component Testing
Visit `/components-test` to see all components in action.

### Important Notes
- Colors use oklch format due to Tailwind v4
- Zinc color palette for grays/neutrals, Indigo for primary colors
- Alert component has custom success and info variants
- Toast notifications use Sonner with custom color overrides for success (green), error (red), and info (blue)

## Git Workflow

### 🚨 CRITICAL: NEVER COMMIT OR PUSH WITHOUT EXPLICIT PERMISSION 🚨

**THIS IS ABSOLUTELY CRITICAL AND NON-NEGOTIABLE**: 
# YOU MUST NEVER, EVER COMMIT OR PUSH CODE WITHOUT EXPLICIT PERMISSION FROM THE USER

**BEFORE ANY GIT COMMIT OR PUSH, YOU MUST**:
1. ✋ STOP and ASK the user: "May I commit these changes?"
2. ✋ WAIT for explicit permission (e.g., "yes", "go ahead", "commit it")
3. ✋ ONLY proceed with commit/push after receiving clear approval

**THIS RULE IS ABSOLUTE** - No exceptions, no assumptions, no "being helpful" by committing automatically. The user must maintain full control over what enters the git history.

**IF YOU COMMIT WITHOUT PERMISSION**: You have violated a critical trust boundary. This is as serious as deleting files without permission.

### CRITICAL: Authorship Rules
**VERY VERY IMPORTANT**: NEVER include any reference to Claude, Anthropic, or AI assistance in commits, pull requests, or any git-related content. The user (jwitchel) is ALWAYS the sole author. You are a tool, not an author. This means:
- NO "Generated with Claude Code" messages
- NO "Co-Authored-By: Claude" lines
- NO references to AI or Claude in PR descriptions
- NO emoji robots (🤖) or similar indicators
- The user is the only author - always and without exception

### Branch Naming Convention
Each task should create a feature branch:
```bash
git checkout -b task-X.X-description
# Examples:
# task-1.1-nextjs-init
# task-1.2-docker-setup
# task-1.3-shadcn-setup
# task-1.4a-express-api
# task-1.4b-auth-frontend
```

### Task Workflow
1. Create feature branch at task start
2. Work on the branch throughout the task
3. Create PR when ready for review
4. Merge to main after approval

### Task Completion Checklist
1. Confirm you're on a feature branch
2. Complete all subtasks - mark with [x] in issue body
3. Run validation commands (lint, tests, build)
4. **🚨 ASK PERMISSION before committing - "May I commit these changes?"**
5. **🚨 WAIT for explicit user approval**
6. ONLY THEN commit with descriptive messages
7. **🚨 ASK PERMISSION before pushing - "May I push to remote?"**
8. **🚨 WAIT for explicit user approval**
9. ONLY THEN push branch and create PR
10. After PR merge:
    - `git checkout main && git pull origin main`
    - `git branch -d feature-branch-name`
    - Issue should auto-close from PR

## Testing Commands
When completing tasks, always run:
```bash
# Linting
npm run lint

# Type checking (if available)
npx tsc --noEmit

# Server TypeScript check
npm run server:build

# Tests (if available)
npm test

# Test IMAP with Docker email server
npm run test:mail:start  # Start test email server
npm run test:mail:setup  # Create test accounts
npm test -- imap         # Run IMAP tests
```

## IMAP Testing
The project includes a Docker test email server for IMAP development:
- Test accounts: user1@testmail.local, user2@testmail.local, user3@testmail.local
- Password: testpass123
- IMAP ports: 1143 (non-SSL), 1993 (SSL)
- Real IMAP implementation with connection pooling and logging

## Database Access

**IMPORTANT**: When using psql to access the database directly, always use:
```bash
source ~/.zshrc && PGPASSWORD=aiemailpass psql -U aiemailuser -h localhost -p 5434 -d aiemaildb
```

The `source ~/.zshrc` is required because psql is installed via Homebrew at `/opt/homebrew/opt/libpq/bin/psql` and needs the PATH to be set up correctly.

Example queries:
```bash
# Check database version
source ~/.zshrc && PGPASSWORD=aiemailpass psql -U aiemailuser -h localhost -p 5434 -d aiemaildb -c "SELECT version();"

# View tone preferences
source ~/.zshrc && PGPASSWORD=aiemailpass psql -U aiemailuser -h localhost -p 5434 -d aiemaildb -c "SELECT target_identifier, jsonb_pretty(profile_data) FROM tone_preferences LIMIT 1;"
```

## Common Issues and Solutions

### Authentication Issues
1. **Password hashing**: better-auth uses scrypt from @noble/hashes, not bcrypt
2. **Session table**: Must have all required columns (see Architecture Notes)
3. **CORS errors**: Ensure trustedOrigins includes both localhost:3001 and localhost:3002

### Database Issues
1. **Connection refused**: Check Docker is running and using port 5434
2. **Missing tables**: better-auth auto-creates tables on first use

### Development Tips
1. Use `npm run dev:all` to start both servers
2. Check server logs in terminal for debugging
3. Browser DevTools Network tab helps debug auth issues
4. Clear cookies if session problems persist

## Project Files
- **README.md**: User-facing documentation with setup instructions
- **CLAUDE.md**: This file - instructions for Claude
- **docs/FEATURES.md**: Feature reference and API documentation
- **docs/TESTING.md**: Comprehensive testing guide
- **.env.defaults**: Operational config defaults (committed to git)
- **docker-compose.yml**: Docker services configuration
- **/scripts**: Utility scripts for development

## Notes for Future Sessions
- All new tasks should be assigned to the project and given the "Backlog" status initially
- Each task has detailed subtasks, code examples, and acceptance criteria
- **GitHub CLI**: Remember `gh project list` does NOT accept --repo flag, only --owner
- **Subtask Updates**: Always update subtasks in issue body, never use comments unless requested
- **Authentication**: Full system working - use test users for development
- **Validation**: Always run lint before committing
- **🚨 CRITICAL REMINDER**: NEVER commit or push without explicit permission - ALWAYS ASK FIRST!