import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Database } from 'bun:sqlite'

const FORBIDDEN_PATHS = [
  'registry',
  'notifications',
  'credentials',
  'stores/notification-secrets.json',
]
const FORBIDDEN_CONTENT_DIRECTORIES = ['backups']

const EMPTY_TABLES = [
  'agent_enrollment_codes',
  'agent_host_bindings',
  'agent_identity_aliases',
  'agents',
  'credentials',
  'identity_link_requests',
  'invitation_roles',
  'invitations',
  'notification_contact_points',
  'notification_cooldowns',
  'notification_deliveries',
  'notification_delivery_attempts',
  'notification_evaluation_cursors',
  'notification_host_override_resources',
  'notification_host_overrides',
  'notification_monitored_resources',
  'notification_normalized_states',
  'notification_pending_transitions',
  'notification_quiet_hours',
  'notification_rule_contact_points',
  'notification_secrets',
  'registry_contribution_outbox',
  'registry_installation_projection',
  'sessions',
]

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

function tableExists(database, table) {
  return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

function sanitizeCore(database) {
  const operation = database.transaction(() => {
    database.exec('PRAGMA foreign_keys = OFF;')
    for (const table of EMPTY_TABLES) if (tableExists(database, table)) database.exec(`DELETE FROM "${table}";`)
    if (tableExists(database, 'authentication_settings')) {
      database.exec(`UPDATE authentication_settings SET
        enabled = 0, local_enabled = 0, oidc_enabled = 0,
        oidc_issuer = NULL, oidc_client_id = NULL, oidc_external_url = NULL,
        oidc_client_secret_configured = 0, setup_required = 0, updated_at_ms = NULL;`)
    }
    if (tableExists(database, 'notification_settings')) {
      database.exec('UPDATE notification_settings SET enabled = 0;')
    }
    if (tableExists(database, 'registry_settings')) {
      const columns = database.query('PRAGMA table_info(registry_settings)').all().map((column) => column.name)
      if (columns.includes('automatic_contributions')) {
        database.exec('UPDATE registry_settings SET automatic_contributions = 0;')
      }
    }
    if (tableExists(database, 'backup_schedules')) {
      database.exec('UPDATE backup_schedules SET enabled = 0;')
    }
    if (tableExists(database, 'backup_operations')) database.exec('DELETE FROM backup_operations;')
    if (tableExists(database, 'backup_restore_journal')) database.exec('DELETE FROM backup_restore_journal;')
    database.exec('PRAGMA foreign_keys = ON;')
  })
  operation()
  const integrity = database.query('PRAGMA quick_check').get()?.quick_check
  const foreignKeys = database.query('PRAGMA foreign_key_check').all()
  if (integrity !== 'ok' || foreignKeys.length > 0) throw new Error('Sanitized core database failed integrity validation.')
}

async function fingerprintDirectory(directory) {
  const hash = createHash('sha256')
  async function visit(current, relative = '') {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = path.join(relative, entry.name)
      const child = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Staging data contains symlink ${childRelative}.`)
      if (entry.isDirectory()) await visit(child, childRelative)
      else if (entry.isFile() && !entry.name.endsWith('-wal') && !entry.name.endsWith('-shm')) {
        hash.update(`${childRelative}\0`)
        hash.update(await fs.readFile(child))
      }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}

async function directoryContainsFiles(directory) {
  if (!await exists(directory)) return false
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() || entry.isSymbolicLink()) return true
    if (entry.isDirectory() && await directoryContainsFiles(path.join(directory, entry.name))) return true
  }
  return false
}

export async function validateStagingData(dataDir) {
  const corePath = path.join(dataDir, 'databases', 'homelab-inventory.sqlite')
  if (!await exists(corePath)) throw new Error('Staging core database is missing.')
  for (const relative of FORBIDDEN_PATHS) {
    if (await exists(path.join(dataDir, relative))) throw new Error(`Staging data retains forbidden path ${relative}.`)
  }
  for (const relative of FORBIDDEN_CONTENT_DIRECTORIES) {
    if (await directoryContainsFiles(path.join(dataDir, relative))) {
      throw new Error(`Staging data retains forbidden content in ${relative}.`)
    }
  }
  const database = new Database(corePath)
  try {
    if (database.query('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Staging core database is invalid.')
    if (tableExists(database, 'authentication_settings')) {
      const row = database.query('SELECT enabled, local_enabled, oidc_enabled FROM authentication_settings WHERE id = 1').get()
      if (row && (row.enabled || row.local_enabled || row.oidc_enabled)) throw new Error('Staging authentication remains enabled.')
    }
    for (const table of EMPTY_TABLES) {
      if (tableExists(database, table) && Number(database.query(`SELECT COUNT(*) AS count FROM "${table}"`).get().count) > 0) {
        throw new Error(`Staging table ${table} retains active private state.`)
      }
    }
  } finally {
    database.close(false)
  }
  return { fingerprint: await fingerprintDirectory(dataDir) }
}

export async function sanitizeStagingData(dataDir) {
  const corePath = path.join(dataDir, 'databases', 'homelab-inventory.sqlite')
  const database = new Database(corePath)
  try { sanitizeCore(database) } finally { database.close(false) }
  for (const relative of FORBIDDEN_PATHS) await fs.rm(path.join(dataDir, relative), { recursive: true, force: true })
  for (const relative of FORBIDDEN_CONTENT_DIRECTORIES) await fs.rm(path.join(dataDir, relative), { recursive: true, force: true })
  for (const name of await fs.readdir(path.join(dataDir, 'stores')).catch(() => [])) {
    if (name.endsWith('.tmp')) await fs.rm(path.join(dataDir, 'stores', name), { force: true })
  }
  const result = await validateStagingData(dataDir)
  return { ...result, sanitizedAt: new Date().toISOString() }
}
