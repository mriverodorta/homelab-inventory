import { decode, encode } from '@msgpack/msgpack'

export const ENGINE_PROTOCOL_VERSION = 1
export const EMPTY_ENGINE_TOPOLOGY = Object.freeze({
  items: Object.freeze([]),
  assignments: Object.freeze([]),
  connections: Object.freeze([]),
  placements: Object.freeze([]),
})

function asBytes(value) {
  if (value instanceof Uint8Array) return value
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError('Engine protocol payload must be an ArrayBuffer or Uint8Array.')
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value
}

function assertProtocolVersion(value, label) {
  if (value.protocol_version !== ENGINE_PROTOCOL_VERSION) {
    throw new Error(`${label} uses unsupported protocol version ${String(value.protocol_version)}.`)
  }
}

function encodeValue(value, label) {
  asObject(value, label)
  return Uint8Array.from(encode(value))
}

function decodeValue(bytes, label) {
  return asObject(decode(asBytes(bytes)), label)
}

function assertTopologySnapshot(topology) {
  const value = asObject(topology, 'Engine snapshot topology')
  for (const field of ['items', 'assignments', 'connections', 'placements']) {
    if (!Array.isArray(value[field])) {
      throw new TypeError(`Engine snapshot topology.${field} must be an array.`)
    }
  }
}

export function encodeEngineSnapshot(snapshot) {
  const value = asObject(snapshot, 'Engine snapshot')
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError('Engine snapshot revision must be a positive safe integer.')
  }
  if (typeof value.project_name !== 'string' || value.project_name.trim() === '') {
    throw new TypeError('Engine snapshot project_name must not be empty.')
  }
  assertTopologySnapshot(value.topology)
  return encodeValue(value, 'Engine snapshot')
}

export function decodeEngineSnapshot(bytes) {
  const value = decodeValue(bytes, 'Engine snapshot')
  encodeEngineSnapshot(value)
  return value
}

export function encodeEngineRequest(request) {
  const value = asObject(request, 'Engine request')
  assertProtocolVersion(value, 'Engine request')
  return encodeValue(value, 'Engine request')
}

export function decodeEngineRequest(bytes) {
  const value = decodeValue(bytes, 'Engine request')
  assertProtocolVersion(value, 'Engine request')
  return value
}

export function encodeEngineResponse(response) {
  const value = asObject(response, 'Engine response')
  assertProtocolVersion(value, 'Engine response')
  return encodeValue(value, 'Engine response')
}

export function decodeEngineResponse(bytes) {
  const value = decodeValue(bytes, 'Engine response')
  assertProtocolVersion(value, 'Engine response')
  return value
}
