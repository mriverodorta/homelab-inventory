import { COMMON_PASSWORDS } from './common-passwords.mjs'

export function normalizePassword(password) {
  return String(password ?? '').normalize('NFKC')
}

export function assertPasswordPolicy(password) {
  const normalized = normalizePassword(password)
  if (normalized.length < 12) throw new Error('Password must contain at least 12 characters.')
  if (normalized.length > 512) throw new Error('Password must contain no more than 512 characters.')
  if (COMMON_PASSWORDS.has(normalized.toLowerCase())) throw new Error('Choose a password that is not commonly used.')
  return normalized
}

export async function hashPassword(password) {
  return Bun.password.hash(assertPasswordPolicy(password), { algorithm: 'argon2id' })
}

export async function verifyPassword(password, passwordHash) {
  if (typeof passwordHash !== 'string' || passwordHash.length === 0) return false
  return Bun.password.verify(normalizePassword(password), passwordHash)
}

export function normalizeUsername(value) {
  const username = String(value ?? '').normalize('NFKC').trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error('Username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens.')
  }
  return username
}
