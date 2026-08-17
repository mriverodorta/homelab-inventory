import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../persistence/fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../persistence/legacy/identity-plan.ts'
import { importLegacyCore } from '../persistence/migration/core-importer.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { SystemAttentionProjector } from './attention-projector.mjs'

const roots: string[] = []
const stores: SqliteHomelabInventoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-attention-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id, sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const store = new SqliteHomelabInventoryStore({ core: handle })
  stores.push(store)
  return store
}

describe('System Attention projector', () => {
  test('materializes Registry, audit, and notification findings for a complete assembly', async () => {
    const store = await fixtureStore()
    const database = store.core.database
    database.query('DELETE FROM compatibility_audit_ignores').run()
    database.query('DELETE FROM compatibility_audit_findings').run()
    database.query('DELETE FROM incidents').run()
    database.query('DELETE FROM registry_update_evaluations').run()
    database.query('DELETE FROM registry_update_runs').run()
    const host = database.query(`
      SELECT item.id, type.key AS type FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      WHERE type.key IN ('server', 'nas', 'pcBuild') ORDER BY item.id LIMIT 1
    `).get() as { id: number, type: string }
    const component = database.query(`
      SELECT component_item_id AS id FROM component_assignments
      WHERE project_id = 1 AND host_item_id = ? ORDER BY id LIMIT 1
    `).get(host.id) as { id: number }
    const link = database.query(`
      SELECT link.id, link.source_id FROM registry_links link
      WHERE link.item_id IN (?, ?) ORDER BY link.id LIMIT 1
    `).get(host.id, component.id) as { id: number, source_id: number }
    const run = database.query(`
      INSERT INTO registry_update_runs (
        source_id, catalog_revision, state, automatic, started_at_ms, completed_at_ms
      ) VALUES (?, 9999, 'completed', 0, 1, 1) RETURNING id
    `).get(link.source_id) as { id: number }
    database.query(`
      INSERT INTO registry_update_evaluations (
        run_id, link_id, from_revision, to_revision, target_content_hash,
        classification, decision, reasons_json, changes_json, evaluated_at_ms
      ) VALUES (?, ?, 1, 2, ?, 'blocked', 'pending', '[]', '[]', 1)
    `).run(run.id, link.id, 'f'.repeat(64))
    database.query(`
      INSERT INTO compatibility_audit_findings (
        project_id, host_item_id, component_item_id, finding_key, rule_key,
        severity, message, details_json, first_seen_at_ms, last_seen_at_ms
      ) VALUES (1, ?, ?, 'fixture-audit', 'fixture-rule', 'warning',
        'The assigned component needs attention.', '{}', 1, 1)
    `).run(host.id, component.id)
    database.query(`
      INSERT INTO incidents (
        host_item_id, event_key, event_type, severity, title, summary, state,
        opened_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, 'fixture-incident', 'storage.warning', 'critical', 'Storage warning',
        'A monitored filesystem is nearly full.', 'open', 1, 1, 1)
    `).run(host.id)

    const projector = new SystemAttentionProjector({ now: () => 2, log: { error() {} } })
    projector.markHostDirty(store, { projectId: 1, hostType: host.type, hostId: host.id, reason: 'test' })
    expect(projector.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, reused: 0, failed: 0 })
    expect(projector.summaries(store, 1).get(host.id)).toMatchObject({
      registryCount: 1, auditCount: 1, notificationCount: 1, totalCount: 3, state: 'current',
    })
    expect(projector.details(store, 1, host.type, host.id).findings.map((finding) => finding.category).sort())
      .toEqual(['audit', 'notification', 'registry'])
    expect(projector.summaries(store, 1, new Set(['audit'])).get(host.id)).toMatchObject({
      registryCount: 0, auditCount: 1, notificationCount: 0, totalCount: 1,
    })
    expect(projector.details(store, 1, host.type, host.id, new Set(['notification'])).findings)
      .toMatchObject([{ category: 'notification' }])

    projector.markHostDirty(store, { projectId: 1, hostType: host.type, hostId: host.id, reason: 'unchanged' })
    expect(projector.reconcile(store)).toEqual({ claimed: 1, evaluated: 0, reused: 1, failed: 0 })
  })

  test('marks only the host assembly containing a changed component', async () => {
    const store = await fixtureStore()
    const database = store.core.database
    database.query('DELETE FROM system_attention_dirty_hosts').run()
    const assignment = database.query(`
      SELECT assignment.project_id, assignment.host_item_id, assignment.component_item_id, type.key AS host_type
      FROM component_assignments assignment
      JOIN inventory_items host ON host.id = assignment.host_item_id
      JOIN inventory_item_types type ON type.id = host.type_id
      ORDER BY assignment.id LIMIT 1
    `).get() as { project_id: number, host_item_id: number, component_item_id: number, host_type: string }
    const projector = new SystemAttentionProjector({ now: () => 2 })
    projector.markHostsForItemDirty(store, { projectId: assignment.project_id, itemId: assignment.component_item_id, reason: 'component-changed' })
    expect(database.query(`SELECT project_id, host_type, host_id FROM system_attention_dirty_hosts`).all()).toEqual([{
      project_id: assignment.project_id, host_type: assignment.host_type, host_id: assignment.host_item_id,
    }])
  })
})
