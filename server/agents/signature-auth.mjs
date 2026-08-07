import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto'

export const AGENT_SIGNATURE_HEADERS = Object.freeze({
  deviceId: 'x-homelab-agent-id',
  timestamp: 'x-homelab-agent-timestamp',
  sequence: 'x-homelab-agent-sequence',
  bodyDigest: 'x-homelab-agent-content-sha256',
  signature: 'x-homelab-agent-signature',
})

export const DEFAULT_SIGNATURE_CLOCK_SKEW_MS = 5 * 60_000

function requireHeader(request, name) {
  const value = request.get?.(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentAuthenticationError(`Missing ${name} header.`, 'missing-agent-signature', 401)
  }
  return value.trim()
}

function parsePositiveInteger(value, field) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new AgentAuthenticationError(`${field} must be a positive integer.`, 'invalid-agent-signature', 401)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new AgentAuthenticationError(`${field} exceeds the safe integer range.`, 'invalid-agent-signature', 401)
  }
  return parsed
}

function decodeCanonicalBase64(value, field) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AgentAuthenticationError(`${field} must use canonical Base64.`, 'invalid-agent-signature', 401)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new AgentAuthenticationError(`${field} must use canonical Base64.`, 'invalid-agent-signature', 401)
  }
  return decoded
}

export class AgentAuthenticationError extends Error {
  constructor(message, code = 'invalid-agent-signature', status = 401) {
    super(message)
    this.name = 'AgentAuthenticationError'
    this.code = code
    this.status = status
  }
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalAgentRequest({ method, path, timestamp, sequence, bodyDigest }) {
  const normalizedMethod = String(method ?? '').toUpperCase()
  const normalizedPath = String(path ?? '')
  const normalizedTimestamp = String(timestamp ?? '')
  const normalizedSequence = String(sequence ?? '')
  const normalizedDigest = String(bodyDigest ?? '').toLowerCase()

  if (!/^[A-Z]+$/.test(normalizedMethod)) throw new Error('Agent request method is invalid.')
  if (!normalizedPath.startsWith('/') || normalizedPath.includes('\n')) throw new Error('Agent request path is invalid.')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(normalizedTimestamp)) {
    throw new Error('Agent request timestamp is invalid.')
  }
  if (!/^[1-9]\d*$/.test(normalizedSequence)) throw new Error('Agent request sequence is invalid.')
  if (!/^[a-f0-9]{64}$/.test(normalizedDigest)) throw new Error('Agent request body digest is invalid.')

  return Buffer.from([
    'homelab-inventory-agent-v1',
    normalizedMethod,
    normalizedPath,
    normalizedTimestamp,
    normalizedSequence,
    normalizedDigest,
  ].join('\n'), 'utf8')
}

export function parseEd25519PublicKey(value) {
  let key
  try {
    const der = decodeCanonicalBase64(value, 'Agent public key')
    key = createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    throw new AgentAuthenticationError('Agent public key is invalid.', 'invalid-agent-public-key', 400)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new AgentAuthenticationError('Agent public key must be Ed25519.', 'invalid-agent-public-key', 400)
  }
  return key
}

export function verifyAgentRequest(request, device, rawBody, {
  now = Date.now(),
  clockSkewMs = DEFAULT_SIGNATURE_CLOCK_SKEW_MS,
} = {}) {
  if (!device || typeof device !== 'object' || typeof device.publicKey !== 'string') {
    throw new AgentAuthenticationError('Agent identity is unavailable.', 'unknown-agent-identity', 401)
  }
  if (!Buffer.isBuffer(rawBody)) {
    throw new AgentAuthenticationError('Signed request body is unavailable.', 'invalid-agent-signature', 400)
  }

  const deviceId = parsePositiveInteger(requireHeader(request, AGENT_SIGNATURE_HEADERS.deviceId), 'Agent id')
  if (deviceId !== device.id) {
    throw new AgentAuthenticationError('Agent identity does not match the request.', 'unknown-agent-identity', 401)
  }
  const timestamp = requireHeader(request, AGENT_SIGNATURE_HEADERS.timestamp)
  const timestampMs = Date.parse(timestamp)
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > clockSkewMs) {
    throw new AgentAuthenticationError('Agent request timestamp is outside the allowed clock window.', 'stale-agent-request', 401)
  }
  const sequenceText = requireHeader(request, AGENT_SIGNATURE_HEADERS.sequence)
  const sequence = parsePositiveInteger(sequenceText, 'Agent sequence')
  if (sequence <= (device.lastSequence ?? 0)) {
    throw new AgentAuthenticationError('Agent request sequence has already been used.', 'replayed-agent-request', 409)
  }
  const suppliedDigest = requireHeader(request, AGENT_SIGNATURE_HEADERS.bodyDigest).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(suppliedDigest)) {
    throw new AgentAuthenticationError('Agent content digest is invalid.', 'invalid-agent-signature', 401)
  }
  const actualDigest = sha256Hex(rawBody)
  if (!timingSafeEqual(Buffer.from(actualDigest, 'hex'), Buffer.from(suppliedDigest, 'hex'))) {
    throw new AgentAuthenticationError('Agent content digest does not match the request body.', 'invalid-agent-signature', 401)
  }
  const signature = decodeCanonicalBase64(
    requireHeader(request, AGENT_SIGNATURE_HEADERS.signature),
    'Agent signature',
  )
  if (signature.length !== 64) {
    throw new AgentAuthenticationError('Agent signature is invalid.', 'invalid-agent-signature', 401)
  }

  const url = new URL(request.originalUrl ?? request.url ?? '/', 'http://agent.local')
  let canonical
  try {
    canonical = canonicalAgentRequest({
      method: request.method,
      path: url.pathname,
      timestamp,
      sequence: sequenceText,
      bodyDigest: suppliedDigest,
    })
  } catch {
    throw new AgentAuthenticationError('Agent signed request metadata is invalid.', 'invalid-agent-signature', 401)
  }
  const publicKey = parseEd25519PublicKey(device.publicKey)
  if (!verify(null, canonical, publicKey, signature)) {
    throw new AgentAuthenticationError('Agent request signature is invalid.', 'invalid-agent-signature', 401)
  }

  return { deviceId, sequence, timestamp, bodyDigest: suppliedDigest }
}
