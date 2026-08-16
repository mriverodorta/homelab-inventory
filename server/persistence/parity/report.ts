import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PERMISSIONS } from '../../auth/permission-catalog.mjs'

const PROTECTED_IDENTITY_FILES = Object.freeze([
  'installation-instance.json',
  'installation-ed25519.pem',
  'installation-credentials.json',
])

function values(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function canonicalInventoryType(value: unknown) {
  return value === 'wireless' ? 'network' : value
}

function canonicalItemReference(value: unknown) {
  return typeof value === 'string' && value.startsWith('wireless:')
    ? `network:${value.slice('wireless:'.length)}`
    : value
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function itemKey(record: Record<string, any>, prefix: 'host' | 'item' | 'endpoint') {
  if (prefix === 'host') return canonicalItemReference(record.serverId ?? `${record.hostType}:${record.hostId}`)
  if (prefix === 'endpoint') {
    return canonicalItemReference(record.itemId ?? `${canonicalInventoryType(record.itemType)}:${record.legacyItemId}`)
  }
  return canonicalItemReference(typeof record.itemId === 'string'
    ? record.itemId
    : `${canonicalInventoryType(record.itemType)}:${record.itemId}`)
}

export function normalizedTopology(project: Record<string, any>) {
  const assignments = values(project.assignments).map((assignment) => ({
    host: itemKey(assignment, 'host'),
    item: itemKey(assignment, 'item'),
    type: canonicalInventoryType(assignment.type ?? assignment.itemType),
    assignedAt: assignment.assignedAt ?? null,
    allocation: assignment.allocation ? {
      resourceType: assignment.allocation.resourceType ?? null,
      groupId: assignment.allocation.groupId ?? null,
      positions: [...(assignment.allocation.positions ?? [])].sort((left, right) => left - right),
    } : null,
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  const placements = values(project.placements).map((placement) => ({
    item: canonicalItemReference(placement.serverId ?? `${canonicalInventoryType(placement.itemType)}:${placement.itemId}`),
    x: placement.x,
    y: placement.y,
    orientation: placement.orientation ?? null,
    zIndex: placement.zIndex ?? 0,
  })).sort((left, right) => left.item.localeCompare(right.item))
  const connections = values(project.connections).map((connection) => ({
    from: {
      item: typeof connection.from?.itemId === 'string'
        ? canonicalItemReference(connection.from.itemId)
        : `${canonicalInventoryType(connection.from?.itemType)}:${connection.from?.itemId}`,
      portId: connection.from?.portId,
    },
    to: {
      item: typeof connection.to?.itemId === 'string'
        ? canonicalItemReference(connection.to.itemId)
        : `${canonicalInventoryType(connection.to?.itemType)}:${connection.to?.itemId}`,
      portId: connection.to?.portId,
    },
    type: connection.type,
    createdAt: connection.createdAt ?? null,
    route: connection.route ? {
      sourceSide: connection.route.sourceSide ?? null,
      targetSide: connection.route.targetSide ?? null,
      bendPoints: connection.route.bendPoints ?? [],
      avoidCableOverlap: connection.route.avoidCableOverlap === true,
    } : null,
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  return { assignments, placements, connections }
}

export function topologyHash(project: Record<string, any>) {
  return createHash('sha256').update(canonicalJson(normalizedTopology(project))).digest('hex')
}

export async function protectedIdentityHashes(dataDir: string) {
  const entries = await Promise.all(PROTECTED_IDENTITY_FILES.map(async (file) => {
    try {
      const body = await readFile(join(dataDir, 'registry', file))
      return [file, createHash('sha256').update(body).digest('hex')] as const
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [file, null] as const
      throw error
    }
  }))
  return Object.fromEntries(entries)
}

export function authenticationCountsFromLegacy(authentication: Record<string, any>) {
  return {
    accounts: values(authentication?.accounts).length,
    credentials: values(authentication?.localCredentials).length,
    identities: values(authentication?.oidcIdentities).length,
    sessions: values(authentication?.sessions).length,
    roles: values(authentication?.roles).length,
    permissions: PERMISSIONS.length,
    rolePermissions: values(authentication?.rolePermissions).length,
    accountRoles: values(authentication?.accountRoles).length,
    invitations: values(authentication?.invitations).length,
  }
}

export function authenticationCountsFromSqlite(database: Database) {
  const tables = {
    accounts: 'users', credentials: 'credentials', identities: 'user_identities',
    sessions: 'sessions', roles: 'roles', permissions: 'permissions',
    rolePermissions: 'role_permissions', accountRoles: 'user_roles', invitations: 'invitations',
  }
  return Object.fromEntries(Object.entries(tables).map(([key, table]) => [
    key,
    Number((database.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count),
  ]))
}

export function telemetryCounts(filePath: string) {
  const database = new Database(filePath, { readonly: true, strict: true })
  const tables = [
    'heartbeat_receipts', 'host_metric_samples', 'agent_capabilities', 'host_system_facts',
    'host_runtime_state', 'telemetry_family_revisions', 'service_states', 'container_states',
    'storage_device_states', 'filesystem_mount_states', 'gpu_states', 'sensor_states',
    'storage_health_states', 'component_events', 'latest_virtualization_state', 'virtualization_events',
    'manual_inventory_reports', 'manual_inventory_components', 'agent_field_suggestions',
  ]
  try {
    const existing = new Set((database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
    return Object.fromEntries(tables.map((table) => [
      table,
      existing.has(table)
        ? Number((database.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count)
        : 0,
    ]))
  } finally {
    database.close(false)
  }
}

export function catalogIndexSummary(filePath: string) {
  const database = new Database(filePath, { readonly: true, strict: true })
  try {
    return {
      schemaVersion: Number((database.query('PRAGMA user_version').get() as { user_version: number }).user_version),
      templates: Number((database.query('SELECT count(*) AS count FROM templates').get() as { count: number }).count),
    }
  } finally {
    database.close(false)
  }
}
