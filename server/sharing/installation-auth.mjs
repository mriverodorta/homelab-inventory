import { createHash, randomBytes, sign } from 'node:crypto'

export const SHARING_TOKEN_SCOPES = Object.freeze([
  'publication:write',
  'events:read',
  'shares:manage',
  'analytics:read',
  'token:renew',
  'key:rotate',
  'claim:create',
])

export const LEGACY_SHARING_TOKEN_SCOPES = Object.freeze([
  'publication:write',
  'token:renew',
  'key:rotate',
  'claim:create',
])

export function sharingPublicKeyId(publicKeySpki) {
  const bytes = Buffer.from(publicKeySpki, 'base64')
  if (!bytes.length) throw new Error('Sharing public key is invalid.')
  return createHash('sha256').update(bytes).digest('hex')
}

export function activationSignature(challenge, clientInstanceId, privateKey) {
  return sign(null, Buffer.from(`${challenge}\n${clientInstanceId}`), privateKey).toString('base64')
}

export function signedRequestHeaders({ token, body, scope, privateKey, now = new Date(), nonce = randomBytes(24).toString('base64url') }) {
  if (!SHARING_TOKEN_SCOPES.includes(scope)) throw new Error('Sharing request scope is invalid.')
  const timestamp = now.toISOString()
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const payload = Buffer.from(`${timestamp}\n${nonce}\n${bodyHash}\n${scope}`)
  return {
    authorization: `Bearer ${token}`,
    'x-labgd-timestamp': timestamp,
    'x-labgd-nonce': nonce,
    'x-labgd-signature': sign(null, payload, privateKey).toString('base64'),
  }
}

export function sharingIdentityHash(clientInstanceId, publicKeySpki) {
  return createHash('sha256').update(`${clientInstanceId}\n${publicKeySpki}`).digest('hex')
}
