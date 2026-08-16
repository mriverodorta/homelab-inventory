import { createHash } from 'node:crypto'

export const AGENT_SCHEMA_BUNDLE_DIGEST = '0e1749bf18a921f89334410d61ce95ebd0d001c6ed30ef6ae4655c90e1180554'
export const AGENT_PREVIOUS_SCHEMA_BUNDLE_DIGEST = '3179a40f31801dee2edaf890485e0e360680684c2ef9ba6e01f6961bacca0106'
export const AGENT_INTERMEDIATE_SCHEMA_BUNDLE_DIGEST = '97ea85ea215e8d35d2cf8c70c24d715d79e092391dd57f70b6b54ef9717e7495'
export const AGENT_LEGACY_SCHEMA_BUNDLE_DIGEST = '6991de825d245d5906d64a137f51fd52ed820c97c5f093a0935434a0130c06ec'

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
    this.representations = new Map([
      AGENT_SCHEMA_BUNDLE_DIGEST,
      AGENT_PREVIOUS_SCHEMA_BUNDLE_DIGEST,
      AGENT_INTERMEDIATE_SCHEMA_BUNDLE_DIGEST,
      AGENT_LEGACY_SCHEMA_BUNDLE_DIGEST,
    ].map((schemaBundleDigest) => {
      const contract = { ...this.contract, schemaBundleDigest }
      const body = Buffer.from(`${canonicalJson(contract)}\n`, 'utf8')
      return [schemaBundleDigest, {
        contract,
        body,
        etag: `"sha256-${createHash('sha256').update(body).digest('base64url')}"`,
      }]
    }))
  }

  current() {
    const current = this.representations.get(AGENT_SCHEMA_BUNDLE_DIGEST)
    return { contract: structuredClone(current.contract), body: Buffer.from(current.body), etag: current.etag }
  }

  respond(request, response) {
    const requestedDigest = request.get('x-homelab-agent-schema-digest')
      || AGENT_LEGACY_SCHEMA_BUNDLE_DIGEST
    const representation = this.representations.get(requestedDigest)
    if (!representation) {
      response.status(409).json({
        message: 'The agent schema bundle is not supported by this application version.',
        code: 'agent-schema-bundle-unsupported',
      })
      return
    }
    if (request.get('if-none-match') === representation.etag) {
      response.status(304).end()
      return
    }
    response
      .set('Cache-Control', 'private, max-age=60, must-revalidate')
      .set('ETag', representation.etag)
      .type('application/json')
      .send(representation.body)
  }
}
