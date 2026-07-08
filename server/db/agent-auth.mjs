import crypto from 'node:crypto'

export function createToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function timingSafeEqualString(first, second) {
  const firstBuffer = Buffer.from(first)
  const secondBuffer = Buffer.from(second)

  if (firstBuffer.length !== secondBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(firstBuffer, secondBuffer)
}

export function createNumericId(existingIds) {
  const usedIds = new Set(existingIds.map((id) => String(id)).filter(Boolean))
  let nextId = 1

  while (usedIds.has(String(nextId))) {
    nextId += 1
  }

  return String(nextId)
}
