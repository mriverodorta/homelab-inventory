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

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function itemKey(record: Record<string, any>, prefix: 'host' | 'item' | 'endpoint') {
  if (prefix === 'host') return record.serverId ?? `${record.hostType}:${record.hostId}`
  if (prefix === 'endpoint') return record.itemId ?? `${record.itemType}:${record.legacyItemId}`
  return typeof record.itemId === 'string' ? record.itemId : `${record.itemType}:${record.itemId}`
}

export function normalizedTopology(project: Record<string, any>) {
  const assignments = values(project.assignments).map((assignment) => ({
    host: itemKey(assignment, 'host'),
    item: itemKey(assignment, 'item'),
    type: assignment.type ?? assignment.itemType,
    assignedAt: assignment.assignedAt ?? null,
    allocation: assignment.allocation ? {
      resourceType: assignment.allocation.resourceType ?? null,
      groupId: assignment.allocation.groupId ?? null,
      positions: [...(assignment.allocation.positions ?? [])].sort((left, right) => left - right),
    } : null,
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  const placements = values(project.placements).map((placement) => ({
    item: placement.serverId ?? `${placement.itemType}:${placement.itemId}`,
    x: placement.x,
    y: placement.y,
    orientation: placement.orientation ?? null,
    zIndex: placement.zIndex ?? 0,
  })).sort((left, right) => left.item.localeCompare(right.item))
  const connections = values(project.connections).map((connection) => ({
    from: {
      item: typeof connection.from?.itemId === 'string'
        ? connection.from.itemId
        : `${connection.from?.itemType}:${connection.from?.itemId}`,
      portId: connection.from?.portId,
    },
    to: {
      item: typeof connection.to?.itemId === 'string'
        ? connection.to.itemId
        : `${connection.to?.itemType}:${connection.to?.itemId}`,
      portId: connection.to?.portId,
    },
    type: connection.type,
    negotiatedSpeedMbps: connection.negotiatedSpeedMbps ?? null,
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
    'telemetry_samples', 'latest_host_state', 'latest_component_state', 'component_events',
    'host_metric_samples', 'network_interface_samples', 'storage_device_samples',
    'filesystem_samples', 'latest_virtualization_state', 'virtualization_events',
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
