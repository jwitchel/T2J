/**
 * User Alert Service
 *
 * Manages persistent user alerts using a Producer-Consumer Queue Pattern:
 * - Enqueue: createAlert() - creates or increments error count
 * - Dequeue: resolveAlert() / resolveAlertsForSource() - marks as resolved
 */

import { pool } from './db';
import { sharedConnection as redis } from './redis-connection';
import {
  CreateAlertParams,
  UserAlert,
  SourceType,
  PERSISTENT_ERROR_THRESHOLD,
} from '../types/user-alerts';

const ALERT_VERSION_PREFIX = 'alerts:version:';

class UserAlertService {
  /**
   * Get alert version for a user (for efficient polling)
   */
  async getAlertVersion(userId: string): Promise<number> {
    const version = await redis.get(`${ALERT_VERSION_PREFIX}${userId}`);
    return version ? parseInt(version, 10) : 0;
  }

  /**
   * Increment alert version when alerts change
   */
  private async _incrementVersion(userId: string): Promise<void> {
    await redis.incr(`${ALERT_VERSION_PREFIX}${userId}`);
  }

  /**
   * Enqueue: Create alert or increment error_count if exists
   * Uses INSERT ... ON CONFLICT to atomically upsert
   */
  async createAlert(params: CreateAlertParams): Promise<void> {
    const result = await pool.query(
      `INSERT INTO user_alerts (
        user_id, alert_type, severity, source_type, source_id, source_name,
        message, action_url, action_label, error_count, last_occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW())
      ON CONFLICT (user_id, source_type, source_id, alert_type)
        WHERE resolved_at IS NULL
      DO UPDATE SET
        error_count = user_alerts.error_count + 1,
        last_occurred_at = NOW(),
        message = EXCLUDED.message
      RETURNING id, error_count`,
      [
        params.userId,
        params.alertType,
        params.severity,
        params.sourceType,
        params.sourceId,
        params.sourceName,
        params.message,
        params.actionUrl,
        params.actionLabel,
      ]
    );

    const { id, error_count } = result.rows[0];

    // Only log when alert is first created or becomes persistent
    if (error_count === 1) {
      console.log(
        '[UserAlertService] Created alert %s: %s for %s (user: %s)',
        id, params.alertType, params.sourceName, params.userId
      );
    } else if (error_count === PERSISTENT_ERROR_THRESHOLD) {
      console.log(
        '[UserAlertService] Alert %s became persistent after %d failures (user: %s)',
        id, error_count, params.userId
      );
      await this._maybeSendNotification(id, params);
    }

    // Notify frontend of change
    await this._incrementVersion(params.userId);
  }

  /**
   * Dequeue: Mark alert as resolved by ID
   */
  async resolveAlert(alertId: string): Promise<void> {
    const result = await pool.query(
      `UPDATE user_alerts SET resolved_at = NOW() WHERE id = $1
       RETURNING user_id, source_name, alert_type`,
      [alertId]
    );

    if (result.rows.length > 0) {
      const { user_id, source_name, alert_type } = result.rows[0];
      console.log(
        '[UserAlertService] Resolved alert %s: %s for %s (user: %s)',
        alertId, alert_type, source_name, user_id
      );
      await this._incrementVersion(user_id);
    }
  }

  /**
   * Dequeue by source: Resolve ALL active alerts for a source
   * Called when operation succeeds (auto-resolution)
   */
  async resolveAlertsForSource(
    sourceType: SourceType,
    sourceId: string
  ): Promise<void> {
    const result = await pool.query(
      `UPDATE user_alerts
       SET resolved_at = NOW()
       WHERE source_type = $1 AND source_id = $2 AND resolved_at IS NULL
       RETURNING id, user_id, source_name, alert_type`,
      [sourceType, sourceId]
    );

    if (result.rowCount && result.rowCount > 0) {
      const firstRow = result.rows[0];
      console.log(
        '[UserAlertService] Auto-resolved %d alert(s) for %s (user: %s)',
        result.rowCount, firstRow.source_name, firstRow.user_id
      );
      await this._incrementVersion(firstRow.user_id);
    }
  }

  /**
   * Resolve ALL alerts of a source type for a user
   * Called when any provider of that type succeeds (e.g., any LLM works = clear all LLM alerts)
   */
  async resolveAllAlertsForSourceType(
    userId: string,
    sourceType: SourceType
  ): Promise<void> {
    const result = await pool.query(
      `UPDATE user_alerts
       SET resolved_at = NOW()
       WHERE user_id = $1 AND source_type = $2 AND resolved_at IS NULL
       RETURNING id, source_name, alert_type`,
      [userId, sourceType]
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(
        '[UserAlertService] Auto-resolved %d %s alert(s) (user: %s)',
        result.rowCount, sourceType, userId
      );
      await this._incrementVersion(userId);
    }
  }

  /**
   * Query: Get all active alerts for a user
   */
  async getActiveAlerts(userId: string): Promise<UserAlert[]> {
    const result = await pool.query(
      `SELECT
        id,
        alert_type,
        severity,
        source_type,
        source_id,
        source_name,
        message,
        action_url,
        action_label,
        error_count,
        last_occurred_at,
        created_at
      FROM user_alerts
      WHERE user_id = $1 AND resolved_at IS NULL
      ORDER BY
        CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        last_occurred_at DESC`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      alertType: row.alert_type,
      severity: row.severity,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceName: row.source_name,
      message: row.message,
      actionUrl: row.action_url,
      actionLabel: row.action_label,
      errorCount: row.error_count,
      lastOccurredAt: row.last_occurred_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    }));
  }

  /**
   * Query: Check if source has an active alert
   */
  async hasActiveAlert(
    sourceType: SourceType,
    sourceId: string
  ): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM user_alerts
       WHERE source_type = $1 AND source_id = $2 AND resolved_at IS NULL
       LIMIT 1`,
      [sourceType, sourceId]
    );

    return result.rows.length > 0;
  }

  /**
   * STUB: Send email notification for persistent errors
   * TODO: Implement actual email sending
   */
  private async _maybeSendNotification(
    alertId: string,
    params: CreateAlertParams
  ): Promise<void> {
    console.log(
      `[UserAlertService] STUB: Would send email notification for alert ${alertId}`
    );
    console.log(`  User: ${params.userId}`);
    console.log(`  Source: ${params.sourceType}/${params.sourceName}`);
    console.log(`  Error: ${params.message}`);

    // Mark as notified to prevent duplicate emails
    await pool.query(
      `UPDATE user_alerts SET notified_at = NOW() WHERE id = $1`,
      [alertId]
    );

    // TODO: Implement actual email sending
    // await emailService.sendAlertNotification({
    //   userId: params.userId,
    //   subject: `Action required: ${params.sourceName}`,
    //   message: params.message,
    //   actionUrl: params.actionUrl,
    // });
  }
}

export const userAlertService = new UserAlertService();
