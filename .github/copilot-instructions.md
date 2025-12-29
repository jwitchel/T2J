# Repository Guidelines

## 🚨 MANDATORY Design Principles 🚨

**These principles are NON-NEGOTIABLE. All code changes MUST follow them.**

### 1. Trust the Caller
- **NEVER validate typed parameters** - If the type is `string`, don't check `if (!param)`
- The caller is responsible for passing valid data
- Type errors are caught at compile time, not runtime

### 2. Throw Hard
- **NO try/catch for "safety"** - Let errors propagate naturally
- **NO error wrapping** - Don't catch just to re-throw with a different message
- **NO silent failures** - Never swallow errors with empty catch blocks
- Only catch when you can actually **handle** the error (retry, fallback, cleanup)

### 3. Named Types
- **NEVER return anonymous objects** - Define an interface for every return type
- **NEVER use `any`** - Use proper types or `unknown` if truly dynamic
- All function parameters with 2+ properties must have a named interface

### 4. Private Method Extraction
- **Extract helpers WITHIN existing files** - Do NOT create new modules for helpers
- Use `_` prefix for private methods (e.g., `_parseContent`)
- Keep files cohesive - decomposition happens inside classes, not across files

### 5. No Defensive Defaults
- **NEVER use `|| {}` or `|| []`** - If data is missing, that's a bug and let it throw.
- **NEVER use fallback values for config** - Let missing config fail loudly
- Trust the database schema - if a field should exist, don't provide a default

### 6. Search Before Creating
- **🚨 BEFORE writing ANY new function, SEARCH THE CODEBASE 🚨**
- The solution likely already exists - use Grep/Glob to find it
- Prefer extending existing code over creating new code
- See `CLAUDE.md` for list of existing services to use

**Violating these principles is equivalent to introducing a bug.**

---

## Project Structure & Module Organization
- `src/`: Next.js app (frontend)
  - `app/` pages (App Router), `components/`, `lib/`, `hooks/`, `types/`
- `server/`: Express + workers (backend)
  - `src/` with `routes/`, `lib/`, `middleware/`, `websocket/`, `scripts/`, `types/`
  - build output in `server/dist`
- `db/`: migrations and helpers; `scripts/`: developer utilities; `public/`: static assets
- Key configs: `package.json`, `next.config.ts`, `eslint.config.mjs`, `jest.config.*.js`, `docker-compose*.yml`

## Build, Test, and Development Commands
- `npm run dev`: Unified server (Next.js + Express) + workers on port 3001
- `npm run server`: Unified server only (nodemon)
- `npm run workers`: Start background job workers
- `npm run build` / `npm run server:build`: Build frontend/backend
- `npm test`: All tests. `test:unit` (no services), `test:integration` (services)
- Docker services: `docker:up|down|reset|logs` or per service `postgres:*`, `redis:*`
- Data setup: `db:migrate`, `seed`

Example: initialize stack for local dev
```
npm install
npm run docker:up && npm run db:migrate && npm run seed
npm run dev
```

## Coding Style & Naming Conventions
- Language: TypeScript (frontend and backend)
- Linting: ESLint with Next presets (`npm run lint`)
- Indentation/formatting: 2‑space; keep imports ordered; prefer explicit types on exported APIs
- Names: `camelCase` for vars/functions, `PascalCase` for React components/types, route files follow Next.js/Express conventions
- File paths: co-locate tests in `server/src/__tests__` or alongside modules when appropriate

## Testing Guidelines
- Framework: Jest (`jest.config.unit.js`, `jest.config.integration.js`)
- Naming: unit → `*.unit.test.ts`; integration → `*.integration.test.ts`
- Coverage: keep meaningful assertions; prefer unit tests for logic, integration for DB/Redis/mail flows
- Run: `npm run test:unit` locally; for integration tests start services first: `npm run docker:up && npm run test:integration`

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject ("Fix reply-all detection"), optional body for context; group related changes
- PRs: clear description, link issues, list affected areas, include setup/repro steps and screenshots when UI changes; ensure `npm run lint` and relevant tests pass

## Security & Configuration Tips
- Env files: `.env` (backend secrets) and `.env.local` (frontend); `.env.defaults` has operational config; never commit secrets
- Local ports: unified server 3001, Postgres 5434, Redis 6380
- Resets: `npm run docker:reset` to wipe services and reseed for a clean slate

## Agent-Specific Instructions (.claude)
- Purpose: `.claude/settings.local.json` defines an allowlist for automation.
- **🚨 IMPORTANT: When creating issues, ALWAYS add them to project 3!**
  - After `gh issue create`, run: `gh project item-add 3 --owner jwitchel --url <issue-url>`
  - Issues not added to the project will NOT appear in the prioritized backlog
- GitHub CLI: `gh issue create/view/list/edit`, `gh project *` (incl. `item-add`), `gh api` (REST/GraphQL), `gh label create`, `gh pr list`, `gh auth refresh`.
- Docker: `docker compose *`, `docker logs/exec/inspect/start/restart`, `docker-compose -f …`, `./test-docker.sh`.
- Node/NPM: `npm install|i`, `npm run *` (incl. `lint`, `build`, `test`, `server:build`, `validate-extraction`, demo/test scripts), `npx jest`, `npx tsx`, `npx ts-node`, `npx next build`.
- System/FS: `ls`, `cp`, `mv`, `rm`, `mkdir`, `chmod`, `touch`, `echo`, `grep`, `find`, `awk`, `tree`, `pkill`, `true`, `source`.
- Networking: `curl`; Web fetch allowed for `github.com`, `www.npmjs.com`, and `www.better-auth.com`; `WebSearch` allowed.
- Database: `psql` commands permitted against local Postgres on `5434` (default DB creds in README). Example: `PGPASSWORD=… psql -U aiemailuser -h localhost -p 5434 -d aiemaildb -f db/migrations/011_create_oauth_sessions.sql`.
- Examples: environment overrides for quick runs are allowed, e.g.
  ````
  EXAMPLE_COUNT=5 PIPELINE_BATCH_SIZE=10 npx tsx -e "/* inline script */"
  ````
- Policy: allowlist only; `deny` is empty. Propose additions via PR if new commands are needed.

## Related Docs & Tools
- Training UI: `http://localhost:3001/tone` (click Training tab for training panel + live logs)
- WebSocket logs: `ws://localhost:3001/ws`
- Deep dives: `server/src/lib/imap/README.md`, `server/src/lib/pipeline/README.md`, `server/src/lib/pipeline/TONE_LEARNING_E2E.md`, `server/src/lib/vector/README.md`, `server/src/scripts/README.md`, `docs/SUPPORTING_DOCS.md`
