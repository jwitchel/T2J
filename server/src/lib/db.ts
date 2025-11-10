import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from root .env file
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Database connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
