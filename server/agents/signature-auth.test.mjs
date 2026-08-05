import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AGENT_SIGNATURE_HEADERS,
  AgentAuthenticationError,
  canonicalAgentRequest,
  parseEd25519PublicKey,
  sha256Hex,
  verifyAgentRequest,
} from './signature-auth.mjs'

function keyPair(type = 'ed25519') {
  const pair = type === 'rsa'
    ? generateKeyPairSync('rsa', { modulusLength: 2048 })
    : generateKeyPairSync('ed25519')
  return {
    ...pair,
    publicKeyBase64: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

function signedRequest({
  pair = keyPair(),
  body = Buffer.from('{"ok":true}'),
  path = '/api/agent/hosts/server/1/heartbeats',
  timestamp = '2026-08-05T20:00:00.000Z',
  sequence = 1,
  deviceId = 7,
} = {}) {
  const bodyDigest = sha256Hex(body)
  const canonical = canonicalAgentRequest({ method: 'POST', path, timestamp, sequence, bodyDigest })
  const signature = sign(null, canonical, pair.privateKey).toString('base64')
  const headers = new Map([
    [AGENT_SIGNATURE_HEADERS.deviceId, String(deviceId)],
    [AGENT_SIGNATURE_HEADERS.timestamp, timestamp],
    [AGENT_SIGNATURE_HEADERS.sequence, String(sequence)],
    [AGENT_SIGNATURE_HEADERS.bodyDigest, bodyDigest],
    [AGENT_SIGNATURE_HEADERS.signature, signature],
  ])
  return {
    pair,
    body,
    request: {
      method: 'POST',
      originalUrl: path,
      get: (name) => headers.get(name),
    },
  }
}

function verifyFixture(fixture, overrides = {}) {
  return verifyAgentRequest(
    fixture.request,
    {
      id: 7,
      publicKey: fixture.pair.publicKeyBase64,
      lastSequence: 0,
      ...overrides,
    },
    fixture.body,
    { now: Date.parse('2026-08-05T20:01:00.000Z') },
  )
}

describe('signed agent authentication', () => {
  it('verifies exact request bytes and returns state for a later atomic sequence update', () => {
    const fixture = signedRequest()
    expect(verifyFixture(fixture)).toEqual({
      deviceId: 7,
      sequence: 1,
      timestamp: '2026-08-05T20:00:00.000Z',
      bodyDigest: sha256Hex(fixture.body),
    })
  })

  it('rejects body, path, identity, replay, and clock changes', () => {
    const fixture = signedRequest()
    expect(() => verifyAgentRequest(
      fixture.request,
      { id: 7, publicKey: fixture.pair.publicKeyBase64, lastSequence: 0 },
      Buffer.from('{"ok":false}'),
      { now: Date.parse('2026-08-05T20:01:00.000Z') },
    )).toThrow('digest does not match')

    fixture.request.originalUrl = '/api/agent/hosts/server/2/heartbeats'
    expect(() => verifyFixture(fixture)).toThrow('signature is invalid')
    fixture.request.originalUrl = '/api/agent/hosts/server/1/heartbeats'

    expect(() => verifyFixture(fixture, { id: 8 })).toThrow('identity does not match')
    expect(() => verifyFixture(fixture, { lastSequence: 1 })).toThrow('already been used')
    expect(() => verifyAgentRequest(
      fixture.request,
      { id: 7, publicKey: fixture.pair.publicKeyBase64, lastSequence: 0 },
      fixture.body,
      { now: Date.parse('2026-08-05T20:10:00.000Z') },
    )).toThrow('clock window')
  })

  it('rejects malformed keys, noncanonical signatures, and non-Ed25519 keys', () => {
    expect(() => parseEd25519PublicKey('not-base64')).toThrow(AgentAuthenticationError)
    const rsa = keyPair('rsa')
    expect(() => parseEd25519PublicKey(rsa.publicKeyBase64)).toThrow('must be Ed25519')

    const fixture = signedRequest()
    fixture.request.get = (name) => name === AGENT_SIGNATURE_HEADERS.signature
      ? '!!!!'
      : signedRequest({ pair: fixture.pair }).request.get(name)
    expect(() => verifyFixture(fixture)).toThrow('canonical Base64')
  })

  it('does not mutate the device when verification fails', () => {
    const fixture = signedRequest()
    const device = { id: 7, publicKey: fixture.pair.publicKeyBase64, lastSequence: 1 }
    expect(() => verifyAgentRequest(
      fixture.request,
      device,
      fixture.body,
      { now: Date.parse('2026-08-05T20:01:00.000Z') },
    )).toThrow('already been used')
    expect(device.lastSequence).toBe(1)
  })
})
