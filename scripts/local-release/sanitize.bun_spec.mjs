import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sanitizeStagingData, validateStagingData } from './sanitize.mjs'

const roots = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-release-sanitize-'))
  roots.push(root)
  await fs.mkdir(path.join(root, 'databases'), { recursive: true })
  await fs.mkdir(path.join(root, 'registry'), { recursive: true })
  await fs.mkdir(path.join(root, 'notifications'), { recursive: true })
  await fs.mkdir(path.join(root, 'backups'), { recursive: true })
  const database = new Database(path.join(root, 'databases', 'homelab-inventory.sqlite'))
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE inventory_items(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO inventory_items VALUES(1, 'Keep me');
    CREATE TABLE authentication_settings(id INTEGER PRIMARY KEY, enabled INTEGER, local_enabled INTEGER, oidc_enabled INTEGER, oidc_issuer TEXT, oidc_client_id TEXT, oidc_external_url TEXT, oidc_client_secret_configured INTEGER, setup_required INTEGER, updated_at_ms INTEGER);
    INSERT INTO authentication_settings VALUES(1,1,1,1,'issuer','client','url',1,0,1);
    CREATE TABLE credentials(id INTEGER PRIMARY KEY, secret_hash TEXT);
    INSERT INTO credentials VALUES(1,'private');
    CREATE TABLE sessions(id INTEGER PRIMARY KEY, token TEXT);
    INSERT INTO sessions VALUES(1,'token');
    CREATE TABLE agents(id INTEGER PRIMARY KEY, public_key TEXT);
    INSERT INTO agents VALUES(1,'key');
    CREATE TABLE agent_host_bindings(id INTEGER PRIMARY KEY, agent_id INTEGER REFERENCES agents(id));
    INSERT INTO agent_host_bindings VALUES(1,1);
    CREATE TABLE registry_installation_projection(id INTEGER PRIMARY KEY, client_instance_id TEXT);
    INSERT INTO registry_installation_projection VALUES(1,'uuid');
    CREATE TABLE registry_contribution_outbox(id INTEGER PRIMARY KEY);
    INSERT INTO registry_contribution_outbox VALUES(1);
  `)
  database.close(false)
  await fs.writeFile(path.join(root, 'registry', 'installation-ed25519.pem'), 'private')
  await fs.writeFile(path.join(root, 'notifications', 'master-key'), 'private')
  await fs.writeFile(path.join(root, 'backups', 'private-backup.hli'), 'private')
  return root
}

describe('staging sanitization', () => {
  test('retains business data and removes environment identity and credentials', async () => {
    const root = await fixture()
    const result = await sanitizeStagingData(root)
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    const database = new Database(path.join(root, 'databases', 'homelab-inventory.sqlite'))
    expect(database.query('SELECT name FROM inventory_items').get()).toEqual({ name: 'Keep me' })
    expect(database.query('SELECT COUNT(*) AS count FROM credentials').get().count).toBe(0)
    expect(database.query('SELECT COUNT(*) AS count FROM agents').get().count).toBe(0)
    expect(database.query('SELECT enabled FROM authentication_settings').get().enabled).toBe(0)
    database.close(false)
    await expect(fs.stat(path.join(root, 'registry'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(validateStagingData(root)).resolves.toMatchObject({ fingerprint: result.fingerprint })
  })

  test('allows empty runtime backup directories but rejects backup files', async () => {
    const root = await fixture()
    await sanitizeStagingData(root)
    await fs.mkdir(path.join(root, 'backups', 'user', '.staging'), { recursive: true })

    await expect(validateStagingData(root)).resolves.toMatchObject({ fingerprint: expect.any(String) })

    await fs.writeFile(path.join(root, 'backups', 'user', 'leaked.hli'), 'private')
    await expect(validateStagingData(root)).rejects.toThrow('forbidden content in backups')
  })

  test('allows only verified migration backups during the post-start staging check', async () => {
    const root = await fixture()
    await sanitizeStagingData(root)
    const directory = path.join(root, 'backups', 'migrations', 'sqlite-upgrade-2026-08-13T20-51-36-953Z')
    await fs.mkdir(directory, { recursive: true })
    const files = {}
    for (const [name, file] of Object.entries({ core: 'core.sqlite', telemetry: 'telemetry.sqlite', catalog: 'catalog.sqlite' })) {
      const body = Buffer.from(`${name}-database`)
      await fs.writeFile(path.join(directory, file), body)
      files[name] = {
        file,
        sizeBytes: body.length,
        sha256: new Bun.CryptoHasher('sha256').update(body).digest('hex'),
      }
    }
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
      version: 1,
      kind: 'sqlite-upgrade',
      createdAt: '2026-08-13T20:51:36.953Z',
      files,
    }))
    await fs.mkdir(path.join(root, 'backups', 'user', '.restore'), { recursive: true })

    await expect(validateStagingData(root)).rejects.toThrow('forbidden content in backups')
    await expect(validateStagingData(root, { allowGeneratedMigrationBackups: true })).resolves.toMatchObject({
      fingerprint: expect.any(String),
    })

    await fs.writeFile(path.join(directory, 'core.sqlite'), 'tampered')
    await expect(validateStagingData(root, { allowGeneratedMigrationBackups: true }))
      .rejects.toThrow('failed verification for core.sqlite')
  })
})
