import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function hashOpaqueToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function createOpaqueToken(bytes = 32) {
  const token = randomBytes(bytes).toString('base64url')
  return { token, hash: hashOpaqueToken(token) }
}

export function tokenHashMatches(token, expectedHash) {
  const actual = Buffer.from(hashOpaqueToken(token), 'hex')
  const expected = Buffer.from(String(expectedHash ?? ''), 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
