import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { replaceSharingIdentityState } from './backup-service.mjs'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { closeManagedDatabase, openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('sharing identity restore', () => {
  test('replaces the projection and durable account operations atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hli-sharing-identity-restore-'))
    directories.push(directory)
    const handle = await openManagedDatabase({ filePath: join(directory, 'core.sqlite'), schemaName: 'core' })
    try {
      const migrationsDirectory = resolve(import.meta.dir, '../persistence/core/migrations/generated')
      await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        ...migration,
        sql: await readFile(join(migrationsDirectory, migration.file), 'utf8'),
      }))))
      const projection = {
        id: 1,
        client_instance_id: '11111111-3333-4555-8666-777777777777',
        key_id: 'key-id',
        public_key_spki: 'public-key',
        identity_hash: 'a'.repeat(64),
        remote_installation_id: 7,
        credential_expires_at_ms: 99,
        state: 'active',
        recovery_public_key_spki: null,
        account_claimed: 1,
        github_username: 'maikeldorta',
        account_claimed_at_ms: 50,
        account_binding_revision: 3,
        created_at_ms: 1,
        updated_at_ms: 2,
      }
      const operation = {
        id: 1,
        client_attempt_id: '3c58e2df-f909-4131-b62c-7763682fc1d4',
        remote_idempotency_key: 'c3373662-7995-4179-824c-bfb08e80996d',
        share_disposition: 'keep',
        expected_account_binding_revision: 3,
        state: 'retrying',
        result_json: null,
        last_error_code: 'labgd-unavailable',
        actor_user_id: null,
        created_at_ms: 1,
        updated_at_ms: 2,
      }

      replaceSharingIdentityState(handle.database, { projection, accountOperations: [operation] })

      expect(handle.database.query('SELECT account_binding_revision, github_username FROM sharing_installation_projection').get()).toEqual({ account_binding_revision: 3, github_username: 'maikeldorta' })
      expect(handle.database.query('SELECT client_attempt_id, remote_idempotency_key, state FROM sharing_account_operations').get()).toEqual({ client_attempt_id: operation.client_attempt_id, remote_idempotency_key: operation.remote_idempotency_key, state: 'retrying' })
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
