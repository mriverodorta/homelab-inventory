const MAX_JSON_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 20_000

export class LabGdPublicationClient {
  constructor({ identityService, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.identityService = identityService
    this.timeoutMs = timeoutMs
  }

  async request(pathname, { method = 'POST', body = {}, raw = false, headers = {} } = {}) {
    const bytes = raw
      ? body
      : new TextEncoder().encode(JSON.stringify(body))
    const response = await this.identityService.signedFetch(pathname, {
      method,
      body: bytes,
      scope: 'publication:write',
      headers: raw ? headers : { 'content-type': 'application/json', ...headers },
      timeoutMs: this.timeoutMs,
    })
    return response
  }

  async stage({ idempotencyKey, sharePublicId, manifest, availableHashes }) {
    const response = await this.request('/v1/publications/manifest', {
      body: { idempotencyKey, sharePublicId, manifest, availableHashes },
    })
    const result = await boundedJson(response)
    if (!response.ok || !Number.isSafeInteger(result.operation?.id) || !Array.isArray(result.missingHashes)) {
      throw remoteError(response, result, 'sharing-publication-stage-failed')
    }
    return { operationId: result.operation.id, missingHashes: result.missingHashes }
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
    if (!response.ok || !Number.isSafeInteger(result.revisionId)) {
      throw remoteError(response, result, 'sharing-publication-activation-failed')
    }
    return result
  }
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
  const retryAfter = Number(response.headers.get('retry-after'))
  error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 3_600_000) : null
  return error
}
