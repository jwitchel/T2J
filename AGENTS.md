# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Next.js app (frontend)
  - `app/` pages (App Router), `components/`, `lib/`, `hooks/`, `types/`
- `server/`: Express + workers (backend)
  - `src/` with `routes/`, `lib/`, `middleware/`, `websocket/`, `scripts/`, `types/`
  - build output in `server/dist`
- `db/`: migrations and helpers; `scripts/`: developer utilities; `public/`: static assets
- Key configs: `package.json`, `next.config.ts`, `eslint.config.mjs`, `jest.config.*.js`, `docker-compose*.yml`

## Build, Test, and Development Commands
- `npm run dev`: Next.js on port 3001
- `npm run server`: Express server on port 3002 (nodemon)
- `npm run workers`: Start background job workers
- `npm run dev:all`: Frontend + server + workers (kills ports 3001/3002)
- `npm run build` / `npm run server:build`: Build frontend/backend
- `npm test`: All tests. `test:unit` (no services), `test:integration` (services)
- Docker services: `docker:up|down|reset|logs` or per service `postgres:*`, `redis:*`, `mail:*`
- Data setup: `db:migrate`, `seed`

Example: initialize stack for local dev
```
npm install
npm run docker:up && npm run db:migrate && npm run seed
npm run dev:all
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
- Commits: concise, imperative subject (“Fix reply-all detection”), optional body for context; group related changes
- PRs: clear description, link issues, list affected areas, include setup/repro steps and screenshots when UI changes; ensure `npm run lint` and relevant tests pass

## Security & Configuration Tips
- Env files: `.env` (backend) and `.env.local` (frontend); use `.env.example` as reference; never commit secrets
- Local ports: web 3001, API 3002, Postgres 5434, Redis 6380
- Resets: `npm run docker:reset` to wipe services and reseed for a clean slate

## Agent-Specific Instructions (.claude)
- Purpose: `.claude/settings.local.json` defines an allowlist for automation.
- GitHub CLI: `gh issue create/view/list/edit`, `gh project *` (incl. `item-add`), `gh api` (REST/GraphQL), `gh label create`, `gh pr list`, `gh auth refresh`.
- Docker: `docker compose *`, `docker logs/exec/inspect/start/restart`, `docker-compose -f …`, `./test-docker.sh`.
- Node/NPM: `npm install|i`, `npm run *` (incl. `lint`, `build`, `test`, `server:build`, `validate-extraction`, demo/test scripts), `npx jest`, `npx tsx`, `npx ts-node`, `npx next build`.
- System/FS: `ls`, `cp`, `mv`, `rm`, `mkdir`, `chmod`, `touch`, `echo`, `grep`, `find`, `awk`, `tree`, `pkill`, `true`, `source`.
- Networking: `curl`; Web fetch allowed for `github.com`, `www.npmjs.com`, and `www.better-auth.com`; `WebSearch` allowed.
- Database: `psql` commands permitted against local Postgres on `5434` (default DB creds in README/.env.example). Example: `PGPASSWORD=… psql -U aiemailuser -h localhost -p 5434 -d aiemaildb -f db/migrations/011_create_oauth_sessions.sql`.
- Examples: environment overrides for quick runs are allowed, e.g.
  ````
  EXAMPLE_COUNT=5 PIPELINE_BATCH_SIZE=10 npx tsx -e "/* inline script */"
  ````
- Policy: allowlist only; `deny` is empty. Propose additions via PR if new commands are needed.

## Related Docs & Tools
- Training UI: `http://localhost:3001/tone` (click Training tab for training panel + live logs)
- WebSocket logs: `ws://localhost:3002/ws/imap-logs`
- Deep dives: `server/src/lib/imap/README.md`, `server/src/websocket/README.md`, `server/src/websocket/INTEGRATION.md`, `server/src/lib/pipeline/README.md`, `server/src/lib/pipeline/TONE_LEARNING_E2E.md`, `server/src/lib/vector/README.md`, `server/src/scripts/README.md`
