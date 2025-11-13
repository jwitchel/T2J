# AI Email Assistant

An AI-powered email assistant that generates email reply drafts matching your personal writing tone. Built with Next.js, Express.js, and better-auth.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- Docker and Docker Compose
- PostgreSQL client (optional, for direct DB access)

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/jwitchel/test-repo.git
   cd test-repo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create the required environment files:
   ```bash
   # Create .env for backend (Express server)
   cat > .env << 'EOF'
   DATABASE_URL=postgresql://aiemailuser:aiemailpass@localhost:5434/aiemaildb
   BETTER_AUTH_SECRET=your-secret-key-here
   ENCRYPTION_KEY=your-encryption-key-here
   PORT=3002
   FRONTEND_URL=http://localhost:3001
   NODE_ENV=development
   EMAIL_PIPELINE_CONCURRENCY=1
   EOF
   
   # Create .env.local for frontend (Next.js)
   echo "NEXT_PUBLIC_API_URL=http://localhost:3002" > .env.local
   ```
   
   **Note**: Docker services use hardcoded values in docker-compose.yml for consistency.
   
   For production, generate secure keys:
   ```bash
   openssl rand -base64 32  # For BETTER_AUTH_SECRET and ENCRYPTION_KEY
   ```

4. **Start all Docker services**
   ```bash
   npm run docker:up
   ```
   
   This starts:
   - PostgreSQL on port 5434 (non-standard to avoid conflicts)
   - Redis on port 6380 (non-standard to avoid conflicts)
   - Test mail server on ports 1143/1993 (IMAP testing)

5. **Initialize the database**
   ```bash
   npm run db:migrate
   ```

6. **Start the development servers**
   ```bash
   npm run dev:all
   ```
   
   This runs:
   - Next.js frontend on http://localhost:3001
   - Express.js backend on http://localhost:3002
   - Background workers for job processing
   
   Alternative commands:
   - `npm run dev:backend` - Start only backend services (server + workers)
   - `npm run dev` - Start only Next.js frontend
   - `npm run server` - Start only Express server
   - `npm run workers` - Start only background workers

7. **Seed demo data**
   ```bash
   npm run seed        # Seeds all demo data (wipes existing data first)
   ```
   
   This creates:
   - Test users: test1@example.com / password123, test2@example.com / password456
   - Sample emails demonstrating different writing styles
   - Aggregated style patterns for colleague, friend, and manager relationships
   - People (recipients) with relationship mappings

## 📁 Project Structure

```
test-repo/
├── src/                    # Next.js frontend source
│   ├── app/               # App router pages
│   ├── components/        # React components
│   ├── lib/              # Utilities and contexts
│   └── hooks/            # Custom React hooks
├── server/                # Express.js backend
│   ├── src/              # Server source code
│   │   ├── routes/       # API routes
│   │   └── lib/          # Server utilities
│   │       └── vector/   # Vector services (embeddings, PostgreSQL + Vectra)
│   └── tsconfig.json     # Server TypeScript config
├── scripts/               # Utility scripts
├── docker-compose.yml     # Docker services config
└── package.json          # Project dependencies
```

## 🛠️ Available Scripts

```bash
# Development
npm run dev              # Start Next.js frontend (port 3001)
npm run server          # Start Express backend (port 3002)
npm run workers         # Start background job workers
npm run dev:all         # Start frontend, backend, and workers (kills existing processes first)
npm run dev:backend     # Start backend and workers only
npm run dev:kill-ports  # Kill processes on ports 3001 and 3002

# Individual Docker Services
# PostgreSQL Database
npm run postgres:up     # Start PostgreSQL
npm run postgres:down   # Stop PostgreSQL
npm run postgres:reset  # Reset PostgreSQL
npm run postgres:logs   # View PostgreSQL logs

# Redis Cache
npm run redis:up        # Start Redis
npm run redis:down      # Stop Redis
npm run redis:reset     # Reset Redis
npm run redis:logs      # View Redis logs

# Mail Server (IMAP Testing)
npm run mail:up         # Start test mail server
npm run mail:down       # Stop test mail server
npm run mail:reset      # Reset mail server
npm run mail:logs       # View mail server logs
npm run mail:seed       # Create test email accounts

# All Docker Services
npm run docker:up       # Start ALL services (PostgreSQL, Redis, Mail)
npm run docker:down     # Stop ALL services
npm run docker:reset    # Reset ALL services
npm run docker:logs     # View logs for all docker-compose services

# Database Management
npm run db:migrate      # Run database migrations
npm run seed            # Seed all demo data (users, emails, styles, etc.)
npm run vector:test     # Test vector services

# Code Quality
npm run lint            # Run ESLint
npm run build          # Build Next.js for production
npm run server:build   # Build Express server

# Testing
npm test               # Run all tests (requires Docker services)
npm run test:unit      # Run only unit tests (no external dependencies)
npm run test:integration  # Run integration tests (requires all services)

# System Management
npm run system:reset   # Full reset: Docker, DB, and mail accounts
```

## ⚙️ Configuration

### Environment Variables

The project uses environment variables for configuration. Key settings include:

- **EXAMPLE_COUNT**: Number of email examples to use for tone learning (default: 25)
- **DIRECT_EMAIL_MAX_PERCENTAGE**: Maximum portion of examples from direct correspondence (default: 0.6)
- **PATTERN_ANALYSIS_CORPUS_SIZE**: Number of emails to analyze for writing patterns (default: 200)
- **PIPELINE_BATCH_SIZE**: Batch size for email processing (default: 100)
- **VECTOR_SEARCH_LIMIT**: Maximum results from vector search (default: 50)

See `.env.example` for the complete list with descriptions.

### Tone Learning Strategy

The AI learns your writing style using a two-phase approach:

1. **Direct correspondence**: Prioritizes past emails with the specific recipient (up to 60%)
2. **Relationship category**: Fills remaining slots with emails to others in the same relationship type

This ensures the AI captures both your personal communication style with individuals and your general tone for different relationship types.

## 🔑 Authentication

The project uses [better-auth](https://www.better-auth.com/) for authentication with:
- Email/password authentication
- Secure httpOnly cookie sessions
- Protected routes with automatic redirects
- Cross-origin authentication between frontend (3001) and backend (3002)

### Authentication Flow
1. User signs up/signs in at `/signup` or `/signin`
2. Backend creates secure session cookie
3. Protected routes (e.g., `/dashboard`) require authentication
4. Unauthenticated users are redirected to sign in

## 🎨 UI Components

The project uses [shadcn/ui](https://ui.shadcn.com/) components with:
- **Zinc** color palette for neutral elements
- **Indigo** color palette for primary actions
- Pre-configured components including Button, Card, Form, Alert, etc.
- Toast notifications via custom `useToast()` hook

View all components at http://localhost:3001/components-test

## Important Files
- **complete_project_plan.md**: Master project specification document
- **CLAUDE.md**: Instructions for Claude AI assistant
- **TESTING.md**: Comprehensive testing guide

## 📊 Current Project Status

### ✅ Sprint 1 Completed
- [x] Task 1.1: Next.js initialization with TypeScript
- [x] Task 1.2: Docker setup (PostgreSQL, Redis) 
- [x] Task 1.3: shadcn/ui component library setup
- [x] Task 1.4a: Express.js API setup with better-auth
- [x] Task 1.4b: Frontend authentication implementation

### 🚧 What's Working
- Full authentication system (sign up, sign in, sign out)
- Protected routes with session management
- PostgreSQL database with better-auth tables
- Express.js API server with CORS support
- Next.js frontend with TypeScript
- shadcn/ui components with custom theme

### 📋 What's Next
- Sprint 2: Email Integration (IMAP setup, email account management)
- Sprint 3: Tone Analysis Engine
- Sprint 4: Draft Generation
- Sprint 5: Testing & Error Handling
- Sprint 6: Polish & Optimization
- Sprint 7: Production Readiness

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**
   - PostgreSQL uses port 5434 (not standard 5432)
   - Redis uses port 6380 (not standard 6379)
   - Next.js uses port 3001 (not standard 3000)
   - Express uses port 3002

2. **Database connection errors**
   - Ensure Docker is running: `docker compose ps`
   - Check logs: `docker compose logs postgres`
   - Verify connection: `npm run db:test`

3. **Authentication errors**
   - Ensure both servers are running: `npm run dev:all`
   - Check NEXT_PUBLIC_API_URL is set to http://localhost:3002
   - Clear browser cookies if session issues persist

4. **Missing environment variables**
   - Create `.env` and `.env.local` files as shown in setup instructions
   - Generate secure keys for BETTER_AUTH_SECRET and ENCRYPTION_KEY
   - Ensure DATABASE_URL uses port 5434

## 🏗️ Architecture Decisions

- **Monorepo structure**: Frontend and backend in same repository
- **Authentication**: Centralized in Express API using better-auth
- **Database**: PostgreSQL for all data (no separate auth DB)
- **Session management**: Secure httpOnly cookies (no JWT)
- **Real-time updates**: WebSocket support for email processing logs
- **Queue system**: BullMQ with Redis for background jobs
- **Email parsing**: Uses [email-reply-parser](https://github.com/crisp-oss/email-reply-parser) for extracting user content
- **HTML conversion**: Uses [html-to-text](https://www.npmjs.com/package/html-to-text) for reliable HTML parsing
- **Vector storage**: PostgreSQL with Vectra in-memory search, dual embeddings (semantic + style) - see [Vector Services Documentation](server/src/lib/vector/README.md)

## 🔌 Real-time Features

### WebSocket Integration
The application includes real-time logging for email processing operations through WebSocket connections. This provides immediate visibility into:

- IMAP operations (connect, login, fetch, etc.)
- Email parsing and text extraction
- Processing metrics and performance data

For detailed information about the WebSocket architecture and integration, see [server/src/websocket/INTEGRATION.md](server/src/websocket/INTEGRATION.md).

**Live Demo**: Visit http://localhost:3001/tone (Training tab) after signing in to see the real-time logging in action.

## 🤝 Contributing

This project uses GitHub Issues and Projects for task management. Each task:
- Has a feature branch (e.g., `task-1.4b-auth-frontend`)
- Includes detailed subtasks in the issue description
- Requires PR review before merging to main

## 📝 License

Private project - not for public distribution.