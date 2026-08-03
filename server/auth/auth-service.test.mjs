import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from './auth-service.mjs'
import { assertAuthenticationStoreShape, createAuthenticationStore, createOwnerAccount, ensureProtectedOwnerRole } from './model.mjs'

const directories = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

function fakeStore({ failNextFlush = false, initialState = null } = {}) {
  let state = structuredClone(initialState ?? createAuthenticationStore())
  let shouldFail = failNextFlush
  return {
    getAuthenticationState: () => structuredClone(state),
    updateAuthentication(mutator) {
      const draft = structuredClone(state)
      mutator(draft)
      assertAuthenticationStoreShape(draft)
      state = draft
      return structuredClone(state)
    },
    async flush() {
      if (!shouldFail) return
      shouldFail = false
      throw new Error('simulated persistence failure')
    },
  }
}

function runtime(secretFile, secret = null) {
  return {
    bootstrapCode: 'bootstrap-code', bootstrapSource: 'generated', externalUrl: null,
    oidcClientSecret: secret, oidcClientSecretFile: secretFile, oidcSecretLocked: false,
    backupEncryptionConfigured: false,
  }
}

function oidcSettings(clientSecret = 'new-client-secret') {
  return {
    enabled: true,
    localEnabled: false,
    oidcEnabled: true,
    oidc: {
      issuer: 'https://identity.example/application/o/inventory/',
      clientId: 'homelab-inventory',
      clientSecret,
      externalUrl: 'https://inventory.example',
      scopes: ['openid', 'profile', 'email'],
    },
  }
}

describe('authentication settings service', () => {
  it('lets an authenticated OIDC account add local sign-in without creating another account', async () => {
    vi.stubGlobal('Bun', { password: { hash: vi.fn(async () => '$argon2id$test-password-hash') } })
    const state = createAuthenticationStore()
    state.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
    state.nextAccountId = 2
    ensureProtectedOwnerRole(state, 1)
    state.oidcIdentities.push({
      id: state.nextOidcIdentityId++, accountId: 1,
      issuer: 'https://identity.example/application/o/inventory', subject: 'owner-subject',
      email: 'owner@example.com', createdAt: '2026-08-02T00:00:00.000Z', lastLoginAt: '2026-08-02T00:00:00.000Z',
    })
    const store = fakeStore({ initialState: state })
    const authorization = { permissionsForSync: () => ['authentication.view'] }
    const service = new AuthService({
      store,
      sessionService: { authenticateRequest: () => ({ account: { id: 1 }, session: { id: 1 } }) },
      authorization,
      runtime: runtime('/unused'),
    })

    const status = await service.addLocalIdentity({ username: 'owner-local', password: 'A-long-local-password-123!' }, {})

    expect(store.getAuthenticationState().accounts).toHaveLength(1)
    expect(store.getAuthenticationState().accounts[0].username).toBe('owner-local')
    expect(store.getAuthenticationState().localCredentials).toHaveLength(1)
    expect(status.identityMethods).toEqual({ local: true, oidc: true })
  })

  it('writes OIDC secrets privately and reports actual runtime configuration', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-service-'))
    directories.push(directory)
    const secretFile = path.join(directory, 'oidc-secret')
    const store = fakeStore()
    const service = new AuthService({ store, sessionService: { externalUrl: null }, runtime: runtime(secretFile) })
    const status = await service.updateMethods(oidcSettings())
    expect(await fs.readFile(secretFile, 'utf8')).toBe('new-client-secret\n')
    expect((await fs.stat(secretFile)).mode & 0o777).toBe(0o600)
    expect(status.mode).toBe('oidc')
    expect(status.oidc.clientSecretConfigured).toBe(true)
  })

  it('rolls back the secret and authentication store when persistence fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-service-'))
    directories.push(directory)
    const secretFile = path.join(directory, 'oidc-secret')
    const store = fakeStore({ failNextFlush: true })
    const originalState = store.getAuthenticationState()
    const service = new AuthService({ store, sessionService: { externalUrl: null }, runtime: runtime(secretFile) })
    await expect(service.updateMethods(oidcSettings())).rejects.toThrow('simulated persistence failure')
    expect(store.getAuthenticationState()).toEqual(originalState)
    await expect(fs.stat(secretFile)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(service.runtime.oidcClientSecret).toBeNull()
  })

  it('does not trust a stale persisted secret-configured flag', () => {
    const store = fakeStore()
    store.updateAuthentication((draft) => { draft.configuration.oidc.clientSecretConfigured = true })
    const service = new AuthService({ store, sessionService: {}, runtime: runtime('/unused') })
    expect(service.status().oidc.clientSecretConfigured).toBe(false)
  })

  it('reports a dormant local credential when local login is disabled', () => {
    const state = createAuthenticationStore()
    state.accounts.push({
      id: 1,
      username: 'owner',
      displayName: 'Owner',
      role: 'owner',
      active: true,
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
    })
    state.localCredentials.push({
      id: 1,
      accountId: 1,
      passwordHash: 'argon2id-hash-placeholder',
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
    })
    state.nextAccountId = 2
    state.nextLocalCredentialId = 2
    const service = new AuthService({
      store: fakeStore({ initialState: state }),
      sessionService: {},
      runtime: runtime('/unused'),
    })

    expect(service.status()).toMatchObject({
      mode: 'disabled',
      localCredentialConfigured: true,
      methods: { local: false, oidc: false },
    })
  })

  it('does not allow local login to be disabled before the owner binds OIDC', async () => {
    const state = createAuthenticationStore()
    state.accounts.push({
      id: 1,
      username: 'owner',
      displayName: 'Owner',
      role: 'owner',
      active: true,
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
    })
    state.nextAccountId = 2
    state.configuration.oidc.clientSecretConfigured = true
    const store = fakeStore({ initialState: state })
    const service = new AuthService({
      store,
      sessionService: { externalUrl: null },
      runtime: runtime('/unused', 'existing-secret'),
    })
    await expect(service.updateMethods(oidcSettings('')))
      .rejects.toThrow(/Link the owner identity through OIDC/)
  })

  it('blocks authentication from being enabled while scheduled backups are unencrypted', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-service-'))
    directories.push(directory)
    const secretFile = path.join(directory, 'oidc-secret')
    const store = fakeStore()
    store.getBackupManagementState = () => ({ schedule: { enabled: true } })
    const service = new AuthService({
      store,
      sessionService: { externalUrl: null },
      runtime: runtime(secretFile),
    })

    await expect(service.updateMethods(oidcSettings()))
      .rejects.toThrow(/BACKUP_ENCRYPTION_PASSPHRASE/)
    expect(store.getAuthenticationState().configuration.enabled).toBe(false)
  })

  it('allows authentication with scheduled backups when environment encryption is configured', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-service-'))
    directories.push(directory)
    const secretFile = path.join(directory, 'oidc-secret')
    const store = fakeStore()
    store.getBackupManagementState = () => ({ schedule: { enabled: true } })
    const configuredRuntime = runtime(secretFile)
    configuredRuntime.backupEncryptionConfigured = true
    const service = new AuthService({
      store,
      sessionService: { externalUrl: null },
      runtime: configuredRuntime,
    })

    const status = await service.updateMethods(oidcSettings())
    expect(status.mode).toBe('oidc')
  })
})
