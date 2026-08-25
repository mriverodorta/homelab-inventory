function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive safe integer.`)
  return parsed
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function itemSize(type) {
  if (type === 'server' || type === 'nas' || type === 'pcBuild') return { width: 300, height: 180 }
  if (type === 'switch' || type === 'patchPanel') return { width: 300, height: 120 }
  return { width: 240, height: 120 }
}

function routePoints(value) {
  const payload = parseObject(value)
  const candidates = payload.result?.route?.points ?? payload.route?.points ?? payload.points ?? []
  if (!Array.isArray(candidates)) return []
  return candidates.flatMap((point) => {
    if (Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite)) return [{ x: point[0], y: point[1] }]
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return [{ x: point.x, y: point.y }]
    return []
  })
}

export function createSharingSourceProvider(store) {
  if (!store?.core?.database) throw new Error('Sharing source provider requires the SQLite application store.')
  const database = store.core.database

  return async function sharingSource(configuration) {
    const projectId = positiveId(configuration.share.projectId, 'Share project ID')
    const workbook = store.getProjectWorkbook(projectId)
    const defaultWorkspace = workbook.workspaces.find(({ id }) => id === workbook.defaultWorkspaceId)
    const canvasWorkspace = defaultWorkspace?.type === 'canvas'
      ? defaultWorkspace
      : workbook.workspaces.find(({ type }) => type === 'canvas')
    if (!canvasWorkspace) throw new Error(`Project ${projectId} has no shareable Canvas workspace.`)
    const base = store.getWorkspace(projectId, canvasWorkspace.id)
    const canonicalRows = database.query(`
      SELECT alias.item_id, alias.legacy_type_key, alias.legacy_id,
        item.extensions_json
      FROM inventory_identity_aliases alias
      JOIN inventory_items item ON item.id = alias.item_id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      WHERE item.archived_at_ms IS NULL
        AND (membership.id IS NOT NULL OR item.owner_project_id = ?)
      ORDER BY alias.item_id
    `).all(projectId, projectId)
    const canonicalByRuntime = new Map(canonicalRows.map((row) => [`${row.legacy_type_key}:${row.legacy_id}`, row]))
    const ports = database.query(`
      SELECT port.id, port.item_id, alias.legacy_port_id
      FROM inventory_ports port
      JOIN port_identity_aliases alias ON alias.port_id = port.id
      JOIN inventory_items item ON item.id = port.item_id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = port.item_id AND membership.project_id = ?
      WHERE membership.id IS NOT NULL OR item.owner_project_id = ?
      ORDER BY port.id
    `).all(projectId, projectId)
    const portsByItem = Map.groupBy(ports, (port) => port.item_id)
    const items = canonicalRows.map((row) => {
      const runtime = base.items[`${row.legacy_type_key}:${row.legacy_id}`]
      if (!runtime) throw new Error(`Share inventory item ${row.legacy_type_key}:${row.legacy_id} is unavailable.`)
      const runtimePorts = new Map((runtime.ports ?? []).map((port) => [Number(port.id), port]))
      return {
        ...runtime,
        ...parseObject(row.extensions_json),
        id: row.item_id,
        ports: (portsByItem.get(row.item_id) ?? []).map((port) => ({
          ...(runtimePorts.get(port.legacy_port_id) ?? {}),
          id: port.id,
        })),
      }
    })

    const registryLinks = new Map(database.query(`
      SELECT item_id AS itemId, template_key AS templateKey,
        imported_revision AS importedRevision,
        imported_content_hash AS importedContentHash
      FROM registry_links
      WHERE item_id IN (
        SELECT item.id FROM inventory_items item
        LEFT JOIN project_inventory_memberships membership
          ON membership.item_id = item.id AND membership.project_id = ?
        WHERE membership.id IS NOT NULL OR item.owner_project_id = ?
      )
      ORDER BY item_id
    `).all(projectId, projectId).map((link) => [link.itemId, link]))

    const metadataByItem = new Map()
    for (const [runtimeKey, canonical] of canonicalByRuntime) {
      const [type, legacyId] = runtimeKey.split(':')
      const metadata = store.getInventoryItemMetadata({ type, id: Number(legacyId) })
      const definitions = new Map((metadata.definitions ?? []).map((definition) => [definition.id, definition]))
      metadataByItem.set(canonical.item_id, {
        tags: metadata.tags ?? [],
        customFields: (metadata.values ?? []).map((value) => {
          const definition = definitions.get(value.definitionId)
          if (!definition) throw new Error(`Custom field definition ${value.definitionId} is unavailable.`)
          const optionLabels = new Map((definition.options ?? []).map((option) => [option.id, option.label]))
          return {
            definitionId: value.definitionId,
            name: definition.name,
            value: value.optionIds?.length
              ? value.optionIds.map((id) => optionLabels.get(id)).filter(Boolean)
              : value.value,
          }
        }),
      })
    }

    const views = configuration.views.map((selection) => {
      const descriptor = workbook.workspaces.find(({ id }) => id === selection.workspaceId)
      if (!descriptor || descriptor.type !== selection.viewType) throw new Error(`Selected workspace ${selection.workspaceId} is unavailable.`)
      if (selection.viewType === 'systems') {
        return {
          workspaceId: descriptor.id,
          type: 'systems',
          name: descriptor.name,
          itemIds: items.filter(({ type }) => ['server', 'nas', 'pcBuild'].includes(type)).map(({ id }) => id),
        }
      }
      const placements = database.query(`
        SELECT id, item_id AS itemId, x, y, z_index AS zIndex
        FROM workspace_placements
        WHERE project_id = ? AND workspace_id = ? ORDER BY id
      `).all(projectId, descriptor.id).map((placement) => ({
        ...placement,
        ...itemSize(items.find(({ id }) => id === placement.itemId)?.type),
      }))
      const connections = database.query(`
        SELECT connection.id, connection.connection_type AS kind, connection.label,
          source_port.item_id AS sourceItemId, source.port_id AS sourcePortId,
          target_port.item_id AS targetItemId, target.port_id AS targetPortId,
          cache.route_payload_json AS routePayloadJson
        FROM project_connections connection
        JOIN connection_endpoints source ON source.connection_id = connection.id AND source.role = 'source'
        JOIN inventory_ports source_port ON source_port.id = source.port_id
        JOIN connection_endpoints target ON target.connection_id = connection.id AND target.role = 'target'
        JOIN inventory_ports target_port ON target_port.id = target.port_id
        LEFT JOIN workspace_connection_visibility visibility
          ON visibility.workspace_id = ? AND visibility.connection_id = connection.id
        LEFT JOIN workspace_route_cache cache
          ON cache.workspace_id = ? AND cache.connection_id = connection.id
        WHERE connection.project_id = ? AND connection.workspace_id = ?
          AND coalesce(visibility.visible, 1) = 1
        ORDER BY connection.id
      `).all(descriptor.id, descriptor.id, projectId, descriptor.id).map((connection) => ({
        id: connection.id,
        kind: connection.kind,
        label: connection.label,
        source: { itemId: connection.sourceItemId, portId: connection.sourcePortId },
        target: { itemId: connection.targetItemId, portId: connection.targetPortId },
        route: routePoints(connection.routePayloadJson),
      }))
      const canvas = store.getWorkspace(projectId, descriptor.id)
      return {
        workspaceId: descriptor.id,
        type: 'canvas',
        name: descriptor.name,
        placements,
        connections,
        viewport: {
          x: Number(canvas.metadata?.viewport?.x ?? 0),
          y: Number(canvas.metadata?.viewport?.y ?? 0),
          zoom: Number(canvas.metadata?.viewport?.zoom ?? 1),
        },
      }
    })

    const resourceSnapshots = new Map()
    let resourceSnapshotCapturedAt
    if (configuration.share.resourceSnapshotIncluded) {
      const rows = database.query(`
        SELECT snapshot.payload_json AS payloadJson, snapshot.captured_at_ms AS capturedAtMs
        FROM share_resource_snapshots snapshot
        JOIN (
          SELECT share_id, max(captured_at_ms) AS capturedAtMs
          FROM share_resource_snapshots WHERE share_id = ? GROUP BY share_id
        ) latest ON latest.share_id = snapshot.share_id AND latest.capturedAtMs = snapshot.captured_at_ms
        WHERE snapshot.share_id = ? ORDER BY snapshot.id DESC LIMIT 1
      `).all(configuration.share.id, configuration.share.id)
      for (const row of rows) {
        resourceSnapshotCapturedAt = new Date(row.capturedAtMs).toISOString()
        const payload = JSON.parse(row.payloadJson)
        for (const item of payload.items ?? []) resourceSnapshots.set(positiveId(item.itemId, 'Resource snapshot item ID'), item.snapshot)
      }
    }

    return {
      share: {
        ...configuration.share,
        fieldDefinitionIds: configuration.fieldDefinitionIds,
        tagIds: configuration.tagIds,
        embed: configuration.share.embedEnabled
          ? {
              enabled: true,
              origins: configuration.share.embedOrigins.length
                ? { type: 'allowlist', origins: configuration.share.embedOrigins }
                : { type: 'any' },
            }
          : { enabled: false },
        resourceSnapshotCapturedAt,
      },
      project: { id: workbook.project.id, name: workbook.project.name },
      views,
      items,
      registryLinks,
      metadataByItem,
      resourceSnapshots,
    }
  }
}

export function createSharingResourceSnapshotProvider({ store, telemetryRepository, publicIds, now = Date.now }) {
  if (!store?.core?.database || !telemetryRepository || !publicIds) return null
  const database = store.core.database
  return async function captureResourceSnapshot(configuration) {
    if (!configuration) throw new Error('Share configuration is unavailable.')
    const projectId = positiveId(configuration.share.projectId, 'Share project ID')
    const defaultWorkspaceId = store.getProjectWorkbook(projectId).defaultWorkspaceId
    const hosts = database.query(`
      SELECT item.id
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      WHERE item.archived_at_ms IS NULL
        AND type.key IN ('server', 'nas', 'pcBuild')
        AND (membership.id IS NOT NULL OR item.owner_project_id = ?)
      ORDER BY item.id
    `).all(projectId, projectId)
    const telemetry = telemetryRepository.getSystemsSnapshot(hosts.map(({ id }) => id))
    const capturedAtMs = now()
    const items = []
    for (const { id: itemId } of hosts) {
      const current = telemetry.get(itemId)
      if (!current?.receivedAt) continue
      const snapshot = { capturedAt: current.receivedAt }
      if (finitePercentage(current.cpuPercent) != null) snapshot.cpu = { usagePercent: finitePercentage(current.cpuPercent) }
      const memory = memorySnapshot(current.memory)
      if (memory) snapshot.memory = memory
      const root = filesystemSnapshot(current.rootFilesystem)
      if (root) {
        const storage = database.query(`
          SELECT component.id, component.name
          FROM component_assignments assignment
          JOIN inventory_items component ON component.id = assignment.component_item_id
          JOIN inventory_item_types type ON type.id = component.type_id AND type.key = 'storage'
          WHERE assignment.project_id = ? AND assignment.workspace_id = ?
            AND assignment.host_item_id = ?
            AND component.archived_at_ms IS NULL
          ORDER BY assignment.id LIMIT 1
        `).get(projectId, defaultWorkspaceId, itemId)
        if (storage) snapshot.storage = [{
          publicStorageId: await publicIds.id('item', storage.id),
          name: storage.name,
          totalBytes: root.totalBytes,
          usedBytes: root.usedBytes,
        }]
      }
      if (snapshot.cpu || snapshot.memory || snapshot.storage) items.push({ itemId, snapshot })
    }
    const payload = { items }
    const bytes = canonicalShareJson(payload)
    return {
      payload,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      capturedAtMs,
    }
  }
}

function nonNegativeInteger(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function finitePercentage(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null
}

function memorySnapshot(value) {
  const totalBytes = nonNegativeInteger(value?.totalBytes)
  const availableBytes = nonNegativeInteger(value?.availableBytes)
  if (totalBytes == null || totalBytes === 0 || availableBytes == null || availableBytes > totalBytes) return null
  const usedBytes = nonNegativeInteger(value?.usedBytes) ?? totalBytes - availableBytes
  return {
    totalBytes,
    usedBytes: Math.min(usedBytes, totalBytes),
    availableBytes,
    ...(nonNegativeInteger(value?.buffersBytes) == null ? {} : { buffersBytes: nonNegativeInteger(value.buffersBytes) }),
    ...(nonNegativeInteger(value?.cachedBytes) == null ? {} : { cacheBytes: nonNegativeInteger(value.cachedBytes) }),
    ...(nonNegativeInteger(value?.sharedBytes) == null ? {} : { sharedBytes: nonNegativeInteger(value.sharedBytes) }),
  }
}

function filesystemSnapshot(value) {
  const totalBytes = nonNegativeInteger(value?.totalBytes)
  const usedBytes = nonNegativeInteger(value?.usedBytes)
  if (totalBytes == null || totalBytes === 0 || usedBytes == null) return null
  return { totalBytes, usedBytes: Math.min(usedBytes, totalBytes) }
}
import { createHash } from 'node:crypto'
import { canonicalShareJson } from '../../packages/share-contract/src/index.ts'
