import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

async function readOptionalFile(filePath) {
  if (!filePath) return null
  try {
    return (await fs.readFile(filePath, 'utf8')).trim() || null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function writePrivateSecret(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await fs.writeFile(filePath, `${String(value).trim()}\n`, { mode: 0o600 })
  await fs.chmod(filePath, 0o600)
}

export async function removePrivateSecret(filePath) {
  await fs.rm(filePath, { force: true })
}

export async function readAuthRuntimeConfig({ dataDir, env = process.env, log = console.log } = {}) {
  const authDir = path.join(dataDir, 'auth')
  const bootstrapFile = env.AUTH_BOOTSTRAP_CODE_FILE?.trim() || null
  const configuredBootstrapCode = bootstrapFile
    ? await readOptionalFile(bootstrapFile)
    : env.AUTH_BOOTSTRAP_CODE?.trim() || null
  const generatedBootstrapCode = configuredBootstrapCode || randomBytes(12).toString('base64url')
  if (!configuredBootstrapCode) {
    log(`[auth] First-run bootstrap code: ${generatedBootstrapCode}`)
  }

  const oidcClientSecretFile = env.OIDC_CLIENT_SECRET_FILE?.trim() || path.join(authDir, 'oidc-client-secret')
  const fileOidcClientSecret = await readOptionalFile(oidcClientSecretFile)
  const oidcClientSecret = fileOidcClientSecret || (
    env.OIDC_CLIENT_SECRET_FILE?.trim() ? null : env.OIDC_CLIENT_SECRET?.trim() || null
  )
  const externalUrl = env.AUTH_EXTERNAL_URL?.trim() || null

  return {
    bootstrapCode: generatedBootstrapCode,
    bootstrapSource: configuredBootstrapCode
      ? (bootstrapFile ? 'file' : 'environment')
      : 'generated',
    externalUrl,
    oidcClientSecret,
    oidcClientSecretFile,
    oidcSecretLocked: Boolean(env.OIDC_CLIENT_SECRET_FILE?.trim() || env.OIDC_CLIENT_SECRET?.trim()),
  }
}
