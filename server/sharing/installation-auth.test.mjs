import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { activationSignature, sharingIdentityHash, sharingPublicKeyId, signedRequestHeaders } from './installation-auth.mjs'

describe('sharing installation request authentication', () => {
  it('creates deterministic identity hashes and verifiable signatures', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    expect(sharingPublicKeyId(publicKeySpki)).toBe(createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex'))
    expect(sharingIdentityHash('11111111-2222-4333-8444-555555555555', publicKeySpki)).toHaveLength(64)
    expect(verify(null, Buffer.from('challenge\n11111111-2222-4333-8444-555555555555'), publicKey, Buffer.from(activationSignature('challenge', '11111111-2222-4333-8444-555555555555', privateKey), 'base64'))).toBe(true)
  })

  it('signs the exact timestamp, nonce, body hash, and scope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const body = new TextEncoder().encode('{"ok":true}')
    const headers = signedRequestHeaders({
      token: 'token', body, scope: 'publication:write', privateKey,
      now: new Date('2026-08-22T12:00:00.000Z'), nonce: 'nonce_value_123456',
    })
    const bodyHash = createHash('sha256').update(body).digest('hex')
    const payload = Buffer.from(`2026-08-22T12:00:00.000Z\nnonce_value_123456\n${bodyHash}\npublication:write`)
    expect(verify(null, payload, publicKey, Buffer.from(headers['x-labgd-signature'], 'base64'))).toBe(true)
  })
})
