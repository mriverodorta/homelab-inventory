const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const CONTACT_POINT_TYPES = new Set(['ntfy', 'webhook'])
const HOST_OVERRIDE_MODES = new Set(['inherit', 'custom', 'disabled'])
const RESOURCE_FAMILIES = new Set(['service', 'container', 'storage-health'])
const INCIDENT_STATES = new Set(['pending', 'open', 'resolved', 'cancelled'])
const DELIVERY_STATES = new Set(['queued', 'leased', 'delivered', 'retrying', 'exhausted', 'cancelled'])
const DELIVERY_KINDS = new Set(['opening', 'reminder', 'recovery'])
const SEVERITIES = new Set(['info', 'warning', 'critical'])

export const NOTIFICATION_EVENT_TYPES = Object.freeze([
  'host.offline',
  'service.unhealthy',
  'container.unhealthy',
  'container.missing',
  'storage.warning',
  'storage.failed',
])

const EVENT_TYPE_SET = new Set(NOTIFICATION_EVENT_TYPES)

const DEFAULT_RULES = Object.freeze([
  { eventType: 'host.offline', severity: 'critical', debounceSeconds: 60 },
  { eventType: 'service.unhealthy', severity: 'warning', debounceSeconds: 60 },
  { eventType: 'container.unhealthy', severity: 'warning', debounceSeconds: 60 },
  { eventType: 'container.missing', severity: 'warning', debounceSeconds: 60 },
  { eventType: 'storage.warning', severity: 'warning', debounceSeconds: 0 },
  { eventType: 'storage.failed', severity: 'critical', debounceSeconds: 0 },
])

function isoNow(now = Date.now()) {
  return new Date(now).toISOString()
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
}

function assertString(value, label, { allowEmpty = false, maxLength = 2048 } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '') || value.length > maxLength) {
    throw new Error(`${label} must be a valid string.`)
  }
}

function assertOptionalIso(value, label) {
  if (value === null || value === undefined) return
  assertString(value, label, { maxLength: 64 })
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`)
}

function assertTimezone(value, label) {
  assertString(value, label, { maxLength: 80 })
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
  } catch {
    throw new Error(`${label} must be a valid IANA time zone.`)
  }
}

function assertPositiveId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`)
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`)
}

function assertUniqueIds(records, label) {
  const ids = new Set()
  for (const record of records) {
    assertPositiveId(record?.id, `${label}.id`)
    if (ids.has(record.id)) throw new Error(`${label} contains duplicate id ${record.id}.`)
    ids.add(record.id)
  }
  return ids
}

function clone(value) {
  return structuredClone(value)
}

function defaultRules() {
  return DEFAULT_RULES.map((rule, index) => ({
    id: index + 1,
    ...rule,
    enabled: true,
    contactPointIds: [],
    reminderIntervalSeconds: null,
    cooldownSeconds: 900,
  }))
}

export function createNotificationConfig(now = Date.now()) {
  const timestamp = isoNow(now)
  return {
    version: 1,
    revision: 1,
    enabled: false,
    contactPoints: [],
    rules: defaultRules(),
    quietHours: [],
    hostOverrides: [],
    monitoredResources: [],
    retention: {
      incidentDays: 90,
      deliveryAttemptDays: 30,
    },
    counters: {
      contactPoint: 1,
      rule: DEFAULT_RULES.length + 1,
      quietHours: 1,
      hostOverride: 1,
      monitoredResource: 1,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createNotificationState(now = Date.now()) {
  return {
    version: 1,
    normalizedStates: [],
    pendingTransitions: [],
    incidents: [],
    transitions: [],
    acknowledgements: [],
    deliveryJobs: [],
    deliveryAttempts: [],
    cooldowns: [],
    evaluationCursors: [],
    counters: {
      normalizedState: 1,
      pendingTransition: 1,
      incident: 1,
      transition: 1,
      acknowledgement: 1,
      deliveryJob: 1,
      deliveryAttempt: 1,
      cooldown: 1,
      evaluationCursor: 1,
    },
    lastEvaluatedAt: null,
    updatedAt: isoNow(now),
  }
}

export function createNotificationSecrets(now = Date.now()) {
  return {
    version: 1,
    secrets: [],
    counters: { secret: 1 },
    updatedAt: isoNow(now),
  }
}

function normalizeCounter(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export function normalizeNotificationConfig(value, now = Date.now()) {
  const fallback = createNotificationConfig(now)
  if (!isRecord(value)) return fallback
  return {
    ...fallback,
    ...clone(value),
    version: 1,
    revision: normalizeCounter(value.revision, 1),
    enabled: value.enabled === true,
    contactPoints: Array.isArray(value.contactPoints) ? clone(value.contactPoints) : [],
    rules: Array.isArray(value.rules) && value.rules.length > 0 ? clone(value.rules) : fallback.rules,
    quietHours: Array.isArray(value.quietHours) ? clone(value.quietHours) : [],
    hostOverrides: Array.isArray(value.hostOverrides) ? clone(value.hostOverrides) : [],
    monitoredResources: Array.isArray(value.monitoredResources) ? clone(value.monitoredResources) : [],
    retention: {
      incidentDays: normalizeCounter(value.retention?.incidentDays, 90),
      deliveryAttemptDays: normalizeCounter(value.retention?.deliveryAttemptDays, 30),
    },
    counters: {
      contactPoint: normalizeCounter(value.counters?.contactPoint, 1),
      rule: normalizeCounter(value.counters?.rule, DEFAULT_RULES.length + 1),
      quietHours: normalizeCounter(value.counters?.quietHours, 1),
      hostOverride: normalizeCounter(value.counters?.hostOverride, 1),
      monitoredResource: normalizeCounter(value.counters?.monitoredResource, 1),
    },
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : fallback.createdAt,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
  }
}

export function normalizeNotificationState(value, now = Date.now()) {
  const fallback = createNotificationState(now)
  if (!isRecord(value)) return fallback
  const collections = [
    'normalizedStates',
    'pendingTransitions',
    'incidents',
    'transitions',
    'acknowledgements',
    'deliveryJobs',
    'deliveryAttempts',
    'cooldowns',
    'evaluationCursors',
  ]
  const normalized = { ...fallback, ...clone(value), version: 1 }
  for (const key of collections) normalized[key] = Array.isArray(value[key]) ? clone(value[key]) : []
  normalized.cooldowns = normalized.cooldowns.map((cooldown) => ({ resourceId: null, ...cooldown }))
  normalized.evaluationCursors = normalized.evaluationCursors.map((cursor) => ({
    candidateCollectedAt: null,
    candidateReceivedAt: null,
    ...cursor,
  }))
  normalized.counters = { ...fallback.counters }
  for (const key of Object.keys(fallback.counters)) {
    normalized.counters[key] = normalizeCounter(value.counters?.[key], 1)
  }
  return normalized
}

export function normalizeNotificationSecrets(value, now = Date.now()) {
  const fallback = createNotificationSecrets(now)
  if (!isRecord(value)) return fallback
  return {
    version: 1,
    secrets: Array.isArray(value.secrets) ? clone(value.secrets) : [],
    counters: { secret: normalizeCounter(value.counters?.secret, 1) },
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
  }
}

function assertHostRef(record, label) {
  if (!HOST_TYPES.has(record.hostType)) throw new Error(`${label}.hostType is invalid.`)
  assertPositiveId(record.hostId, `${label}.hostId`)
}

export function assertNotificationConfig(value) {
  assertRecord(value, 'notifications')
  if (value.version !== 1) throw new Error('notifications.version is unsupported.')
  assertPositiveId(value.revision, 'notifications.revision')
  if (typeof value.enabled !== 'boolean') throw new Error('notifications.enabled must be boolean.')
  for (const key of ['contactPoints', 'rules', 'quietHours', 'hostOverrides', 'monitoredResources']) {
    if (!Array.isArray(value[key])) throw new Error(`notifications.${key} must be an array.`)
  }

  const contactPointIds = assertUniqueIds(value.contactPoints, 'notifications.contactPoints')
  for (const point of value.contactPoints) {
    if (!CONTACT_POINT_TYPES.has(point.type)) throw new Error('Notification contact point type is invalid.')
    assertString(point.name, 'Notification contact point name', { maxLength: 120 })
    if (typeof point.enabled !== 'boolean') throw new Error('Notification contact point enabled must be boolean.')
    if (point.secretId !== null) assertPositiveId(point.secretId, 'Notification contact point secretId')
    assertRecord(point.config, 'Notification contact point config')
  }

  assertUniqueIds(value.rules, 'notifications.rules')
  const eventTypes = new Set()
  for (const rule of value.rules) {
    if (!EVENT_TYPE_SET.has(rule.eventType)) throw new Error('Notification rule eventType is invalid.')
    if (eventTypes.has(rule.eventType)) throw new Error(`Duplicate notification rule ${rule.eventType}.`)
    eventTypes.add(rule.eventType)
    if (!SEVERITIES.has(rule.severity)) throw new Error('Notification rule severity is invalid.')
    if (typeof rule.enabled !== 'boolean') throw new Error('Notification rule enabled must be boolean.')
    assertNonNegativeInteger(rule.debounceSeconds, 'Notification rule debounceSeconds')
    assertNonNegativeInteger(rule.cooldownSeconds, 'Notification rule cooldownSeconds')
    if (rule.reminderIntervalSeconds !== null) assertPositiveId(rule.reminderIntervalSeconds, 'Notification rule reminderIntervalSeconds')
    if (!Array.isArray(rule.contactPointIds)) throw new Error('Notification rule contactPointIds must be an array.')
    for (const id of rule.contactPointIds) {
      assertPositiveId(id, 'Notification rule contactPointId')
      if (!contactPointIds.has(id)) throw new Error(`Notification rule references missing contact point ${id}.`)
    }
  }

  assertUniqueIds(value.quietHours, 'notifications.quietHours')
  for (const quiet of value.quietHours) {
    if (typeof quiet.enabled !== 'boolean') throw new Error('Quiet-hours enabled must be boolean.')
    assertTimezone(quiet.timezone, 'Quiet-hours timezone')
    assertString(quiet.start, 'Quiet-hours start', { maxLength: 5 })
    assertString(quiet.end, 'Quiet-hours end', { maxLength: 5 })
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end)) {
      throw new Error('Quiet-hours times must use HH:MM.')
    }
    if (!Array.isArray(quiet.weekdays) || quiet.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error('Quiet-hours weekdays are invalid.')
    }
  }

  const resourceIds = assertUniqueIds(value.monitoredResources, 'notifications.monitoredResources')
  for (const resource of value.monitoredResources) {
    assertHostRef(resource, 'Monitored resource')
    if (!RESOURCE_FAMILIES.has(resource.family)) throw new Error('Monitored resource family is invalid.')
    assertString(resource.key, 'Monitored resource key', { maxLength: 512 })
    assertString(resource.name, 'Monitored resource name', { maxLength: 255 })
    if (typeof resource.enabled !== 'boolean') throw new Error('Monitored resource enabled must be boolean.')
  }

  assertUniqueIds(value.hostOverrides, 'notifications.hostOverrides')
  const hostKeys = new Set()
  for (const override of value.hostOverrides) {
    assertHostRef(override, 'Host override')
    const hostKey = `${override.hostType}:${override.hostId}`
    if (hostKeys.has(hostKey)) throw new Error(`Duplicate notification host override ${hostKey}.`)
    hostKeys.add(hostKey)
    if (!HOST_OVERRIDE_MODES.has(override.mode)) throw new Error('Host override mode is invalid.')
    assertOptionalIso(override.mutedUntil, 'Host override mutedUntil')
    if (!Array.isArray(override.monitoredResourceIds)) throw new Error('Host override monitoredResourceIds must be an array.')
    for (const id of override.monitoredResourceIds) {
      assertPositiveId(id, 'Host override monitoredResourceId')
      if (!resourceIds.has(id)) throw new Error(`Host override references missing resource ${id}.`)
    }
    if (!Array.isArray(override.rules)) throw new Error('Host override rules must be an array.')
    const overrideEvents = new Set()
    for (const rule of override.rules) {
      if (!EVENT_TYPE_SET.has(rule.eventType) || overrideEvents.has(rule.eventType)) throw new Error('Host override rule eventType is invalid or duplicated.')
      overrideEvents.add(rule.eventType)
      if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') throw new Error('Host override rule enabled must be boolean.')
      if (rule.severity !== undefined && !SEVERITIES.has(rule.severity)) throw new Error('Host override rule severity is invalid.')
      for (const key of ['debounceSeconds', 'cooldownSeconds']) {
        if (rule[key] !== undefined) assertNonNegativeInteger(rule[key], `Host override rule ${key}`)
      }
      if (rule.reminderIntervalSeconds !== undefined && rule.reminderIntervalSeconds !== null) {
        assertPositiveId(rule.reminderIntervalSeconds, 'Host override rule reminderIntervalSeconds')
      }
      if (rule.contactPointIds !== undefined) {
        if (!Array.isArray(rule.contactPointIds)) throw new Error('Host override rule contactPointIds must be an array.')
        for (const id of rule.contactPointIds) {
          assertPositiveId(id, 'Host override rule contactPointId')
          if (!contactPointIds.has(id)) throw new Error(`Host override rule references missing contact point ${id}.`)
        }
      }
    }
  }

  assertPositiveId(value.retention?.incidentDays, 'Notification incident retention')
  assertPositiveId(value.retention?.deliveryAttemptDays, 'Notification delivery-attempt retention')
  assertRecord(value.counters, 'Notification counters')
  for (const [key, counter] of Object.entries(value.counters)) assertPositiveId(counter, `Notification counter ${key}`)
  assertOptionalIso(value.createdAt, 'notifications.createdAt')
  assertOptionalIso(value.updatedAt, 'notifications.updatedAt')
  return true
}

export function assertNotificationState(value) {
  assertRecord(value, 'notificationState')
  if (value.version !== 1) throw new Error('notificationState.version is unsupported.')
  const collectionNames = [
    'normalizedStates', 'pendingTransitions', 'incidents', 'transitions',
    'acknowledgements', 'deliveryJobs', 'deliveryAttempts', 'cooldowns', 'evaluationCursors',
  ]
  const idsByCollection = {}
  for (const key of collectionNames) {
    if (!Array.isArray(value[key])) throw new Error(`notificationState.${key} must be an array.`)
    idsByCollection[key] = assertUniqueIds(value[key], `notificationState.${key}`)
  }
  for (const incident of value.incidents) {
    assertHostRef(incident, 'Incident')
    if (incident.resourceId !== null) assertPositiveId(incident.resourceId, 'Incident resourceId')
    if (!EVENT_TYPE_SET.has(incident.eventType)) throw new Error('Incident eventType is invalid.')
    if (!SEVERITIES.has(incident.severity)) throw new Error('Incident severity is invalid.')
    if (!INCIDENT_STATES.has(incident.state)) throw new Error('Incident state is invalid.')
    assertString(incident.eventKey, 'Incident eventKey', { maxLength: 512 })
    assertOptionalIso(incident.openedAt, 'Incident openedAt')
    assertOptionalIso(incident.resolvedAt, 'Incident resolvedAt')
  }
  for (const transition of value.transitions) {
    assertPositiveId(transition.incidentId, 'Transition incidentId')
    if (!idsByCollection.incidents.has(transition.incidentId)) throw new Error(`Transition references missing incident ${transition.incidentId}.`)
  }
  for (const acknowledgement of value.acknowledgements) {
    assertPositiveId(acknowledgement.incidentId, 'Acknowledgement incidentId')
    if (!idsByCollection.incidents.has(acknowledgement.incidentId)) throw new Error(`Acknowledgement references missing incident ${acknowledgement.incidentId}.`)
  }
  for (const job of value.deliveryJobs) {
    assertPositiveId(job.incidentId, 'Delivery job incidentId')
    assertPositiveId(job.contactPointId, 'Delivery job contactPointId')
    if (!idsByCollection.incidents.has(job.incidentId)) throw new Error(`Delivery job references missing incident ${job.incidentId}.`)
    if (!DELIVERY_STATES.has(job.state)) throw new Error('Delivery job state is invalid.')
    if (!DELIVERY_KINDS.has(job.kind)) throw new Error('Delivery job kind is invalid.')
  }
  for (const attempt of value.deliveryAttempts) {
    assertPositiveId(attempt.deliveryJobId, 'Delivery attempt deliveryJobId')
    if (!idsByCollection.deliveryJobs.has(attempt.deliveryJobId)) throw new Error(`Delivery attempt references missing job ${attempt.deliveryJobId}.`)
  }
  for (const cooldown of value.cooldowns) {
    assertHostRef(cooldown, 'Cooldown')
    if (cooldown.resourceId !== null) assertPositiveId(cooldown.resourceId, 'Cooldown resourceId')
    assertPositiveId(cooldown.contactPointId, 'Cooldown contactPointId')
    if (!EVENT_TYPE_SET.has(cooldown.eventType)) throw new Error('Cooldown eventType is invalid.')
    assertOptionalIso(cooldown.expiresAt, 'Cooldown expiresAt')
  }
  const cursorHosts = new Set()
  for (const cursor of value.evaluationCursors) {
    assertHostRef(cursor, 'Evaluation cursor')
    const hostKey = `${cursor.hostType}:${cursor.hostId}`
    if (cursorHosts.has(hostKey)) throw new Error(`Duplicate evaluation cursor ${hostKey}.`)
    cursorHosts.add(hostKey)
    assertNonNegativeInteger(cursor.lastSequence, 'Evaluation cursor lastSequence')
    assertOptionalIso(cursor.lastCollectedAt, 'Evaluation cursor lastCollectedAt')
    assertOptionalIso(cursor.lastReceivedAt, 'Evaluation cursor lastReceivedAt')
    assertOptionalIso(cursor.candidateCollectedAt, 'Evaluation cursor candidateCollectedAt')
    assertOptionalIso(cursor.candidateReceivedAt, 'Evaluation cursor candidateReceivedAt')
  }
  assertRecord(value.counters, 'Notification-state counters')
  for (const [key, counter] of Object.entries(value.counters)) assertPositiveId(counter, `Notification-state counter ${key}`)
  assertOptionalIso(value.lastEvaluatedAt, 'notificationState.lastEvaluatedAt')
  assertOptionalIso(value.updatedAt, 'notificationState.updatedAt')
  return true
}

export function assertNotificationSecrets(value) {
  assertRecord(value, 'notificationSecrets')
  if (value.version !== 1 || !Array.isArray(value.secrets)) throw new Error('notificationSecrets is invalid.')
  assertUniqueIds(value.secrets, 'notificationSecrets.secrets')
  for (const secret of value.secrets) {
    if (secret.algorithm !== 'aes-256-gcm') throw new Error('Notification secret algorithm is invalid.')
    for (const key of ['iv', 'tag', 'ciphertext']) assertString(secret[key], `Notification secret ${key}`, { maxLength: 65536 })
  }
  assertPositiveId(value.counters?.secret, 'Notification secret counter')
  assertOptionalIso(value.updatedAt, 'notificationSecrets.updatedAt')
  return true
}

export function nextRelationalId(store, counterName) {
  const value = store.counters[counterName]
  assertPositiveId(value, `Counter ${counterName}`)
  store.counters[counterName] += 1
  return value
}

export function notificationHostKey(hostType, hostId) {
  if (!HOST_TYPES.has(hostType)) throw new Error('Notification host type is invalid.')
  assertPositiveId(hostId, 'Notification host id')
  return `${hostType}:${hostId}`
}
