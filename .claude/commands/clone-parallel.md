---
description: Create a parallel clone for a second Claude agent
argument-hint: [number, e.g. 2]
---

Create a parallel clone of this repository for running a second Claude agent. The clone will use different ports but share the same database and Redis.

## Instructions

Execute these steps in order:

### 1. Determine clone number and paths

Get the argument (default to 2 if not provided): `$ARGUMENTS`

Determine paths dynamically:
- Current repo root: Use `git rev-parse --show-toplevel` to get the current repo path
- Parent directory: The parent of the repo root
- Repo name: The basename of the repo root (e.g., "T2J")
- Clone name: `{repo-name}-{number}` (e.g., "T2J-2")
- Clone path: `{parent-directory}/{clone-name}`

Calculate ports based on clone number:
- Frontend port: 3000 + (number * 2) + 1 (e.g., clone 2 = 3003, clone 3 = 3005)
- Backend port: 3000 + (number * 2) + 2 (e.g., clone 2 = 3004, clone 3 = 3006)

### 2. Check if clone already exists

If the clone directory already exists, ask the user if they want to:
- Use the existing clone
- Delete and recreate
- Abort

### 3. Clone the repository

Get the remote URL from the current repo:
```bash
git remote get-url origin
```

Then clone:
```bash
cd {parent-directory}
git clone {remote-url} {clone-name}
```

### 4. Set up git branch and tracking

Create a dedicated branch for this clone and set up tracking to origin/main:

```bash
cd {clone-path}
git checkout -b clone{number}
git branch --set-upstream-to=origin/main
git config pull.rebase false
```

This allows the clone to pull updates from main while keeping local changes on a separate branch.

### 5. Install dependencies

```bash
cd {clone-path}
npm install
```

### 6. Create the .env file

Read the current repo's `.env` file and create a modified version for the clone:

**Values to CHANGE (use calculated ports):**
- `FRONTEND_PORT={frontend-port}` (for Next.js dev server)
- `FRONTEND_URL=http://localhost:{frontend-port}`
- `BACKEND_URL=http://localhost:{backend-port}`
- `PORT={backend-port}`
- `NEXT_PUBLIC_API_URL=http://localhost:{backend-port}`
- `TRUSTED_ORIGINS=http://localhost:{frontend-port},http://localhost:{backend-port}`
- Update any OAuth redirect URIs to use the new ports
- `WORKERS_START_PAUSED=true` (always pause workers in clones)

**Values to KEEP THE SAME:**
- `DATABASE_URL` (shared database)
- `REDIS_URL` (shared Redis)
- All secrets (BETTER_AUTH_SECRET, ENCRYPTION_KEY, etc.)
- OAuth client IDs and secrets
- SERVICE_TOKEN

### 7. Create .env.local

Create `{clone-path}/.env.local` with:
```
NEXT_PUBLIC_API_URL=http://localhost:{backend-port}
```

### 8. Report completion

Tell the user:

1. Clone created at: `{clone-path}`
2. Ports: Frontend {frontend-port}, Backend {backend-port}
3. Shared: Database and Redis with main instance
4. Workers: Paused (main instance handles jobs)

To start servers (uses `dev:clone` which skips Redis reset since Redis is shared):
```bash
cd {clone-path}
npm run dev:clone
```

Or separately:
```bash
npm run dev &
npm run server &
npm run workers
```
