import { gunzipSync } from 'node:zlib'
import { createToken, hashToken } from '../db/agent-auth.mjs'
import { isRelationalId } from '../db/relational-ids.mjs'
import { normalizeAgentEndpoint } from '../agent-routes.mjs'
import { AgentContractService } from './contract-service.mjs'
import { buildHardwareSuggestions } from './hardware-suggestions.mjs'
import { buildStorageTelemetry } from './storage-interpretation.mjs'
import { AGENT_HOST_TYPES, normalizeV1Activation, normalizeV1HardwareSnapshot, normalizeV1Heartbeat } from './protocol-v1.mjs'
import { agentStatusTiming } from './status-model.mjs'
import {
  AGENT_SIGNATURE_HEADERS,
  AgentAuthenticationError,
  verifyAgentRequest,
} from './signature-auth.mjs'

const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000
const HEARTBEAT_RATE_WINDOW_MS = 60_000
const HEARTBEAT_RATE_LIMIT = 10
const MAX_DECOMPRESSED_BYTES = 1024 * 1024
const MAX_COMPRESSED_BYTES = 256 * 1024
const HOST_TYPE_SET = new Set(AGENT_HOST_TYPES)
const DISABLED_MESSAGE = 'Agent features are disabled in public demo mode.'

function parseHost(request) {
  const hostType = request.params.hostType
  const rawHostId = request.params.hostId
  if (!HOST_TYPE_SET.has(hostType) || typeof rawHostId !== 'string' || !/^[1-9]\d*$/.test(rawHostId)) return null
  const hostId = Number(rawHostId)
  return isRelationalId(hostId) ? { hostType, hostId } : null
}

function hostKey(host) {
  return `${host.hostType}:${host.hostId}`
}

function telemetryQuery(request) {
  const now = Date.now()
  const from = request.query.from === undefined ? now - (30 * 60 * 1000) : Number(request.query.from)
  const to = request.query.to === undefined ? now : Number(request.query.to)
  const limit = request.query.limit === undefined ? 30 : Number(request.query.limit)
  if (![from, to, limit].every(Number.isSafeInteger) || from < 0 || to < from || limit < 1 || limit > 1_440) {
    const error = new Error('Telemetry range must contain valid from, to, and limit values.')
    error.code = 'invalid-telemetry-range'
    error.status = 400
    throw error
  }
  return { from, to, limit }
}

function hostExists(store, host) {
  return store.getProject().items[hostKey(host)]?.type === host.hostType
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.get('authorization') ?? '')
  return match?.[1] ?? null
}

function publicEndpoint(request) {
  return normalizeAgentEndpoint(`${request.protocol}://${request.get('host')}`)
}

function routeError(response, error) {
  const status = Number.isInteger(error?.status) ? error.status : 400
  response.status(status).json({
    message: error instanceof Error ? error.message : 'Agent request is invalid.',
    code: typeof error?.code === 'string' ? error.code : 'invalid-agent-request',
  })
}

function disabledRoute(_request, response) {
  response.status(403).json({ message: DISABLED_MESSAGE, code: 'agent-disabled' })
}

function findEnrollment(store, host, token) {
  return store.findAgentEnrollment({
    ...host,
    protocolMajor: 1,
    tokenHash: hashToken(token),
  })
}

function parseDeviceId(request) {
  const value = request.get(AGENT_SIGNATURE_HEADERS.deviceId)
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isRelationalId(parsed) ? parsed : null
}

function findDevice(store, host, request) {
  const deviceId = parseDeviceId(request)
  return deviceId ? store.findAgentDevice({ ...host, deviceId, protocolMajor: 1 }) : null
}

function findRevokedDevice(store, host, request) {
  const deviceId = parseDeviceId(request)
  return deviceId
    ? store.findAgentDevice({ ...host, deviceId, protocolMajor: 1, revoked: true })
    : null
}

function registrationDeletionOptions(body) {
  if (body === undefined || body === null || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)) {
    return { deleteTelemetry: false }
  }
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'deleteTelemetry') || typeof body.deleteTelemetry !== 'boolean') {
    const error = new Error('Registration deletion must specify deleteTelemetry as a boolean.')
    error.code = 'invalid-agent-deletion-options'
    error.status = 400
    throw error
  }
  return { deleteTelemetry: body.deleteTelemetry }
}

function decodeHeartbeat(request, device, host, rawBody) {
  const authentication = verifyAgentRequest(request, device, rawBody)
  if (request.get('content-encoding')?.toLowerCase() !== 'gzip') {
    const error = new Error('Protocol v1 heartbeats require Content-Encoding: gzip.')
    error.code = 'agent-content-encoding-required'
    error.status = 415
    throw error
  }
  let decompressed
  try {
    decompressed = gunzipSync(rawBody, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
  } catch {
    const error = new Error('Agent heartbeat gzip payload is invalid or exceeds the decompressed limit.')
    error.code = 'invalid-agent-compression'
    error.status = 400
    throw error
  }
  let payload
  try {
    payload = JSON.parse(decompressed.toString('utf8'))
  } catch {
    const error = new Error('Agent heartbeat contains invalid JSON.')
    error.code = 'invalid-agent-json'
    error.status = 400
    throw error
  }
  const heartbeat = normalizeV1Heartbeat(payload, host)
  if (heartbeat.sequence !== authentication.sequence) {
    const error = new Error('Heartbeat sequence does not match the signed request sequence.')
    error.code = 'invalid-agent-sequence'
    error.status = 400
    throw error
  }
  return { authentication, heartbeat }
}

function decodeHardwareSnapshot(request, device, host, rawBody) {
  if (request.get('content-encoding')) {
    const error = new Error('Hardware snapshots do not accept a content encoding.')
    error.code = 'invalid-agent-content-encoding'
    error.status = 415
    throw error
  }
  const authentication = verifyAgentRequest(request, device, rawBody)
  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    const error = new Error('Hardware snapshot contains invalid JSON.')
    error.code = 'invalid-agent-json'
    error.status = 400
    throw error
  }
  return { authentication, snapshot: normalizeV1HardwareSnapshot(payload, host) }
}

async function persistHardwareSnapshot(store, device, host, authentication, snapshot, receivedAt) {
  return store.saveAgentHardwareSnapshot({
    deviceId: device.id,
    ...host,
    protocolMajor: snapshot.protocolMajor,
    collectedAt: snapshot.collectedAt,
    receivedAt,
    host: snapshot.host,
    components: snapshot.components,
    sequence: authentication.sequence,
  })
}

function persistHeartbeat(store, device, host, authentication, heartbeat, receivedAt) {
  const statusPayload = { ...heartbeat }
  delete statusPayload.host
  delete statusPayload.sequence
  delete statusPayload.protocolMajor
  store.recordAgentHeartbeat({
    deviceId: device.id,
    host,
    sequence: authentication.sequence,
    status: { lastSeenAt: receivedAt, ...statusPayload },
  })
}

export function createAgentV1BodyMiddleware({ maxBytes = MAX_COMPRESSED_BYTES, label = 'Agent heartbeat' } = {}) {
  return function readSignedAgentBody(request, response, next) {
    const declaredLength = Number(request.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      response.status(413).json({ message: `${label} exceeds the size limit.` })
      return
    }
    const chunks = []
    let size = 0
    let finished = false
    request.on('data', (chunk) => {
      if (finished) return
      size += chunk.length
      if (size > maxBytes) {
        finished = true
        response.status(413).json({ message: `${label} exceeds the size limit.` })
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (finished) return
      finished = true
      request.body = Buffer.concat(chunks, size)
      next()
    })
    request.on('error', (error) => {
      if (finished) return
      finished = true
      next(error)
    })
  }
}

/** @param {import('../persistence/store-contract.ts').HomelabInventoryPersistence} store */
export function registerAgentV1Routes(app, store, {
  disabled = false,
  contractService = new AgentContractService(),
  heartbeatRateLimit = HEARTBEAT_RATE_LIMIT,
  heartbeatRateWindowMs = HEARTBEAT_RATE_WINDOW_MS,
  heartbeatSink = null,
  monitoringConfigProvider = null,
  notificationHostLifecycle = null,
  telemetryRepository = null,
  releaseService = null,
} = {}) {
  app.get('/api/agent/contracts/current', disabled
    ? disabledRoute
    : (request, response) => contractService.respond(request, response))

  const typedPaths = [
    ['post', '/api/agent/hosts/:hostType/:hostId/enrollments'],
    ['post', '/api/agent/hosts/:hostType/:hostId/activate'],
    ['post', '/api/agent/hosts/:hostType/:hostId/heartbeats'],
    ['post', '/api/agent/hosts/:hostType/:hostId/hardware-snapshots'],
    ['get', '/api/agent/hosts/:hostType/:hostId/hardware-snapshot'],
    ['get', '/api/agent/hosts/:hostType/:hostId/hardware-suggestions'],
    ['get', '/api/agent/hosts/:hostType/:hostId/telemetry'],
    ['delete', '/api/agent/hosts/:hostType/:hostId/registration'],
    ['delete', '/api/agent/hosts/:hostType/:hostId/status'],
  ]
  if (disabled) {
    for (const [method, path] of typedPaths) app[method](path, disabledRoute)
    return
  }

  const heartbeatBuckets = new Map()
  function heartbeatAllowed(deviceId) {
    const now = Date.now()
    const cutoff = now - heartbeatRateWindowMs
    const recent = (heartbeatBuckets.get(deviceId) ?? []).filter((time) => time > cutoff)
    if (recent.length >= heartbeatRateLimit) return false
    recent.push(now)
    heartbeatBuckets.set(deviceId, recent)
    return true
  }

  app.post('/api/agent/hosts/:hostType/:hostId/enrollments', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    let endpoint
    try {
      endpoint = request.body?.endpoint
        ? normalizeAgentEndpoint(request.body.endpoint)
        : publicEndpoint(request)
    } catch (error) {
      return routeError(response, error)
    }
    let commands = null
    try {
      commands = releaseService?.installCommands({
        endpoint,
        hostType: host.hostType,
        hostId: host.hostId,
        activationToken: 'pending',
        containers: request.body?.containers,
      }) ?? null
    } catch (error) {
      return routeError(response, error)
    }
    const token = createToken()
    if (commands) {
      commands = releaseService.installCommands({
        endpoint,
        hostType: host.hostType,
        hostId: host.hostId,
        activationToken: token,
        containers: request.body?.containers,
      })
    }
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS).toISOString()
    const enrollment = store.createAgentEnrollment({
      ...host,
      protocolMajor: 1,
      tokenHash: hashToken(token),
      endpoint,
      createdAt,
      expiresAt,
    })
    return response.set('Cache-Control', 'no-store').json({
      enrollmentId: enrollment.id,
      endpoint,
      expiresAt,
      activationToken: token,
      protocolMajor: 1,
      ...(commands ? {
        agentVersion: releaseService.current().version,
        installCommand: commands.linux,
        installCommands: commands,
      } : {}),
    })
  })

  app.post('/api/agent/hosts/:hostType/:hostId/activate', (request, response) => {
    const host = parseHost(request)
    const token = bearerToken(request)
    if (!token) return response.status(401).json({ message: 'Missing enrollment token.' })
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    const enrollment = findEnrollment(store, host, token)
    if (!enrollment) return response.status(403).json({ message: 'Enrollment token is invalid or expired.' })
    let activation
    try {
      activation = normalizeV1Activation(request.body)
    } catch (error) {
      return routeError(response, error)
    }
    const now = new Date().toISOString()
    const activated = store.activateAgentEnrollment({
      enrollmentId: enrollment.id,
      device: {
        ...host,
        protocolMajor: 1,
        publicKey: activation.publicKey,
        agentVersion: activation.agentVersion,
        capabilities: activation.capabilities,
        createdAt: now,
        lastSeenAt: null,
        lastSequence: 0,
      },
    })
    for (const deviceId of activated.revokedDeviceIds) heartbeatBuckets.delete(deviceId)
    return response.set('Cache-Control', 'no-store').json({
      deviceId: activated.device.id,
      protocolMajor: 1,
      contractUrl: '/api/agent/contracts/current',
      heartbeatUrl: `/api/agent/hosts/${host.hostType}/${host.hostId}/heartbeats`,
    })
  })

  app.post('/api/agent/hosts/:hostType/:hostId/heartbeats', async (request, response) => {
    const host = parseHost(request)
    const device = host ? findDevice(store, host, request) : null
    if (host && !device && findRevokedDevice(store, host, request)) {
      return response.status(410).json({ message: 'Agent registration was revoked.', code: 'agent-registration-revoked' })
    }
    if (!host || !device) return response.status(401).json({ message: 'Agent identity is invalid.' })
    if (!heartbeatAllowed(device.id)) return response.status(429).json({ message: 'Too many heartbeat requests.' })
    try {
      const { authentication, heartbeat } = decodeHeartbeat(request, device, host, request.body)
      const receivedAt = new Date().toISOString()
      const identity = store.resolveAgentTelemetryIdentity({
        deviceId: device.id,
        hostType: host.hostType,
        hostId: host.hostId,
      })
      const telemetry = await heartbeatSink?.({
        deviceId: device.id,
        agentId: identity.agentId,
        hostType: host.hostType,
        hostId: host.hostId,
        hostItemId: identity.hostItemId,
        receivedAt,
        payload: heartbeat,
      })
      persistHeartbeat(store, device, host, authentication, heartbeat, receivedAt)
      return response.json({
        ok: true,
        receivedAt,
        sequence: authentication.sequence,
        ...(telemetry ? { telemetry } : {}),
        ...(monitoringConfigProvider
          ? { monitoringConfig: monitoringConfigProvider(host.hostType, host.hostId) }
          : {}),
      })
    } catch (error) {
      if (!(error instanceof AgentAuthenticationError) && !Number.isInteger(error?.status)) throw error
      if (Number(error.status) >= 500) throw error
      return routeError(response, error)
    }
  })

  app.post('/api/agent/hosts/:hostType/:hostId/hardware-snapshots', async (request, response) => {
    const host = parseHost(request)
    const device = host ? findDevice(store, host, request) : null
    if (host && !device && findRevokedDevice(store, host, request)) {
      return response.status(410).json({ message: 'Agent registration was revoked.', code: 'agent-registration-revoked' })
    }
    if (!host || !device) return response.status(401).json({ message: 'Agent identity is invalid.' })
    try {
      const { authentication, snapshot } = decodeHardwareSnapshot(request, device, host, request.body)
      const receivedAt = new Date().toISOString()
      const persisted = await persistHardwareSnapshot(store, device, host, authentication, snapshot, receivedAt)
      return response.status(201).json({ ok: true, snapshotId: persisted.id, receivedAt, sequence: authentication.sequence })
    } catch (error) {
      if (!(error instanceof AgentAuthenticationError) && !Number.isInteger(error?.status)) throw error
      if (Number(error.status) >= 500) throw error
      return routeError(response, error)
    }
  })

  app.get('/api/agent/hosts/:hostType/:hostId/hardware-snapshot', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    return response.set('Cache-Control', 'no-store').json(buildHardwareSuggestions(
      store.getAgentHardwareContext(host.hostType, host.hostId),
    ))
  })

  app.get('/api/agent/hosts/:hostType/:hostId/hardware-suggestions', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    const result = buildHardwareSuggestions(store.getAgentHardwareContext(host.hostType, host.hostId))
    return response.set('Cache-Control', 'no-store').json({
      snapshotId: result.snapshot?.id ?? null,
      stale: result.stale,
      ageMs: result.ageMs ?? null,
      suggestions: result.suggestions,
    })
  })

  app.get('/api/agent/hosts/:hostType/:hostId/telemetry', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    if (!telemetryRepository) return response.status(503).json({ message: 'Telemetry storage is unavailable.' })
    try {
      const range = telemetryQuery(request)
      const serverTime = new Date()
      const heartbeatIntervalSeconds = contractService.current().contract.collection.hostIntervalSeconds
      const timing = agentStatusTiming(heartbeatIntervalSeconds)
      const summary = store.getAgentStatusSummary({
        heartbeatIntervalSeconds,
        now: serverTime.getTime(),
      })
      const key = hostKey(host)
      const connected = summary.registeredHosts.some(
        (candidate) => candidate.hostType === host.hostType && candidate.hostId === host.hostId,
      )
      const status = summary.hosts[key] ?? {
        ...host,
        state: connected ? 'unknown' : 'unregistered',
        connected,
        ageMs: null,
      }
      const telemetryView = telemetryRepository.getTelemetryView?.(host.hostType, host.hostId, { now: serverTime.getTime(), minutes: 30 })
      const latest = telemetryView?.latest ?? telemetryRepository.getHostSummary?.(host.hostType, host.hostId) ?? null
      const hardware = store.getAgentHardwareContext(host.hostType, host.hostId)
      const metricBuckets = telemetryView?.buckets ?? []
      const reconstructed = latest ? {
        source: 'reconstructed-latest-state',
        observedAt: latest.receivedAt,
        agentVersion: latest.agentVersion,
        sequence: latest.sequence,
        ...latest.payload,
      } : null
      return response.set('Cache-Control', 'no-store').json({
        host,
        serverTime: serverTime.toISOString(),
        status,
        timing,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        heartbeatBuckets: metricBuckets.map(({ at, received }) => ({ at, received })),
        metricBuckets,
        latest: reconstructed,
        storage: buildStorageTelemetry({
          heartbeat: latest?.payload ?? null,
          snapshot: hardware.snapshot,
          inventory: hardware.inventory,
          project: hardware.project,
        }),
      })
    } catch (error) {
      return routeError(response, error)
    }
  })

  app.delete('/api/agent/hosts/:hostType/:hostId/registration', async (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    let options
    try {
      options = registrationDeletionOptions(request.body)
    } catch (error) {
      return routeError(response, error)
    }
    if (options.deleteTelemetry && !telemetryRepository) {
      return response.status(503).json({ message: 'Telemetry storage is unavailable.' })
    }
    let telemetryDeleted = null
    if (options.deleteTelemetry) {
      telemetryDeleted = telemetryRepository.deleteHost(host.hostType, host.hostId)
      store.clearAgentRuntimeData(host.hostType, host.hostId)
    }
    const { revoked, revokedAt, revokedDeviceIds } = store.revokeAgentRegistration(host.hostType, host.hostId)
    for (const deviceId of revokedDeviceIds) heartbeatBuckets.delete(deviceId)
    if (revoked || options.deleteTelemetry) await store.flush(['agents', 'agentStatus'])
    if (revoked) await notificationHostLifecycle?.cancelHost(host.hostType, host.hostId, 'agent-unlinked')
    return response.json({ ok: true, ...host, revoked, revokedAt, deleteTelemetry: options.deleteTelemetry, telemetryDeleted })
  })

  app.delete('/api/agent/hosts/:hostType/:hostId/status', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    if (store.hasActiveAgentRegistration(host.hostType, host.hostId)) {
      return response.status(409).json({ message: 'Revoke the active agent registration before clearing runtime status.' })
    }
    return response.json(store.clearAgentRuntimeData(host.hostType, host.hostId))
  })
}
