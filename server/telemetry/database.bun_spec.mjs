import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  closeTelemetryDatabase,
  openTelemetryDatabase,
  TELEMETRY_DATABASE_RELATIVE_PATH,
  telemetryDatabaseStatus,
} from './database.mjs'

const directories = []

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-db-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('telemetry database', () => {
  test('creates a private WAL database and reopens the current schema', async () => {
    const dataDir = await temporaryDirectory()
    const filePath = path.join(dataDir, TELEMETRY_DATABASE_RELATIVE_PATH)
    const first = await openTelemetryDatabase({ dataDir })
    expect(telemetryDatabaseStatus(first)).toEqual({ schemaVersion: 1, journalMode: 'wal', expectedSchemaVersion: 1 })
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
    closeTelemetryDatabase(first)

    const second = await openTelemetryDatabase({ dataDir })
    expect(telemetryDatabaseStatus(second).schemaVersion).toBe(1)
    closeTelemetryDatabase(second)
  })

  test('fails closed when the database is corrupt', async () => {
    const dataDir = await temporaryDirectory()
    const filePath = path.join(dataDir, TELEMETRY_DATABASE_RELATIVE_PATH)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'this is not sqlite')

    await expect(openTelemetryDatabase({ dataDir })).rejects.toThrow('Unable to initialize telemetry database')
  })

  test('rejects schema versions newer than the application', async () => {
    const dataDir = await temporaryDirectory()
    const database = await openTelemetryDatabase({ dataDir })
    database.exec('PRAGMA user_version = 999;')
    closeTelemetryDatabase(database)

    await expect(openTelemetryDatabase({ dataDir })).rejects.toThrow('newer than this app supports')
  })
})
