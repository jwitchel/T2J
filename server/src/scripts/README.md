# Scripts Directory

This directory contains test utilities, tools, and the demo data seed script for the Time to Just project.

## Directory Structure

```
scripts/
├── data/           # Demo data definitions
├── tests/          # Test scripts for specific features
├── tools/          # Utility scripts for data management
└── seed-demo.ts    # Main demo data seeding script
```

## Main Scripts

### Demo Data Seeding

#### `seed-demo.ts`
Comprehensive script that seeds all demo data needed for a fully functional system:
- Creates test users with authentication
- Sets up relationship types
- Creates people (recipients) with email mappings
- Seeds aggregated style patterns
- Ingests sample emails through the pipeline

```bash
npm run seed
```

#### `demos/demo-websocket-processing.ts`
Shows real-time WebSocket integration:
- Live email processing logs
- IMAP operation tracking
- Error monitoring
- Performance metrics

```bash
npm run demo:websocket
```

## Test Scripts

### `tests/vector-comprehensive-test.ts`
Comprehensive test suite for vector storage and embedding services:
- Connection and health checks
- Embedding generation (single and batch)
- Vector similarity search
- Relationship-based filtering
- Near-duplicate detection
- Usage tracking
- Performance testing

```bash
npm run vector:test
```

## Pipeline Scripts (in `src/lib/pipeline/`)

### Core Components

#### `tone-learning-orchestrator.ts`
Main orchestration service that coordinates:
- Email ingestion
- Feature extraction
- Example selection
- Draft generation

```bash
npm run tone:demo
```

#### `test-data-loader.ts`
Manages test data in the vector store:
- Load John's test emails
- Clear test data
- Reset database

```bash
npm run tone:load    # Load test data
npm run tone:clear   # Clear test data
npm run tone:reset   # Reset and reload
```

#### `test-e2e-flow.ts`
End-to-end test of the complete tone learning system:
- Loads test emails
- Processes relationships
- Generates drafts
- Validates output

```bash
npm run tone:e2e
```

### Test Scripts

- `test-pipeline.ts` - Full pipeline integration test
- `test-pipeline-mock.ts` - Pipeline test with mocked dependencies
- `test-prompt-formatter.ts` - Tests prompt generation
- `test-templates.ts` - Tests Handlebars templates

## Prerequisites

### For Demo Scripts
- Docker services running: `docker compose up -d`
- Test users created: `npm run db:seed`

### For Vector/Embedding Tests
- PostgreSQL running: `docker compose up -d postgres`
- Embedding models download on first run (~30MB semantic + ~300MB style)

### For Pipeline Tests
- All Docker services running
- Test email data loaded: `npm run tone:load`

## Common Issues

### "No test data found"
```bash
# Load John's test emails
npm run tone:load
```

### "Port already in use"
```bash
# Reset all Docker services
npm run docker:reset
```

## Adding New Scripts

1. Place demos in `demos/` directory
2. Place tests in `tests/` directory
3. Place utilities in `tools/` directory
4. Update this README with documentation
5. Add npm script to package.json if needed