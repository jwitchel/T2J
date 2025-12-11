const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://aiemailuser:aiemailpass@localhost:5434/aiemaildb'
});

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function isMigrationApplied(client, name) {
  const result = await client.query(
    'SELECT 1 FROM schema_migrations WHERE name = $1',
    [name]
  );
  return result.rows.length > 0;
}

async function recordMigration(client, name) {
  await client.query(
    'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [name]
  );
}

async function runMigration() {
  const client = await pool.connect();

  try {
    // Create migrations tracking table first
    await ensureMigrationsTable(client);

    // Run better-auth schema (idempotent - uses IF NOT EXISTS)
    if (!(await isMigrationApplied(client, 'better-auth-schema'))) {
      const betterAuthSchema = fs.readFileSync(path.join(__dirname, 'better-auth-schema.sql'), 'utf8');
      await client.query(betterAuthSchema);
      await recordMigration(client, 'better-auth-schema');
      console.log('Better-auth schema migration completed');
    } else {
      console.log('Better-auth schema already applied, skipping');
    }

    // Run the original schema (idempotent - uses IF NOT EXISTS)
    if (!(await isMigrationApplied(client, 'base-schema'))) {
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await client.query(schema);
      await recordMigration(client, 'base-schema');
      console.log('Base schema migration completed');
    } else {
      console.log('Base schema already applied, skipping');
    }

    // Run the relationship schema (idempotent - uses IF NOT EXISTS)
    if (!(await isMigrationApplied(client, 'relationship-schema'))) {
      const relationshipSchema = fs.readFileSync(path.join(__dirname, 'relationship-schema.sql'), 'utf8');
      await client.query(relationshipSchema);
      await recordMigration(client, 'relationship-schema');
      console.log('Relationship schema migration completed');
    } else {
      console.log('Relationship schema already applied, skipping');
    }

    // Run numbered migrations in order from db/migrations
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

      for (const file of migrationFiles) {
        if (await isMigrationApplied(client, file)) {
          console.log(`Migration ${file} already applied, skipping`);
          continue;
        }

        try {
          const migration = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(migration);
          await recordMigration(client, file);
          console.log(`Migration ${file} completed`);
        } catch (error) {
          console.error(`Migration ${file} failed:`, error.message);
          throw error; // Stop on failure - don't continue with broken state
        }
      }
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
