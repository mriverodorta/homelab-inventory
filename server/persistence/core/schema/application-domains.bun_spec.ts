import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function createDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-domains-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  return handle
}

function insertHost(database: Awaited<ReturnType<typeof createDatabase>>['database']) {
  const item = database.query(`
    INSERT INTO inventory_items (
      type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
    ) VALUES (1, 'global', NULL, 'Managed host', 1, 1, 1)
    RETURNING id
  `).get() as { id: number }
  database.query('INSERT INTO servers (id) VALUES (?)').run(item.id)
  return item.id
}

describe('application persistence domains', () => {
  test('keeps registry sources, links, and adoption status relational', async () => {
    const handle = await createDatabase()
    try {
      const itemId = insertHost(handle.database)
      const source = handle.database.query(`
        INSERT INTO registry_sources (kind, display_name, created_at_ms)
        VALUES ('official-connected', 'Official', 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO registry_links (
          item_id, source_id, template_key, imported_revision,
          imported_content_hash, state, linked_at_ms, updated_at_ms
        ) VALUES (?, ?, 'server-template', 1, ?, 'linked', 1, 1)
      `).run(itemId, source.id, 'a'.repeat(64))
      handle.database.query(`
        INSERT INTO registry_catalog_adoption_status (
          source_id, catalog_revision, application_version, reported_at_ms
        ) VALUES (?, 1, '0.10.0', 1)
      `).run(source.id)

      expect(() => handle.database.query(`
        INSERT INTO registry_catalog_adoption_status (
          source_id, catalog_revision, application_version, reported_at_ms
        ) VALUES (?, 2, '0.10.0', 2)
      `).run(source.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('permits only one active agent binding per host', async () => {
    const handle = await createDatabase()
    try {
      const hostId = insertHost(handle.database)
      const firstAgent = handle.database.query(`
        INSERT INTO agents (public_key, protocol_major, agent_version, created_at_ms)
        VALUES ('key-1', 1, '0.1.8', 1)
        RETURNING id
      `).get() as { id: number }
      const secondAgent = handle.database.query(`
        INSERT INTO agents (public_key, protocol_major, agent_version, created_at_ms)
        VALUES ('key-2', 1, '0.1.8', 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO agent_host_bindings (agent_id, host_item_id, state, bound_at_ms)
        VALUES (?, ?, 'active', 1)
      `).run(firstAgent.id, hostId)

      expect(() => handle.database.query(`
        INSERT INTO agent_host_bindings (agent_id, host_item_id, state, bound_at_ms)
        VALUES (?, ?, 'active', 1)
      `).run(secondAgent.id, hostId)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces authentication relationships and protects the owner', async () => {
    const handle = await createDatabase()
    try {
      const owner = handle.database.query(`
        INSERT INTO users (
          username, display_name, protected_owner, active, created_at_ms, updated_at_ms
        ) VALUES ('owner', 'Owner', 1, 1, 1, 1)
        RETURNING id
      `).get() as { id: number }
      const role = handle.database.query(`
        INSERT INTO roles (key, name, description, built_in, active, created_at_ms, updated_at_ms)
        VALUES ('owner', 'Owner', 'Owner role', 1, 1, 1, 1)
        RETURNING id
      `).get() as { id: number }
      const permission = handle.database.query(`
        INSERT INTO permissions (permission_key, category, description, risk)
        VALUES ('system.manage', 'system', 'Manage the system', 'elevated')
        RETURNING id
      `).get() as { id: number }
      handle.database.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(role.id, permission.id)
      expect(() => handle.database.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(role.id, permission.id)).toThrow()
      handle.database.query(`
        INSERT INTO user_roles (user_id, role_id, scope_kind, scope_id)
        VALUES (?, ?, 'global', 0)
      `).run(owner.id, role.id)
      handle.database.query(`
        INSERT INTO sessions (
          user_id, token_hash, remember, created_at_ms, last_seen_at_ms,
          idle_expires_at_ms, absolute_expires_at_ms
        ) VALUES (?, ?, 0, 1, 1, 2, 3)
      `).run(owner.id, 'b'.repeat(64))

      expect(() => handle.database.query('DELETE FROM users WHERE id = ?').run(owner.id)).toThrow(/protected owner/iu)
      expect(() => handle.database.query(`
        INSERT INTO sessions (
          user_id, token_hash, remember, created_at_ms, last_seen_at_ms,
          idle_expires_at_ms, absolute_expires_at_ms
        ) VALUES (999, ?, 0, 1, 1, 2, 3)
      `).run('c'.repeat(64))).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('keeps notification incidents and delivery attempts connected', async () => {
    const handle = await createDatabase()
    try {
      const hostId = insertHost(handle.database)
      const point = handle.database.query(`
        INSERT INTO notification_contact_points (
          type, name, enabled, config_json, created_at_ms, updated_at_ms
        ) VALUES ('ntfy', 'Primary', 1, '{}', 1, 1)
        RETURNING id
      `).get() as { id: number }
      const incident = handle.database.query(`
        INSERT INTO incidents (
          host_item_id, event_key, event_type, severity, title, summary,
          state, opened_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, 'server:1:host.offline', 'host.offline', 'critical',
          'Offline', 'No heartbeat', 'open', 1, 1, 1)
        RETURNING id
      `).get(hostId) as { id: number }
      const delivery = handle.database.query(`
        INSERT INTO notification_deliveries (
          incident_id, contact_point_id, kind, state, idempotency_key,
          available_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 'opening', 'queued', '1:1:opening', 1, 1, 1)
        RETURNING id
      `).get(incident.id, point.id) as { id: number }
      handle.database.query(`
        INSERT INTO notification_delivery_attempts (
          delivery_id, attempt_number, state, attempted_at_ms
        ) VALUES (?, 1, 'delivered', 1)
      `).run(delivery.id)

      expect(() => handle.database.query(`
        INSERT INTO notification_delivery_attempts (
          delivery_id, attempt_number, state, attempted_at_ms
        ) VALUES (999, 1, 'failed', 1)
      `).run()).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('validates the one-row backup schedule', async () => {
    const handle = await createDatabase()
    try {
      handle.database.query(`
        INSERT INTO backup_schedules (
          id, enabled, frequency, local_time, weekday, retention_count
        ) VALUES (1, 1, 'daily', '02:00', 0, 7)
      `).run()
      expect(() => handle.database.query(`
        INSERT INTO backup_schedules (
          id, enabled, frequency, local_time, weekday, retention_count
        ) VALUES (2, 1, 'daily', '02:00', 0, 7)
      `).run()).toThrow()
      expect(() => handle.database.query(`
        UPDATE backup_schedules SET local_time = '29:91' WHERE id = 1
      `).run()).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('guards singleton application configuration and environment source metadata', async () => {
    const handle = await createDatabase()
    try {
      handle.database.query(`
        INSERT INTO application_configuration (id, revision, settings_json, updated_at_ms)
        VALUES (1, 1, '{}', 1)
      `).run()
      handle.database.query(`
        INSERT INTO setting_source_metadata (
          domain, setting_key, source, environment_variable, updated_at_ms
        ) VALUES ('application', 'externalUrl', 'environment', 'APP_EXTERNAL_URL', 1)
      `).run()

      expect(() => handle.database.query(`
        INSERT INTO application_configuration (id, revision, settings_json, updated_at_ms)
        VALUES (2, 1, '{}', 1)
      `).run()).toThrow()
      expect(() => handle.database.query(`
        INSERT INTO setting_source_metadata (
          domain, setting_key, source, environment_variable, updated_at_ms
        ) VALUES ('registry', 'mode', 'database', 'REGISTRY_MODE', 1)
      `).run()).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
