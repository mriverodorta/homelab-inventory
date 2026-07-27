import { canonicalJson } from './canonicalize'
import type {
  CatalogVerificationKey,
  SignedCatalogArtifact,
} from './types'

const encoder = new TextEncoder()

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('Signature material must be canonical base64.')
  }
  if (typeof globalThis.atob === 'function') {
    return Uint8Array.from(globalThis.atob(value), (character) => character.charCodeAt(0))
  }
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

function assertTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be an ISO timestamp.`)
  return timestamp
}

export async function verifySignedCatalogArtifact<T>(
  artifact: SignedCatalogArtifact<T>,
  keys: CatalogVerificationKey[],
  options: { now?: Date } = {},
): Promise<T> {
  if (!artifact || typeof artifact !== 'object' || !artifact.signature) {
    throw new Error('Catalog artifact is not signed.')
  }
  if (artifact.signature.algorithm !== 'Ed25519') {
    throw new Error('Catalog artifact signature algorithm is unsupported.')
  }

  const key = keys.find((candidate) => candidate.keyId === artifact.signature.keyId)
  if (!key) throw new Error(`Catalog signing key ${artifact.signature.keyId} is not trusted.`)

  const now = (options.now ?? new Date()).getTime()
  if (key.notBefore && now < assertTimestamp(key.notBefore, 'Signing key notBefore')) {
    throw new Error('Catalog signing key is not active yet.')
  }
  if (key.notAfter && now > assertTimestamp(key.notAfter, 'Signing key notAfter')) {
    throw new Error('Catalog signing key has expired.')
  }

  const publicKey = decodeBase64(key.publicKey)
  if (publicKey.byteLength !== 32) throw new Error('Catalog Ed25519 public key must be 32 bytes.')
  const signature = decodeBase64(artifact.signature.value)
  if (signature.byteLength !== 64) throw new Error('Catalog Ed25519 signature must be 64 bytes.')

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    Uint8Array.from(publicKey) as unknown as BufferSource,
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
  const verified = await globalThis.crypto.subtle.verify(
    { name: 'Ed25519' },
    cryptoKey,
    Uint8Array.from(signature) as unknown as BufferSource,
    encoder.encode(canonicalJson(artifact.payload)),
  )
  if (!verified) throw new Error('Catalog artifact signature is invalid.')
  return artifact.payload
}
