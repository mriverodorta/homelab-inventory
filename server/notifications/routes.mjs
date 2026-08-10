import { nextRelationalId } from './model.mjs'
import { parseDeliveryUrl } from './adapters/http-utils.mjs'

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const CONTACT_TYPES = new Set(['ntfy', 'webhook'])
const HOST_MODES = new Set(['inherit', 'custom', 'disabled'])

function idParam(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer.`)
  return id
}

function expectedRevision(request, current) {
  const expected = request.body?.expectedRevision
  if (expected === undefined || expected === null) return null
  if (!Number.isSafeInteger(expected) || expected !== current.revision) {
    const error = new Error('Notification settings changed in another session. Refresh and try again.')
    error.status = 409
    error.code = 'notification-revision-conflict'
    throw error
  }
  return expected
}

function ensureRevision(draft, expected) {
  if (expected === null || draft.revision === expected) return
  const error = new Error('Notification settings changed in another session. Refresh and try again.')
  error.status = 409
  error.code = 'notification-revision-conflict'
  throw error
}

function redactedConfig(config) {
  return {
    ...structuredClone(config),
    contactPoints: config.contactPoints.map(({ secretId, ...point }) => ({
      ...point,
      hasSecret: secretId !== null,
    })),
  }
}

function publicSnapshot(store) {
  const config = store.readConfig()
  const state = store.readState()
  const active = state.incidents.filter((incident) => incident.state === 'open')
  return {
    available: true,
    config: redactedConfig(config),
    summary: {
      active: active.length,
      unacknowledged: active.filter((incident) => !incident.acknowledgedAt).length,
      exhaustedDeliveries: state.deliveryJobs.filter((job) => job.state === 'exhausted').length,
    },
  }
}

function displayDeliveryUrl(value) {
  const parsed = parseDeliveryUrl(value)
  return `${parsed.protocol}//${parsed.host}`
}

function normalizeContactPointInput(input, existing = null) {
  if (!CONTACT_TYPES.has(input?.type)) throw new Error('Notification contact point type is invalid.')
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 120) throw new Error('Notification contact point name is required.')
  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
    ? structuredClone(input.config)
    : {}
  if (input.type === 'ntfy') {
    if (!String(config.serverUrl ?? '').trim() || !String(config.topic ?? '').trim()) {
      throw new Error('Ntfy server URL and topic are required.')
    }
    parseDeliveryUrl(config.serverUrl)
  } else {
    const url = String(config.url ?? '').trim()
    if (!url && !existing) throw new Error('Webhook URL is required.')
    if (url) parseDeliveryUrl(url)
    config.displayUrl = url ? displayDeliveryUrl(url) : existing.config.displayUrl
    delete config.url
    return { type: input.type, name, enabled: input.enabled !== false, config, deliveryUrl: url || null }
  }
  return { type: input.type, name, enabled: input.enabled !== false, config }
}

function credentialsObject(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Notification credentials are invalid.')
  return structuredClone(value)
}

async function readStoredCredentials(vault, secretId) {
  if (secretId === null) return {}
  const value = JSON.parse(await vault.open(secretId))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stored notification credentials are invalid.')
  return value
}

function normalizeRuleInput(input, current) {
  const severity = ['info', 'warning', 'critical'].includes(input?.severity) ? input.severity : current.severity
  const contactPointIds = Array.isArray(input?.contactPointIds)
    ? [...new Set(input.contactPointIds.map((value) => idParam(value, 'Contact point id')))]
    : current.contactPointIds
  const integer = (value, fallback, { nullable = false } = {}) => {
    if (nullable && value === null) return null
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback
  }
  return {
    ...current,
    enabled: input?.enabled ?? current.enabled,
    severity,
    contactPointIds,
    debounceSeconds: integer(input?.debounceSeconds, current.debounceSeconds),
    cooldownSeconds: integer(input?.cooldownSeconds, current.cooldownSeconds),
    reminderIntervalSeconds: integer(input?.reminderIntervalSeconds, current.reminderIntervalSeconds, { nullable: true }),
  }
}

function handle(response, operation) {
  void operation().catch((error) => {
    const status = Number.isInteger(error?.status) ? error.status : 400
    response.status(status).json({ message: error instanceof Error ? error.message : 'Notification request failed.', code: error?.code })
  })
}

export function registerNotificationRoutes(app, {
  store,
  vault,
  incidentManager,
  deliveryCoordinator,
  demo = false,
}) {
  app.get('/api/notifications', (_request, response) => {
    if (demo || !store) {
      response.json({ available: false, config: { enabled: false }, summary: { active: 0, unacknowledged: 0, exhaustedDeliveries: 0 } })
      return
    }
    response.set('Cache-Control', 'no-store').json(publicSnapshot(store))
  })

  const requireRuntime = () => {
    if (demo || !store) {
      const error = new Error('Notifications are unavailable in demo mode.')
      error.status = 403
      error.code = 'notifications-disabled-in-demo'
      throw error
    }
  }

  app.patch('/api/notifications/settings', (request, response) => handle(response, async () => {
    requireRuntime()
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      if (typeof request.body?.enabled === 'boolean') draft.enabled = request.body.enabled
      if (request.body?.retention) {
        for (const key of ['incidentDays', 'deliveryAttemptDays']) {
          if (request.body.retention[key] !== undefined) draft.retention[key] = idParam(request.body.retention[key], key)
        }
      }
    })
    await incidentManager.reconcilePolicies()
    response.json(publicSnapshot(store))
  }))

  app.post('/api/notifications/contact-points', (request, response) => handle(response, async () => {
    requireRuntime()
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    const input = normalizeContactPointInput(request.body)
    const { deliveryUrl, ...pointInput } = input
    const credentials = credentialsObject(request.body?.credentials) ?? {}
    if (input.type === 'webhook') credentials.url = deliveryUrl
    const secretId = Object.keys(credentials).length > 0 ? await vault.seal(JSON.stringify(credentials)) : null
    let point
    try {
      point = await store.mutateConfig((draft) => {
        ensureRevision(draft, expected)
        const record = {
          id: nextRelationalId(draft, 'contactPoint'),
          ...pointInput,
          secretId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        draft.contactPoints.push(record)
        return record
      })
    } catch (error) {
      if (secretId !== null) await vault.remove(secretId)
      throw error
    }
    response.status(201).json({ ...point, secretId: undefined, hasSecret: point.secretId !== null })
  }))

  app.put('/api/notifications/contact-points/:id', (request, response) => handle(response, async () => {
    requireRuntime()
    const id = idParam(request.params.id, 'Contact point id')
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    const existing = current.contactPoints.find((point) => point.id === id)
    if (!existing) throw new Error(`Notification contact point ${id} does not exist.`)
    const input = normalizeContactPointInput({ ...existing, ...request.body }, existing)
    const { deliveryUrl, ...pointInput } = input
    const credentials = credentialsObject(request.body?.credentials)
    let secretId = existing.secretId
    let replacementSecretId = null
    const destinationChanged = input.type === 'webhook' && deliveryUrl !== null
    if (credentials !== undefined || destinationChanged) {
      const stored = await readStoredCredentials(vault, existing.secretId)
      const replacement = credentials === null ? {} : credentials ?? stored
      if (input.type === 'webhook') {
        replacement.url = deliveryUrl ?? stored.url ?? existing.config.url
        if (!replacement.url) throw new Error('Webhook URL is required.')
      }
      if (Object.keys(replacement).length > 0) {
        replacementSecretId = await vault.seal(JSON.stringify(replacement))
        secretId = replacementSecretId
      } else {
        secretId = null
      }
    }
    try {
      await store.mutateConfig((draft) => {
        ensureRevision(draft, expected)
        const point = draft.contactPoints.find((candidate) => candidate.id === id)
        Object.assign(point, pointInput, { secretId, updatedAt: new Date().toISOString() })
      })
    } catch (error) {
      if (replacementSecretId !== null) await vault.remove(replacementSecretId)
      throw error
    }
    if (existing.secretId !== null && existing.secretId !== secretId) await vault.remove(existing.secretId)
    response.json(publicSnapshot(store))
  }))

  app.delete('/api/notifications/contact-points/:id', (request, response) => handle(response, async () => {
    requireRuntime()
    const id = idParam(request.params.id, 'Contact point id')
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    const point = current.contactPoints.find((candidate) => candidate.id === id)
    if (!point) throw new Error(`Notification contact point ${id} does not exist.`)
    const workspaceRules = current.rules.filter((rule) => rule.contactPointIds.includes(id))
    const hostRules = current.hostOverrides.flatMap((override) => (
      override.rules.filter((rule) => rule.contactPointIds?.includes(id))
        .map((rule) => `${override.hostType}:${override.hostId}:${rule.eventType}`)
    ))
    if (workspaceRules.length > 0 || hostRules.length > 0) {
      const error = new Error('Remove this contact point from every workspace and host rule before deleting it.')
      error.status = 409
      error.code = 'notification-contact-point-in-use'
      throw error
    }
    await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      draft.contactPoints = draft.contactPoints.filter((candidate) => candidate.id !== id)
    })
    if (point.secretId !== null) await vault.remove(point.secretId)
    response.status(204).end()
  }))

  app.post('/api/notifications/contact-points/:id/test', (request, response) => handle(response, async () => {
    requireRuntime()
    const result = await deliveryCoordinator.sendTest(idParam(request.params.id, 'Contact point id'))
    response.json({ ok: true, status: result.status })
  }))

  app.put('/api/notifications/rules/:id', (request, response) => handle(response, async () => {
    requireRuntime()
    const id = idParam(request.params.id, 'Rule id')
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    const existing = current.rules.find((rule) => rule.id === id)
    if (!existing) throw new Error(`Notification rule ${id} does not exist.`)
    const normalized = normalizeRuleInput(request.body, existing)
    await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      Object.assign(draft.rules.find((rule) => rule.id === id), normalized)
    })
    await incidentManager.reconcilePolicies()
    response.json(publicSnapshot(store))
  }))

  app.post('/api/notifications/quiet-hours', (request, response) => handle(response, async () => {
    requireRuntime()
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    const record = await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      const quiet = {
        id: nextRelationalId(draft, 'quietHours'),
        enabled: request.body?.enabled !== false,
        timezone: String(request.body?.timezone ?? 'UTC'),
        start: String(request.body?.start ?? '22:00'),
        end: String(request.body?.end ?? '06:00'),
        weekdays: Array.isArray(request.body?.weekdays) ? request.body.weekdays : [0, 1, 2, 3, 4, 5, 6],
      }
      draft.quietHours.push(quiet)
      return quiet
    })
    response.status(201).json(record)
  }))

  app.put('/api/notifications/quiet-hours/:id', (request, response) => handle(response, async () => {
    requireRuntime()
    const id = idParam(request.params.id, 'Quiet-hours id')
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      const quiet = draft.quietHours.find((candidate) => candidate.id === id)
      if (!quiet) throw new Error(`Quiet-hours schedule ${id} does not exist.`)
      Object.assign(quiet, request.body, { id })
    })
    response.json(publicSnapshot(store))
  }))

  app.delete('/api/notifications/quiet-hours/:id', (request, response) => handle(response, async () => {
    requireRuntime()
    const id = idParam(request.params.id, 'Quiet-hours id')
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      if (!draft.quietHours.some((candidate) => candidate.id === id)) throw new Error(`Quiet-hours schedule ${id} does not exist.`)
      draft.quietHours = draft.quietHours.filter((candidate) => candidate.id !== id)
    })
    response.status(204).end()
  }))

  app.put('/api/notifications/hosts/:hostType/:hostId', (request, response) => handle(response, async () => {
    requireRuntime()
    const hostType = request.params.hostType
    const hostId = idParam(request.params.hostId, 'Host id')
    if (!HOST_TYPES.has(hostType) || !HOST_MODES.has(request.body?.mode)) throw new Error('Notification host policy is invalid.')
    const current = store.readConfig()
    const expected = expectedRevision(request, current)
    await store.mutateConfig((draft) => {
      ensureRevision(draft, expected)
      const requestedResources = Array.isArray(request.body.resources) ? request.body.resources : []
      const selectedIds = []
      for (const input of requestedResources) {
        if (!['service', 'container', 'storage-health'].includes(input.family)) throw new Error('Monitored resource family is invalid.')
        const key = String(input.key ?? '').trim()
        const name = String(input.name ?? '').trim()
        if (!key || !name) throw new Error('Monitored resource key and name are required.')
        let resource = draft.monitoredResources.find((candidate) => candidate.hostType === hostType && candidate.hostId === hostId && candidate.family === input.family && candidate.key === key)
        if (!resource) {
          resource = { id: nextRelationalId(draft, 'monitoredResource'), hostType, hostId, family: input.family, key, name, enabled: true }
          draft.monitoredResources.push(resource)
        } else {
          resource.name = name
          resource.enabled = true
        }
        selectedIds.push(resource.id)
      }
      for (const resource of draft.monitoredResources) {
        if (resource.hostType === hostType && resource.hostId === hostId) resource.enabled = selectedIds.includes(resource.id)
      }
      let override = draft.hostOverrides.find((candidate) => candidate.hostType === hostType && candidate.hostId === hostId)
      if (!override) {
        override = { id: nextRelationalId(draft, 'hostOverride'), hostType, hostId }
        draft.hostOverrides.push(override)
      }
      Object.assign(override, {
        mode: request.body.mode,
        mutedUntil: request.body.mutedUntil ?? null,
        monitoredResourceIds: selectedIds,
        rules: Array.isArray(request.body.rules)
          ? request.body.rules.map((input) => {
              const inherited = current.rules.find((rule) => rule.eventType === input?.eventType)
              if (!inherited) throw new Error('Notification host rule event type is invalid.')
              const normalized = normalizeRuleInput(input, inherited)
              return {
                eventType: normalized.eventType,
                enabled: normalized.enabled,
                severity: normalized.severity,
                contactPointIds: normalized.contactPointIds,
                debounceSeconds: normalized.debounceSeconds,
                cooldownSeconds: normalized.cooldownSeconds,
                reminderIntervalSeconds: normalized.reminderIntervalSeconds,
              }
            })
          : [],
        updatedAt: new Date().toISOString(),
      })
    })
    await incidentManager.reconcilePolicies({ hostType, hostId })
    response.json(publicSnapshot(store))
  }))

  app.get('/api/notifications/incidents', (request, response) => {
    if (demo || !store) return response.json({ incidents: [], deliveries: [], total: 0 })
    const state = store.readState()
    const filter = String(request.query.state ?? 'all')
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200)
    const offset = Math.max(Number(request.query.offset) || 0, 0)
    const filtered = state.incidents
      .filter((incident) => filter === 'all' || (filter === 'history' ? incident.state !== 'open' : incident.state === filter))
      .sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt))
    const incidents = filtered.slice(offset, offset + limit)
    const incidentIds = new Set(incidents.map((incident) => incident.id))
    response.set('Cache-Control', 'no-store').json({
      incidents,
      deliveries: state.deliveryJobs.filter((job) => incidentIds.has(job.incidentId)),
      total: filtered.length,
    })
  })

  app.post('/api/notifications/incidents/:id/acknowledge', (request, response) => handle(response, async () => {
    requireRuntime()
    const actor = request.authentication?.account?.id ?? null
    response.json(await incidentManager.acknowledge(idParam(request.params.id, 'Incident id'), actor))
  }))

  app.post('/api/notifications/deliveries/:id/retry', (request, response) => handle(response, async () => {
    requireRuntime()
    response.json(await deliveryCoordinator.retry(idParam(request.params.id, 'Delivery id')))
  }))
}
