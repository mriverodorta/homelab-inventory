import { isRelationalId } from '../db/relational-ids.mjs'
import { parseEd25519PublicKey } from './signature-auth.mjs'

export const AGENT_PROTOCOL_MAJOR = 1
export const AGENT_HOST_TYPES = Object.freeze(['server', 'nas', 'pcBuild'])
export const AGENT_CAPABILITY_STATES = Object.freeze([
  'available',
  'unavailable',
  'permission-blocked',
  'disabled',
])

const HOST_TYPE_SET = new Set(AGENT_HOST_TYPES)
const CAPABILITY_STATE_SET = new Set(AGENT_CAPABILITY_STATES)
const METRIC_ARRAY_LIMITS = Object.freeze({
  filesystems: 256,
  diskIo: 128,
  network: 128,
  sensors: 256,
  batteries: 16,
  gpus: 16,
})
const STORAGE_KINDS = new Set(['smart', 'emmc', 'mdraid'])
const STORAGE_STATES = new Set(['healthy', 'warning', 'failed', 'unknown'])
const SERVICE_CLASSIFICATIONS = new Set(['user-installed', 'system', 'unknown'])
const CONTAINER_NETWORK_MODES = new Set(['host', 'bridge', 'none', 'custom'])
const CONTAINER_PORT_PROTOCOLS = new Set(['tcp', 'udp', 'sctp'])
const MAX_OBJECT_KEYS = 128
const MAX_STRING_LENGTH = 2048
const MAX_DEPTH = 6

function protocolError(message) {
  const error = new Error(message)
  error.code = 'invalid-agent-payload'
  error.status = 400
  return error
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw protocolError(`${field} must be an object.`)
  }
  return value
}

function assertAllowedFields(record, allowed, field) {
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown) throw protocolError(`${field} contains unsupported field ${unknown}.`)
}

function string(value, field, { max = MAX_STRING_LENGTH, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw protocolError(`${field} must be a non-empty string of at most ${max} characters.`)
  }
  return value.trim()
}

function timestamp(value, field) {
  const normalized = string(value, field, { max: 32 })
  if (!Number.isFinite(Date.parse(normalized))) throw protocolError(`${field} must be an ISO timestamp.`)
  return new Date(normalized).toISOString()
}

function positiveInteger(value, field) {
  if (!isRelationalId(value)) throw protocolError(`${field} must be a positive safe integer.`)
  return value
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw protocolError(`${field} must be a non-negative safe integer.`)
  return value
}

function boundedValue(value, field, depth = 0, maxDepth = MAX_DEPTH) {
  if (depth > maxDepth) throw protocolError(`${field} is nested too deeply.`)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw protocolError(`${field} must contain only finite numbers.`)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw protocolError(`${field} contains an oversized string.`)
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 1024) throw protocolError(`${field} contains an oversized array.`)
    return value.map((entry, index) => boundedValue(entry, `${field}[${index}]`, depth + 1, maxDepth))
  }
  const record = object(value, field)
  const entries = Object.entries(record)
  if (entries.length > MAX_OBJECT_KEYS) throw protocolError(`${field} contains too many fields.`)
  return Object.fromEntries(entries.map(([key, entry]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw protocolError(`${field} contains an unsafe field.`)
    return [key, boundedValue(entry, `${field}.${key}`, depth + 1, maxDepth)]
  }))
}

function normalizeCapabilities(value) {
  const capabilities = object(value, 'capabilities')
  if (Object.keys(capabilities).length > 64) throw protocolError('capabilities contains too many fields.')
  return Object.fromEntries(Object.entries(capabilities).map(([name, input]) => {
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(name)) throw protocolError(`Capability name ${name} is invalid.`)
    const capability = object(input, `capabilities.${name}`)
    assertAllowedFields(capability, new Set(['state', 'detail']), `capabilities.${name}`)
    if (!CAPABILITY_STATE_SET.has(capability.state)) throw protocolError(`capabilities.${name}.state is invalid.`)
    return [name, {
      state: capability.state,
      ...(capability.detail ? { detail: string(capability.detail, `capabilities.${name}.detail`, { max: 256 }) } : {}),
    }]
  }))
}

function normalizeHost(value, expectedHost) {
  const host = object(value, 'host')
  if (!HOST_TYPE_SET.has(host.type) || !isRelationalId(host.id)) {
    throw protocolError('host must reference a supported compute-host type and positive numeric id.')
  }
  if (expectedHost && (host.type !== expectedHost.hostType || host.id !== expectedHost.hostId)) {
    throw protocolError('Agent payload host does not match the authenticated endpoint.')
  }
  return { type: host.type, id: host.id }
}

function normalizeMetrics(value) {
  const metrics = boundedValue(object(value, 'metrics'), 'metrics')
  const allowed = new Set([
    'uptimeSeconds', 'loadAverage', 'system', 'cpu', 'memory', 'filesystems', 'diskIo',
    'network', 'sensors', 'batteries', 'gpus',
  ])
  const unknown = Object.keys(metrics).find((field) => !allowed.has(field))
  if (unknown) throw protocolError(`metrics contains unsupported field ${unknown}.`)
  for (const [field, limit] of Object.entries(METRIC_ARRAY_LIMITS)) {
    if (metrics[field] !== undefined && (!Array.isArray(metrics[field]) || metrics[field].length > limit)) {
      throw protocolError(`metrics.${field} cannot exceed ${limit} items.`)
    }
  }
  if (metrics.loadAverage !== undefined && (!Array.isArray(metrics.loadAverage) || metrics.loadAverage.length !== 3)) {
    throw protocolError('metrics.loadAverage must contain exactly three values.')
  }
  return metrics
}

function normalizeServices(value = []) {
  if (!Array.isArray(value) || value.length > 512) throw protocolError('services cannot exceed 512 items.')
  return value.map((input, index) => {
    const service = boundedValue(object(input, `services[${index}]`), `services[${index}]`)
    const allowed = new Set([
      'name', 'description', 'activeState', 'classification', 'subState', 'enabled', 'memoryCurrentBytes',
      'memoryPeakBytes', 'cpuPercent', 'restartCount', 'taskCount', 'taskLimit',
      'lastResult', 'activeEnteredAt', 'inactiveEnteredAt',
    ])
    const unknown = Object.keys(service).find((field) => !allowed.has(field))
    if (unknown) throw protocolError(`services[${index}] contains unsupported field ${unknown}.`)
    if (service.classification !== undefined && !SERVICE_CLASSIFICATIONS.has(service.classification)) {
      throw protocolError(`services[${index}].classification is invalid.`)
    }
    return {
      ...service,
      name: string(service.name, `services[${index}].name`, { max: 256 }),
      activeState: string(service.activeState, `services[${index}].activeState`, { max: 64 }),
    }
  })
}

function normalizeContainers(value = []) {
  if (!Array.isArray(value) || value.length > 256) throw protocolError('containers cannot exceed 256 items.')
  const allowed = new Set([
    'runtime', 'runtimeId', 'name', 'image', 'imageDigest', 'state', 'status', 'uptime', 'health',
    'composeService', 'networkMode', 'networkNames', 'ports', 'publishedPorts',
    'cpuPercent', 'memoryBytes', 'networkRxBytesPerSecond', 'networkTxBytesPerSecond',
    'diskReadBytesPerSecond', 'diskWriteBytesPerSecond',
  ])
  return value.map((input, index) => {
    const container = object(input, `containers[${index}]`)
    const forbidden = Object.keys(container).filter((key) => !allowed.has(key))
    if (forbidden.length > 0) throw protocolError(`containers[${index}] contains forbidden field ${forbidden[0]}.`)
    const normalized = boundedValue(container, `containers[${index}]`)
    if (!['docker', 'podman'].includes(normalized.runtime)) {
      throw protocolError(`containers[${index}].runtime is invalid.`)
    }
    if (normalized.networkMode !== undefined && !CONTAINER_NETWORK_MODES.has(normalized.networkMode)) {
      throw protocolError(`containers[${index}].networkMode is invalid.`)
    }
    if (normalized.networkNames !== undefined && (!Array.isArray(normalized.networkNames) || normalized.networkNames.length > 32)) {
      throw protocolError(`containers[${index}].networkNames cannot exceed 32 items.`)
    }
    const networkNames = normalized.networkNames?.map((name, nameIndex) => string(name, `containers[${index}].networkNames[${nameIndex}]`, { max: 128 }))
    if (normalized.ports !== undefined && (!Array.isArray(normalized.ports) || normalized.ports.length > 128)) {
      throw protocolError(`containers[${index}].ports cannot exceed 128 items.`)
    }
    const ports = normalized.ports?.map((inputPort, portIndex) => {
      const port = object(inputPort, `containers[${index}].ports[${portIndex}]`)
      assertAllowedFields(port, new Set(['hostPort', 'containerPort', 'protocol']), `containers[${index}].ports[${portIndex}]`)
      if (!Number.isSafeInteger(port.hostPort) || port.hostPort < 1 || port.hostPort > 65535 ||
        !Number.isSafeInteger(port.containerPort) || port.containerPort < 1 || port.containerPort > 65535 ||
        !CONTAINER_PORT_PROTOCOLS.has(port.protocol)) {
        throw protocolError(`containers[${index}].ports[${portIndex}] is invalid.`)
      }
      return { hostPort: port.hostPort, containerPort: port.containerPort, protocol: port.protocol }
    })
    return {
      ...normalized,
      runtime: string(normalized.runtime, `containers[${index}].runtime`, { max: 16 }),
      runtimeId: string(normalized.runtimeId, `containers[${index}].runtimeId`, { max: 128 }),
      name: string(normalized.name, `containers[${index}].name`, { max: 256 }),
      image: string(normalized.image, `containers[${index}].image`, { max: 512 }),
      state: string(normalized.state, `containers[${index}].state`, { max: 64 }),
      ...(normalized.status !== undefined ? { status: string(normalized.status, `containers[${index}].status`, { max: 256 }) } : {}),
      ...(normalized.uptime !== undefined ? { uptime: string(normalized.uptime, `containers[${index}].uptime`, { max: 128 }) } : {}),
      ...(normalized.composeService !== undefined ? { composeService: string(normalized.composeService, `containers[${index}].composeService`, { max: 256 }) } : {}),
      ...(networkNames ? { networkNames } : {}),
      ...(ports ? { ports } : {}),
    }
  })
}

function normalizeStorageHealth(value = []) {
  if (!Array.isArray(value) || value.length > 64) throw protocolError('storageHealth cannot exceed 64 items.')
  return value.map((input, index) => {
    const record = boundedValue(object(input, `storageHealth[${index}]`), `storageHealth[${index}]`)
    assertAllowedFields(record, new Set(['deviceId', 'kind', 'state', 'collectedAt', 'metrics']), `storageHealth[${index}]`)
    if (!STORAGE_KINDS.has(record.kind) || !STORAGE_STATES.has(record.state)) {
      throw protocolError(`storageHealth[${index}] kind or state is invalid.`)
    }
    return {
      ...record,
      deviceId: string(record.deviceId, `storageHealth[${index}].deviceId`, { max: 128 }),
      collectedAt: timestamp(record.collectedAt, `storageHealth[${index}].collectedAt`),
    }
  })
}

export function normalizeV1Activation(payload) {
  const input = object(payload, 'activation')
  assertAllowedFields(input, new Set(['protocolMajor', 'agentVersion', 'publicKey', 'capabilities']), 'activation')
  if (input.protocolMajor !== AGENT_PROTOCOL_MAJOR) {
    throw protocolError(`Unsupported agent protocol major ${String(input.protocolMajor)}.`)
  }
  const publicKey = string(input.publicKey, 'publicKey', { max: 128 })
  parseEd25519PublicKey(publicKey)
  return {
    protocolMajor: AGENT_PROTOCOL_MAJOR,
    agentVersion: string(input.agentVersion, 'agentVersion', { max: 64 }),
    publicKey,
    capabilities: normalizeCapabilities(input.capabilities),
  }
}

export function normalizeV1Heartbeat(payload, expectedHost) {
  const input = object(payload, 'heartbeat')
  assertAllowedFields(input, new Set([
    'protocolMajor', 'sequence', 'agentVersion', 'collectedAt', 'host', 'hostname',
    'droppedSamples', 'capabilities', 'metrics', 'services', 'containers', 'storageHealth',
  ]), 'heartbeat')
  if (input.protocolMajor !== AGENT_PROTOCOL_MAJOR) {
    throw protocolError(`Unsupported agent protocol major ${String(input.protocolMajor)}.`)
  }
  return {
    protocolMajor: AGENT_PROTOCOL_MAJOR,
    sequence: positiveInteger(input.sequence, 'sequence'),
    agentVersion: string(input.agentVersion, 'agentVersion', { max: 64 }),
    collectedAt: timestamp(input.collectedAt, 'collectedAt'),
    host: normalizeHost(input.host, expectedHost),
    ...(input.hostname ? { hostname: string(input.hostname, 'hostname', { max: 255 }) } : {}),
    droppedSamples: input.droppedSamples === undefined
      ? 0
      : nonNegativeInteger(input.droppedSamples, 'droppedSamples'),
    capabilities: normalizeCapabilities(input.capabilities),
    metrics: normalizeMetrics(input.metrics),
    services: normalizeServices(input.services),
    containers: normalizeContainers(input.containers),
    storageHealth: normalizeStorageHealth(input.storageHealth),
  }
}

export function normalizeV1HardwareSnapshot(payload, expectedHost) {
  const input = object(payload, 'hardwareSnapshot')
  assertAllowedFields(input, new Set(['protocolMajor', 'host', 'collectedAt', 'components']), 'hardwareSnapshot')
  if (input.protocolMajor !== AGENT_PROTOCOL_MAJOR) {
    throw protocolError(`Unsupported agent protocol major ${String(input.protocolMajor)}.`)
  }
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.length > 1024) {
    throw protocolError('hardwareSnapshot.components must contain 1 to 1024 entries.')
  }
  return {
    protocolMajor: AGENT_PROTOCOL_MAJOR,
    host: normalizeHost(input.host, expectedHost),
    collectedAt: timestamp(input.collectedAt, 'hardwareSnapshot.collectedAt'),
    components: input.components.map((candidate, index) => {
      const component = object(candidate, `hardwareSnapshot.components[${index}]`)
      assertAllowedFields(component, new Set(['kind', 'locator', 'values']), `hardwareSnapshot.components[${index}]`)
      const kind = string(component.kind, `hardwareSnapshot.components[${index}].kind`, { max: 64 })
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(kind)) {
        throw protocolError(`hardwareSnapshot.components[${index}].kind is invalid.`)
      }
      const values = boundedValue(object(component.values, `hardwareSnapshot.components[${index}].values`), `hardwareSnapshot.components[${index}].values`, 0, 12)
      if (Object.keys(values).length === 0) throw protocolError(`hardwareSnapshot.components[${index}].values cannot be empty.`)
      return {
        kind,
        locator: string(component.locator, `hardwareSnapshot.components[${index}].locator`, { max: 256 }),
        values,
      }
    }),
  }
}
