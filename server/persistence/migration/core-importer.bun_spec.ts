import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { legacySemanticSnapshot } from '../legacy/semantic-snapshot.ts'
import { closeManagedDatabase, openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import { importLegacyCore } from './core-importer.ts'
import { verifyImportedCore } from './core-verifier.ts'
import { createAuthenticationStore, createOwnerAccount, ensureProtectedOwnerRole } from '../../auth/model.mjs'
import { projectAuthenticationState } from '../core/projections/legacy-domains.ts'
import { buildLegacyInventoryProjection } from '../core/projections/legacy-project.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function migratedDatabase(migrationCount = CORE_MIGRATIONS.length) {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-core-import-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../core/migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.slice(0, migrationCount).map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  return handle
}

describe('schema-29 core import', () => {
  test('migrates an existing port table to non-negative slot numbers without losing constraints', async () => {
    const migrationIndex = CORE_MIGRATIONS.findIndex((migration) => migration.id === '0016_nonnegative_port_slots')
    const handle = await migratedDatabase(migrationIndex)
    try {
      const itemId = (handle.database.query(`
        INSERT INTO inventory_items (type_id, scope, name, extensions_json, created_at_ms, updated_at_ms)
        SELECT id, 'global', 'Power strip', '{}', 0, 0 FROM inventory_item_types WHERE key = 'powerStrip'
        RETURNING id
      `).get() as { id: number }).id
      const portId = (handle.database.query(`
        INSERT INTO inventory_ports (item_id, created_at_ms) VALUES (?, 0) RETURNING id
      `).get(itemId) as { id: number }).id
      const kindId = (handle.database.query("SELECT id FROM port_kinds WHERE key = 'power-input'").get() as { id: number }).id
      const connectorId = (handle.database.query("SELECT id FROM connector_types WHERE key = 'iec-c14'").get() as { id: number }).id

      expect(() => handle.database.query(`
        INSERT INTO item_port_details (port_id, kind_id, connector_type_id, slot_number)
        VALUES (?, ?, ?, 0)
      `).run(portId, kindId, connectorId)).toThrow()

      await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        ...migration,
        sql: await readFile(resolve(import.meta.dir, '../core/migrations/generated', migration.file), 'utf8'),
      }))))
      handle.database.query(`
        INSERT INTO item_port_details (port_id, kind_id, connector_type_id, slot_number)
        VALUES (?, ?, ?, 0)
      `).run(portId, kindId, connectorId)

      expect(handle.database.query('SELECT slot_number FROM item_port_details WHERE port_id = ?').get(portId))
        .toEqual({ slot_number: 0 })
      expect(handle.database.query('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('preserves canonical slot zero for a power-strip AC input', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    const powerStrip = snapshot.inventory.powerStrips[0]
    powerStrip.ports[0].slotNumber = 0
    try {
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
      const projected = buildLegacyInventoryProjection(handle.database)

      expect(projected.powerStrips[0].ports[0]).toMatchObject({
        id: powerStrip.ports[0].id,
        slotNumber: 0,
      })
      expect(handle.database.query(`
        SELECT details.slot_number
        FROM item_port_details details
        JOIN port_identity_aliases aliases ON aliases.port_id = details.port_id
        WHERE aliases.legacy_item_type_key = 'powerStrip'
          AND aliases.legacy_item_id = ?
          AND aliases.legacy_port_id = ?
      `).get(powerStrip.id, powerStrip.ports[0].id)).toEqual({ slot_number: 0 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('preserves DDR3L as a distinct host and module generation', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    snapshot.inventory.servers[0].compatibility.host.memory.generations = ['DDR3L']
    snapshot.inventory.ram[0].specs.generation = 'DDR3L'
    try {
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
      const projected = buildLegacyInventoryProjection(handle.database)

      expect(projected.servers[0].compatibility.host.memory.generations).toEqual(['DDR3L'])
      expect(projected.ram[0].specs.generation).toBe('DDR3L')
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('repairs collapsed DDR3L rows without changing the registry link', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    snapshot.inventory.servers[0].compatibility.host.memory.generations = ['DDR3L']
    snapshot.inventory.ram[0].specs.generation = 'DDR3L'
    snapshot.registry.links.push({
      id: 2,
      itemType: 'server',
      itemId: 7,
      sourceId: 1,
      templateKey: 'desktop-example-micro-host',
      importedRevision: 4,
      importedContentHash: 'b'.repeat(64),
      importedFingerprintVersion: 9,
      state: 'linked',
      linkedAt: '2026-08-11T12:00:00.000Z',
      updatedAt: '2026-08-11T12:00:00.000Z',
    })
    try {
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
      const ddr3Id = (handle.database.query("SELECT id FROM memory_generations WHERE key = 'ddr3'").get() as { id: number }).id
      const ddr3lId = (handle.database.query("SELECT id FROM memory_generations WHERE key = 'ddr3l'").get() as { id: number }).id
      handle.database.query('UPDATE memory_modules SET memory_generation_id = ? WHERE memory_generation_id = ?').run(ddr3Id, ddr3lId)
      handle.database.query('UPDATE host_memory_generation_support SET generation_id = ? WHERE generation_id = ?').run(ddr3Id, ddr3lId)
      handle.database.query("DELETE FROM memory_generations WHERE key = 'ddr3l'").run()
      const linkBefore = handle.database.query('SELECT * FROM registry_links WHERE id = 2').get()
      const repairSql = await readFile(resolve(
        import.meta.dir,
        '../core/migrations/generated/0012_distinct_ddr3l_memory.sql',
      ), 'utf8')
      handle.database.transaction(() => {
        for (const statement of repairSql.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) {
          handle.database.run(statement)
        }
      })()
      const projected = buildLegacyInventoryProjection(handle.database)

      expect(projected.servers[0].compatibility.host.memory.generations).toEqual(['DDR3L'])
      expect(projected.ram[0].specs.generation).toBe('DDR3L')
      expect(handle.database.query('SELECT * FROM registry_links WHERE id = 2').get()).toEqual(linkBefore)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('imports a production-shaped snapshot in one verified relational graph', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    const identityPlan = buildCanonicalIdentityPlan(snapshot)
    try {
      expect(importLegacyCore({ database: handle.database, snapshot, identityPlan })).toEqual({
        projectId: 1,
        systemsWorkspaceId: 1,
        canvasWorkspaceId: 2,
      })
      expect(verifyImportedCore({ database: handle.database, expected: legacySemanticSnapshot(snapshot) })).toEqual({ ok: true })
      expect(handle.database.query('SELECT count(*) AS count FROM workspace_manual_bend_points').get()).toEqual({ count: 1 })
      expect(handle.database.query('SELECT count(*) AS count FROM workspace_route_cache').get()).toEqual({ count: 1 })
      expect(handle.database.query('SELECT count(*) AS count FROM host_resource_slots').get()).toEqual({ count: 4 })
      expect(handle.database.query('SELECT imported_revision FROM registry_links WHERE id = 1').get()).toEqual({ imported_revision: 1 })
      expect(handle.database.query('SELECT state FROM agent_host_bindings').get()).toEqual({ state: 'active' })
      expect(handle.database.query('SELECT local_time, retention_count FROM backup_schedules').get()).toEqual({ local_time: '03:30', retention_count: 14 })
      expect(handle.database.query('SELECT id, name FROM projects').all()).toEqual([{ id: 1, name: 'Default Project' }])
      expect(handle.database.query('SELECT id, type, sort_order FROM workspaces ORDER BY id').all()).toEqual([
        { id: 1, type: 'systems', sort_order: 0 },
        { id: 2, type: 'canvas', sort_order: 1 },
      ])
      expect(handle.database.query('SELECT default_workspace_id FROM project_preferences WHERE project_id = 1').get())
        .toEqual({ default_workspace_id: 2 })
      expect(handle.database.query('SELECT policy_json FROM project_compatibility_policies WHERE project_id = 1').get())
        .toEqual({ policy_json: JSON.stringify(snapshot.project.compatibilityPolicy) })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rolls the whole import back when a late relationship is invalid', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    snapshot.notifications.contactPoints[0].type = 'unsupported'
    const identityPlan = buildCanonicalIdentityPlan(snapshot)
    try {
      expect(() => importLegacyCore({ database: handle.database, snapshot, identityPlan })).toThrow()
      expect(handle.database.query('SELECT count(*) AS count FROM inventory_items').get()).toEqual({ count: 0 })
      expect(handle.database.query('SELECT count(*) AS count FROM registry_sources').get()).toEqual({ count: 0 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('preserves revoked agent history when a replacement is active on the same host', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    snapshot.agents.devices[3] = {
      id: 3,
      hostType: 'server',
      hostId: 7,
      publicKey: 'fixture-revoked-agent-key',
      protocolMajor: 1,
      version: '0.1.0',
      revokedAt: '2026-08-10T12:00:00.000Z',
      createdAt: '2026-08-09T12:00:00.000Z',
    }
    try {
      importLegacyCore({
        database: handle.database,
        snapshot,
        identityPlan: buildCanonicalIdentityPlan(snapshot),
      })
      expect(handle.database.query(`
        SELECT alias.legacy_id, binding.state, binding.unbound_at_ms
        FROM agent_host_bindings binding
        JOIN agent_identity_aliases alias ON alias.agent_id = binding.agent_id
        ORDER BY alias.legacy_id
      `).all()).toEqual([
        { legacy_id: 3, state: 'revoked', unbound_at_ms: Date.parse('2026-08-10T12:00:00.000Z') },
        { legacy_id: 4, state: 'active', unbound_at_ms: null },
      ])
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('normalizes every authentication entity and preserves numeric relationships', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    const timestamp = '2026-08-11T12:00:00.000Z'
    const authentication = createAuthenticationStore()
    authentication.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
    authentication.nextAccountId = 2
    ensureProtectedOwnerRole(authentication, 1)
    authentication.localCredentials.push({ id: 1, accountId: 1, passwordHash: '$argon2id$fixture-password-hash', createdAt: timestamp, updatedAt: timestamp })
    authentication.oidcIdentities.push({ id: 1, accountId: 1, issuer: 'https://identity.example', subject: 'owner-subject', email: 'owner@example.com', createdAt: timestamp, lastLoginAt: timestamp })
    authentication.sessions.push({ id: 1, accountId: 1, tokenHash: 'b'.repeat(64), remember: true, createdAt: timestamp, lastSeenAt: timestamp, idleExpiresAt: '2026-08-12T12:00:00.000Z', absoluteExpiresAt: '2026-09-10T12:00:00.000Z', revokedAt: null, userAgent: 'fixture-agent', ip: 'fixture-ip' })
    authentication.recoveryTokens.push({ id: 1, accountId: 1, tokenHash: 'c'.repeat(64), createdAt: timestamp, expiresAt: '2026-08-12T12:00:00.000Z', usedAt: null })
    authentication.securityEvents.push({ id: 1, accountId: 1, type: 'fixture-event', detail: 'fixture', ip: null, userAgent: null, createdAt: timestamp })
    authentication.oidcTransactions.push({ id: 1, accountId: 1, purpose: 'link-identity', invitationId: null, tokenHash: 'd'.repeat(64), state: 'state-value-long-enough', nonce: 'nonce-value-long-enough', codeVerifier: 'verifier-value-long-enough', returnTo: '/', createdAt: timestamp, expiresAt: '2026-08-12T12:00:00.000Z', usedAt: null })
    authentication.invitations.push({ id: 1, email: 'invitee@example.com', identityType: 'local', roleIds: [4], tokenHash: 'e'.repeat(64), status: 'pending', createdByAccountId: 1, accountId: null, createdAt: timestamp, expiresAt: '2026-08-12T12:00:00.000Z', acceptedAt: null, revokedAt: null })
    authentication.identityLinkRequests.push({ id: 1, accountId: 1, identityType: 'oidc', status: 'pending', tokenHash: 'f'.repeat(64), issuer: 'https://identity.example', createdAt: timestamp, expiresAt: '2026-08-12T12:00:00.000Z', confirmedAt: null })
    for (const [counter, value] of Object.entries({ nextLocalCredentialId: 2, nextOidcIdentityId: 2, nextSessionId: 2, nextRecoveryTokenId: 2, nextSecurityEventId: 2, nextOidcTransactionId: 2, nextInvitationId: 2, nextIdentityLinkRequestId: 2 })) authentication[counter] = value
    snapshot.authentication = authentication
    try {
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
      expect(handle.database.query('SELECT count(*) AS count FROM permissions').get()).toEqual({ count: 36 })
      expect(handle.database.query('SELECT user_id, role_id FROM user_roles').get()).toEqual({ user_id: 1, role_id: 1 })
      expect(handle.database.query('SELECT invitation_id, role_id FROM invitation_roles').get()).toEqual({ invitation_id: 1, role_id: 4 })
      const projected = projectAuthenticationState(handle.database)
      expect(projected).toMatchObject({
        localCredentials: [{ id: 1, accountId: 1, passwordHash: '$argon2id$fixture-password-hash' }],
        oidcIdentities: [{ id: 1, accountId: 1, subject: 'owner-subject' }],
        sessions: [{ id: 1, accountId: 1, tokenHash: 'b'.repeat(64) }],
        recoveryTokens: [{ id: 1, accountId: 1, tokenHash: 'c'.repeat(64) }],
        securityEvents: [{ id: 1, accountId: 1, type: 'fixture-event', detail: 'fixture' }],
        oidcTransactions: [{ id: 1, accountId: 1, purpose: 'link-identity' }],
        invitations: [{ id: 1, createdByAccountId: 1, roleIds: [4] }],
        identityLinkRequests: [{ id: 1, accountId: 1, issuer: 'https://identity.example' }],
      })
      expect(projected.recordExtensions).toBeUndefined()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects lossy canonical conversions and non-empty targets', async () => {
    const handle = await migratedDatabase()
    try {
      const lossy = schema29ProductionShapeFixture()
      lossy.inventory.ram[0].specs.capacityGb = 1 / 3
      expect(() => importLegacyCore({ database: handle.database, snapshot: lossy, identityPlan: buildCanonicalIdentityPlan(lossy) })).toThrow(/lose precision/iu)

      const valid = schema29ProductionShapeFixture()
      importLegacyCore({ database: handle.database, snapshot: valid, identityPlan: buildCanonicalIdentityPlan(valid) })
      expect(() => importLegacyCore({ database: handle.database, snapshot: valid, identityPlan: buildCanonicalIdentityPlan(valid) })).toThrow(/must not contain inventory/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('stores v9 canonical integers directly and projects friendly inventory units', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    const cpu = snapshot.inventory.cpus[0]
    cpu.specs = { cores: 6, threads: 12, baseClockMhz: 2_300, boostClockMhz: 3_800, vendorFeature: { tier: 'public' } }
    const ram = snapshot.inventory.ram[0]
    ram.specs = { capacityMib: 16_384, generation: 'DDR4', speedMt: 3_200, voltageMv: 1_200 }
    const storage = snapshot.inventory.storage[0]
    storage.specs = { capacityBytes: 1_000_000_000_000, interface: 'NVMe', formFactor: '2280' }
    const adapter = snapshot.inventory.powerAdapters[0]
    adapter.specs = { ratedPowerMw: 90_000, connector: 'Slim tip' }
    const server = snapshot.inventory.servers[0]
    server.compatibility.host.maxExpansionPowerMw = 75_000
    delete server.compatibility.host.maxExpansionPowerWatts
    server.compatibility.host.cpu.maxTdpMw = 65_000
    delete server.compatibility.host.cpu.maxTdpWatts
    server.compatibility.host.memory.maxCapacityMib = 65_536
    delete server.compatibility.host.memory.maxCapacityGb
    server.compatibility.host.experimentalPublicField = { retained: true }
    try {
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
      expect(handle.database.query('SELECT base_clock_mhz, boost_clock_mhz FROM cpus').get()).toEqual({ base_clock_mhz: 2_300, boost_clock_mhz: 3_800 })
      expect(handle.database.query('SELECT capacity_mib, voltage_mv FROM memory_modules').get()).toEqual({ capacity_mib: 16_384, voltage_mv: 1_200 })
      expect(handle.database.query('SELECT capacity_bytes FROM storage_devices').get()).toEqual({ capacity_bytes: 1_000_000_000_000 })
      expect(handle.database.query('SELECT rated_power_mw FROM power_adapters').get()).toEqual({ rated_power_mw: 90_000 })
      expect(handle.database.query('SELECT max_expansion_power_mw FROM host_compatibility_profiles').get()).toEqual({ max_expansion_power_mw: 75_000 })
      const projected = buildLegacyInventoryProjection(handle.database)
      expect(projected.cpus[0].specs).toMatchObject({ baseClockGhz: 2.3, boostClockGhz: 3.8, vendorFeature: { tier: 'public' } })
      expect(projected.ram[0].specs).toMatchObject({ capacityGb: 16, voltageVolts: 1.2 })
      expect(projected.storage[0].specs).toMatchObject({ capacityGb: 1_000 })
      expect(projected.powerAdapters[0].specs).toMatchObject({ wattageWatts: 90 })
      expect(projected.servers[0].compatibility.host).toMatchObject({
        maxExpansionPowerWatts: 75,
        experimentalPublicField: { retained: true },
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
