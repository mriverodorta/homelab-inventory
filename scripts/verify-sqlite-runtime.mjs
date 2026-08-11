#!/usr/bin/env bun

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'

export const REQUIRED_BUN_VERSION = '1.3.14'
export const REQUIRED_SQLITE_VERSION = '3.51.0'
export const REQUIRED_SQLITE_CAPABILITIES = Object.freeze([
  'strictTables',
  'foreignKeys',
  'wal',
  'transactionRollback',
  'preparedStatements',
  'json',
  'jsonb',
  'fts5',
  'rtree',
  'mathFunctions',
  'generatedColumns',
  'optimize',
  'quickCheck',
])

function versionParts(value) {
  if (!/^\d+(?:\.\d+)*$/u.test(value)) throw new Error(`Invalid version ${value}.`)
  return value.split('.').map(Number)
}

export function compareVersions(actual, required) {
  const actualParts = versionParts(actual)
  const requiredParts = versionParts(required)
  const length = Math.max(actualParts.length, requiredParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (actualParts[index] ?? 0) - (requiredParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function validateSQLiteRuntimeReport(report, {
  requiredBunVersion = REQUIRED_BUN_VERSION,
  requiredSQLiteVersion = REQUIRED_SQLITE_VERSION,
} = {}) {
  if (report.bunVersion !== requiredBunVersion) {
    throw new Error(`Bun ${requiredBunVersion} is required; found ${report.bunVersion}.`)
  }
  if (compareVersions(report.sqliteVersion, requiredSQLiteVersion) < 0) {
    throw new Error(`SQLite ${requiredSQLiteVersion} or newer is required; found ${report.sqliteVersion}.`)
  }
  const missing = REQUIRED_SQLITE_CAPABILITIES.filter((name) => report.capabilities?.[name] !== true)
  if (missing.length > 0) throw new Error(`Missing SQLite capabilities: ${missing.join(', ')}.`)
  return { ...report, ok: true }
}

function succeeds(operation) {
  try {
    return operation() === true
  } catch {
    return false
  }
}

async function probeSQLiteRuntime(filePath) {
  const database = new Database(filePath, { create: true, strict: true })
  const capabilities = {}
  try {
    const sqliteVersion = String(database.query('SELECT sqlite_version() AS version').get().version)
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')

    capabilities.wal = String(database.query('PRAGMA journal_mode = WAL').get().journal_mode).toLowerCase() === 'wal'

    capabilities.strictTables = succeeds(() => {
      database.exec('CREATE TABLE strict_probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL) STRICT;')
      try {
        database.query('INSERT INTO strict_probe (value) VALUES (?)').run('not-an-integer')
        return false
      } catch {
        return true
      }
    })

    capabilities.foreignKeys = succeeds(() => {
      database.exec(`
        CREATE TABLE parent_probe (id INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE child_probe (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER NOT NULL REFERENCES parent_probe(id)
        ) STRICT;
      `)
      try {
        database.query('INSERT INTO child_probe (id, parent_id) VALUES (1, 999)').run()
        return false
      } catch {
        return true
      }
    })

    capabilities.preparedStatements = succeeds(() => (
      database.query('SELECT ? + ? AS total').get(2, 3).total === 5
    ))

    capabilities.transactionRollback = succeeds(() => {
      database.exec('CREATE TABLE transaction_probe (id INTEGER PRIMARY KEY) STRICT;')
      const rollback = database.transaction(() => {
        database.query('INSERT INTO transaction_probe (id) VALUES (?)').run(1)
        throw new Error('rollback-probe')
      })
      try {
        rollback()
      } catch (error) {
        if (error.message !== 'rollback-probe') throw error
      }
      return database.query('SELECT COUNT(*) AS count FROM transaction_probe').get().count === 0
    })

    capabilities.json = succeeds(() => (
      database.query(`SELECT json_extract('{"value":42}', '$.value') AS value`).get().value === 42
    ))
    capabilities.jsonb = succeeds(() => {
      const result = database.query(`
        SELECT typeof(jsonb('{"value":42}')) AS storage_type,
               json_extract(jsonb('{"value":42}'), '$.value') AS value
      `).get()
      return result.storage_type === 'blob' && result.value === 42
    })

    capabilities.fts5 = succeeds(() => {
      database.exec("CREATE VIRTUAL TABLE search_probe USING fts5(value); INSERT INTO search_probe(value) VALUES ('homelab inventory');")
      return database.query("SELECT COUNT(*) AS count FROM search_probe WHERE search_probe MATCH 'inventory'").get().count === 1
    })

    capabilities.rtree = succeeds(() => {
      database.exec('CREATE VIRTUAL TABLE spatial_probe USING rtree(id, min_x, max_x, min_y, max_y);')
      database.query('INSERT INTO spatial_probe VALUES (?, ?, ?, ?, ?)').run(1, 0, 24, 0, 24)
      return database.query('SELECT COUNT(*) AS count FROM spatial_probe WHERE min_x <= 12 AND max_x >= 12').get().count === 1
    })

    capabilities.mathFunctions = succeeds(() => database.query('SELECT sqrt(81) AS value').get().value === 9)
    capabilities.generatedColumns = succeeds(() => {
      database.exec(`
        CREATE TABLE generated_probe (
          base INTEGER NOT NULL,
          doubled INTEGER GENERATED ALWAYS AS (base * 2) STORED
        ) STRICT;
        INSERT INTO generated_probe(base) VALUES (21);
      `)
      return database.query('SELECT doubled FROM generated_probe').get().doubled === 42
    })
    capabilities.optimize = succeeds(() => {
      database.query('PRAGMA optimize').all()
      return true
    })
    capabilities.quickCheck = succeeds(() => database.query('PRAGMA quick_check').get().quick_check === 'ok')

    const compileOptions = database.query('PRAGMA compile_options').all().map((row) => String(row.compile_options)).sort()
    return {
      bunVersion: Bun.version,
      sqliteVersion,
      capabilities,
      diagnostics: {
        session: compileOptions.includes('ENABLE_SESSION'),
        snapshot: compileOptions.includes('ENABLE_SNAPSHOT'),
      },
    }
  } finally {
    try {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    } finally {
      database.close(false)
    }
  }
}

export async function verifySQLiteRuntime({
  requiredBunVersion = REQUIRED_BUN_VERSION,
  requiredSQLiteVersion = REQUIRED_SQLITE_VERSION,
} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-inventory-sqlite-runtime-'))
  try {
    const report = await probeSQLiteRuntime(path.join(directory, 'runtime.sqlite'))
    return validateSQLiteRuntimeReport(report, { requiredBunVersion, requiredSQLiteVersion })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) console.log(JSON.stringify(await verifySQLiteRuntime()))
