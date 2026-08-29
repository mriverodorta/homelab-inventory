const MAX_JSON_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 20_000

export class LabGdPublicationClient {
  constructor({ identityService, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.identityService = identityService
    this.timeoutMs = timeoutMs
  }

  async request(pathname, { method = 'POST', body = {}, raw = false, headers = {}, scope = 'publication:write', timeoutMs = this.timeoutMs, signal = null } = {}) {
    const bytes = raw
      ? body
      : new TextEncoder().encode(JSON.stringify(body))
    const response = await this.identityService.signedFetch(pathname, {
      method,
      body: bytes,
      scope,
      headers: raw ? headers : { 'content-type': 'application/json', ...headers },
      timeoutMs,
      signal,
    })
    return response
  }

  async stage({ idempotencyKey, sharePublicId, manifest, availableHashes }) {
    const response = await this.request('/v1/publications/manifest', {
      body: { idempotencyKey, sharePublicId, manifest, availableHashes },
    })
    const result = await boundedJson(response)
    if (!response.ok) {
      throw remoteError(response, result, 'sharing-publication-stage-failed')
    }
    try {
      return publicationStageResult(result)
    } catch {
      throw remoteError(response, {}, 'sharing-publication-stage-failed')
    }
  }

  async upload(operationId, blob) {
    const response = await this.request(`/v1/publications/operations/${operationId}/blobs/${blob.contentHash}`, {
      method: 'PUT',
      body: new TextEncoder().encode(blob.contentJson),
      raw: true,
      headers: { 'content-type': blob.mediaType },
    })
    if (!response.ok) throw remoteError(response, await boundedJson(response), 'sharing-publication-blob-failed')
  }

  async activate(operationId, expectedShareRevision) {
    const response = await this.request(`/v1/publications/operations/${operationId}/activate`, {
      body: { expectedShareRevision },
    })
    const result = await boundedJson(response)
    if (!response.ok || result.operationId !== operationId || !Number.isSafeInteger(result.revisionId) || result.revisionId <= 0) {
      throw remoteError(response, result, 'sharing-publication-activation-failed')
    }
    return result
  }

  async events(cursor = 0, { signal = null } = {}) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('lab.gd event cursor is invalid.')
    const response = await this.request('/v1/installations/events', {
      method: 'GET', body: new Uint8Array(), raw: true, scope: 'events:read', timeoutMs: 0,
      headers: cursor > 0 ? { 'last-event-id': String(cursor) } : {},
      signal,
    })
    if (!response.ok || !String(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')) {
      throw remoteError(response, await boundedJson(response), 'sharing-events-failed')
    }
    return response
  }

  settings(publicId, expectedRevision, idempotencyKey, settings) {
    return this.shareMutation(publicId, '', 'PATCH', 'shares:manage', { expectedRevision, idempotencyKey, ...settings })
  }

  unpublish(publicId, expectedRevision, idempotencyKey) {
    return this.shareMutation(publicId, '/unpublish', 'POST', 'shares:manage', { expectedRevision, idempotencyKey })
  }

  delete(publicId, expectedRevision, idempotencyKey) {
    return this.shareMutation(publicId, '', 'DELETE', 'shares:manage', { expectedRevision, idempotencyKey })
  }

  republish(publicId, expectedRevision, idempotencyKey) {
    return this.shareMutation(publicId, '/republish', 'POST', 'shares:manage', { expectedRevision, idempotencyKey })
  }

  async replacePassword(publicId, expectedRevision, idempotencyKey, password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Share password must be between 12 and 1024 characters.')
    const result = await this.shareMutation(publicId, '/password', 'PUT', 'shares:manage', { expectedRevision, idempotencyKey, password }, false)
    if (result.passwordConfigured !== true || result.viewerGrantsRevoked !== true) throw new Error('lab.gd returned an invalid password result.')
    return { publicId: result.publicId, revision: result.revision, passwordConfigured: true, viewerGrantsRevoked: true }
  }

  async analytics(publicId) {
    const response = await this.request(`/v1/installation-shares/${encodeURIComponent(publicId)}/analytics`, { method: 'GET', body: new Uint8Array(), raw: true, scope: 'analytics:read' })
    const result = await boundedJson(response)
    if (!response.ok) throw remoteError(response, result, 'sharing-analytics-failed')
    return analyticsResult(result, publicId)
  }

  async shareMutation(publicId, suffix, method, scope, body, requireState = true) {
    if (typeof publicId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(publicId)) throw new Error('Remote share ID is invalid.')
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision <= 0 || typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/u.test(body.idempotencyKey)) throw new Error('Remote share mutation metadata is invalid.')
    const response = await this.request(`/v1/installation-shares/${encodeURIComponent(publicId)}${suffix}`, { method, body, scope })
    const result = await boundedJson(response)
    if (!response.ok) throw remoteError(response, result, 'sharing-lifecycle-failed')
    if (result.publicId !== publicId || !Number.isSafeInteger(result.revision) || result.revision <= body.expectedRevision || (requireState && typeof result.state !== 'string')) throw new Error('lab.gd returned an invalid lifecycle result.')
    return result
  }
}

function analyticsResult(value, publicId) {
  if (!value || typeof value !== 'object' || value.publicId !== publicId || !value.totals || !Number.isSafeInteger(value.totals.fullLoads) || value.totals.fullLoads < 0 || !Number.isSafeInteger(value.totals.embedLoads) || value.totals.embedLoads < 0 || !Array.isArray(value.daily) || value.daily.length > 90 || !value.lifecycle) throw new Error('lab.gd returned invalid owner analytics.')
  const daily = value.daily.map((row) => {
    if (!row || typeof row !== 'object' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.date) || !Number.isSafeInteger(row.fullLoads) || row.fullLoads < 0 || !Number.isSafeInteger(row.embedLoads) || row.embedLoads < 0) throw new Error('lab.gd returned invalid owner analytics.')
    return { date: row.date, fullLoads: row.fullLoads, embedLoads: row.embedLoads }
  })
  for (const field of ['expiresAt', 'inactivityAt', 'graceEndsAt']) if (value.lifecycle[field] !== null && (typeof value.lifecycle[field] !== 'string' || !Number.isFinite(Date.parse(value.lifecycle[field])))) throw new Error('lab.gd returned invalid owner analytics.')
  if (value.lastSuccessfulLoadAt !== null && (typeof value.lastSuccessfulLoadAt !== 'string' || !Number.isFinite(Date.parse(value.lastSuccessfulLoadAt)))) throw new Error('lab.gd returned invalid owner analytics.')
  if (!['active', 'unpublished', 'expired', 'grace-period', 'deleted'].includes(value.lifecycle.state)) throw new Error('lab.gd returned invalid owner analytics.')
  return { publicId, totals: { fullLoads: value.totals.fullLoads, embedLoads: value.totals.embedLoads }, daily, lastSuccessfulLoadAt: value.lastSuccessfulLoadAt, lifecycle: { state: value.lifecycle.state, expiresAt: value.lifecycle.expiresAt, inactivityAt: value.lifecycle.inactivityAt, graceEndsAt: value.lifecycle.graceEndsAt } }
}

async function boundedJson(response, maximumBytes = MAX_JSON_BYTES) {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maximumBytes) throw new Error('lab.gd response exceeded the allowed size.')
  const text = await response.text()
  if (Buffer.byteLength(text) > maximumBytes) throw new Error('lab.gd response exceeded the allowed size.')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error('lab.gd returned invalid JSON.')
  }
}

function remoteError(response, body, fallback) {
  const error = new Error(typeof body?.message === 'string' ? body.message : `lab.gd request failed with HTTP ${response.status}.`)
  error.code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' ? body.error : fallback
  error.status = response.status
  const retryAfter = Number(response.headers.get('retry-after'))
  error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 3_600_000) : null
  return error
}

function publicationStageResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.operation || typeof value.operation !== 'object' || Array.isArray(value.operation)) throw new Error('invalid stage result')
  const operationId = value.operation.id
  const state = value.operation.state
  if (!Number.isSafeInteger(operationId) || operationId <= 0 || !['staged', 'ready', 'active', 'failed'].includes(state)) throw new Error('invalid stage operation')
  if (!Array.isArray(value.missingHashes) || value.missingHashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) || new Set(value.missingHashes).size !== value.missingHashes.length) throw new Error('invalid missing hashes')
  const failureCode = value.operation.failureCode ?? null
  if ((failureCode !== null && (typeof failureCode !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(failureCode))) || (state === 'failed') !== (failureCode !== null)) throw new Error('invalid failure code')
  const result = value.operation.result ?? null
  if (state === 'active') {
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 2 || !Object.hasOwn(result, 'operationId') || !Object.hasOwn(result, 'revisionId') || result.operationId !== operationId || !Number.isSafeInteger(result.revisionId) || result.revisionId <= 0) throw new Error('invalid activation result')
  } else if (result !== null) throw new Error('unexpected activation result')
  return {
    operationId,
    state,
    failureCode,
    missingHashes: [...value.missingHashes],
    activationResult: result === null ? null : { operationId: result.operationId, revisionId: result.revisionId },
  }
}
