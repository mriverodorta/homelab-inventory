import fs from 'node:fs/promises'
import path from 'node:path'
import {
  catalogSnapshotDigest,
  FINGERPRINT_VERSION,
  sha256Hex,
  validateCatalogManifest,
  validateCatalogFacetIndex,
  validateCatalogDigestIndex,
  validateCatalogSnapshot,
  verifySignedCatalogArtifact,
} from '../../packages/catalog-protocol/src/index.ts'
import { trustedCatalogKeys } from './trusted-keys.mjs'
import { discoverContributionCandidates } from './contribution-service.mjs'

const runtimeImport = new Function('specifier', 'return import(specifier)')

async function openCatalogIndex(filePath) {
  const moduleUrl = new URL('./catalog-index.mjs', import.meta.url).href
  const { CatalogIndex } = await runtimeImport(moduleUrl)
  return new CatalogIndex(filePath)
}

const OFFICIAL_REGISTRY_ORIGIN = 'https://registry.homelabinventory.com'
const MAX_MANIFEST_BYTES = 1 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const MAX_DIGEST_BYTES = 32 * 1024 * 1024
const MAX_FACET_BYTES = 8 * 1024 * 1024
const CATALOG_GENERATION_VERSION = 1

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

async function readBoundedResponse(response, { label, maxBytes }) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${label} exceeds the maximum allowed size.`)
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel()
        throw new Error(`${label} exceeds the maximum allowed size.`)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
  }

  const text = typeof response.text === 'function'
    ? await response.text()
    : JSON.stringify(await response.json())
  if (byteLength(text) > maxBytes) throw new Error(`${label} exceeds the maximum allowed size.`)
  return text
}

function assertDigestMatchesSnapshot(snapshot, digestIndex) {
  if (digestIndex.catalogRevision !== snapshot.catalogRevision) {
    throw new Error('Catalog digest index revision does not match its snapshot.')
  }
  if (digestIndex.entries.length !== snapshot.templates.length) {
    throw new Error('Catalog digest index template count does not match its snapshot.')
  }

  const entries = new Map(digestIndex.entries.map((entry) => [entry.templateKey, entry]))
  for (const template of snapshot.templates) {
    const entry = entries.get(template.templateKey)
    const publishedHash = entry?.contentHashes.find((candidate) => (
      candidate.hash === template.contentHash
      && candidate.revision === template.revision
      && candidate.state === 'published'
    ))
    if (
      !entry
      || entry.identityHash !== template.identityHash
      || (entry.fingerprintVersion ?? digestIndex.fingerprintVersion) !== template.fingerprintVersion
      || !publishedHash
    ) {
      throw new Error(`Catalog digest index entry for ${template.templateKey} does not match its snapshot.`)
    }
  }
}

function nextId(records) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function sourceKind(mode) {
  return mode === 'connected' ? 'official-connected' : 'official-offline'
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function safeRefreshMessage(error) {
  if (error?.name === 'AbortError') return 'Official catalog request timed out.'
  const message = error instanceof Error ? error.message : ''
  const safePatterns = [
    /^Catalog (manifest|snapshot|digest|facet) request failed with HTTP \d{3}\.$/,
    /^Catalog (manifest|snapshot|digest index|digest|facet index|facet) .{1,180}\.$/,
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
    this.generationsDir = path.join(this.catalogDir, 'generations')
    this.activePointerPath = path.join(this.catalogDir, 'active-generation.json')
    this.legacySnapshotPath = path.join(this.catalogDir, 'active-snapshot.json')
    this.legacyDigestPath = path.join(this.catalogDir, 'active-digests.json')
    this.legacyIndexPath = path.join(this.cacheDir, 'catalog.sqlite')
    this.resolvedPaths = null
  }

  generationName(revision, digest) {
    return `${revision}-${digest}`
  }

  generationPaths(generation) {
    const directory = path.join(this.generationsDir, generation)
    return {
      generation,
      directory,
      snapshot: path.join(directory, 'snapshot.json'),
      digest: path.join(directory, 'digests.json'),
      facets: path.join(directory, 'facets.json'),
      index: path.join(directory, 'catalog.sqlite'),
      metadata: path.join(directory, 'generation.json'),
    }
  }

  async writeActivePointer(paths, activeSnapshot) {
    await fs.mkdir(this.catalogDir, { recursive: true })
    const temporary = `${this.activePointerPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporary, `${JSON.stringify({
        version: CATALOG_GENERATION_VERSION,
        generation: paths.generation,
        revision: activeSnapshot.revision,
        digest: activeSnapshot.digest,
      }, null, 2)}\n`, { mode: 0o600 })
      await fs.rename(temporary, this.activePointerPath)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }

  async validateStoredGeneration(paths, activeSnapshot) {
    const metadata = JSON.parse(await fs.readFile(paths.metadata, 'utf8'))
    if (
      metadata.version !== CATALOG_GENERATION_VERSION
      || metadata.revision !== activeSnapshot.revision
      || metadata.digest !== activeSnapshot.digest
    ) {
      throw new Error('Catalog generation metadata does not match the active snapshot.')
    }
    const artifact = JSON.parse(await fs.readFile(paths.snapshot, 'utf8'))
    const payload = await verifySignedCatalogArtifact(artifact, this.trustedKeys)
    const validationTime = payload.expiresAt
      ? new Date(Date.parse(payload.expiresAt) - 1)
      : new Date(Math.max(Date.now(), Date.parse(payload.generatedAt)))
    const snapshot = await validateCatalogSnapshot(payload, { now: validationTime })
    if (
      snapshot.catalogRevision !== activeSnapshot.revision
      || await catalogSnapshotDigest(payload) !== activeSnapshot.digest
    ) {
      throw new Error('Catalog generation content does not match the active snapshot.')
    }
    const storedDigest = JSON.parse(await fs.readFile(paths.digest, 'utf8'))
    const digestPayload = storedDigest.signed
      ? await verifySignedCatalogArtifact(storedDigest.artifact, this.trustedKeys)
      : storedDigest.payload
    assertDigestMatchesSnapshot(snapshot, validateCatalogDigestIndex(digestPayload))
    let facets = null
    if (await pathExists(paths.facets)) {
      const storedFacets = JSON.parse(await fs.readFile(paths.facets, 'utf8'))
      facets = validateCatalogFacetIndex(await verifySignedCatalogArtifact(storedFacets, this.trustedKeys))
      if (facets.catalogRevision !== snapshot.catalogRevision) {
        throw new Error('Catalog facet index revision does not match its snapshot.')
      }
    }
    const index = await openCatalogIndex(paths.index)
    if (!await pathExists(paths.index) || !index.isCurrent()) {
      await index.rebuild(snapshot, paths.index, facets)
    }
    return paths
  }

  async resolveActivePaths() {
    const activeSnapshot = this.store.getRegistryState().snapshot
    if (!activeSnapshot) return null
    if (
      this.resolvedPaths?.revision === activeSnapshot.revision
      && this.resolvedPaths?.digestValue === activeSnapshot.digest
    ) return this.resolvedPaths

    const generation = this.generationName(activeSnapshot.revision, activeSnapshot.digest)
    const paths = this.generationPaths(generation)
    if (await pathExists(paths.directory)) {
      await this.validateStoredGeneration(paths, activeSnapshot)
      await this.writeActivePointer(paths, activeSnapshot)
      this.resolvedPaths = { ...paths, revision: activeSnapshot.revision, digestValue: activeSnapshot.digest }
      return this.resolvedPaths
    }

    if (
      await pathExists(this.legacySnapshotPath)
      && await pathExists(this.legacyDigestPath)
    ) {
      this.resolvedPaths = {
        generation: null,
        directory: null,
        snapshot: this.legacySnapshotPath,
        digest: this.legacyDigestPath,
        facets: null,
        index: this.legacyIndexPath,
        metadata: null,
        revision: activeSnapshot.revision,
        digestValue: activeSnapshot.digest,
      }
      return this.resolvedPaths
    }

    throw new Error('Active catalog artifacts are unavailable.')
  }

  async verifyArtifact(artifact, options = {}) {
    if (this.trustedKeys.length === 0) throw new Error('No trusted official catalog signing keys are configured.')
    const payload = await verifySignedCatalogArtifact(artifact, this.trustedKeys, options)
    return {
      payload,
      snapshot: await validateCatalogSnapshot(payload, options),
    }
  }

  async activate(artifact, { mode, now = new Date(), digestArtifact, facetArtifact } = {}) {
    if (mode !== 'offline' && mode !== 'connected') throw new Error('Catalog activation mode is invalid.')
    const { payload, snapshot } = await this.verifyArtifact(artifact, { now })
    const digest = await catalogSnapshotDigest(payload)
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
            fingerprintVersion: template.fingerprintVersion,
            ...(template.identityAliases ? { identityAliases: template.identityAliases } : {}),
            templateKey: template.templateKey,
            contentHashes: [{ hash: template.contentHash, state: 'published', revision: template.revision }],
          })),
        })
    assertDigestMatchesSnapshot(snapshot, digestIndex)
    const facetIndex = facetArtifact
      ? validateCatalogFacetIndex(await verifySignedCatalogArtifact(facetArtifact, this.trustedKeys, { now }))
      : null
    if (facetIndex && facetIndex.catalogRevision !== snapshot.catalogRevision) {
      throw new Error('Catalog facet index revision does not match its snapshot.')
    }
    const activeSnapshot = this.store.getRegistryState().snapshot
    if (activeSnapshot && snapshot.catalogRevision < activeSnapshot.revision) {
      throw new Error('Catalog snapshot revision is older than the active snapshot.')
    }
    if (
      activeSnapshot
      && snapshot.catalogRevision === activeSnapshot.revision
      && digest !== activeSnapshot.digest
    ) {
      throw new Error('Catalog snapshot reuses the active revision with different content.')
    }
    await fs.mkdir(this.generationsDir, { recursive: true })
    const nonce = `${process.pid}-${Date.now()}`
    const generation = this.generationName(snapshot.catalogRevision, digest)
    const finalPaths = this.generationPaths(generation)
    const temporaryDirectory = path.join(this.generationsDir, `.${generation}.${nonce}.tmp`)
    const temporaryPaths = {
      directory: temporaryDirectory,
      snapshot: path.join(temporaryDirectory, 'snapshot.json'),
      digest: path.join(temporaryDirectory, 'digests.json'),
      facets: path.join(temporaryDirectory, 'facets.json'),
      index: path.join(temporaryDirectory, 'catalog.sqlite'),
      metadata: path.join(temporaryDirectory, 'generation.json'),
    }
    try {
      await fs.mkdir(temporaryDirectory, { mode: 0o700 })
      await fs.writeFile(temporaryPaths.snapshot, JSON.stringify(artifact), { mode: 0o600 })
      await fs.writeFile(temporaryPaths.digest, JSON.stringify(digestArtifact
        ? { signed: true, artifact: digestArtifact }
        : { signed: false, payload: digestIndex }), { mode: 0o600 })
      if (facetArtifact) await fs.writeFile(temporaryPaths.facets, JSON.stringify(facetArtifact), { mode: 0o600 })
      await (await openCatalogIndex(temporaryPaths.index)).rebuild(snapshot, temporaryPaths.index, facetIndex)
      await fs.writeFile(temporaryPaths.metadata, `${JSON.stringify({
        version: CATALOG_GENERATION_VERSION,
        revision: snapshot.catalogRevision,
        digest,
      }, null, 2)}\n`, { mode: 0o600 })

      if (await pathExists(finalPaths.directory)) {
        try {
          await this.validateStoredGeneration(finalPaths, {
            revision: snapshot.catalogRevision,
            digest,
          })
          if (facetArtifact) {
            const existingFacets = await fs.readFile(finalPaths.facets, 'utf8').catch(() => null)
            if (existingFacets !== JSON.stringify(facetArtifact)) {
              throw new Error('Catalog generation facet index changed.')
            }
          }
          await fs.rm(temporaryDirectory, { recursive: true, force: true })
        } catch {
          const corrupt = `${finalPaths.directory}.corrupt-${nonce}`
          await fs.rename(finalPaths.directory, corrupt)
          await fs.rename(temporaryDirectory, finalPaths.directory)
          await fs.rm(corrupt, { recursive: true, force: true })
        }
      } else {
        await fs.rename(temporaryDirectory, finalPaths.directory)
      }
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
      throw error
    }

    const activatedAt = now.toISOString()
    const registry = this.store.registryTransaction((draft) => {
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
        if (link.state === 'adoption-available') {
          if (template.contentHash === link.importedContentHash) {
            link.importedRevision = template.revision
            link.state = 'linked'
            delete link.availableRevision
            delete link.availableContentHash
            continue
          }
          link.availableRevision = template.revision
          link.availableContentHash = template.contentHash
          continue
        }
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
    await this.store.flush?.(['registry'])
    await this.writeActivePointer(finalPaths, registry.snapshot)
    this.resolvedPaths = {
      ...finalPaths,
      revision: registry.snapshot.revision,
      digestValue: registry.snapshot.digest,
    }
    await discoverContributionCandidates(
      this.store,
      now,
      await this.knownContributionHashes(),
      { linkOnly: true },
    )
    await this.store.flush?.(['registry'])
    return this.store.getRegistryState()
  }

  async ensureIndex() {
    const paths = await this.resolveActivePaths()
    if (!paths) return null
    try {
      await fs.access(paths.index)
      if ((await openCatalogIndex(paths.index)).isCurrent()) return paths
    } catch {}
    const artifact = JSON.parse(await fs.readFile(paths.snapshot, 'utf8'))
    const payload = await verifySignedCatalogArtifact(artifact, this.trustedKeys)
    const validationTime = payload.expiresAt
      ? new Date(Date.parse(payload.expiresAt) - 1)
      : new Date(Math.max(Date.now(), Date.parse(payload.generatedAt)))
    const snapshot = await validateCatalogSnapshot(payload, { now: validationTime })
    let facets = null
    if (paths.facets && await pathExists(paths.facets)) {
      facets = validateCatalogFacetIndex(await verifySignedCatalogArtifact(JSON.parse(await fs.readFile(paths.facets, 'utf8')), this.trustedKeys))
    }
    await (await openCatalogIndex(paths.index)).rebuild(snapshot, paths.index, facets)
    return paths
  }

  async search(parameters) {
    const registry = this.store.getRegistryState()
    if (!registry.snapshot) return { total: 0, limit: 30, offset: 0, hasMore: false, nextOffset: null, items: [] }
    const paths = await this.ensureIndex()
    return (await openCatalogIndex(paths.index)).search(parameters)
  }

  async facets() {
    const registry = this.store.getRegistryState()
    if (!registry.snapshot) return { available: false, categories: [] }
    const paths = await this.ensureIndex()
    return (await openCatalogIndex(paths.index)).facets()
  }

  async template(templateKey) {
    const registry = this.store.getRegistryState()
    if (!registry.snapshot) return null
    const paths = await this.ensureIndex()
    return (await openCatalogIndex(paths.index)).getByKey(templateKey)
  }

  async knownContributionHashes() {
    try {
      const paths = await this.resolveActivePaths()
      if (!paths) return new Map()
      const stored = JSON.parse(await fs.readFile(paths.digest, 'utf8'))
      const payload = stored.signed
        ? await verifySignedCatalogArtifact(stored.artifact, this.trustedKeys)
        : stored.payload
      const digestIndex = validateCatalogDigestIndex(payload)
      return new Map(digestIndex.entries.flatMap((entry) => entry.contentHashes.map((observation) => [
        observation.hash,
        {
          identityHash: entry.identityHash,
          fingerprintVersion: entry.fingerprintVersion ?? digestIndex.fingerprintVersion,
          identityAliases: entry.identityAliases ?? [],
          ...(entry.productFamily ? { productFamily: entry.productFamily } : {}),
          ...(entry.variantEvidence ? { variantEvidence: entry.variantEvidence } : {}),
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
      const manifestText = await readBoundedResponse(manifestResponse, {
        label: 'Catalog manifest',
        maxBytes: MAX_MANIFEST_BYTES,
      })
      const signedManifest = JSON.parse(manifestText)
      const manifestPayload = await verifySignedCatalogArtifact(signedManifest, this.trustedKeys, { now })
      const manifest = validateCatalogManifest(manifestPayload, { now })
      if (manifest.snapshot.expandedSizeBytes > MAX_SNAPSHOT_BYTES) {
        throw new Error('Catalog snapshot exceeds the maximum allowed size.')
      }
      if (manifest.digests.expandedSizeBytes > MAX_DIGEST_BYTES) {
        throw new Error('Catalog digest index exceeds the maximum allowed size.')
      }
      if (manifest.facets && manifest.facets.expandedSizeBytes > MAX_FACET_BYTES) {
        throw new Error('Catalog facet index exceeds the maximum allowed size.')
      }
      const snapshotUrl = new URL(manifest.snapshot.url)
      if (snapshotUrl.origin !== this.officialOrigin) throw new Error('Catalog manifest points outside the official registry origin.')
      const digestUrl = new URL(manifest.digests.url)
      if (digestUrl.origin !== this.officialOrigin) throw new Error('Catalog manifest digest index points outside the official registry origin.')
      const facetUrl = manifest.facets ? new URL(manifest.facets.url) : null
      if (facetUrl && facetUrl.origin !== this.officialOrigin) throw new Error('Catalog manifest facet index points outside the official registry origin.')
      const [response, digestResponse, facetResponse] = await Promise.all([
        this.fetchImpl(snapshotUrl, { signal: controller.signal, headers: { accept: 'application/json' } }),
        this.fetchImpl(digestUrl, { signal: controller.signal, headers: { accept: 'application/json' } }),
        facetUrl ? this.fetchImpl(facetUrl, { signal: controller.signal, headers: { accept: 'application/json' } }) : null,
      ])
      if (!response.ok) throw new Error(`Catalog snapshot request failed with HTTP ${response.status}.`)
      if (!digestResponse.ok) throw new Error(`Catalog digest request failed with HTTP ${digestResponse.status}.`)
      if (facetResponse && !facetResponse.ok) throw new Error(`Catalog facet request failed with HTTP ${facetResponse.status}.`)
      const [text, digestText, facetText] = await Promise.all([
        readBoundedResponse(response, {
          label: 'Catalog snapshot',
          maxBytes: manifest.snapshot.expandedSizeBytes,
        }),
        readBoundedResponse(digestResponse, {
          label: 'Catalog digest index',
          maxBytes: manifest.digests.expandedSizeBytes,
        }),
        facetResponse ? readBoundedResponse(facetResponse, {
          label: 'Catalog facet index',
          maxBytes: manifest.facets.expandedSizeBytes,
        }) : null,
      ])
      if (await sha256Hex(text) !== manifest.snapshot.sha256) throw new Error('Catalog snapshot checksum does not match its manifest.')
      if (await sha256Hex(digestText) !== manifest.digests.sha256) throw new Error('Catalog digest checksum does not match its manifest.')
      if (facetText && await sha256Hex(facetText) !== manifest.facets.sha256) throw new Error('Catalog facet checksum does not match its manifest.')
      if (this.store.getRegistryState().settings.mode !== 'connected') {
        throw new Error('Connected catalog mode was disabled before activation.')
      }
      return this.activate(JSON.parse(text), {
        mode: 'connected',
        now,
        digestArtifact: JSON.parse(digestText),
        ...(facetText ? { facetArtifact: JSON.parse(facetText) } : {}),
      })
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
