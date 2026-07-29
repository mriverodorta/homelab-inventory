const OFFICIAL_REGISTRY_2026_01 = Object.freeze({
  keyId: 'registry-2026-01',
  publicKey: 'ocdzcp6kCKf6pwl+Nm0gMagLlLeTwo+F8113kqX/ruI=',
  notBefore: '2026-07-26T22:15:46Z',
})

export const OFFICIAL_CATALOG_KEYS = Object.freeze([OFFICIAL_REGISTRY_2026_01])

function normalizedKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Trusted catalog keys must be objects.')
  }
  const keyId = typeof value.keyId === 'string' ? value.keyId.trim() : ''
  const publicKey = typeof value.publicKey === 'string' ? value.publicKey.trim() : ''
  if (!keyId || !publicKey) throw new Error('Trusted catalog keys require keyId and publicKey.')

  return {
    keyId,
    publicKey,
    ...(typeof value.notBefore === 'string' && value.notBefore.trim()
      ? { notBefore: value.notBefore.trim() }
      : {}),
    ...(typeof value.notAfter === 'string' && value.notAfter.trim()
      ? { notAfter: value.notAfter.trim() }
      : {}),
  }
}

function sameKey(left, right) {
  return left.keyId === right.keyId
    && left.publicKey === right.publicKey
}

export function trustedCatalogKeys(value = process.env.REGISTRY_TRUSTED_KEYS_JSON) {
  const configured = value ? JSON.parse(value) : []
  if (!Array.isArray(configured)) throw new Error('REGISTRY_TRUSTED_KEYS_JSON must be an array.')

  const keys = OFFICIAL_CATALOG_KEYS.map((key) => ({ ...key }))
  const byId = new Map(keys.map((key) => [key.keyId, key]))
  for (const candidate of configured.map(normalizedKey)) {
    const current = byId.get(candidate.keyId)
    if (current) {
      if (!sameKey(current, candidate)) {
        throw new Error(`Catalog signing key ${candidate.keyId} conflicts with an existing trusted key.`)
      }
      continue
    }
    keys.push(candidate)
    byId.set(candidate.keyId, candidate)
  }
  return keys
}
