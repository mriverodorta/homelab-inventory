import { createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export const SCRYPT_PARAMETERS = Object.freeze({ N: 1 << 15, r: 8, p: 1 })

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function createEncryptionSalt() {
  return randomBytes(16)
}

export async function deriveArchiveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) {
    throw new Error('Backup passphrase must contain between 12 and 1024 characters.')
  }
  if (!Buffer.isBuffer(salt) || salt.length !== 16) throw new Error('Backup encryption salt is invalid.')
  return scrypt(passphrase, salt, 32, { ...SCRYPT_PARAMETERS, maxmem: 64 * 1024 * 1024 })
}

export function assertSafeArchivePath(name) {
  if (
    typeof name !== 'string'
    || name.length === 0
    || name.length > 240
    || name.includes('\\')
    || name.startsWith('/')
    || name.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('Backup archive contains an unsafe path.')
  }
}
