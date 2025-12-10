// Load environment variables FIRST, before any other imports
// This file must be imported at the very top of entry points
import dotenv from 'dotenv';
import path from 'path';

// Load .env first (local overrides), then .env.defaults (committed defaults)
// dotenv won't override already-set variables, so .env takes precedence
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.defaults') });
