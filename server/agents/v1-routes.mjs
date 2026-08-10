import { gunzipSync } from 'node:zlib'
import { createNumericId, createToken, hashToken, timingSafeEqualString } from '../db/agent-auth.mjs'
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

function recordMatchesHost(record, host) {
  return record.hostType === host.hostType && record.hostId === host.hostId
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

function compactTelemetrySample(sample) {
  const metrics = { ...(sample.payload?.metrics ?? {}) }
  delete metrics.filesystems
  return { ...sample, payload: { ...sample.payload, metrics } }
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
  const tokenHash = hashToken(token)
  return Object.values(store.databases.agents.data.enrollments ?? {}).find((record) =>
    recordMatchesHost(record, host)
      && record.protocolMajor === 1
      && !record.usedAt
      && !record.revokedAt
      && Date.parse(record.expiresAt) > Date.now()
      && timingSafeEqualString(record.tokenHash, tokenHash),
  )
}

function parseDeviceId(request) {
  const value = request.get(AGENT_SIGNATURE_HEADERS.deviceId)
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isRelationalId(parsed) ? parsed : null
}

function findDevice(store, host, request) {
  const deviceId = parseDeviceId(request)
  const device = deviceId ? store.databases.agents.data.devices?.[String(deviceId)] : null
  return device && recordMatchesHost(device, host) && device.protocolMajor === 1 && !device.revokedAt
    ? device
    : null
}

function findRevokedDevice(store, host, request) {
  const deviceId = parseDeviceId(request)
  const device = deviceId ? store.databases.agents.data.devices?.[String(deviceId)] : null
  return device && recordMatchesHost(device, host) && device.protocolMajor === 1 && device.revokedAt
    ? device
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

function componentKindCounts(components) {
  return Object.fromEntries([...components.reduce((counts, component) => {
    counts.set(component.kind, (counts.get(component.kind) ?? 0) + 1)
    return counts
  }, new Map())].sort(([first], [second]) => first.localeCompare(second)))
}

async function persistHardwareSnapshot(store, device, host, authentication, snapshot, receivedAt) {
  const collection = store.databases.agents.data.hardwareSnapshots
  const events = store.databases.agents.data.hardwareEvents
  const previousSequence = device.lastSequence
  const previousSnapshots = structuredClone(collection)
  const previousEvents = structuredClone(events)
  const previous = Object.values(collection).find((record) => record.hostType === host.hostType && record.hostId === host.hostId)
  const snapshotId = previous?.id ?? createNumericId(Object.keys(collection))
  const previousCounts = previous ? componentKindCounts(previous.components) : {}
  const nextCounts = componentKindCounts(snapshot.components)
  const changedKinds = [...new Set([...Object.keys(previousCounts), ...Object.keys(nextCounts)])]
    .filter((kind) => previousCounts[kind] !== nextCounts[kind])
    .sort()
  collection[snapshotId] = {
    id: snapshotId,
    deviceId: device.id,
    hostType: host.hostType,
    hostId: host.hostId,
    protocolMajor: snapshot.protocolMajor,
    collectedAt: snapshot.collectedAt,
    receivedAt,
    host: snapshot.host,
    components: snapshot.components,
  }
  if (previous) {
    const eventId = createNumericId(Object.keys(events))
    events[eventId] = {
      id: eventId,
      snapshotId,
      deviceId: device.id,
      hostType: host.hostType,
      hostId: host.hostId,
      componentCountBefore: previous.components.length,
      componentCountAfter: snapshot.components.length,
      changedKinds,
      createdAt: receivedAt,
    }
    const hostEvents = Object.values(events)
      .filter((event) => event.hostType === host.hostType && event.hostId === host.hostId)
      .sort((first, second) => second.id - first.id)
    for (const event of hostEvents.slice(256)) delete events[event.id]
  }
  device.lastSequence = authentication.sequence
  store.scheduleFlush('agents')
  try {
    await store.flush(['agents'])
  } catch (error) {
    device.lastSequence = previousSequence
    store.databases.agents.data.hardwareSnapshots = previousSnapshots
    store.databases.agents.data.hardwareEvents = previousEvents
    store.scheduleFlush('agents')
    throw error
  }
  return collection[snapshotId]
}

function persistHeartbeat(store, device, host, authentication, heartbeat, receivedAt) {
  device.lastSequence = authentication.sequence
  device.lastSeenAt = receivedAt
  device.agentVersion = heartbeat.agentVersion
  device.capabilities = heartbeat.capabilities
  const statusPayload = { ...heartbeat }
  delete statusPayload.host
  delete statusPayload.sequence
  delete statusPayload.protocolMajor
  store.databases.agentStatus.data.hosts[hostKey(host)] = {
    hostType: host.hostType,
    hostId: host.hostId,
    lastSeenAt: receivedAt,
    ...statusPayload,
  }
  store.scheduleFlush('agents')
  store.scheduleFlush('agentStatus')
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
    const enrollmentId = createNumericId(Object.keys(store.databases.agents.data.enrollments))
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS).toISOString()
    for (const enrollment of Object.values(store.databases.agents.data.enrollments ?? {})) {
      if (recordMatchesHost(enrollment, host) && !enrollment.usedAt && !enrollment.revokedAt) enrollment.revokedAt = createdAt
    }
    store.databases.agents.data.enrollments[enrollmentId] = {
      id: enrollmentId,
      ...host,
      protocolMajor: 1,
      tokenHash: hashToken(token),
      endpoint,
      createdAt,
      expiresAt,
    }
    store.scheduleFlush('agents')
    return response.set('Cache-Control', 'no-store').json({
      enrollmentId,
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
    const deviceId = createNumericId(Object.keys(store.databases.agents.data.devices))
    enrollment.usedAt = now
    for (const device of Object.values(store.databases.agents.data.devices ?? {})) {
      if (recordMatchesHost(device, host) && !device.revokedAt) {
        device.revokedAt = now
        heartbeatBuckets.delete(device.id)
      }
    }
    store.databases.agents.data.devices[deviceId] = {
      id: deviceId,
      ...host,
      protocolMajor: 1,
      publicKey: activation.publicKey,
      agentVersion: activation.agentVersion,
      capabilities: activation.capabilities,
      createdAt: now,
      lastSeenAt: null,
      lastSequence: 0,
    }
    store.scheduleFlush('agents')
    return response.set('Cache-Control', 'no-store').json({
      deviceId,
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
      await heartbeatSink?.({
        deviceId: device.id,
        hostType: host.hostType,
        hostId: host.hostId,
        receivedAt,
        payload: heartbeat,
      })
      persistHeartbeat(store, device, host, authentication, heartbeat, receivedAt)
      return response.json({
        ok: true,
        receivedAt,
        sequence: authentication.sequence,
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
    const snapshot = Object.values(store.databases.agents.data.hardwareSnapshots)
      .find((record) => record.hostType === host.hostType && record.hostId === host.hostId) ?? null
    return response.set('Cache-Control', 'no-store').json(buildHardwareSuggestions({
      snapshot,
      inventory: store.databases.inventory.data,
      project: store.databases.project.data,
    }))
  })

  app.get('/api/agent/hosts/:hostType/:hostId/hardware-suggestions', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    const snapshot = Object.values(store.databases.agents.data.hardwareSnapshots)
      .find((record) => record.hostType === host.hostType && record.hostId === host.hostId) ?? null
    const result = buildHardwareSuggestions({
      snapshot,
      inventory: store.databases.inventory.data,
      project: store.databases.project.data,
    })
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
      const latest = telemetryRepository.getHostSummary?.(host.hostType, host.hostId) ?? null
      const snapshot = Object.values(store.databases.agents.data.hardwareSnapshots)
        .find((record) => record.hostType === host.hostType && record.hostId === host.hostId) ?? null
      return response.set('Cache-Control', 'no-store').json({
        host,
        serverTime: serverTime.toISOString(),
        status,
        timing,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        samples: telemetryRepository.listSamples(host.hostType, host.hostId, range).map(compactTelemetrySample),
        storage: buildStorageTelemetry({
          heartbeat: latest?.payload ?? null,
          snapshot,
          inventory: store.databases.inventory.data,
          project: store.databases.project.data,
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
    const revokedAt = new Date().toISOString()
    let telemetryDeleted = null
    if (options.deleteTelemetry) {
      telemetryDeleted = telemetryRepository.deleteHost(host.hostType, host.hostId)
      store.clearAgentRuntimeData(host.hostType, host.hostId)
    }
    let revoked = 0
    for (const collection of [store.databases.agents.data.enrollments ?? {}, store.databases.agents.data.devices ?? {}]) {
      for (const record of Object.values(collection)) {
        if (recordMatchesHost(record, host) && !record.revokedAt) {
          record.revokedAt = revokedAt
          heartbeatBuckets.delete(record.id)
          revoked += 1
        }
      }
    }
    if (revoked) store.scheduleFlush('agents')
    if (revoked || options.deleteTelemetry) await store.flush(['agents', 'agentStatus'])
    if (revoked) await notificationHostLifecycle?.cancelHost(host.hostType, host.hostId, 'agent-unlinked')
    return response.json({ ok: true, ...host, revoked, revokedAt, deleteTelemetry: options.deleteTelemetry, telemetryDeleted })
  })

  app.delete('/api/agent/hosts/:hostType/:hostId/status', (request, response) => {
    const host = parseHost(request)
    if (!host || !hostExists(store, host)) return response.status(404).json({ message: 'Compute host not found.' })
    const active = [
      ...Object.values(store.databases.agents.data.enrollments ?? {}),
      ...Object.values(store.databases.agents.data.devices ?? {}),
    ].some((record) => recordMatchesHost(record, host) && !record.revokedAt && (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()))
    if (active) return response.status(409).json({ message: 'Revoke the active agent registration before clearing runtime status.' })
    return response.json(store.clearAgentRuntimeData(host.hostType, host.hostId))
  })
}
