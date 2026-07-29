import fs from 'node:fs/promises'
import path from 'node:path'
import {
  catalogSnapshotDigest,
  FINGERPRINT_VERSION,
  sha256Hex,
  validateCatalogManifest,
  validateCatalogDigestIndex,
  validateCatalogSnapshot,
  verifySignedCatalogArtifact,
} from '../../packages/catalog-protocol/src/index.ts'
import { trustedCatalogKeys } from './trusted-keys.mjs'

const runtimeImport = new Function('specifier', 'return import(specifier)')

async function openCatalogIndex(filePath) {
  const moduleUrl = new URL('./catalog-index.mjs', import.meta.url).href
  const { CatalogIndex } = await runtimeImport(moduleUrl)
  return new CatalogIndex(filePath)
}

const OFFICIAL_REGISTRY_ORIGIN = 'https://registry.homelabinventory.com'

function nextId(records) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function sourceKind(mode) {
  return mode === 'connected' ? 'official-connected' : 'official-offline'
}

function safeRefreshMessage(error) {
  if (error?.name === 'AbortError') return 'Official catalog request timed out.'
  const message = error instanceof Error ? error.message : ''
  const safePatterns = [
    /^Catalog (manifest|snapshot|digest) request failed with HTTP \d{3}\.$/,
    /^Catalog (manifest|snapshot|digest index|digest) .{1,180}\.$/,
    /^Connected catalog mode was disabled before activation\.$/,
    /^No trusted official catalog signing keys are configured\.$/,
  ]
  if (message.length <= 240 && safePatterns.some((pattern) => pattern.test(message))) return message
  return 'Official catalog refresh failed.'
}

export function parseTrustedCatalogKeys(value = process.env.REGISTRY_TRUSTED_KEYS_JSON) {
  return trustedCatalogKeys(value)
}

export class SnapshotService {
  constructor(store, {
    trustedKeys = parseTrustedCatalogKeys(),
    fetchImpl = globalThis.fetch,
    officialOrigin = OFFICIAL_REGISTRY_ORIGIN,
    timeoutMs = 15_000,
  } = {}) {
    this.store = store
    this.trustedKeys = trustedKeys
    this.fetchImpl = fetchImpl
    this.officialOrigin = new URL(officialOrigin).origin
    this.timeoutMs = timeoutMs
    this.catalogDir = path.join(store.dataDir, 'catalog')
    this.cacheDir = path.join(store.dataDir, 'cache')
    this.snapshotPath = path.join(this.catalogDir, 'active-snapshot.json')
    this.digestPath = path.join(this.catalogDir, 'active-digests.json')
    this.indexPath = path.join(this.cacheDir, 'catalog.sqlite')
  }

  async verifyArtifact(artifact, options = {}) {
    if (this.trustedKeys.length === 0) throw new Error('No trusted official catalog signing keys are configured.')
    const payload = await verifySignedCatalogArtifact(artifact, this.trustedKeys, options)
    return validateCatalogSnapshot(payload, options)
  }

  async activate(artifact, { mode, now = new Date(), digestArtifact } = {}) {
    if (mode !== 'offline' && mode !== 'connected') throw new Error('Catalog activation mode is invalid.')
    const snapshot = await this.verifyArtifact(artifact, { now })
    const digest = await catalogSnapshotDigest(snapshot)
    const digestIndex = digestArtifact
      ? validateCatalogDigestIndex(await verifySignedCatalogArtifact(digestArtifact, this.trustedKeys, { now }))
      : validateCatalogDigestIndex({
          schemaVersion: snapshot.schemaVersion,
          fingerprintVersion: FINGERPRINT_VERSION,
          manufacturerAliasVersion: 1,
          catalogRevision: snapshot.catalogRevision,
          generatedAt: snapshot.generatedAt,
          entries: snapshot.templates.map((template) => ({
            identityHash: template.identityHash,
            templateKey: template.templateKey,
            contentHashes: [{ hash: template.contentHash, state: 'published', revision: template.revision }],
          })),
        })
    if (digestIndex.catalogRevision !== snapshot.catalogRevision) throw new Error('Catalog digest index revision does not match its snapshot.')
    await fs.mkdir(this.catalogDir, { recursive: true })
    await fs.mkdir(this.cacheDir, { recursive: true })
    const nonce = `${process.pid}-${Date.now()}`
    const temporarySnapshot = `${this.snapshotPath}.${nonce}.tmp`
    const temporaryDigests = `${this.digestPath}.${nonce}.tmp`
    const temporaryIndex = `${this.indexPath}.${nonce}.tmp`
    try {
      await fs.writeFile(temporarySnapshot, JSON.stringify(artifact), { mode: 0o600 })
      await fs.writeFile(temporaryDigests, JSON.stringify(digestArtifact
        ? { signed: true, artifact: digestArtifact }
        : { signed: false, payload: digestIndex }), { mode: 0o600 })
      await (await openCatalogIndex(temporaryIndex)).rebuild(snapshot, temporaryIndex)
      await fs.rename(temporarySnapshot, this.snapshotPath)
      await fs.rename(temporaryDigests, this.digestPath)
      await fs.rename(temporaryIndex, this.indexPath)
    } catch (error) {
      await Promise.allSettled([fs.rm(temporarySnapshot, { force: true }), fs.rm(temporaryDigests, { force: true }), fs.rm(temporaryIndex, { force: true })])
      throw error
    }

    const activatedAt = now.toISOString()
    return this.store.registryTransaction((draft) => {
      const kind = sourceKind(mode)
      let source = draft.sources.find((candidate) => candidate.kind?.startsWith('official-'))
      if (!source) {
        source = { id: nextId(draft.sources), kind, displayName: 'Official Homelab Inventory Catalog' }
        draft.sources.push(source)
      }
      Object.assign(source, {
        kind,
        activeRevision: snapshot.catalogRevision,
        lastCheckedAt: activatedAt,
        lastSuccessAt: activatedAt,
        lastErrorAt: null,
        lastError: null,
      })
      draft.snapshot = {
        sourceId: source.id,
        revision: snapshot.catalogRevision,
        generatedAt: snapshot.generatedAt,
        expiresAt: snapshot.expiresAt ?? null,
        activatedAt,
        digest,
        templateCount: snapshot.templates.length,
        keyId: artifact.signature.keyId,
      }
      const templates = new Map(snapshot.templates.map((template) => [template.templateKey, template]))
      for (const link of draft.links.filter((candidate) => candidate.sourceId === source.id)) {
        const template = templates.get(link.templateKey)
        if (!template || link.state === 'detached' || link.state === 'contribution-pending') continue
        if (template.contentHash === link.importedContentHash) {
          link.importedRevision = template.revision
          link.state = 'linked'
        } else {
          link.state = 'update-available'
          link.availableRevision = template.revision
          link.availableContentHash = template.contentHash
        }
      }
    })
  }

  async ensureIndex() {
    try {
      await fs.access(this.indexPath)
      return
    } catch {}
    const artifact = JSON.parse(await fs.readFile(this.snapshotPath, 'utf8'))
    const snapshot = await this.verifyArtifact(artifact)
    await (await openCatalogIndex(this.indexPath)).rebuild(snapshot)
  }

  async search(parameters) {
    const registry = this.store.getRegistryState()
    if (!registry.snapshot) return { total: 0, limit: 30, offset: 0, items: [] }
    await this.ensureIndex()
    return (await openCatalogIndex(this.indexPath)).search(parameters)
  }

  async template(templateKey) {
    const registry = this.store.getRegistryState()
    if (!registry.snapshot) return null
    await this.ensureIndex()
    return (await openCatalogIndex(this.indexPath)).getByKey(templateKey)
  }

  async knownContributionHashes() {
    try {
      const stored = JSON.parse(await fs.readFile(this.digestPath, 'utf8'))
      const payload = stored.signed
        ? await verifySignedCatalogArtifact(stored.artifact, this.trustedKeys)
        : stored.payload
      const digestIndex = validateCatalogDigestIndex(payload)
      return new Map(digestIndex.entries.flatMap((entry) => entry.contentHashes.map((observation) => [
        observation.hash,
        {
          identityHash: entry.identityHash,
          templateKey: entry.templateKey,
          revision: observation.revision,
          state: observation.state,
        },
      ])))
    } catch (error) {
      if (error?.code === 'ENOENT') return new Map()
      throw error
    }
  }

  async refreshConnected({ now = new Date() } = {}) {
    const registry = this.store.getRegistryState()
    if (registry.settings.mode !== 'connected') throw new Error('Connected catalog mode is not enabled.')
    const manifestUrl = new URL('/v1/manifest', this.officialOrigin)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const manifestResponse = await this.fetchImpl(manifestUrl, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!manifestResponse.ok) throw new Error(`Catalog manifest request failed with HTTP ${manifestResponse.status}.`)
      const signedManifest = await manifestResponse.json()
      const manifestPayload = await verifySignedCatalogArtifact(signedManifest, this.trustedKeys, { now })
      const manifest = validateCatalogManifest(manifestPayload, { now })
      const snapshotUrl = new URL(manifest.snapshot.url)
      if (snapshotUrl.origin !== this.officialOrigin) throw new Error('Catalog manifest points outside the official registry origin.')
      const digestUrl = new URL(manifest.digests.url)
      if (digestUrl.origin !== this.officialOrigin) throw new Error('Catalog manifest digest index points outside the official registry origin.')
      const [response, digestResponse] = await Promise.all([
        this.fetchImpl(snapshotUrl, { signal: controller.signal, headers: { accept: 'application/json' } }),
        this.fetchImpl(digestUrl, { signal: controller.signal, headers: { accept: 'application/json' } }),
      ])
      if (!response.ok) throw new Error(`Catalog snapshot request failed with HTTP ${response.status}.`)
      if (!digestResponse.ok) throw new Error(`Catalog digest request failed with HTTP ${digestResponse.status}.`)
      const [text, digestText] = await Promise.all([response.text(), digestResponse.text()])
      if (new TextEncoder().encode(text).byteLength > manifest.snapshot.expandedSizeBytes) {
        throw new Error('Catalog snapshot exceeds its declared expanded size.')
      }
      if (new TextEncoder().encode(digestText).byteLength > manifest.digests.expandedSizeBytes) {
        throw new Error('Catalog digest index exceeds its declared expanded size.')
      }
      if (await sha256Hex(text) !== manifest.snapshot.sha256) throw new Error('Catalog snapshot checksum does not match its manifest.')
      if (await sha256Hex(digestText) !== manifest.digests.sha256) throw new Error('Catalog digest checksum does not match its manifest.')
      if (this.store.getRegistryState().settings.mode !== 'connected') {
        throw new Error('Connected catalog mode was disabled before activation.')
      }
      return this.activate(JSON.parse(text), { mode: 'connected', now, digestArtifact: JSON.parse(digestText) })
    } catch (error) {
      const message = safeRefreshMessage(error)
      const checkedAt = now.toISOString()
      this.store.registryTransaction((draft) => {
        let source = draft.sources.find((candidate) => candidate.kind?.startsWith('official-'))
        if (!source) {
          source = {
            id: nextId(draft.sources),
            kind: 'official-connected',
            displayName: 'Official Homelab Inventory Catalog',
          }
          draft.sources.push(source)
        }
        Object.assign(source, {
          lastCheckedAt: checkedAt,
          lastErrorAt: checkedAt,
          lastError: message,
        })
      })
      throw new Error(message, { cause: error })
    } finally {
      clearTimeout(timeout)
    }
  }
}
