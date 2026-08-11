import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import {
  REQUIRED_BUN_VERSION,
  REQUIRED_SQLITE_CAPABILITIES,
  REQUIRED_SQLITE_VERSION,
  compareVersions,
  validateSQLiteRuntimeReport,
  verifySQLiteRuntime,
} from './verify-sqlite-runtime.mjs'

describe('SQLite runtime verifier', () => {
  test('pins every Bun Docker stage and verifies SQLite in the final image', async () => {
    const dockerfile = await fs.readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
    expect(dockerfile.match(/oven\/bun:1\.3\.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0/gu)).toHaveLength(3)
    expect(dockerfile.match(/oven\/bun:1\.3\.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04/gu)).toHaveLength(1)
    expect(dockerfile).toContain('RUN ["bun", "scripts/verify-sqlite-runtime.mjs"]')
    expect(dockerfile).not.toMatch(/oven\/bun:1-(?:alpine|slim)/u)
  })

  test.each([
    ['3.51.0', '3.51.0', 0],
    ['3.51.1', '3.51.0', 1],
    ['3.50.9', '3.51.0', -1],
    ['3.51', '3.51.0', 0],
    ['4.0.0', '3.51.0', 1],
  ])('compares %s with %s', (actual, required, expected) => {
    expect(Math.sign(compareVersions(actual, required))).toBe(expected)
  })

  test('executes every required capability against the current Bun runtime', async () => {
    await expect(verifySQLiteRuntime({ requiredBunVersion: Bun.version })).resolves.toMatchObject({
      ok: true,
      bunVersion: Bun.version,
      capabilities: {
        foreignKeys: true,
        fts5: true,
        generatedColumns: true,
        json: true,
        jsonb: true,
        mathFunctions: true,
        optimize: true,
        preparedStatements: true,
        quickCheck: true,
        rtree: true,
        strictTables: true,
        transactionRollback: true,
        wal: true,
      },
    })
  })

  test('rejects an unsupported Bun version', () => {
    expect(() => validateSQLiteRuntimeReport({
      bunVersion: '1.3.13',
      sqliteVersion: REQUIRED_SQLITE_VERSION,
      capabilities: { strictTables: true },
    })).toThrow(`Bun ${REQUIRED_BUN_VERSION}`)
  })

  test('rejects an unsupported SQLite version', () => {
    expect(() => validateSQLiteRuntimeReport({
      bunVersion: REQUIRED_BUN_VERSION,
      sqliteVersion: '3.50.0',
      capabilities: { strictTables: true },
    })).toThrow(`SQLite ${REQUIRED_SQLITE_VERSION}`)
  })

  test('names every missing capability', () => {
    const capabilities = Object.fromEntries(REQUIRED_SQLITE_CAPABILITIES.map((name) => [name, true]))
    capabilities.jsonb = false
    capabilities.fts5 = false
    expect(() => validateSQLiteRuntimeReport({
      bunVersion: REQUIRED_BUN_VERSION,
      sqliteVersion: REQUIRED_SQLITE_VERSION,
      capabilities,
    })).toThrow(/Missing SQLite capabilities:.*jsonb.*fts5/u)
  })
})
