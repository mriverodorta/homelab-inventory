import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAuthRuntimeConfig } from './config.mjs'

const directories = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

describe('authentication runtime config', () => {
  it('prefers bootstrap secret files over environment values', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-config-'))
    directories.push(dataDir)
    const file = path.join(dataDir, 'bootstrap')
    await fs.writeFile(file, 'file-code\n')
    const config = await readAuthRuntimeConfig({ dataDir, env: { AUTH_BOOTSTRAP_CODE: 'env-code', AUTH_BOOTSTRAP_CODE_FILE: file }, log() {} })
    expect(config.bootstrapCode).toBe('file-code')
    expect(config.bootstrapSource).toBe('file')
  })

  it('generates a bootstrap code when none is configured', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-config-'))
    directories.push(dataDir)
    const messages = []
    const config = await readAuthRuntimeConfig({ dataDir, env: {}, log: (message) => messages.push(message) })
    expect(config.bootstrapCode.length).toBeGreaterThan(12)
    expect(messages[0]).toContain(config.bootstrapCode)
  })

  it('does not fall back to environment secrets when an explicit file is missing', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-config-'))
    directories.push(dataDir)
    const bootstrapFile = path.join(dataDir, 'missing-bootstrap')
    const oidcFile = path.join(dataDir, 'missing-oidc')
    const messages = []
    const config = await readAuthRuntimeConfig({
      dataDir,
      env: {
        AUTH_BOOTSTRAP_CODE: 'must-not-be-used',
        AUTH_BOOTSTRAP_CODE_FILE: bootstrapFile,
        OIDC_CLIENT_SECRET: 'must-not-be-used',
        OIDC_CLIENT_SECRET_FILE: oidcFile,
      },
      log: (message) => messages.push(message),
    })
    expect(config.bootstrapCode).not.toBe('must-not-be-used')
    expect(config.bootstrapSource).toBe('generated')
    expect(config.oidcClientSecret).toBeNull()
    expect(messages[0]).toContain(config.bootstrapCode)
  })

  it('prefers an OIDC secret file over an environment value', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-config-'))
    directories.push(dataDir)
    const oidcFile = path.join(dataDir, 'oidc-secret')
    await fs.writeFile(oidcFile, 'file-secret\n')
    const config = await readAuthRuntimeConfig({
      dataDir,
      env: { OIDC_CLIENT_SECRET: 'environment-secret', OIDC_CLIENT_SECRET_FILE: oidcFile },
      log() {},
    })
    expect(config.oidcClientSecret).toBe('file-secret')
    expect(config.oidcSecretLocked).toBe(true)
  })
})
