/**
 * Transaction utility functions for managing database transactions
 * Provides consistent transaction handling across the codebase
 */

import { Pool, PoolClient } from 'pg';

/**
 * Execute a callback within a transaction
 *
 * If client is provided, uses existing transaction (caller manages commit/rollback)
 * If client is not provided, creates new transaction and manages it automatically
 *
 * @param pool - Database connection pool
 * @param callback - Function to execute within transaction
 * @param client - Optional existing transaction client
 * @returns Result from callback
 *
 * @example
 * // Create new transaction
 * const result = await withTransaction(pool, async (client) => {
 *   await client.query('INSERT INTO ...');
 *   return { success: true };
 * });
 *
 * @example
 * // Use existing transaction
 * await withTransaction(pool, async (client) => {
 *   await nestedOperation(client);
 * }, existingClient);
 */
export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
  client?: PoolClient
): Promise<T> {
  const shouldManageTransaction = !client;
  const db = client || await pool.connect();

  if (shouldManageTransaction) {
    await db.query('BEGIN');
  }

  try {
    const result = await callback(db);

    if (shouldManageTransaction) {
      await db.query('COMMIT');
    }

    return result;
  } catch (error) {
    if (shouldManageTransaction) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        // Log rollback failure but throw original error
        console.error('Failed to rollback transaction:', rollbackError);
      }
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      db.release();
    }
  }
}

/**
 * Safe ROLLBACK wrapper
 * Attempts to rollback and logs error if it fails, but doesn't throw
 *
 * @param client - Database client
 */
export async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    console.error('Failed to rollback transaction:', rollbackError);
  }
}

/**
 * Commit and release a connection
 * Used for early returns where we want to commit and exit
 *
 * @param client - Database client
 */
export async function commitAndRelease(client: PoolClient): Promise<void> {
  try {
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}
