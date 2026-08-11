import type { Database } from 'bun:sqlite'

const DOCUMENT_KEY = 'runtime.notification-store'

const DELETE_ORDER = [
  'notification_delivery_attempts',
  'notification_deliveries',
  'incident_acknowledgements',
  'incident_transitions',
  'incidents',
  'notification_pending_transitions',
  'notification_normalized_states',
  'notification_cooldowns',
  'notification_evaluation_cursors',
  'notification_host_override_resources',
  'notification_host_overrides',
  'notification_monitored_resources',
  'notification_quiet_hours',
  'notification_rule_contact_points',
  'notification_rules',
  'notification_contact_points',
  'notification_secrets',
  'notification_settings',
] as const

type NotificationDocument = Readonly<{
  config: Record<string, any>
  state: Record<string, any>
  secrets: Record<string, any>
}>

function records(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value : []
}

function json(value: unknown) {
  return JSON.stringify(value ?? null)
}

function timestamp(value: unknown, fallback: number | null = null) {
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function integer(value: unknown, fallback = 0) {
  return Number.isSafeInteger(value) ? value as number : fallback
}

function nullableInteger(value: unknown) {
  return Number.isSafeInteger(value) ? value as number : null
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export class SqliteNotificationPersistence {
  readonly database: Database
  readonly now: () => number

  constructor({ database, now = Date.now }: { database: Database, now?: () => number }) {
    this.database = database
    this.now = now
  }

  read(): NotificationDocument | null {
    const row = this.database.query(
      'SELECT value_json FROM application_metadata WHERE key = ?',
    ).get(DOCUMENT_KEY) as { value_json: string } | null
    return row ? JSON.parse(row.value_json) : null
  }

  write(document: NotificationDocument) {
    const serialized = JSON.stringify(document)
    const existing = this.database.query(
      'SELECT value_json FROM application_metadata WHERE key = ?',
    ).get(DOCUMENT_KEY) as { value_json: string } | null
    if (existing?.value_json === serialized) return

    const persist = this.database.transaction(() => {
      for (const table of DELETE_ORDER) this.database.run(`DELETE FROM ${table}`)
      this.#writeProjection(document)
      this.database.query(`
        INSERT INTO application_metadata (key, value_json, updated_at_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at_ms = excluded.updated_at_ms
      `).run(DOCUMENT_KEY, serialized, this.now())
    })
    persist.immediate()
  }

  #hostItemId(hostType: unknown, hostId: unknown) {
    const row = this.database.query(`
      SELECT item_id
      FROM inventory_identity_aliases
      WHERE legacy_type_key = ? AND legacy_id = ?
    `).get(hostType, hostId) as { item_id: number } | null
    if (!row) throw new Error(`Notification host ${String(hostType)}:${String(hostId)} does not exist.`)
    return row.item_id
  }

  #userId(actor: unknown) {
    if (!Number.isSafeInteger(actor) || (actor as number) <= 0) return null
    const row = this.database.query('SELECT id FROM users WHERE id = ?').get(actor) as { id: number } | null
    return row?.id ?? null
  }

  #writeProjection(document: NotificationDocument) {
    const now = this.now()
    const config = document.config
    const state = document.state
    const secrets = document.secrets
    const retention = config.retention ?? {}

    this.database.query(`
      INSERT INTO notification_settings (
        id, revision, enabled, incident_retention_days,
        delivery_attempt_retention_days, last_evaluated_at_ms,
        created_at_ms, updated_at_ms
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      integer(config.revision, 1),
      Number(config.enabled === true),
      integer(retention.incidentDays ?? config.incidentRetentionDays, 90),
      integer(retention.deliveryAttemptDays ?? config.deliveryAttemptRetentionDays, 30),
      timestamp(state.lastEvaluatedAt),
      timestamp(config.createdAt, now),
      timestamp(config.updatedAt, now),
    )

    for (const secret of records(secrets.secrets)) {
      this.database.query(`
        INSERT INTO notification_secrets (
          id, algorithm, iv, auth_tag, ciphertext, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        secret.id,
        secret.algorithm,
        secret.iv,
        secret.tag,
        secret.ciphertext,
        timestamp(secret.createdAt, now),
        timestamp(secret.updatedAt, now),
      )
    }

    for (const point of records(config.contactPoints)) {
      this.database.query(`
        INSERT INTO notification_contact_points (
          id, type, name, enabled, secret_id, config_json, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        point.id,
        point.type,
        point.name,
        Number(point.enabled !== false),
        nullableInteger(point.secretId),
        json(point.config ?? {}),
        timestamp(point.createdAt, now),
        timestamp(point.updatedAt, now),
      )
    }

    for (const rule of records(config.rules)) {
      this.database.query(`
        INSERT INTO notification_rules (
          id, event_type, severity, enabled, debounce_seconds,
          cooldown_seconds, reminder_interval_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        rule.id,
        rule.eventType,
        rule.severity,
        Number(rule.enabled !== false),
        integer(rule.debounceSeconds),
        integer(rule.cooldownSeconds),
        nullableInteger(rule.reminderIntervalSeconds),
      )
      for (const contactPointId of records(rule.contactPointIds).map(Number)) {
        this.database.query(`
          INSERT INTO notification_rule_contact_points (rule_id, contact_point_id)
          VALUES (?, ?)
        `).run(rule.id, contactPointId)
      }
    }

    for (const quiet of records(config.quietHours)) {
      this.database.query(`
        INSERT INTO notification_quiet_hours (
          id, enabled, timezone, start_time, end_time, weekdays_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        quiet.id,
        Number(quiet.enabled !== false),
        quiet.timezone,
        quiet.start,
        quiet.end,
        json(quiet.weekdays ?? []),
      )
    }

    for (const resource of records(config.monitoredResources)) {
      this.database.query(`
        INSERT INTO notification_monitored_resources (
          id, host_item_id, family, resource_key, name, enabled
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        resource.id,
        this.#hostItemId(resource.hostType, resource.hostId),
        resource.family,
        resource.key,
        resource.name,
        Number(resource.enabled !== false),
      )
    }

    for (const override of records(config.hostOverrides)) {
      this.database.query(`
        INSERT INTO notification_host_overrides (
          id, host_item_id, mode, muted_until_ms, rules_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        override.id,
        this.#hostItemId(override.hostType, override.hostId),
        override.mode,
        timestamp(override.mutedUntil),
        json(override.rules ?? []),
      )
      for (const resourceId of records(override.monitoredResourceIds).map(Number)) {
        this.database.query(`
          INSERT INTO notification_host_override_resources (
            host_override_id, monitored_resource_id
          ) VALUES (?, ?)
        `).run(override.id, resourceId)
      }
    }

    for (const normalized of records(state.normalizedStates)) {
      this.database.query(`
        INSERT INTO notification_normalized_states (
          id, host_item_id, monitored_resource_id, event_type, state,
          sequence, observed_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalized.id,
        this.#hostItemId(normalized.hostType, normalized.hostId),
        nullableInteger(normalized.resourceId),
        normalized.eventType,
        normalized.state,
        nullableInteger(normalized.sequence),
        timestamp(normalized.lastObservedAt, now),
        timestamp(normalized.lastObservedAt, now),
      )
    }

    for (const pending of records(state.pendingTransitions)) {
      this.database.query(`
        INSERT INTO notification_pending_transitions (
          id, host_item_id, monitored_resource_id, event_key, event_type,
          candidate_state, first_observed_at_ms, last_observed_at_ms,
          observation_count, due_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pending.id,
        this.#hostItemId(pending.hostType, pending.hostId),
        nullableInteger(pending.resourceId),
        pending.eventKey,
        pending.eventType,
        pending.candidateState ?? 'problem',
        timestamp(pending.firstObservedAt, now),
        timestamp(pending.lastObservedAt, now),
        integer(pending.observations ?? pending.observationCount, 1),
        timestamp(pending.dueAt, now),
      )
    }

    for (const incident of records(state.incidents)) {
      this.database.query(`
        INSERT INTO incidents (
          id, host_item_id, monitored_resource_id, event_key, event_type,
          severity, title, summary, state, opened_at_ms, resolved_at_ms,
          notification_delivered_at_ms, last_reminder_at_ms, created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        incident.id,
        this.#hostItemId(incident.hostType, incident.hostId),
        nullableInteger(incident.resourceId),
        incident.eventKey,
        incident.eventType,
        incident.severity,
        incident.title,
        incident.summary,
        incident.state,
        timestamp(incident.openedAt, now),
        timestamp(incident.resolvedAt),
        timestamp(incident.notificationDeliveredAt),
        timestamp(incident.lastReminderAt),
        timestamp(incident.createdAt, now),
        timestamp(incident.updatedAt, now),
      )
    }

    for (const transition of records(state.transitions)) {
      this.database.query(`
        INSERT INTO incident_transitions (
          id, incident_id, from_state, to_state, reason, occurred_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        transition.id,
        transition.incidentId,
        optionalText(transition.from),
        transition.to,
        optionalText(transition.reason),
        timestamp(transition.occurredAt, now),
      )
    }

    for (const acknowledgement of records(state.acknowledgements)) {
      this.database.query(`
        INSERT INTO incident_acknowledgements (
          id, incident_id, user_id, note, acknowledged_at_ms
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        acknowledgement.id,
        acknowledgement.incidentId,
        this.#userId(acknowledgement.actor),
        optionalText(acknowledgement.note),
        timestamp(acknowledgement.acknowledgedAt, now),
      )
    }

    for (const delivery of records(state.deliveryJobs)) {
      this.database.query(`
        INSERT INTO notification_deliveries (
          id, incident_id, contact_point_id, kind, state, idempotency_key,
          attempt_count, available_at_ms, lease_owner, lease_expires_at_ms,
          delivered_at_ms, last_error, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        delivery.id,
        delivery.incidentId,
        delivery.contactPointId,
        delivery.kind,
        delivery.state,
        delivery.idempotencyKey,
        integer(delivery.attempts ?? delivery.attemptCount),
        timestamp(delivery.availableAt, now),
        optionalText(delivery.leaseOwner),
        timestamp(delivery.leaseExpiresAt),
        timestamp(delivery.deliveredAt),
        optionalText(delivery.lastError),
        timestamp(delivery.createdAt, now),
        timestamp(delivery.updatedAt, now),
      )
    }

    for (const attempt of records(state.deliveryAttempts)) {
      this.database.query(`
        INSERT INTO notification_delivery_attempts (
          id, delivery_id, attempt_number, state, status_code, error_code,
          attempted_at_ms, completed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attempt.id,
        attempt.deliveryJobId,
        integer(attempt.attempt, 1),
        attempt.state === 'exhausted' ? 'failed' : attempt.state,
        nullableInteger(attempt.status),
        optionalText(attempt.error),
        timestamp(attempt.attemptedAt, now),
        timestamp(attempt.completedAt ?? attempt.attemptedAt),
      )
    }

    for (const cooldown of records(state.cooldowns)) {
      this.database.query(`
        INSERT INTO notification_cooldowns (
          id, host_item_id, monitored_resource_id, contact_point_id,
          event_type, expires_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cooldown.id,
        this.#hostItemId(cooldown.hostType, cooldown.hostId),
        nullableInteger(cooldown.resourceId),
        cooldown.contactPointId,
        cooldown.eventType,
        timestamp(cooldown.expiresAt, now),
        timestamp(cooldown.createdAt, now),
        timestamp(cooldown.updatedAt, now),
      )
    }

    for (const cursor of records(state.evaluationCursors)) {
      this.database.query(`
        INSERT INTO notification_evaluation_cursors (
          id, host_item_id, last_sequence, last_collected_at_ms,
          last_received_at_ms, candidate_collected_at_ms,
          candidate_received_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        cursor.id,
        this.#hostItemId(cursor.hostType, cursor.hostId),
        integer(cursor.lastSequence),
        timestamp(cursor.lastCollectedAt),
        timestamp(cursor.lastReceivedAt),
        timestamp(cursor.candidateCollectedAt),
        timestamp(cursor.candidateReceivedAt),
      )
    }
  }
}
