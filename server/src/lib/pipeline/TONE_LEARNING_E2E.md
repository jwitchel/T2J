# Tone Learning System

## Overview

The tone learning system learns writing style from historical emails and applies it to draft generation.

## Architecture

1. **Email Ingestion**: Historical emails stored in PostgreSQL with dual vectors (semantic + style)
2. **Pattern Learning**: Vector search finds similar emails based on relationship and context
3. **Example Selection**: Two-phase selection prioritizes direct correspondence and relationship category
4. **Draft Generation**: LLM uses selected examples to match tone and style

## Components

See the following files for implementation details:

- **EmailIngestPipeline** (`email-ingest-pipeline.ts`) - Processes and stores emails with vectors
- **ExampleSelector** (`example-selector.ts`) - Selects relevant examples for tone matching
- **ToneLearningOrchestrator** (`tone-learning-orchestrator.ts`) - Coordinates ingestion and generation
- **TemplateManager** (`template-manager.ts`) - Formats prompts with examples

## Testing

See `__tests__/` directory for unit tests.

For integration testing with real data, use the seeding system:

```bash
npm run seed  # Seeds demo users with sample emails
```

## Configuration

Key environment variables:

```bash
EXAMPLE_COUNT=10                    # Examples to use for tone learning
DIRECT_EMAIL_MAX_PERCENTAGE=0.6    # Max portion from direct correspondence
VECTOR_SCORE_THRESHOLD=0.5         # Minimum similarity threshold
```

See `.env.defaults` for complete configuration.