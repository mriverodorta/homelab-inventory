import { agentStatusTiming, resolveAgentStatusState } from '../agents/status-model.mjs'

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const ACTIVE_REGISTRY_STATES = new Set(['linked', 'update-available', 'adoption-available', 'contribution-pending'])

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive safe integer.`)
  return parsed
}

function finitePercent(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : null
}

function compactParts(parts) {
  const normalized = parts.map((part) => String(part ?? '').trim()).filter(Boolean)
  return normalized.length ? normalized.join(' ') : null
}

function formatMemoryCapacity(capacityMib) {
  if (!Number.isFinite(capacityMib) || capacityMib <= 0) return null
  if (capacityMib % 1024 === 0) return `${capacityMib / 1024}GB`
  return `${capacityMib}MiB`
}

function formatStorageCapacity(capacityBytes) {
  if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) return null
  const terabytes = capacityBytes / 1_000_000_000_000
  if (terabytes >= 1) return `${Number(terabytes.toFixed(terabytes >= 10 ? 0 : 1))}TB`
  const gigabytes = capacityBytes / 1_000_000_000
  return `${Number(gigabytes.toFixed(gigabytes >= 10 ? 0 : 1))}GB`
}

function cpuLabel(components) {
  const cpus = components.filter((component) => component.type === 'cpu')
  if (!cpus.length) return null
  const labels = cpus.map((cpu) => cpu.model
    ? compactParts([cpu.manufacturer, cpu.model]) ?? cpu.name
    : cpu.name)
  if (new Set(labels).size === 1 && labels.length > 1) return `${labels.length}x ${labels[0]}`
  return labels.join(', ')
}

function memoryLabel(components) {
  const modules = components.filter((component) => component.type === 'ram')
  if (!modules.length) return null
  const capacity = modules.reduce((total, module) => total + (Number(module.capacityMib) || 0), 0)
  const generations = [...new Set(modules.map((module) => module.memoryGeneration).filter(Boolean))]
  const speeds = modules.map((module) => Number(module.speedMtps)).filter((speed) => Number.isFinite(speed) && speed > 0)
  return compactParts([
    formatMemoryCapacity(capacity),
    generations.length === 1 ? generations[0] : null,
    speeds.length ? `${Math.min(...speeds)}MHz` : null,
  ])
}

function selectStorage(components, telemetry) {
  const devices = components.filter((component) => component.type === 'storage')
  if (!devices.length) return null
  const rootBytes = Number(telemetry?.rootFilesystem?.totalBytes)
  if (!Number.isFinite(rootBytes) || rootBytes <= 0 || devices.length === 1) return devices[0]
  return devices
    .filter((device) => Number(device.capacityBytes) >= rootBytes)
    .sort((left, right) => Number(left.capacityBytes) - Number(right.capacityBytes))[0] ?? devices[0]
}

function storageLabel(components, telemetry) {
  const storage = selectStorage(components, telemetry)
  if (!storage) return null
  return compactParts([
    formatStorageCapacity(Number(storage.capacityBytes)),
    storage.storageInterface,
  ]) ?? storage.name
}

function storagePercent(telemetry) {
  const total = Number(telemetry?.rootFilesystem?.totalBytes)
  const used = Number(telemetry?.rootFilesystem?.usedBytes)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used) || used < 0) return null
  return finitePercent((used / total) * 100)
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function nativeUpdateAvailable(capabilitiesJson) {
  const capabilities = parseObject(capabilitiesJson)
  return capabilities?.['agent.native-update']?.state === 'available'
}

function operatingSystem(system) {
  const name = system?.operatingSystem ?? system?.os ?? null
  const version = system?.osVersion ?? system?.version ?? null
  if (!name) return null
  return compactParts([name, version && !String(name).includes(String(version)) ? version : null])
}

function lanIp(system) {
  const value = system?.lanIp ?? system?.ipAddress ?? null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export class SystemsReadService {
  constructor({ telemetryRepository, releaseService = null, attentionProjector = null, now = () => Date.now() } = {}) {
    this.telemetryRepository = telemetryRepository
    this.releaseService = releaseService
    this.attentionProjector = attentionProjector
    this.now = now
  }

  #hostRows(database, projectId) {
    const project = database.query(`
      SELECT id FROM projects WHERE id = ? AND archived_at_ms IS NULL
    `).get(projectId)
    if (!project) throw new Error(`Active project ${projectId} was not found.`)

    return database.query(`
      SELECT DISTINCT
        item.id AS item_id,
        type.key AS type,
        identity.legacy_id,
        coalesce(override.display_name, item.name) AS name,
        coalesce(manufacturer.name, item.manufacturer_text) AS manufacturer,
        item.model,
        server.hardware_class,
        coalesce(server.usage_role, pc.usage_role) AS usage_role,
        registry.state AS registry_state,
        agent.id AS agent_id,
        agent.agent_version,
        agent.last_seen_at_ms,
        agent.capabilities_json
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      LEFT JOIN inventory_identity_aliases identity ON identity.item_id = item.id
      LEFT JOIN manufacturers manufacturer ON manufacturer.id = item.manufacturer_id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      LEFT JOIN project_inventory_overrides override
        ON override.item_id = item.id AND override.project_id = ?
      LEFT JOIN servers server ON server.id = item.id
      LEFT JOIN pc_builds pc ON pc.id = item.id
      LEFT JOIN registry_links registry ON registry.item_id = item.id
      LEFT JOIN agent_host_bindings binding
        ON binding.host_item_id = item.id AND binding.state = 'active'
      LEFT JOIN agents agent
        ON agent.id = binding.agent_id AND agent.revoked_at_ms IS NULL
      WHERE item.archived_at_ms IS NULL
        AND type.key IN ('server', 'nas', 'pcBuild')
        AND (membership.id IS NOT NULL OR item.owner_project_id = ?)
      ORDER BY lower(coalesce(override.display_name, item.name)), item.id
    `).all(projectId, projectId, projectId)
  }

  #componentRows(database, projectId, hostItemIds) {
    if (!hostItemIds.length) return []
    const placeholders = hostItemIds.map(() => '?').join(', ')
    return database.query(`
      SELECT assignment.id AS assignment_id,
        assignment.host_item_id,
        component.id AS item_id,
        type.key AS type,
        component.name,
        coalesce(manufacturer.name, component.manufacturer_text) AS manufacturer,
        component.model,
        memory.capacity_mib AS capacityMib,
        memory.speed_mtps AS speedMtps,
        memory_generation.label AS memoryGeneration,
        storage.capacity_bytes AS capacityBytes,
        coalesce(storage_interface.label, storage.interface_text) AS storageInterface
      FROM component_assignments assignment
      JOIN inventory_items component ON component.id = assignment.component_item_id
      JOIN inventory_item_types type ON type.id = component.type_id
      LEFT JOIN manufacturers manufacturer ON manufacturer.id = component.manufacturer_id
      LEFT JOIN memory_modules memory ON memory.id = component.id
      LEFT JOIN memory_generations memory_generation ON memory_generation.id = memory.memory_generation_id
      LEFT JOIN storage_devices storage ON storage.id = component.id
      LEFT JOIN storage_interfaces storage_interface ON storage_interface.id = storage.interface_id
      WHERE assignment.project_id = ?
        AND assignment.host_item_id IN (${placeholders})
        AND component.archived_at_ms IS NULL
      ORDER BY assignment.host_item_id, assignment.id
    `).all(projectId, ...hostItemIds)
  }

  #liveHostRows(database, projectId) {
    const project = database.query(`
      SELECT id FROM projects WHERE id = ? AND archived_at_ms IS NULL
    `).get(projectId)
    if (!project) throw new Error(`Active project ${projectId} was not found.`)
    return database.query(`
      SELECT item.id AS item_id,
        agent.id AS agent_id,
        agent.agent_version,
        agent.last_seen_at_ms,
        agent.capabilities_json
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      LEFT JOIN agent_host_bindings binding
        ON binding.host_item_id = item.id AND binding.state = 'active'
      LEFT JOIN agents agent
        ON agent.id = binding.agent_id AND agent.revoked_at_ms IS NULL
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      WHERE item.archived_at_ms IS NULL
        AND type.key IN ('server', 'nas', 'pcBuild')
        AND (membership.id IS NOT NULL OR item.owner_project_id = ?)
      ORDER BY item.id
    `).all(projectId, projectId)
  }

  #snapshot(store, projectId, endpoint, attentionCategories) {
    const id = positiveId(projectId, 'Project ID')
    const hosts = this.#hostRows(store.core.database, id)
    const hostItemIds = hosts.map((host) => host.item_id)
    const boundHostItemIds = hosts.filter((host) => host.agent_id != null).map((host) => host.item_id)
    const components = this.#componentRows(store.core.database, id, hostItemIds)
    const telemetryByHost = this.telemetryRepository?.getSystemsSnapshot(boundHostItemIds) ?? new Map()
    const componentsByHost = new Map()
    for (const component of components) {
      const existing = componentsByHost.get(component.host_item_id) ?? []
      existing.push(component)
      componentsByHost.set(component.host_item_id, existing)
    }
    const timing = agentStatusTiming()
    const currentAgentVersion = this.releaseService?.current().version ?? null
    const attentionByHost = this.attentionProjector?.summaries(store, id, attentionCategories) ?? new Map()

    return {
      projectId: id,
      generatedAt: new Date(this.now()).toISOString(),
      currentAgentVersion,
      systems: hosts.map((host) => {
        if (!HOST_TYPES.has(host.type)) throw new Error(`Unsupported Systems host type ${host.type}.`)
        const registered = host.agent_id != null
        const telemetry = registered ? telemetryByHost.get(host.item_id) ?? null : null
        const lastSeenAt = telemetry?.receivedAt
          ?? (host.last_seen_at_ms == null ? null : new Date(host.last_seen_at_ms).toISOString())
        const { state } = resolveAgentStatusState({
          connected: registered,
          lastSeenAt,
          now: this.now(),
          timing,
        })
        const agentVersion = telemetry?.agentVersion ?? host.agent_version ?? null
        const updateAvailable = Boolean(
          registered
          && agentVersion
          && this.releaseService?.updateAvailable(agentVersion),
        )
        const updateCommand = updateAvailable && endpoint
          ? this.releaseService.upgradeCommands(endpoint, {
              native: nativeUpdateAvailable(host.capabilities_json),
            }).linux
          : undefined
        const assigned = componentsByHost.get(host.item_id) ?? []
        const liveTelemetry = state === 'online' ? telemetry : null
        const legacyId = Number(host.legacy_id ?? host.item_id)
        const attention = attentionByHost.get(host.item_id) ?? null
        return {
          itemId: host.item_id,
          itemKey: `${host.type}:${legacyId}`,
          type: host.type,
          legacyId,
          name: host.name,
          manufacturer: host.manufacturer ?? null,
          model: host.model ?? null,
          hardwareClass: host.hardware_class ?? null,
          usageRole: host.usage_role ?? null,
          cpuLabel: cpuLabel(assigned),
          memoryLabel: memoryLabel(assigned),
          storageLabel: storageLabel(assigned, liveTelemetry),
          operatingSystem: operatingSystem(telemetry?.system),
          lanIp: lanIp(telemetry?.system),
          agentRegistered: registered,
          agentState: state,
          agentVersion,
          agentUpdateAvailable: updateAvailable,
          ...(updateCommand ? { agentUpdateCommand: updateCommand } : {}),
          registryLinked: ACTIVE_REGISTRY_STATES.has(host.registry_state),
          cpuPercent: finitePercent(liveTelemetry?.cpuPercent),
          memoryPercent: finitePercent(liveTelemetry?.memoryPercent),
          storagePercent: storagePercent(liveTelemetry),
          uptimeSeconds: Number.isFinite(liveTelemetry?.uptimeSeconds) ? liveTelemetry.uptimeSeconds : null,
          attentionCount: attention?.totalCount ?? 0,
          attentionState: attention?.state ?? 'refreshing',
          attentionRevision: attention?.revision ?? 0,
        }
      }),
    }
  }

  initial(store, projectId, endpoint, { attentionCategories = null } = {}) {
    return this.#snapshot(store, projectId, endpoint, attentionCategories)
  }

  live(store, projectId, endpoint, { attentionCategories = null } = {}) {
    const id = positiveId(projectId, 'Project ID')
    const hosts = this.#liveHostRows(store.core.database, id)
    const boundHostItemIds = hosts.filter((host) => host.agent_id != null).map((host) => host.item_id)
    const telemetryByHost = this.telemetryRepository?.getSystemsSnapshot(boundHostItemIds) ?? new Map()
    const timing = agentStatusTiming()
    const attentionByHost = this.attentionProjector?.summaries(store, id, attentionCategories) ?? new Map()
    return {
      projectId: id,
      generatedAt: new Date(this.now()).toISOString(),
      systems: hosts.map((host) => {
        const registered = host.agent_id != null
        const telemetry = registered ? telemetryByHost.get(host.item_id) ?? null : null
        const lastSeenAt = telemetry?.receivedAt
          ?? (host.last_seen_at_ms == null ? null : new Date(host.last_seen_at_ms).toISOString())
        const { state } = resolveAgentStatusState({ connected: registered, lastSeenAt, now: this.now(), timing })
        const agentVersion = telemetry?.agentVersion ?? host.agent_version ?? null
        const updateAvailable = Boolean(registered && agentVersion && this.releaseService?.updateAvailable(agentVersion))
        const liveTelemetry = state === 'online' ? telemetry : null
        const attention = attentionByHost.get(host.item_id) ?? null
        return {
          itemId: host.item_id,
          agentRegistered: registered,
          agentState: state,
          agentVersion,
          agentUpdateAvailable: updateAvailable,
          cpuPercent: finitePercent(liveTelemetry?.cpuPercent),
          memoryPercent: finitePercent(liveTelemetry?.memoryPercent),
          storagePercent: storagePercent(liveTelemetry),
          uptimeSeconds: Number.isFinite(liveTelemetry?.uptimeSeconds) ? liveTelemetry.uptimeSeconds : null,
          attentionCount: attention?.totalCount ?? 0,
          attentionState: attention?.state ?? 'refreshing',
          attentionRevision: attention?.revision ?? 0,
        }
      }).filter((host) => host.agentRegistered || host.attentionCount > 0),
    }
  }
}
