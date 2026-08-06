import { createHash } from 'node:crypto'

export const AGENT_SCHEMA_BUNDLE_DIGEST = 'da509832ec10cbe0e8bab4903627e2c46995d3dcf100735f44bbf8a4330b8d4b'

const BASE_CONTRACT = Object.freeze({
  protocolMajor: 1,
  revision: 1,
  issuedAt: '2026-08-05T00:00:00.000Z',
  schemaBundleDigest: AGENT_SCHEMA_BUNDLE_DIGEST,
  collection: Object.freeze({
    hostIntervalSeconds: 60,
    serviceIntervalSeconds: 600,
    storageHealthIntervalSeconds: 3600,
    gpuSampleIntervalSeconds: 4,
  }),
  limits: Object.freeze({
    compressedBytes: 256 * 1024,
    decompressedBytes: 1024 * 1024,
    offlineSamples: 60,
    offlineBytes: 10 * 1024 * 1024,
  }),
  privacy: Object.freeze({
    containersEnabled: true,
    smartEnabled: false,
    rawHardwareIdentifiersEnabled: false,
  }),
})

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export class AgentContractService {
  constructor({ policy = {} } = {}) {
    this.contract = structuredClone({
      ...BASE_CONTRACT,
      ...policy,
      collection: { ...BASE_CONTRACT.collection, ...policy.collection },
      limits: { ...BASE_CONTRACT.limits, ...policy.limits },
      privacy: { ...BASE_CONTRACT.privacy, ...policy.privacy },
    })
    this.body = Buffer.from(`${canonicalJson(this.contract)}\n`, 'utf8')
    this.etag = `"sha256-${createHash('sha256').update(this.body).digest('base64url')}"`
  }

  current() {
    return { contract: structuredClone(this.contract), body: Buffer.from(this.body), etag: this.etag }
  }

  respond(request, response) {
    if (request.get('if-none-match') === this.etag) {
      response.status(304).end()
      return
    }
    response
      .set('Cache-Control', 'private, max-age=60, must-revalidate')
      .set('ETag', this.etag)
      .type('application/json')
      .send(this.body)
  }
}
