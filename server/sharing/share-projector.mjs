import { canonicalShareJson, parseShareManifest, parseShareViewBlob, SHARE_CONTRACT_VERSION, SUPPORTED_VIEW_SCHEMAS } from '../../packages/share-contract/src/index.ts'
import { createHash } from 'node:crypto'
import { sanitizeCustomDefinition, sanitizeLocalOverrides, selectedMetadata } from './privacy-policy.mjs'

function hashCanonical(value) {
  const contentJson = canonicalShareJson(value)
  return { contentJson, contentHash: createHash('sha256').update(contentJson).digest('hex') }
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeSide(value) {
  return ['top', 'right', 'bottom', 'left', 'front', 'back'].includes(value) ? value : undefined
}

function expiration(share) {
  if (share.expirationType === 'duration') return { type: 'duration', durationSeconds: share.expirationDurationSeconds }
  if (share.expirationType === 'at') return { type: 'at', expiresAt: new Date(share.expiresAtMs).toISOString() }
  return { type: 'indefinite' }
}

export class ShareProjector {
  constructor({ publicIds }) {
    this.publicIds = publicIds
  }

  async publicItem(item, context) {
    const publicItemId = await this.publicIds.id('item', item.id)
    const metadata = selectedMetadata(context.metadataByItem?.get(item.id), context.selections)
    const ports = await Promise.all((item.ports ?? []).map(async (port) => ({
      publicPortId: await this.publicIds.id('port', port.id),
      name: String(port.name || `Port ${port.id}`),
      kind: String(port.kind || port.type || 'other'),
      ...(optionalString(port.connector) ? { connector: optionalString(port.connector) } : {}),
      ...(normalizeSide(port.side) ? { side: normalizeSide(port.side) } : {}),
      ...(Number.isSafeInteger(port.speedBps) && port.speedBps >= 0 ? { speedBps: port.speedBps } : {}),
    })))
    const registry = context.registryLinks?.get(item.id)
    const localOverrides = sanitizeLocalOverrides(item.localOverrides)
    const source = registry
      ? {
          type: 'registry',
          registryReference: {
            templateKey: registry.templateKey,
            templateRevision: registry.importedRevision,
            contentHash: registry.importedContentHash,
          },
          ...(Object.keys(localOverrides).length ? { localOverrides } : {}),
        }
      : { type: 'custom', definition: sanitizeCustomDefinition(item) }
    return {
      publicItemId,
      type: item.type,
      name: item.name,
      ...(optionalString(item.manufacturer) ? { manufacturer: optionalString(item.manufacturer) } : {}),
      ...(optionalString(item.model) ? { model: optionalString(item.model) } : {}),
      source,
      ports,
      ...(metadata.tags.length ? {
        tags: await Promise.all(metadata.tags.map(async (tag) => ({
          publicTagId: await this.publicIds.id('tag', tag.id),
          name: tag.name,
          colorToken: tag.colorToken,
        }))),
      } : {}),
      ...(metadata.fields.length ? {
        customFields: await Promise.all(metadata.fields.map(async (field) => ({
          publicFieldId: await this.publicIds.id('field', field.definitionId),
          name: field.name,
          value: field.value,
        }))),
      } : {}),
    }
  }

  async project({ share, project, views, items, registryLinks = new Map(), metadataByItem = new Map(), resourceSnapshots = new Map() }) {
    const selections = {
      fieldDefinitionIds: share.fieldDefinitionIds ?? [],
      tagIds: share.tagIds ?? [],
    }
    const context = { registryLinks, metadataByItem, selections }
    const publicItems = new Map()
    for (const item of items) publicItems.set(item.id, await this.publicItem(item, context))
    const blobs = []
    const descriptors = []

    for (const [sortOrder, view] of views.entries()) {
      const publicViewId = await this.publicIds.id('view', view.workspaceId)
      let blob
      if (view.type === 'systems') {
        const hostIds = view.itemIds ?? items.filter((item) => ['server', 'nas', 'pcBuild'].includes(item.type)).map((item) => item.id)
        blob = {
          shareContractVersion: SHARE_CONTRACT_VERSION,
          viewType: 'systems',
          schemaVersion: SUPPORTED_VIEW_SCHEMAS.systems,
          publicViewId,
          items: hostIds.map((id) => {
            const projected = publicItems.get(id)
            if (!projected) throw new Error(`Systems share references missing item ${id}.`)
            const snapshot = resourceSnapshots.get(id)
            return snapshot ? { ...projected, resourceSnapshot: snapshot } : projected
          }),
        }
      } else if (view.type === 'canvas') {
        const placements = view.placements ?? []
        const visibleIds = new Set(placements.map((placement) => placement.itemId))
        const visibleConnections = (view.connections ?? []).filter((connection) => (
          visibleIds.has(connection.source.itemId) && visibleIds.has(connection.target.itemId)
        ))
        blob = {
          shareContractVersion: SHARE_CONTRACT_VERSION,
          viewType: 'canvas',
          schemaVersion: SUPPORTED_VIEW_SCHEMAS.canvas,
          publicViewId,
          items: [...visibleIds].map((id) => {
            const projected = publicItems.get(id)
            if (!projected) throw new Error(`Canvas share references missing item ${id}.`)
            return projected
          }),
          nodes: await Promise.all(placements.map(async (placement) => ({
            publicNodeId: await this.publicIds.id('node', placement.id),
            publicItemId: await this.publicIds.id('item', placement.itemId),
            ...(placement.parentPlacementId ? { parentPublicNodeId: await this.publicIds.id('node', placement.parentPlacementId) } : {}),
            position: { x: placement.x, y: placement.y },
            size: { width: placement.width, height: placement.height },
            ...(Number.isSafeInteger(placement.zIndex) ? { zIndex: placement.zIndex } : {}),
          }))),
          connections: await Promise.all(visibleConnections.map(async (connection) => ({
            publicConnectionId: await this.publicIds.id('connection', connection.id),
            kind: connection.kind,
            source: {
              publicItemId: await this.publicIds.id('item', connection.source.itemId),
              ...(connection.source.portId ? { publicPortId: await this.publicIds.id('port', connection.source.portId) } : {}),
            },
            target: {
              publicItemId: await this.publicIds.id('item', connection.target.itemId),
              ...(connection.target.portId ? { publicPortId: await this.publicIds.id('port', connection.target.portId) } : {}),
            },
            ...(optionalString(connection.label) ? { label: optionalString(connection.label) } : {}),
            ...(optionalString(connection.color) ? { color: optionalString(connection.color) } : {}),
            route: (connection.route ?? []).map(({ x, y }) => ({ x, y })),
          }))),
          ...(view.viewport ? { viewport: view.viewport } : {}),
        }
      } else {
        throw new Error(`Unsupported share view type ${view.type}.`)
      }
      const parsed = parseShareViewBlob(blob)
      const hashed = hashCanonical(parsed)
      blobs.push({ ...hashed, mediaType: 'application/vnd.homelab-inventory.share-view+json', value: parsed })
      descriptors.push({
        publicViewId,
        type: view.type,
        schemaVersion: SUPPORTED_VIEW_SCHEMAS[view.type],
        contentHash: hashed.contentHash,
        sortOrder,
        name: view.name,
      })
    }

    if (!descriptors.length) throw new Error('A share must contain at least one view.')
    const manifest = parseShareManifest({
      shareContractVersion: SHARE_CONTRACT_VERSION,
      projectPublicId: await this.publicIds.id('project', project.id),
      projectLabel: project.name,
      title: share.title,
      ...(optionalString(share.description) ? { description: share.description } : {}),
      visibility: { type: share.visibility },
      publication: share.mutability === 'immutable'
        ? { type: 'immutable' }
        : { type: 'replaceable', updateMode: share.syncMode },
      expiration: expiration(share),
      comments: { enabled: Boolean(share.commentsEnabled) },
      reactions: { enabled: Boolean(share.reactionsEnabled) },
      embed: share.embed ?? { enabled: false },
      resourceSnapshots: resourceSnapshots.size
        ? { included: true, capturedAt: share.resourceSnapshotCapturedAt }
        : { included: false },
      rendererFeatures: share.rendererFeatures ?? ['workbook-tabs', 'deep-links', 'inspector', 'comments-coming-soon', 'reactions-coming-soon'],
      initialViewPublicId: descriptors[0].publicViewId,
      views: descriptors,
    })
    const manifestBytes = hashCanonical(manifest)
    const uniqueItems = new Map()
    for (const blob of blobs) {
      for (const item of blob.value.items) uniqueItems.set(item.publicItemId, item)
    }
    return {
      manifest,
      manifestJson: manifestBytes.contentJson,
      manifestHash: manifestBytes.contentHash,
      blobs,
      byteLength: Buffer.byteLength(manifestBytes.contentJson) + blobs.reduce((total, blob) => total + Buffer.byteLength(blob.contentJson), 0),
      summary: {
        views: descriptors.length,
        items: uniqueItems.size,
        connections: blobs.reduce((total, blob) => total + (blob.value.connections?.length ?? 0), 0),
        registryReferences: [...uniqueItems.values()].filter((item) => item.source.type === 'registry').length,
        tags: [...uniqueItems.values()].reduce((total, item) => total + (item.tags?.length ?? 0), 0),
        customFields: [...uniqueItems.values()].reduce((total, item) => total + (item.customFields?.length ?? 0), 0),
      },
    }
  }
}
