import type { Database } from 'bun:sqlite'
import { INVENTORY_TYPES, type InventoryType } from '../core/inventory/field-contract.ts'
import { catalogItemForLegacyView } from '../core/inventory/catalog-view.ts'
import { toBitsPerSecond, toBytes, toMhz, toMib, toMillihertz, toMillimeters, toMillivoltAmps, toMilliwatts, toMillivolts } from '../core/inventory/units.ts'
import {
  LEGACY_TABLE_BY_TYPE,
  legacyResourceDefinitions,
  type CanonicalIdentityPlan,
} from '../legacy/identity-plan.ts'
import { persistAuthenticationState } from '../core/projections/legacy-domains.ts'

type LegacySnapshot = Record<string, any>
type LegacyRecord = Record<string, any>

export type ImportLegacyCoreOptions = Readonly<{
  database: Database
  snapshot: LegacySnapshot
  identityPlan: CanonicalIdentityPlan
}>

export type InsertLegacyInventoryItemOptions = Readonly<{
  database: Database
  projectId: number
  type: InventoryType
  item: LegacyRecord
  scope?: 'global' | 'project'
  ownerProjectId?: number | null
  now?: number
}>

export type ReplaceLegacyInventoryItemOptions = Readonly<{
  database: Database
  projectId: number
  type: InventoryType
  item: LegacyRecord
  itemId: number
  now?: number
}>

function records(value: unknown): LegacyRecord[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function timestamp(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function booleanOrNull(value: unknown) {
  return typeof value === 'boolean' ? Number(value) : null
}

function integerOrNull(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function positiveIntegerOrNull(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function canonicalMeasurement(
  canonical: unknown,
  legacy: unknown,
  convertLegacy: (value: number) => number,
  path: string,
) {
  const canonicalValue = canonical == null ? null : integerOrNull(canonical)
  if (canonical != null && canonicalValue === null) throw new Error(`${path} must be a non-negative safe integer.`)
  const legacyValue = legacy == null ? null : convertLegacy(Number(legacy))
  if (canonicalValue !== null && legacyValue !== null && canonicalValue !== legacyValue) {
    throw new Error(`${path} conflicts with its legacy representation.`)
  }
  return canonicalValue ?? legacyValue
}

function json(value: unknown) {
  return JSON.stringify(value ?? {})
}

function normalizeKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_]+/gu, '-').replace(/[^a-z0-9.+-]/gu, '')
}

function itemKey(type: unknown, id: unknown) {
  if (typeof type !== 'string' || !Number.isSafeInteger(id) || Number(id) <= 0) {
    throw new Error('Legacy inventory reference is invalid.')
  }
  return `${type}:${Number(id)}`
}

function canonicalItemId(plan: CanonicalIdentityPlan, type: unknown, id: unknown) {
  const key = itemKey(type, id)
  const result = plan.items.get(key)
  if (!result) throw new Error(`Legacy inventory reference ${key} has no canonical identity.`)
  return result
}

function vocabularyId(database: Database, table: string, value: unknown) {
  const key = normalizeKey(value)
  if (!key) return null
  const aliases: Record<string, string> = {
    'so-dimm': 'sodimm', 'm.2-2230': 'm2-2230', '2230': 'm2-2230',
    'm.2-2242': 'm2-2242', '2242': 'm2-2242', 'm.2-2260': 'm2-2260', '2260': 'm2-2260',
    'm.2-2280': 'm2-2280', '2280': 'm2-2280', 'm.2-22110': 'm2-22110', '22110': 'm2-22110',
    '2.5': '2.5-inch', '2.5-inch': '2.5-inch', '3.5': '3.5-inch', '3.5-inch': '3.5-inch',
    'slim-tip': 'slim-tip', 'slimtip': 'slim-tip',
  }
  const canonicalKey = aliases[key] ?? key
  const existing = database.query(`SELECT id FROM ${table} WHERE key = ?`).get(canonicalKey) as { id: number } | null
  if (existing) return existing.id
  const nextSortOrder = Number((database.query(`SELECT coalesce(max(sort_order), 0) + 1 AS value FROM ${table}`).get() as { value: number }).value)
  return Number((database.query(`INSERT INTO ${table} (key, label, sort_order) VALUES (?, ?, ?) RETURNING id`).get(
    canonicalKey,
    optionalText(value) ?? canonicalKey,
    nextSortOrder,
  ) as { id: number }).id)
}

function speedBps(value: unknown) {
  if (typeof value === 'number') return toBitsPerSecond({ value, unit: 'Mbps' })
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(G|M)?(?:BPS)?$/iu)
  if (!match) return null
  return toBitsPerSecond({ value: Number(match[1]), unit: match[2]?.toUpperCase() === 'G' ? 'Gbps' : 'Mbps' })
}

function connectionType(value: unknown): 'network' | 'display' | 'power' | 'other' {
  return value === 'network' || value === 'display' || value === 'power' ? value : 'other'
}

function portKind(port: LegacyRecord) {
  const connector = normalizeKey(port.type)
  if (connector === 'ac-input') return 'power-input'
  if (connector === 'ac-outlet') return 'power-output'
  if (connector === 'displayport' || connector === 'hdmi') return 'video'
  if (normalizeKey(port.kind).includes('management')) return 'management'
  return 'network'
}

function connectorType(port: LegacyRecord) {
  const key = normalizeKey(port.type)
  if (key === 'ac-input') return 'iec-c14'
  if (key === 'ac-outlet') return 'iec-c13'
  return key
}

function portRole(value: unknown) {
  if (['access', 'trunk', 'uplink', 'management', 'disabled'].includes(String(value))) return value
  return String(value).includes('management') ? 'management' : null
}

function extensionPayload(item: LegacyRecord) {
  const legacyView = catalogItemForLegacyView(item)
  const common = new Set(['id', 'type', 'name', 'aliases', 'manufacturer', 'secondaryManufacturer', 'model', 'family', 'number', 'subtype', 'properties', 'compatibility', 'fixedComponents', 'notes', 'archivedAt', 'ports', 'specs', 'hardwareClass', 'usageRole', 'smart'])
  const unknown = Object.fromEntries(Object.entries(item).filter(([key]) => !common.has(key)))
  const payload: Record<string, unknown> = {}
  if (Object.keys(unknown).length) payload.legacyFields = unknown
  if (legacyView.specs && Object.keys(legacyView.specs).length) payload.legacySpecs = legacyView.specs
  if (legacyView.compatibility && Object.keys(legacyView.compatibility).length) payload.catalogCompatibility = legacyView.compatibility
  return payload
}

function ensureManufacturer(database: Database, value: unknown, now: number) {
  const name = optionalText(value)
  if (!name) return null
  const normalized = name.toLocaleLowerCase('en-US').replace(/\s+/gu, ' ')
  const existing = database.query('SELECT id FROM manufacturers WHERE normalized_name = ?').get(normalized) as { id: number } | null
  if (existing) return existing.id
  return Number((database.query(`
    INSERT INTO manufacturers (name, normalized_name, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?) RETURNING id
  `).get(name, normalized, now, now) as { id: number }).id)
}

function insertSubtype(database: Database, type: InventoryType, itemId: number, item: LegacyRecord) {
  const specs = item.specs ?? {}
  switch (type) {
    case 'server': {
      const chassisId = vocabularyId(database, 'chassis_types', specs.formFactor)
      database.query(`INSERT INTO servers (id, hardware_class, usage_role, chassis_type_id, form_factor_text, network_slot, wireless) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(itemId, item.hardwareClass ?? 'server', item.usageRole ?? 'server', chassisId, chassisId ? null : optionalText(specs.formFactor), optionalText(specs.networkSlot), optionalText(specs.wireless))
      break
    }
    case 'nas': {
      const powerConfiguration = item.compatibility?.host?.power?.configuration ?? specs.powerConfiguration
      database.query(`
        INSERT INTO nas_systems (
          id, drive_bay_count, m2_slot_count, power_configuration, form_factor_text,
          platform_family, variant_key, hardware_revision, board_revision, release_date_text,
          discontinued, width_mm, height_mm, depth_mm, mass_grams, rack_units
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        itemId,
        integerOrNull(specs.driveBays),
        integerOrNull(specs.m2Slots),
        powerConfiguration === 'external-adapter' ? 'external-adapter' : 'internal-psu',
        optionalText(specs.formFactor),
        optionalText(specs.platformFamily),
        optionalText(specs.variantKey),
        optionalText(specs.hardwareRevision),
        optionalText(specs.boardRevision),
        optionalText(specs.releaseDate),
        booleanOrNull(specs.discontinued),
        integerOrNull(specs.widthMm),
        integerOrNull(specs.heightMm),
        integerOrNull(specs.depthMm),
        integerOrNull(specs.massGrams),
        positiveIntegerOrNull(specs.rackUnits),
      )
      break
    }
    case 'pcBuild': database.query('INSERT INTO pc_builds (id, operating_system, usage_role) VALUES (?, ?, ?)').run(itemId, optionalText(specs.operatingSystem), optionalText(specs.role)); break
    case 'cpu': database.query('INSERT INTO cpus (id, core_count, thread_count, base_clock_mhz, boost_clock_mhz) VALUES (?, ?, ?, ?, ?)').run(itemId, positiveIntegerOrNull(specs.cores), positiveIntegerOrNull(specs.threads), canonicalMeasurement(specs.baseClockMhz, specs.baseClockGhz, (value) => toMhz({ value, unit: 'GHz' }), 'specs.baseClockMhz'), canonicalMeasurement(specs.boostClockMhz, specs.boostClockGhz, (value) => toMhz({ value, unit: 'GHz' }), 'specs.boostClockMhz')); break
    case 'ram': database.query('INSERT INTO memory_modules (id, capacity_mib, memory_generation_id, speed_mtps, form_factor, module_type_id, ecc, rank, voltage_mv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(itemId, canonicalMeasurement(specs.capacityMib, specs.capacityGb, (value) => toMib({ value, unit: 'GiB' }), 'specs.capacityMib'), vocabularyId(database, 'memory_generations', specs.generation), integerOrNull(specs.speedMt), optionalText(specs.formFactor), vocabularyId(database, 'memory_module_types', specs.moduleType), booleanOrNull(specs.ecc), optionalText(specs.rank), canonicalMeasurement(specs.voltageMv, specs.voltageVolts, (value) => toMillivolts({ value, unit: 'V' }), 'specs.voltageMv')); break
    case 'storage': {
      const interfaceId = vocabularyId(database, 'storage_interfaces', specs.interface)
      const formFactorId = vocabularyId(database, 'storage_form_factors', specs.formFactor)
      const legacyCapacity = specs.capacityTb != null ? toBytes({ value: specs.capacityTb, unit: 'TB' }) : specs.capacityGb != null ? toBytes({ value: specs.capacityGb, unit: 'GB' }) : null
      const capacityBytes = canonicalMeasurement(specs.capacityBytes, legacyCapacity, (value) => value, 'specs.capacityBytes')
      database.query('INSERT INTO storage_devices (id, capacity_bytes, interface_id, form_factor_id, interface_text, form_factor_text, partition_table) VALUES (?, ?, ?, ?, ?, ?, ?)').run(itemId, capacityBytes, interfaceId, formFactorId, interfaceId ? null : optionalText(specs.interface), formFactorId ? null : optionalText(specs.formFactor), optionalText(specs.partitionTable))
      break
    }
    case 'gpu': database.query('INSERT INTO graphics_cards (id, vram_mib, form_factor, slot_width, pcie) VALUES (?, ?, ?, ?, ?)').run(itemId, canonicalMeasurement(specs.vramMib, specs.vramGb, (value) => toMib({ value, unit: 'GiB' }), 'specs.vramMib'), optionalText(specs.formFactor), optionalText(specs.slotWidth), optionalText(specs.pcie)); break
    case 'network': database.query('INSERT INTO network_cards (id, port_count, max_speed_bps, interface, form_factor) VALUES (?, ?, ?, ?, ?)').run(itemId, integerOrNull(specs.ports), canonicalMeasurement(specs.maxSpeedBps, specs.speedMbps, (value) => toBitsPerSecond({ value, unit: 'Mbps' }), 'specs.maxSpeedBps'), optionalText(specs.interface), optionalText(specs.formFactor)); break
    case 'motherboard': database.query('INSERT INTO motherboards (id, chipset, form_factor, board_revision, launch_date_text, discontinued, wifi_generation, bluetooth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(itemId, optionalText(specs.chipset), optionalText(specs.formFactor), optionalText(specs.boardRevision), optionalText(specs.launchDate), booleanOrNull(specs.discontinued), optionalText(specs.wifiGeneration), optionalText(specs.bluetooth)); break
    case 'cpuCooler': database.query('INSERT INTO cpu_coolers (id, cooler_type) VALUES (?, ?)').run(itemId, optionalText(specs.coolerType)); break
    case 'case': database.query('INSERT INTO computer_cases (id) VALUES (?)').run(itemId); for (const factor of records(specs.formFactors)) database.query('INSERT INTO case_form_factor_support (case_id, form_factor) VALUES (?, ?)').run(itemId, String(factor)); break
    case 'powerSupply': {
      database.query('INSERT INTO power_supplies (id, form_factor, rated_power_mw, efficiency_rating) VALUES (?, ?, ?, ?)').run(itemId, optionalText(specs.formFactor), canonicalMeasurement(specs.ratedPowerMw, specs.wattageWatts, (value) => toMilliwatts({ value, unit: 'W' }), 'specs.ratedPowerMw'), optionalText(specs.efficiency))
      for (const connector of records(specs.connectors)) database.query('INSERT INTO power_supply_connectors (power_supply_id, connector_type_id, connector_text, count) VALUES (?, ?, ?, ?)').run(itemId, vocabularyId(database, 'power_connector_types', connector.type ?? connector.connector), vocabularyId(database, 'power_connector_types', connector.type ?? connector.connector) ? null : optionalText(connector.type ?? connector.connector), positiveIntegerOrNull(connector.count) ?? 1)
      break
    }
    case 'soundCard': database.query('INSERT INTO sound_cards (id, interface) VALUES (?, ?)').run(itemId, optionalText(specs.interface)); break
    case 'wireless': database.query('INSERT INTO wireless_cards (id, interface, wifi_generation, bluetooth) VALUES (?, ?, ?, ?)').run(itemId, optionalText(specs.interface), optionalText(specs.wifiGeneration), booleanOrNull(specs.bluetooth)); break
    case 'powerAdapter': database.query('INSERT INTO power_adapters (id, rated_power_mw, connector_type_id, connector_text) VALUES (?, ?, ?, ?)').run(itemId, canonicalMeasurement(specs.ratedPowerMw, specs.wattageWatts, (value) => toMilliwatts({ value, unit: 'W' }), 'specs.ratedPowerMw'), vocabularyId(database, 'power_connector_types', specs.connector), vocabularyId(database, 'power_connector_types', specs.connector) ? null : optionalText(specs.connector)); break
    case 'switch': database.query('INSERT INTO network_switches (id, management_type, switching_capacity_bps, fanless) VALUES (?, ?, ?, ?)').run(itemId, optionalText(specs.management), canonicalMeasurement(specs.switchingCapacityBps, specs.switchingCapacityGbps, (value) => toBitsPerSecond({ value, unit: 'Gbps' }), 'specs.switchingCapacityBps'), Number(specs.fanless === true)); break
    case 'patchPanel': database.query('INSERT INTO patch_panels (id, rack_units, mount) VALUES (?, ?, ?)').run(itemId, integerOrNull(specs.rackUnits), optionalText(specs.mount)); break
    case 'monitor': database.query('INSERT INTO monitors (id, diagonal_mm, diagonal_source_text, resolution, refresh_rate_millihz) VALUES (?, ?, ?, ?, ?)').run(itemId, canonicalMeasurement(specs.diagonalMm, specs.sizeInches, (value) => toMillimeters({ value, unit: 'in' }), 'specs.diagonalMm'), optionalText(specs.diagonalSourceText) ?? (specs.sizeInches == null ? null : `${specs.sizeInches} in`), optionalText(specs.resolution), canonicalMeasurement(specs.refreshRateMillihz, specs.refreshRateHz, (value) => toMillihertz({ value, unit: 'Hz' }), 'specs.refreshRateMillihz')); break
    case 'ups': database.query('INSERT INTO ups_systems (id, rated_power_mw, capacity_millivolt_amps, battery_outlet_count, surge_outlet_count, outlet_count) VALUES (?, ?, ?, ?, ?, ?)').run(itemId, canonicalMeasurement(specs.ratedPowerMw, specs.wattageWatts, (value) => toMilliwatts({ value, unit: 'W' }), 'specs.ratedPowerMw'), canonicalMeasurement(specs.capacityMillivoltAmps, specs.capacityVa, (value) => toMillivoltAmps({ value, unit: 'VA' }), 'specs.capacityMillivoltAmps'), integerOrNull(specs.batteryBackupOutlets), integerOrNull(specs.surgeProtectedOutlets), integerOrNull(specs.outlets)); break
    case 'powerStrip': database.query('INSERT INTO power_strips (id, outlet_count, surge_protected, surge_outlet_count) VALUES (?, ?, ?, ?)').run(itemId, integerOrNull(specs.outlets), booleanOrNull(specs.surgeProtected), integerOrNull(specs.surgeProtectedOutlets)); break
  }
}

function importCompatibility(database: Database, itemId: number, item: LegacyRecord, now: number, plan: CanonicalIdentityPlan, type: InventoryType) {
  const host = item.compatibility?.host
  if (!host || typeof host !== 'object') return
  const profile = database.query(`INSERT INTO host_compatibility_profiles (host_item_id, topology_completeness, max_expansion_power_mw, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .get(itemId, optionalText(host.topologyCompleteness), canonicalMeasurement(host.maxExpansionPowerMw, host.maxExpansionPowerWatts, (value) => toMilliwatts({ value, unit: 'W' }), 'compatibility.host.maxExpansionPowerMw'), now, now) as { id: number }
  if (host.cpu) {
    const cpu = database.query('INSERT INTO host_cpu_profiles (host_profile_id, socket_count, max_tdp_mw) VALUES (?, ?, ?) RETURNING id').get(profile.id, positiveIntegerOrNull(host.cpu.socketCount ?? host.cpu.socketsCount), canonicalMeasurement(host.cpu.maxTdpMw, host.cpu.maxTdpWatts, (value) => toMilliwatts({ value, unit: 'W' }), 'compatibility.host.cpu.maxTdpMw')) as { id: number }
    for (const socket of records(host.cpu.sockets)) { const id = vocabularyId(database, 'cpu_socket_types', socket); if (id) database.query('INSERT INTO host_cpu_socket_support (cpu_profile_id, socket_type_id) VALUES (?, ?)').run(cpu.id, id) }
    for (const generation of records(host.cpu.generations)) database.query('INSERT INTO host_cpu_generation_support (cpu_profile_id, generation) VALUES (?, ?)').run(cpu.id, String(generation))
    for (const count of records(host.cpu.populationModes)) {
      const populatedSocketCount = positiveIntegerOrNull(count)
      if (populatedSocketCount) database.query('INSERT INTO host_cpu_population_modes (cpu_profile_id, populated_socket_count) VALUES (?, ?)').run(cpu.id, populatedSocketCount)
    }
  }
  if (host.memory) {
    const memory = database.query(`
      INSERT INTO host_memory_profiles (
        host_profile_id, slot_count, slots_per_cpu, max_capacity_mib, max_module_capacity_mib,
        oem_max_capacity_mib, oem_max_module_capacity_mib,
        verified_max_capacity_mib, verified_max_module_capacity_mib,
        max_speed_mtps, ecc_support
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).get(
      profile.id,
      integerOrNull(host.memory.slots),
      integerOrNull(host.memory.slotsPerCpu),
      canonicalMeasurement(host.memory.maxCapacityMib, host.memory.maxCapacityGb, (value) => toMib({ value, unit: 'GiB' }), 'compatibility.host.memory.maxCapacityMib'),
      canonicalMeasurement(host.memory.maxModuleCapacityMib, host.memory.maxModuleCapacityGb, (value) => toMib({ value, unit: 'GiB' }), 'compatibility.host.memory.maxModuleCapacityMib'),
      integerOrNull(host.memory.oemMaxCapacityMib),
      integerOrNull(host.memory.oemMaxModuleCapacityMib),
      integerOrNull(host.memory.verifiedMaxCapacityMib),
      integerOrNull(host.memory.verifiedMaxModuleCapacityMib),
      integerOrNull(host.memory.maxSpeedMt),
      optionalText(host.memory.eccSupport),
    ) as { id: number }
    for (const generation of records(host.memory.generations)) { const id = vocabularyId(database, 'memory_generations', generation); if (id) database.query('INSERT INTO host_memory_generation_support (memory_profile_id, generation_id) VALUES (?, ?)').run(memory.id, id) }
    for (const formFactor of records(host.memory.formFactors)) database.query('INSERT INTO host_memory_form_factor_support (memory_profile_id, form_factor) VALUES (?, ?)').run(memory.id, String(formFactor))
    for (const moduleType of records(host.memory.moduleTypes)) { const id = vocabularyId(database, 'memory_module_types', moduleType); if (id) database.query('INSERT INTO host_memory_module_type_support (memory_profile_id, module_type_id) VALUES (?, ?)').run(memory.id, id) }
  }
  const definitions = legacyResourceDefinitions(item)
  const typedCollections = new Map<string, { entry: LegacyRecord; resourceType: string }>()
  for (const [prefix, collection, resourceType] of [
    ['storage', host.storageSlots, 'storage'],
    ['expansion', host.expansionSlots, 'expansion'],
    ['optional', host.optionalModuleSlots, 'optionalModule'],
    ['controller', host.controllerSlots, 'controllerSlot'],
    ['boot', host.bootDeviceSlots, 'bootDeviceSlot'],
    ['cooling', host.coolingProfiles, 'coolingProfile'],
    ['power-connector', host.powerConnectors, 'power'],
  ] as const) {
    records(collection).forEach((entry, index) => typedCollections.set(
      String(entry.key ?? `${prefix}-${index + 1}`),
      { entry, resourceType },
    ))
  }
  const groupByTypedId = new Map<string, number>()
  for (const definition of definitions) {
    const typed = typedCollections.get(definition.key)
    if (!typed || !Number.isSafeInteger(typed.entry.id)) continue
    const resourceIdentityId = plan.resourceGroups.get(`${type}:${item.id}:resource:${definition.key}`)
    if (resourceIdentityId) groupByTypedId.set(`${typed.resourceType}:${typed.entry.id}`, resourceIdentityId)
  }
  const storageControllerRelations: Array<{ storageId: number; controllerId: number }> = []
  const bootControllerRelations: Array<{ bootId: number; controllerId: number }> = []
  for (const definition of definitions) {
    const groupKey = `${type}:${item.id}:resource:${definition.key}`
    const resourceIdentityId = plan.resourceGroups.get(groupKey)
    if (!resourceIdentityId) throw new Error(`Missing resource identity ${groupKey}.`)
    database.query('INSERT INTO inventory_resources (id, item_id, created_at_ms) VALUES (?, ?, ?)').run(resourceIdentityId, itemId, now)
    const typed = typedCollections.get(definition.key)
    const entry = typed?.entry ?? {}
    database.query('INSERT INTO resource_identity_aliases (resource_id, legacy_item_type_key, legacy_item_id, legacy_resource_key, legacy_resource_group_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)').run(resourceIdentityId, type, item.id, definition.key, positiveIntegerOrNull(entry.id), now)
    const resourceType = definition.key === 'cpu' ? 'cpu' : definition.key === 'memory' ? 'memory' : definition.key === 'power-adapter' ? 'powerAdapter' : definition.key === 'psu' ? 'psuBay' : typed?.resourceType ?? 'optionalModule'
    database.query('INSERT INTO host_resource_groups (id, resource_identity_id, host_item_id, resource_type, semantic_key, label, slot_count, required_cpu_sockets, location, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(resourceIdentityId, resourceIdentityId, itemId, resourceType, definition.key, optionalText(entry.label) ?? definition.key, definition.count, positiveIntegerOrNull(entry.requiredCpuSockets), optionalText(entry.location), now)
    if (resourceType === 'storage') {
      database.query('INSERT INTO storage_resource_groups (id, pcie_generation, hot_swap, backplane, direct_connect) VALUES (?, ?, ?, ?, ?)').run(resourceIdentityId, positiveIntegerOrNull(entry.pcieGeneration), booleanOrNull(entry.hotSwap), optionalText(entry.backplane), booleanOrNull(entry.directConnect))
      for (const value of records(entry.interfaces)) { const id = vocabularyId(database, 'storage_interfaces', value); if (id) database.query('INSERT INTO storage_resource_interfaces (resource_group_id, interface_id) VALUES (?, ?)').run(resourceIdentityId, id) }
      for (const value of records(entry.formFactors)) { const id = vocabularyId(database, 'storage_form_factors', value); if (id) database.query('INSERT INTO storage_resource_form_factors (resource_group_id, form_factor_id) VALUES (?, ?)').run(resourceIdentityId, id) }
      for (const controllerId of records(entry.controllerSlotIds)) {
        if (Number.isSafeInteger(controllerId)) storageControllerRelations.push({ storageId: resourceIdentityId, controllerId: Number(controllerId) })
      }
    }
    if (resourceType === 'expansion') {
      database.query('INSERT INTO expansion_resource_groups (id, interface_family, expansion_slot_type_id, pcie_generation, mechanical_lanes, electrical_lanes, max_slot_width, max_power_mw, proprietary_riser, riser_capability, riser_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(resourceIdentityId, ['pcie', 'm2-ae', 'usb', 'onboard'].includes(entry.interfaceFamily) ? entry.interfaceFamily : 'pcie', vocabularyId(database, 'expansion_slot_types', entry.slotType), positiveIntegerOrNull(entry.pcieGeneration), positiveIntegerOrNull(entry.mechanicalLanes), positiveIntegerOrNull(entry.electricalLanes), positiveIntegerOrNull(entry.maxSlotWidth), canonicalMeasurement(entry.maxPowerMw, entry.maxPowerWatts, (value) => toMilliwatts({ value, unit: 'W' }), `compatibility.host.expansionSlots.${definition.key}.maxPowerMw`), booleanOrNull(entry.proprietaryRiser), optionalText(entry.riserCapability), optionalText(entry.riserGroup))
      for (const height of records(entry.acceptedHeights)) database.query('INSERT INTO expansion_accepted_heights (resource_group_id, height) VALUES (?, ?)').run(resourceIdentityId, String(height))
    }
    for (const kind of records(entry.acceptedKinds ?? entry.acceptedModuleKinds ?? entry.acceptedControllerKinds ?? entry.acceptedDeviceKinds)) database.query('INSERT INTO resource_accepted_kinds (resource_group_id, kind) VALUES (?, ?)').run(resourceIdentityId, String(kind))
    if (resourceType === 'controllerSlot') database.query('INSERT INTO controller_resource_groups (id, interface_family, dedicated) VALUES (?, ?, ?)').run(resourceIdentityId, optionalText(entry.interfaceFamily), booleanOrNull(entry.dedicated))
    if (resourceType === 'bootDeviceSlot') {
      database.query('INSERT INTO boot_device_resource_groups (id) VALUES (?)').run(resourceIdentityId)
      for (const value of records(entry.interfaces)) { const id = vocabularyId(database, 'storage_interfaces', value); if (id) database.query('INSERT INTO boot_device_resource_interfaces (boot_device_resource_group_id, interface_id) VALUES (?, ?)').run(resourceIdentityId, id) }
      for (const value of records(entry.formFactors)) { const id = vocabularyId(database, 'storage_form_factors', value); if (id) database.query('INSERT INTO boot_device_resource_form_factors (boot_device_resource_group_id, form_factor_id) VALUES (?, ?)').run(resourceIdentityId, id) }
      if (Number.isSafeInteger(entry.controllerSlotId)) bootControllerRelations.push({ bootId: resourceIdentityId, controllerId: Number(entry.controllerSlotId) })
    }
    if (resourceType === 'coolingProfile') {
      database.query('INSERT INTO cooling_resource_groups (id, fan_count, redundant) VALUES (?, ?, ?)').run(resourceIdentityId, integerOrNull(entry.fanCount), booleanOrNull(entry.redundant))
      for (const condition of records(entry.conditions)) database.query('INSERT INTO cooling_conditions (resource_group_id, condition) VALUES (?, ?)').run(resourceIdentityId, String(condition))
    }
    if (resourceType === 'power') database.query('INSERT INTO host_power_connector_groups (id, kind, connector, count, required) VALUES (?, ?, ?, ?, ?)').run(resourceIdentityId, entry.kind, entry.connector, positiveIntegerOrNull(entry.count) ?? 1, Number(entry.required === true))
    const slotTable: Record<string, string> = { cpu: 'cpu_socket_slots', memory: 'memory_slots', storage: 'storage_slots', expansion: 'expansion_slots', optionalModule: 'optional_module_slots', controllerSlot: 'controller_slots', bootDeviceSlot: 'boot_device_slots', psuBay: 'psu_bays', powerAdapter: 'power_adapter_slots' }
    for (let position = 1; position <= definition.count; position += 1) {
      const slotKey = `${groupKey}:slot:${position}`
      const slotId = plan.resourceSlots.get(slotKey)
      if (!slotId) throw new Error(`Missing resource slot identity ${slotKey}.`)
      database.query('INSERT INTO host_resource_slots (id, resource_group_id, host_item_id, position, label, single_capacity, created_at_ms) VALUES (?, ?, ?, ?, ?, 1, ?)').run(slotId, resourceIdentityId, itemId, position, `${optionalText(entry.label) ?? definition.key} ${position}`, now)
      if (slotTable[resourceType]) database.query(`INSERT INTO ${slotTable[resourceType]} (id) VALUES (?)`).run(slotId)
    }
  }
  for (const relation of storageControllerRelations) {
    const controllerResourceGroupId = groupByTypedId.get(`controllerSlot:${relation.controllerId}`)
    if (!controllerResourceGroupId) throw new Error(`Storage resource references missing controller slot ${relation.controllerId}.`)
    database.query('INSERT INTO storage_resource_controllers (storage_resource_group_id, controller_resource_group_id) VALUES (?, ?)').run(relation.storageId, controllerResourceGroupId)
  }
  for (const relation of bootControllerRelations) {
    const controllerResourceGroupId = groupByTypedId.get(`controllerSlot:${relation.controllerId}`)
    if (!controllerResourceGroupId) throw new Error(`Boot resource references missing controller slot ${relation.controllerId}.`)
    database.query('UPDATE boot_device_resource_groups SET controller_resource_group_id = ? WHERE id = ?').run(controllerResourceGroupId, relation.bootId)
  }
  if (host.management) database.query('INSERT INTO management_controllers (host_profile_id, controller_family, controller_generation, dedicated_port, shared_nic, port_type, speed_bps) VALUES (?, ?, ?, ?, ?, ?, ?)').run(profile.id, optionalText(host.management.controllerFamily), optionalText(host.management.controllerGeneration), booleanOrNull(host.management.dedicatedPort), booleanOrNull(host.management.sharedNic), optionalText(host.management.portType), canonicalMeasurement(host.management.speedBps, speedBps(host.management.speed), (value) => value, 'compatibility.host.management.speedBps'))
  if (host.power) {
    const configuration = optionalText(host.power.configuration)
    const adapterDisposition = configuration === 'external-adapter'
      ? optionalText(host.power.adapterDisposition) ?? 'replaceable'
      : null
    const power = database.query(`
      INSERT INTO host_power_profiles (
        host_profile_id, configuration, adapter_disposition, connector, adapter_required,
        adapter_type, redundancy, max_graphics_power_mw, psu_bay_count, psu_type, mixed_psu_allowed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).get(
      profile.id,
      configuration,
      adapterDisposition,
      optionalText(host.power.connector),
      booleanOrNull(host.power.adapterRequired),
      optionalText(host.power.adapterType),
      optionalText(host.power.redundancy),
      canonicalMeasurement(host.power.maxGraphicsPowerMw, host.power.maxGraphicsPowerWatts, (value) => toMilliwatts({ value, unit: 'W' }), 'compatibility.host.power.maxGraphicsPowerMw'),
      integerOrNull(host.power.psuBayCount),
      optionalText(host.power.psuType),
      booleanOrNull(host.power.mixedPsuAllowed),
    ) as { id: number }
    const canonicalPower = records(host.power.supportedPowerMw)
    const legacyPower = records(host.power.supportedWattagesWatts)
    if (canonicalPower.length > 0 && legacyPower.length > 0 && canonicalPower.length !== legacyPower.length) {
      throw new Error('compatibility.host.power supported power representations have different lengths.')
    }
    const supportedPower = canonicalPower.length > 0
      ? canonicalPower.map((value, index) => canonicalMeasurement(value, legacyPower[index], (watts) => toMilliwatts({ value: watts, unit: 'W' }), `compatibility.host.power.supportedPowerMw.${index}`))
      : legacyPower.map((value) => canonicalMeasurement(null, value, (watts) => toMilliwatts({ value: watts, unit: 'W' }), 'compatibility.host.power.supportedPowerMw'))
    for (const powerMw of supportedPower) if (powerMw !== null) database.query('INSERT INTO host_power_supported_wattages (power_profile_id, power_mw) VALUES (?, ?)').run(power.id, powerMw)
    for (const mode of records(host.power.redundancyModes)) database.query('INSERT INTO host_power_redundancy_modes (power_profile_id, mode) VALUES (?, ?)').run(power.id, String(mode))
  }
  for (const constraint of records(host.constraintGroups)) {
    const inserted = database.query('INSERT INTO compatibility_constraint_groups (host_profile_id, semantic_key, label, kind) VALUES (?, ?, ?, ?) RETURNING id').get(profile.id, constraint.key, constraint.label, constraint.kind) as { id: number }
    const resourceTypeMap: Record<string, string> = { 'storage-slot': 'storage', 'expansion-slot': 'expansion', 'optional-module-slot': 'optionalModule', 'controller-slot': 'controllerSlot', 'boot-device-slot': 'bootDeviceSlot', 'cooling-profile': 'coolingProfile' }
    for (const member of records(constraint.members)) {
      const resourceGroupId = groupByTypedId.get(`${resourceTypeMap[member.resourceType]}:${member.resourceId}`)
      if (!resourceGroupId) throw new Error(`Compatibility constraint references missing resource ${String(member.resourceType)}:${String(member.resourceId)}.`)
      database.query('INSERT INTO compatibility_constraint_members (constraint_group_id, resource_group_id) VALUES (?, ?)').run(inserted.id, resourceGroupId)
    }
  }
}

function importPorts(database: Database, type: InventoryType, item: LegacyRecord, itemId: number, plan: CanonicalIdentityPlan, now: number) {
  const usedSlots = new Set<number>()
  for (const port of records(item.ports).sort((a, b) => Number(a.id) - Number(b.id))) {
    const key = `${type}:${item.id}:port:${port.id}`
    const portId = plan.ports.get(key)
    if (!portId) throw new Error(`Missing port identity ${key}.`)
    let slotNumber = positiveIntegerOrNull(port.slotNumber) ?? Number(port.id)
    while (usedSlots.has(slotNumber)) slotNumber += 1
    usedSlots.add(slotNumber)
    const kindId = vocabularyId(database, 'port_kinds', portKind(port))
    const connectorId = vocabularyId(database, 'connector_types', connectorType(port))
    if (!kindId || !connectorId) throw new Error(`Port ${key} uses an unsupported kind or connector.`)
    database.query('INSERT INTO inventory_ports (id, item_id, created_at_ms) VALUES (?, ?, ?)').run(portId, itemId, now)
    database.query('INSERT INTO port_identity_aliases (port_id, legacy_item_type_key, legacy_item_id, legacy_port_id, created_at_ms) VALUES (?, ?, ?, ?, ?)').run(portId, type, item.id, port.id, now)
    database.query('INSERT INTO item_port_details (port_id, kind_id, connector_type_id, semantic_key, slot_number, label, notes, ip_address, role, speed_bps, poe, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(portId, kindId, connectorId, optionalText(port.key), slotNumber, optionalText(port.label), optionalText(port.notes), optionalText(port.ipAddress), portRole(port.role), canonicalMeasurement(port.speedBps, speedBps(port.speed), (value) => value, `ports.${port.id}.speedBps`), booleanOrNull(port.poe), port.origin === 'module' ? 'module' : 'fixed')
    for (const endpoint of records(port.endpoints)) {
      const faceId = plan.endpointFaces.get(`${key}:face:${endpoint.id}`)
      if (!faceId) throw new Error(`Missing endpoint-face identity for ${key}.`)
      database.query('INSERT INTO port_endpoint_faces (id, port_id, endpoint_number, side) VALUES (?, ?, ?, ?)').run(faceId, portId, endpoint.id, endpoint.side)
    }
  }
}

function insertInventoryItem(
  database: Database,
  projectId: number,
  type: InventoryType,
  item: LegacyRecord,
  itemId: number,
  plan: CanonicalIdentityPlan,
  now: number,
  scope: 'global' | 'project' = 'global',
  ownerProjectId: number | null = null,
) {
  const typeRow = database.query('SELECT id FROM inventory_item_types WHERE key = ?').get(type) as { id: number } | null
  if (!typeRow) throw new Error(`Inventory item type ${type} is not configured.`)
  const manufacturerId = ensureManufacturer(database, item.manufacturer, now)
  database.query(`INSERT INTO inventory_items (id, type_id, scope, owner_project_id, name, manufacturer_id, manufacturer_text, model, family, product_number, subtype, serial_number, notes, extensions_json, row_version, archived_at_ms, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(itemId, typeRow.id, scope, ownerProjectId, optionalText(item.name) ?? `${type} ${item.id}`, manufacturerId, manufacturerId ? null : optionalText(item.manufacturer), optionalText(item.model), optionalText(item.family), optionalText(item.number), optionalText(item.subtype), optionalText(item.serialNumber ?? item.specs?.serialNumber), optionalText(item.notes), json(extensionPayload(item)), timestamp(item.archivedAt, null as any), now, now)
  database.query('INSERT INTO inventory_identity_aliases (item_id, legacy_type_key, legacy_id, created_at_ms) VALUES (?, ?, ?, ?)').run(itemId, type, item.id, now)
  database.query('INSERT INTO project_inventory_memberships (project_id, item_id, created_at_ms) VALUES (?, ?, ?)').run(projectId, itemId, now)
  insertInventoryItemDetails(database, type, item, itemId, plan, now)
}

const SUBTYPE_TABLE_BY_TYPE: Readonly<Record<InventoryType, string>> = {
  server: 'servers',
  nas: 'nas_systems',
  pcBuild: 'pc_builds',
  cpu: 'cpus',
  ram: 'memory_modules',
  storage: 'storage_devices',
  gpu: 'graphics_cards',
  network: 'network_cards',
  motherboard: 'motherboards',
  cpuCooler: 'cpu_coolers',
  case: 'computer_cases',
  powerSupply: 'power_supplies',
  soundCard: 'sound_cards',
  wireless: 'wireless_cards',
  powerAdapter: 'power_adapters',
  switch: 'network_switches',
  patchPanel: 'patch_panels',
  monitor: 'monitors',
  ups: 'ups_systems',
  powerStrip: 'power_strips',
}

function replacementIdentityPlan(
  database: Database,
  type: InventoryType,
  item: LegacyRecord,
  itemId: number,
) {
  const itemPrefix = `${type}:${item.id}`
  const existingPorts = new Map<number, number>((database.query(`
    SELECT a.legacy_port_id, p.id
    FROM inventory_ports p
    JOIN port_identity_aliases a ON a.port_id = p.id
    WHERE p.item_id = ?
  `).all(itemId) as Array<{ legacy_port_id: number; id: number }>).map((row) => [row.legacy_port_id, row.id]))
  const existingFaces = new Map<string, number>((database.query(`
    SELECT a.legacy_port_id, f.endpoint_number, f.id
    FROM port_endpoint_faces f
    JOIN inventory_ports p ON p.id = f.port_id
    JOIN port_identity_aliases a ON a.port_id = p.id
    WHERE p.item_id = ?
  `).all(itemId) as Array<{ legacy_port_id: number; endpoint_number: number; id: number }>).map(
    (row) => [`${row.legacy_port_id}:${row.endpoint_number}`, row.id],
  ))
  const existingResources = new Map<string, number>((database.query(`
    SELECT a.legacy_resource_key, r.id
    FROM inventory_resources r
    JOIN resource_identity_aliases a ON a.resource_id = r.id
    WHERE r.item_id = ?
  `).all(itemId) as Array<{ legacy_resource_key: string; id: number }>).map(
    (row) => [row.legacy_resource_key, row.id],
  ))
  const existingSlots = new Map<string, number>((database.query(`
    SELECT a.legacy_resource_key, s.position, s.id
    FROM host_resource_slots s
    JOIN resource_identity_aliases a ON a.resource_id = s.resource_group_id
    WHERE s.host_item_id = ?
  `).all(itemId) as Array<{ legacy_resource_key: string; position: number; id: number }>).map(
    (row) => [`${row.legacy_resource_key}:${row.position}`, row.id],
  ))

  let nextPortId = nextTableId(database, 'inventory_ports')
  let nextFaceId = nextTableId(database, 'port_endpoint_faces')
  let nextResourceId = nextTableId(database, 'inventory_resources')
  let nextSlotId = nextTableId(database, 'host_resource_slots')
  const ports = new Map<string, number>()
  const endpointFaces = new Map<string, number>()
  const resourceGroups = new Map<string, number>()
  const resourceSlots = new Map<string, number>()

  for (const port of records(item.ports).sort((left, right) => Number(left.id) - Number(right.id))) {
    const key = `${itemPrefix}:port:${port.id}`
    ports.set(key, existingPorts.get(Number(port.id)) ?? nextPortId++)
    for (const [index, endpoint] of records(port.endpoints).entries()) {
      const endpointNumber = Number(endpoint.id ?? index + 1)
      endpointFaces.set(
        `${key}:face:${endpointNumber}`,
        existingFaces.get(`${port.id}:${endpointNumber}`) ?? nextFaceId++,
      )
    }
  }
  for (const definition of legacyResourceDefinitions(item)) {
    const key = `${itemPrefix}:resource:${definition.key}`
    resourceGroups.set(key, existingResources.get(definition.key) ?? nextResourceId++)
    for (let position = 1; position <= definition.count; position += 1) {
      resourceSlots.set(
        `${key}:slot:${position}`,
        existingSlots.get(`${definition.key}:${position}`) ?? nextSlotId++,
      )
    }
  }
  return Object.freeze({
    items: new Map([[itemPrefix, itemId]]),
    ports,
    endpointFaces,
    resourceGroups,
    resourceSlots,
    agents: new Map(),
    registrySources: new Map(),
    registryLinks: new Map(),
    assignments: new Map(),
    connections: new Map(),
  }) satisfies CanonicalIdentityPlan
}

function insertInventoryItemDetails(
  database: Database,
  type: InventoryType,
  item: LegacyRecord,
  itemId: number,
  plan: CanonicalIdentityPlan,
  now: number,
) {
  insertSubtype(database, type, itemId, item)
  for (const component of records(item.fixedComponents)) {
    const catalogComponentId = positiveIntegerOrNull(component.id)
    const componentType = optionalText(component.componentType)
    const disposition = component.disposition === 'fixed' || component.disposition === 'soldered'
      ? component.disposition
      : null
    const label = optionalText(component.label)
    if (!catalogComponentId || !componentType || !disposition || !label || !component.item || typeof component.item !== 'object') {
      throw new Error('Fixed component topology is invalid.')
    }
    if (component.item.type !== componentType) {
      throw new Error(`Fixed component ${catalogComponentId} type does not match its nested item.`)
    }
    const extensions = Object.fromEntries(Object.entries(component).filter(([key]) => ![
      'id', 'componentType', 'disposition', 'label', 'templateKey', 'templateRevision', 'item',
    ].includes(key)))
    database.query(`
      INSERT INTO host_fixed_components (
        host_item_id, catalog_component_id, component_type, disposition, label,
        template_key, template_revision, item_json, extensions_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      catalogComponentId,
      componentType,
      disposition,
      label,
      optionalText(component.templateKey),
      positiveIntegerOrNull(component.templateRevision),
      json(component.item),
      json(extensions),
      now,
      now,
    )
  }
  for (const alias of records(item.aliases)) {
    const value = optionalText(alias)
    if (value) database.query('INSERT INTO inventory_item_aliases (item_id, alias, normalized_alias, created_at_ms) VALUES (?, ?, ?, ?)').run(itemId, value, value.toLocaleLowerCase('en-US').replace(/\s+/gu, ' '), now)
  }
  const secondaryManufacturer = optionalText(item.secondaryManufacturer)
  if (secondaryManufacturer) {
    const secondaryManufacturerId = ensureManufacturer(database, secondaryManufacturer, now)
    database.query('INSERT INTO inventory_secondary_manufacturers (item_id, manufacturer_id, manufacturer_text, created_at_ms, updated_at_ms) VALUES (?, ?, NULL, ?, ?)').run(itemId, secondaryManufacturerId, now, now)
  }
  for (const [key, value] of Object.entries(item.properties ?? {})) {
    database.query('INSERT INTO inventory_item_properties (item_id, key, value, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)').run(itemId, key, typeof value === 'string' ? value : json(value), now, now)
  }
  importPorts(database, type, item, itemId, plan, now)
  if (type === 'powerStrip' && item.smart?.enabled === true) {
    const smart = database.query('INSERT INTO power_strip_smart_configurations (power_strip_id, enabled, display_name, management_ip, mac_address, created_at_ms, updated_at_ms) VALUES (?, 1, ?, ?, ?, ?, ?) RETURNING id').get(itemId, optionalText(item.smart.displayName), optionalText(item.smart.managementIp), optionalText(item.smart.macAddress), now, now) as { id: number }
    for (const outlet of records(item.smart.outlets)) {
      const portId = plan.ports.get(`${type}:${item.id}:port:${outlet.portId}`)
      if (!portId) throw new Error(`Smart outlet name references missing power strip port ${String(outlet.portId)}.`)
      database.query('INSERT INTO power_strip_outlet_names (smart_configuration_id, port_id, name) VALUES (?, ?, ?)').run(smart.id, portId, outlet.name)
    }
  }
  importCompatibility(database, itemId, item, now, plan, type)
}

function nextTableId(database: Database, table: string) {
  return Number((database.query(`SELECT coalesce(max(id), 0) + 1 AS id FROM ${table}`).get() as { id: number }).id)
}

function runtimeIdentityPlan(database: Database, type: InventoryType, item: LegacyRecord): CanonicalIdentityPlan {
  const itemIdentity = nextTableId(database, 'inventory_items')
  const itemKey = `${type}:${item.id}`
  const items = new Map([[itemKey, itemIdentity]])
  const ports = new Map<string, number>()
  const endpointFaces = new Map<string, number>()
  const resourceGroups = new Map<string, number>()
  const resourceSlots = new Map<string, number>()
  let portId = nextTableId(database, 'inventory_ports')
  let faceId = nextTableId(database, 'port_endpoint_faces')
  let resourceId = nextTableId(database, 'inventory_resources')
  let slotId = nextTableId(database, 'host_resource_slots')

  for (const port of records(item.ports).sort((left, right) => Number(left.id) - Number(right.id))) {
    const portKey = `${itemKey}:port:${port.id}`
    ports.set(portKey, portId++)
    for (const [index, endpoint] of records(port.endpoints).entries()) {
      endpointFaces.set(`${portKey}:face:${endpoint.id ?? index + 1}`, faceId++)
    }
  }
  for (const definition of legacyResourceDefinitions(item)) {
    const groupKey = `${itemKey}:resource:${definition.key}`
    resourceGroups.set(groupKey, resourceId++)
    for (let position = 1; position <= definition.count; position += 1) {
      resourceSlots.set(`${groupKey}:slot:${position}`, slotId++)
    }
  }
  return Object.freeze({
    items,
    ports,
    endpointFaces,
    resourceGroups,
    resourceSlots,
    agents: new Map(),
    registrySources: new Map(),
    registryLinks: new Map(),
    assignments: new Map(),
    connections: new Map(),
  })
}

export function insertLegacyInventoryItem({
  database,
  projectId,
  type,
  item,
  scope = 'global',
  ownerProjectId = null,
  now = Date.now(),
}: InsertLegacyInventoryItemOptions) {
  const legacyId = positiveIntegerOrNull(item.id)
  if (!legacyId) throw new Error('Inventory item ID must be a positive safe integer.')
  const plan = runtimeIdentityPlan(database, type, item)
  const itemId = canonicalItemId(plan, type, legacyId)
  if (scope === 'project' && ownerProjectId !== projectId) {
    throw new Error('Project-bound inventory must be owned by its membership project.')
  }
  if (scope === 'global' && ownerProjectId !== null) {
    throw new Error('Global inventory cannot have an owner project.')
  }
  insertInventoryItem(database, projectId, type, item, itemId, plan, now, scope, ownerProjectId)
  return { itemId, legacyId }
}

export function replaceLegacyInventoryItem({
  database,
  projectId,
  type,
  item,
  itemId,
  now = Date.now(),
}: ReplaceLegacyInventoryItemOptions) {
  const legacyId = positiveIntegerOrNull(item.id)
  if (!legacyId) throw new Error('Inventory item ID must be a positive safe integer.')
  const membership = database.query(
    'SELECT 1 FROM project_inventory_memberships WHERE project_id = ? AND item_id = ?',
  ).get(projectId, itemId)
  if (!membership) throw new Error(`Inventory item ${type}:${legacyId} is not in project ${projectId}.`)

  const plan = replacementIdentityPlan(database, type, item, itemId)
  const endpoints = database.query(`
    SELECT e.id AS endpoint_id, e.connection_id, e.role, a.legacy_port_id,
           f.endpoint_number
    FROM connection_endpoints e
    JOIN inventory_ports p ON p.id = e.port_id
    JOIN port_identity_aliases a ON a.port_id = p.id
    LEFT JOIN port_endpoint_faces f ON f.id = e.endpoint_face_id
    WHERE p.item_id = ?
  `).all(itemId) as LegacyRecord[]
  const internalLinks = database.query(`
    SELECT l.id,
           first_alias.legacy_port_id AS first_legacy_port_id,
           first_face.endpoint_number AS first_endpoint_number,
           second_alias.legacy_port_id AS second_legacy_port_id,
           second_face.endpoint_number AS second_endpoint_number,
           l.created_at_ms
    FROM internal_port_links l
    JOIN port_identity_aliases first_alias ON first_alias.port_id = l.first_port_id
    JOIN port_identity_aliases second_alias ON second_alias.port_id = l.second_port_id
    LEFT JOIN port_endpoint_faces first_face ON first_face.id = l.first_endpoint_face_id
    LEFT JOIN port_endpoint_faces second_face ON second_face.id = l.second_endpoint_face_id
    WHERE l.item_id = ?
  `).all(itemId) as LegacyRecord[]
  const assignmentSlots = database.query(`
    SELECT a.id AS assignment_slot_id, a.assignment_id, a.position AS assignment_position,
           r.legacy_resource_key, s.position AS resource_position,
           CASE WHEN c.resource_slot_id = s.id THEN 1 ELSE 0 END AS is_primary
    FROM component_assignment_slots a
    JOIN component_assignments c ON c.id = a.assignment_id
    JOIN host_resource_slots s ON s.id = a.resource_slot_id
    JOIN resource_identity_aliases r ON r.resource_id = s.resource_group_id
    WHERE a.project_id = ? AND a.host_item_id = ?
    ORDER BY a.assignment_id, a.position
  `).all(projectId, itemId) as LegacyRecord[]
  const primaryOnlySlots = database.query(`
    SELECT c.id AS assignment_id, r.legacy_resource_key,
           s.position AS resource_position
    FROM component_assignments c
    JOIN host_resource_slots s ON s.id = c.resource_slot_id
    JOIN resource_identity_aliases r ON r.resource_id = s.resource_group_id
    WHERE c.project_id = ? AND c.host_item_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM component_assignment_slots a
        WHERE a.assignment_id = c.id AND a.resource_slot_id = c.resource_slot_id
      )
  `).all(projectId, itemId) as LegacyRecord[]

  const portKey = (legacyPortId: number) => `${type}:${legacyId}:port:${legacyPortId}`
  const faceId = (legacyPortId: number, endpointNumber: number | null) => endpointNumber == null
    ? null
    : plan.endpointFaces.get(`${portKey(legacyPortId)}:face:${endpointNumber}`) ?? null
  for (const endpoint of endpoints) {
    if (!plan.ports.has(portKey(endpoint.legacy_port_id))) {
      throw new Error(`Connected port ${endpoint.legacy_port_id} cannot be removed.`)
    }
    if (endpoint.endpoint_number != null && faceId(endpoint.legacy_port_id, endpoint.endpoint_number) == null) {
      throw new Error(`Connected port ${endpoint.legacy_port_id} endpoint ${endpoint.endpoint_number} cannot be removed.`)
    }
  }
  for (const link of internalLinks) {
    if (!plan.ports.has(portKey(link.first_legacy_port_id)) || !plan.ports.has(portKey(link.second_legacy_port_id))) {
      throw new Error('Internally linked ports cannot be removed.')
    }
  }
  const resourceSlot = (resourceKey: string, position: number) => plan.resourceSlots.get(
    `${type}:${legacyId}:resource:${resourceKey}:slot:${position}`,
  )
  for (const slot of [...assignmentSlots, ...primaryOnlySlots]) {
    if (!resourceSlot(slot.legacy_resource_key, slot.resource_position)) {
      throw new Error(
        `Assigned resource ${slot.legacy_resource_key} slot ${slot.resource_position} cannot be removed.`,
      )
    }
  }

  database.query('DELETE FROM connection_endpoints WHERE port_id IN (SELECT id FROM inventory_ports WHERE item_id = ?)').run(itemId)
  database.query('DELETE FROM internal_port_links WHERE item_id = ?').run(itemId)
  database.query('UPDATE component_assignments SET resource_slot_id = NULL WHERE project_id = ? AND host_item_id = ?').run(projectId, itemId)
  database.query('DELETE FROM component_assignment_slots WHERE project_id = ? AND host_item_id = ?').run(projectId, itemId)
  database.query('DELETE FROM power_strip_smart_configurations WHERE power_strip_id = ?').run(itemId)
  database.query('DELETE FROM port_identity_aliases WHERE port_id IN (SELECT id FROM inventory_ports WHERE item_id = ?)').run(itemId)
  database.query('DELETE FROM inventory_ports WHERE item_id = ?').run(itemId)
  database.query('DELETE FROM host_fixed_components WHERE host_item_id = ?').run(itemId)

  database.query('DELETE FROM compatibility_constraint_groups WHERE host_profile_id IN (SELECT id FROM host_compatibility_profiles WHERE host_item_id = ?)').run(itemId)
  database.query('DELETE FROM storage_resource_controllers WHERE storage_resource_group_id IN (SELECT id FROM host_resource_groups WHERE host_item_id = ?) OR controller_resource_group_id IN (SELECT id FROM host_resource_groups WHERE host_item_id = ?)').run(itemId, itemId)
  database.query('UPDATE boot_device_resource_groups SET controller_resource_group_id = NULL WHERE id IN (SELECT id FROM host_resource_groups WHERE host_item_id = ?)').run(itemId)
  database.query('DELETE FROM resource_identity_aliases WHERE resource_id IN (SELECT id FROM inventory_resources WHERE item_id = ?)').run(itemId)
  database.query('DELETE FROM host_resource_groups WHERE host_item_id = ?').run(itemId)
  database.query('DELETE FROM inventory_resources WHERE item_id = ?').run(itemId)
  database.query('DELETE FROM host_compatibility_profiles WHERE host_item_id = ?').run(itemId)

  database.query('DELETE FROM inventory_item_aliases WHERE item_id = ?').run(itemId)
  database.query('DELETE FROM inventory_secondary_manufacturers WHERE item_id = ?').run(itemId)
  database.query('DELETE FROM inventory_item_properties WHERE item_id = ?').run(itemId)
  database.query(`DELETE FROM ${SUBTYPE_TABLE_BY_TYPE[type]} WHERE id = ?`).run(itemId)

  const manufacturerId = ensureManufacturer(database, item.manufacturer, now)
  database.query(`
    UPDATE inventory_items SET
      name = ?, manufacturer_id = ?, manufacturer_text = ?, model = ?, family = ?,
      product_number = ?, subtype = ?, serial_number = ?, notes = ?, extensions_json = ?,
      row_version = row_version + 1, updated_at_ms = ?
    WHERE id = ?
  `).run(
    optionalText(item.name) ?? `${type} ${legacyId}`,
    manufacturerId,
    manufacturerId ? null : optionalText(item.manufacturer),
    optionalText(item.model),
    optionalText(item.family),
    optionalText(item.number),
    optionalText(item.subtype),
    optionalText(item.serialNumber ?? item.specs?.serialNumber),
    optionalText(item.notes),
    json(extensionPayload(item)),
    now,
    itemId,
  )
  insertInventoryItemDetails(database, type, item, itemId, plan, now)

  for (const endpoint of endpoints) {
    database.query('INSERT INTO connection_endpoints (id, connection_id, role, port_id, endpoint_face_id) VALUES (?, ?, ?, ?, ?)').run(
      endpoint.endpoint_id,
      endpoint.connection_id,
      endpoint.role,
      plan.ports.get(portKey(endpoint.legacy_port_id)),
      faceId(endpoint.legacy_port_id, endpoint.endpoint_number),
    )
  }
  for (const link of internalLinks) {
    database.query('INSERT INTO internal_port_links (id, item_id, first_port_id, first_endpoint_face_id, second_port_id, second_endpoint_face_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      link.id,
      itemId,
      plan.ports.get(portKey(link.first_legacy_port_id)),
      faceId(link.first_legacy_port_id, link.first_endpoint_number),
      plan.ports.get(portKey(link.second_legacy_port_id)),
      faceId(link.second_legacy_port_id, link.second_endpoint_number),
      link.created_at_ms,
    )
  }
  for (const slot of assignmentSlots) {
    const slotId = resourceSlot(slot.legacy_resource_key, slot.resource_position)!
    database.query('INSERT INTO component_assignment_slots (id, project_id, assignment_id, host_item_id, resource_slot_id, position) VALUES (?, ?, ?, ?, ?, ?)').run(
      slot.assignment_slot_id,
      projectId,
      slot.assignment_id,
      itemId,
      slotId,
      slot.assignment_position,
    )
    if (slot.is_primary) {
      database.query('UPDATE component_assignments SET resource_slot_id = ? WHERE id = ?').run(slotId, slot.assignment_id)
    }
  }
  for (const slot of primaryOnlySlots) {
    database.query('UPDATE component_assignments SET resource_slot_id = ? WHERE id = ?').run(
      resourceSlot(slot.legacy_resource_key, slot.resource_position),
      slot.assignment_id,
    )
  }
  return { itemId, legacyId }
}

function importInventory(database: Database, snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, now: number) {
  for (const type of INVENTORY_TYPES) {
    for (const item of records(snapshot.inventory?.[LEGACY_TABLE_BY_TYPE[type]]).sort((a, b) => Number(a.id) - Number(b.id))) {
      const itemId = canonicalItemId(plan, type, item.id)
      insertInventoryItem(database, 1, type, item, itemId, plan, now)
    }
  }
}

function findLegacyItem(snapshot: LegacySnapshot, type: InventoryType, id: number) {
  return records(snapshot.inventory?.[LEGACY_TABLE_BY_TYPE[type]]).find((item) => item.id === id)
}

function assignmentSlot(snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, assignment: LegacyRecord) {
  const position = records(assignment.allocation?.positions)[0]
  if (!Number.isSafeInteger(position)) return null
  const resourceType = assignment.allocation?.resourceType ?? assignment.type
  let resourceKey = assignment.allocation?.resourceKey ?? resourceType
  if (assignment.allocation?.groupId != null) {
    const host = findLegacyItem(snapshot, assignment.hostType, assignment.hostId)
    const collectionKey: Record<string, string> = {
      storage: 'storageSlots',
      expansion: 'expansionSlots',
      optionalModule: 'optionalModuleSlots',
      controllerSlot: 'controllerSlots',
      bootDeviceSlot: 'bootDeviceSlots',
    }
    const collection = records(host?.compatibility?.host?.[collectionKey[resourceType]])
    const group = collection.find((entry) => entry.id === assignment.allocation.groupId)
    if (!group) throw new Error(`Assignment ${assignment.id} references missing ${resourceType} group ${assignment.allocation.groupId}.`)
    resourceKey = group.key ?? `${resourceType}-${collection.indexOf(group) + 1}`
  }
  return plan.resourceSlots.get(`${assignment.hostType}:${assignment.hostId}:resource:${resourceKey}:slot:${Number(position) + 1}`) ?? null
}

function importProject(database: Database, snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, now: number) {
  const project = snapshot.project ?? {}
  database.query('UPDATE projects SET name = ?, revision = ?, updated_at_ms = ? WHERE id = 1').run(optionalText(project.metadata?.name) ?? 'Default Project', positiveIntegerOrNull(project.revision) ?? 1, timestamp(project.metadata?.updatedAt, now))
  const viewport = project.viewport ?? project.metadata?.viewport ?? {}
  database.query('UPDATE canvas_workspaces SET viewport_x = ?, viewport_y = ?, viewport_zoom_basis_points = ?, settings_json = ? WHERE id = 2').run(Math.round(viewport.x ?? 0), Math.round(viewport.y ?? 0), Math.max(1, Math.round((viewport.zoom ?? 1) * 10000)), json(project.canvasSettings ?? {}))
  for (const placement of records(project.placements)) {
    database.query('INSERT INTO workspace_placements (project_id, workspace_id, item_id, x, y, orientation, z_index, created_at_ms, updated_at_ms) VALUES (1, 2, ?, ?, ?, ?, ?, ?, ?)').run(canonicalItemId(plan, placement.itemType, placement.itemId), placement.x, placement.y, optionalText(placement.orientation), integerOrNull(placement.zIndex) ?? 0, now, now)
  }
  for (const assignment of records(project.assignments)) {
    const id = plan.assignments.get(String(assignment.id))
    const hostItemId = canonicalItemId(plan, assignment.hostType, assignment.hostId)
    const componentItemId = canonicalItemId(plan, assignment.itemType, assignment.itemId)
    const primarySlotId = assignmentSlot(snapshot, plan, assignment)
    database.query('INSERT INTO component_assignments (id, project_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms) VALUES (?, 1, ?, ?, ?, ?)').run(id, hostItemId, componentItemId, primarySlotId, timestamp(assignment.assignedAt, now))
    const allocationPositions = records(assignment.allocation?.positions)
    for (const [position, legacyPosition] of allocationPositions.entries()) {
      const slotId = assignmentSlot(snapshot, plan, {
        ...assignment,
        allocation: { ...assignment.allocation, positions: [legacyPosition] },
      })
      if (slotId == null) continue
      database.query('INSERT INTO component_assignment_slots (project_id, assignment_id, host_item_id, resource_slot_id, position) VALUES (1, ?, ?, ?, ?)').run(id, hostItemId, slotId, position)
    }
  }
  for (const connection of records(project.connections)) {
    const id = plan.connections.get(String(connection.id))
    const route = connection.route ?? {}
    database.query('INSERT INTO project_connections (id, project_id, connection_type, negotiated_speed_bps, label, source_side, target_side, avoid_cable_overlap, created_at_ms, updated_at_ms) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, connectionType(connection.type), connection.negotiatedSpeedMbps == null ? null : toBitsPerSecond({ value: connection.negotiatedSpeedMbps, unit: 'Mbps' }), optionalText(connection.label), ['left', 'right', 'top', 'bottom'].includes(route.sourceSide) ? route.sourceSide : 'right', ['left', 'right', 'top', 'bottom'].includes(route.targetSide) ? route.targetSide : 'left', Number(route.avoidCableOverlap === true), timestamp(connection.createdAt, now), timestamp(connection.updatedAt, now))
    for (const [role, endpoint] of [['source', connection.from], ['target', connection.to]] as const) {
      const endpointItemType = endpoint.hostedItemType ?? endpoint.itemType
      const endpointItemId = endpoint.hostedItemId ?? endpoint.itemId
      const portKey = `${endpointItemType}:${endpointItemId}:port:${endpoint.portId}`
      const portId = plan.ports.get(portKey)
      if (!portId) throw new Error(`Connection ${connection.id} references missing port ${portKey}.`)
      const endpointFaceId = endpoint.endpointId == null ? null : plan.endpointFaces.get(`${portKey}:face:${endpoint.endpointId}`) ?? null
      database.query('INSERT INTO connection_endpoints (connection_id, role, port_id, endpoint_face_id) VALUES (?, ?, ?, ?)').run(id, role, portId, endpointFaceId)
    }
    for (const [position, point] of records(route.bendPoints).entries()) database.query('INSERT INTO workspace_manual_bend_points (project_id, workspace_id, connection_id, position, x, y) VALUES (1, 2, ?, ?, ?, ?)').run(id, position, point.x, point.y)
  }
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.compatibility-policy', json(project.compatibilityPolicy ?? {}), now)
  database.query(`
    INSERT INTO project_compatibility_policies (project_id, policy_json, updated_at_ms)
    VALUES (1, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      policy_json = excluded.policy_json,
      updated_at_ms = excluded.updated_at_ms
  `).run(json(project.compatibilityPolicy ?? { disabledHosts: [], ignoredWarningIds: [] }), now)
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.project-metadata', json(project.metadata ?? {}), now)
}

function importRoutingCache(database: Database, snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, now: number) {
  const cache = snapshot.routingCache ?? {}
  const { entries: _entries, ...cacheEnvelope } = cache
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run(
    'legacy.routing-cache-envelope',
    json(cacheEnvelope),
    now,
  )
  for (const entry of records(cache.entries)) {
    const legacyId = entry.input?.request?.definition?.connection_id
    const connectionId = plan.connections.get(String(legacyId))
    if (!connectionId) throw new Error(`Route cache references missing connection ${String(legacyId)}.`)
    database.query('INSERT INTO workspace_route_cache (project_id, workspace_id, connection_id, engine_version, layout_fingerprint, route_fingerprint, route_payload_json, calculated_at_ms) VALUES (1, 2, ?, ?, ?, ?, ?, ?)').run(connectionId, optionalText(cache.plannerVersion) ?? 'legacy', optionalText(cache.geometryFingerprint) ?? 'legacy', `legacy:${legacyId}`, json(entry), timestamp(cache.updatedAt, now))
  }
}

function importRegistry(database: Database, snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, now: number) {
  const registry = snapshot.registry ?? {}
  const settings = registry.settings ?? {}
  const registrySettingColumns = new Set((database.query("PRAGMA table_info('registry_settings')").all() as Array<{ name: string }>).map((column) => column.name))
  if (registrySettingColumns.has('automatic_safe_updates')) {
    database.query('INSERT INTO registry_settings (id, mode, default_inventory_source, automatic_contributions, automatic_safe_updates, show_link_indicators, updated_at_ms) VALUES (1, ?, ?, ?, ?, ?, ?)').run(settings.mode ?? 'disabled', settings.defaultInventorySource ?? 'catalog', Number(settings.automaticContributions === true), Number(settings.automaticSafeUpdates !== false), Number(settings.showRegistryLinkIndicators === true), timestamp(settings.updatedAt, now))
  } else {
    database.query('INSERT INTO registry_settings (id, mode, default_inventory_source, automatic_contributions, show_link_indicators, updated_at_ms) VALUES (1, ?, ?, ?, ?, ?)').run(settings.mode ?? 'disabled', settings.defaultInventorySource ?? 'catalog', Number(settings.automaticContributions === true), Number(settings.showRegistryLinkIndicators === true), timestamp(settings.updatedAt, now))
  }
  for (const source of records(registry.sources)) database.query('INSERT INTO registry_sources (id, kind, display_name, endpoint, trusted_key_id, enabled, last_checked_at_ms, last_success_at_ms, last_error, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(plan.registrySources.get(String(source.id)), source.kind, source.displayName, optionalText(source.endpoint), optionalText(source.trustedKeyId), Number(source.enabled !== false), timestamp(source.lastCheckedAt, null as any), timestamp(source.lastSuccessAt, null as any), optionalText(source.lastError), timestamp(source.createdAt, now))
  for (const link of records(registry.links)) database.query('INSERT INTO registry_links (id, item_id, source_id, template_key, imported_revision, imported_content_hash, imported_fingerprint_version, available_revision, available_content_hash, product_family_json, variant_evidence_json, identity_aliases_json, state, linked_at_ms, updated_at_ms, detached_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(plan.registryLinks.get(String(link.id)), canonicalItemId(plan, link.itemType, link.itemId), plan.registrySources.get(String(link.sourceId)), link.templateKey, link.importedRevision, link.importedContentHash, link.importedFingerprintVersion ?? 1, positiveIntegerOrNull(link.availableRevision), optionalText(link.availableContentHash), link.productFamily ? json(link.productFamily) : null, link.variantEvidence ? json(link.variantEvidence) : null, link.identityAliases ? json(link.identityAliases) : null, link.state, timestamp(link.linkedAt, now), timestamp(link.updatedAt, now), timestamp(link.detachedAt, null as any))
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.registry-extended-state', json({ variantMatches: registry.variantMatches ?? [], contributionOutbox: registry.contributionOutbox ?? [], contributionLedger: registry.contributionLedger ?? [], contributionGroups: registry.contributionGroups ?? [], projectionCache: registry.projectionCache ?? [], privateTemplates: registry.privateTemplates ?? [], snapshot: registry.snapshot ?? null, installationIdentity: registry.installationIdentity ?? null }), now)
}

function legacyAgentBinding(agent: LegacyRecord, now: number) {
  const explicitState = ['active', 'revoked', 'replaced', 'unlinked'].includes(agent.state)
    ? agent.state
    : null
  const state = agent.revokedAt
    ? 'revoked'
    : agent.unboundAt
      ? explicitState === 'replaced' ? 'replaced' : 'unlinked'
      : explicitState ?? 'active'

  return {
    state,
    boundAt: timestamp(agent.boundAt ?? agent.createdAt, now),
    unboundAt: state === 'active'
      ? null
      : timestamp(agent.unboundAt ?? agent.revokedAt, null as any),
  }
}

function importAgents(database: Database, snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, now: number) {
  for (const agent of records(snapshot.agents?.devices)) {
    const id = plan.agents.get(String(agent.id))
    const binding = legacyAgentBinding(agent, now)
    database.query('INSERT INTO agents (id, public_key, protocol_major, agent_version, capabilities_json, last_sequence, last_seen_at_ms, revoked_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, agent.publicKey ?? `legacy-agent-${agent.id}`, positiveIntegerOrNull(agent.protocolMajor) ?? 1, agent.version ?? agent.agentVersion ?? 'legacy', json(agent.capabilities ?? {}), integerOrNull(agent.lastSequence) ?? 0, timestamp(agent.lastSeenAt, null as any), timestamp(agent.revokedAt, null as any), timestamp(agent.createdAt, now))
    database.query('INSERT INTO agent_identity_aliases (agent_id, legacy_id, created_at_ms) VALUES (?, ?, ?)').run(id, agent.id, now)
    database.query('INSERT INTO agent_host_bindings (agent_id, host_item_id, state, bound_at_ms, unbound_at_ms) VALUES (?, ?, ?, ?, ?)').run(id, canonicalItemId(plan, agent.hostType, agent.hostId), binding.state, binding.boundAt, binding.unboundAt)
  }
  for (const enrollment of records(snapshot.agents?.enrollments)) {
    database.query('INSERT INTO agent_enrollment_codes (id, host_item_id, token_hash, expires_at_ms, used_at_ms, revoked_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(enrollment.id, canonicalItemId(plan, enrollment.hostType, enrollment.hostId), enrollment.tokenHash, timestamp(enrollment.expiresAt), timestamp(enrollment.usedAt, null as any), timestamp(enrollment.revokedAt, null as any), timestamp(enrollment.createdAt, now))
  }
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.agent-extended-state', json({
    enrollments: snapshot.agents?.enrollments ?? {},
    deviceExtensions: Object.fromEntries(records(snapshot.agents?.devices).map((device) => [String(device.id), device])),
    hardwareSnapshots: snapshot.agents?.hardwareSnapshots ?? {},
    hardwareEvents: snapshot.agents?.hardwareEvents ?? {},
    status: snapshot.agentStatus ?? {},
  }), now)
}

function importAuthentication(database: Database, snapshot: LegacySnapshot, now: number) {
  persistAuthenticationState(database, snapshot.authentication ?? {}, now)
}

function importNotifications(database: Database, snapshot: LegacySnapshot, plan: CanonicalIdentityPlan, now: number) {
  const config = snapshot.notifications ?? {}
  database.query('INSERT INTO notification_settings (id, revision, enabled, incident_retention_days, delivery_attempt_retention_days, last_evaluated_at_ms, created_at_ms, updated_at_ms) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(positiveIntegerOrNull(config.revision) ?? 1, Number(config.enabled === true), positiveIntegerOrNull(config.incidentRetentionDays) ?? 90, positiveIntegerOrNull(config.deliveryAttemptRetentionDays) ?? 30, timestamp(config.lastEvaluatedAt, null as any), now, timestamp(config.updatedAt, now))
  for (const point of records(config.contactPoints)) database.query('INSERT INTO notification_contact_points (id, type, name, enabled, secret_id, config_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)').run(point.id, point.type, point.name, Number(point.enabled !== false), json(point.config ?? {}), timestamp(point.createdAt, now), timestamp(point.updatedAt, now))
  for (const incident of records(snapshot.notificationState?.incidents)) database.query('INSERT INTO incidents (id, host_item_id, event_key, event_type, severity, title, summary, state, opened_at_ms, resolved_at_ms, notification_delivered_at_ms, last_reminder_at_ms, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(incident.id, canonicalItemId(plan, incident.hostType, incident.hostId), incident.eventKey, incident.eventType, incident.severity, incident.title, incident.summary, incident.state, timestamp(incident.openedAt, now), timestamp(incident.resolvedAt, null as any), timestamp(incident.notificationDeliveredAt, null as any), timestamp(incident.lastReminderAt, null as any), timestamp(incident.createdAt, now), timestamp(incident.updatedAt, now))
  for (const delivery of records(snapshot.notificationState?.deliveryJobs)) database.query('INSERT INTO notification_deliveries (id, incident_id, contact_point_id, kind, state, idempotency_key, attempt_count, available_at_ms, delivered_at_ms, last_error, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(delivery.id, delivery.incidentId, delivery.contactPointId, delivery.kind, delivery.state, delivery.idempotencyKey, integerOrNull(delivery.attemptCount) ?? 0, timestamp(delivery.availableAt, now), timestamp(delivery.deliveredAt, null as any), optionalText(delivery.lastError), timestamp(delivery.createdAt, now), timestamp(delivery.updatedAt, now))
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.notification-extended-state', json({ config: Object.fromEntries(Object.entries(config).filter(([key]) => !['revision', 'enabled', 'incidentRetentionDays', 'deliveryAttemptRetentionDays', 'contactPoints', 'updatedAt'].includes(key))), state: Object.fromEntries(Object.entries(snapshot.notificationState ?? {}).filter(([key]) => !['incidents', 'deliveryJobs'].includes(key))), secrets: snapshot.notificationSecrets ?? {} }), now)
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('runtime.notification-store', json({
    config: snapshot.notifications ?? {},
    state: snapshot.notificationState ?? {},
    secrets: snapshot.notificationSecrets ?? {},
  }), now)
}

function importBackups(database: Database, snapshot: LegacySnapshot, now: number) {
  const backups = snapshot.backupManagement ?? {}
  const schedule = backups.schedule ?? {}
  database.query('INSERT INTO backup_schedules (id, enabled, frequency, local_time, weekday, timezone, retention_count, next_run_at_ms, last_run_at_ms, last_result, updated_at_ms) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(Number(schedule.enabled === true), schedule.frequency ?? 'daily', schedule.time ?? schedule.localTime ?? '02:00', integerOrNull(schedule.weekday) ?? 0, optionalText(schedule.timezone), positiveIntegerOrNull(schedule.retention ?? schedule.retentionCount) ?? 7, timestamp(schedule.nextRunAt, null as any), timestamp(schedule.lastRunAt, null as any), optionalText(schedule.lastResult), timestamp(schedule.updatedAt, now))
  for (const backup of records(backups.backups)) database.query('INSERT INTO backup_runs (id, kind, label, state, format_version, selected_sections_json, path, size_bytes, digest, error_code, started_at_ms, completed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(backup.id, backup.kind, backup.label, backup.state, positiveIntegerOrNull(backup.formatVersion) ?? 1, json(backup.selectedSections ?? []), optionalText(backup.path), integerOrNull(backup.sizeBytes), optionalText(backup.digest), optionalText(backup.errorCode), timestamp(backup.startedAt, now), timestamp(backup.completedAt, null as any))
  database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.backup-extended-state', json({ nextBackupId: backups.nextBackupId, nextRestoreId: backups.nextRestoreId, backups: backups.backups ?? [], restores: backups.restores ?? [], operation: backups.operation ?? null }), now)
}

export function importLegacyCore({ database, snapshot, identityPlan }: ImportLegacyCoreOptions) {
  if (snapshot.meta?.schemaVersion !== 29) throw new Error('Core import requires a normalized schema-29 legacy snapshot.')
  if ((database.query('SELECT count(*) AS count FROM inventory_items').get() as { count: number }).count !== 0) throw new Error('Core import target must not contain inventory records.')
  const now = timestamp(snapshot.meta?.updatedAt, Date.now())
  const migrate = database.transaction(() => {
    importInventory(database, snapshot, identityPlan, now)
    importProject(database, snapshot, identityPlan, now)
    importRoutingCache(database, snapshot, identityPlan, now)
    importRegistry(database, snapshot, identityPlan, now)
    importAgents(database, snapshot, identityPlan, now)
    importAuthentication(database, snapshot, now)
    importNotifications(database, snapshot, identityPlan, now)
    importBackups(database, snapshot, now)
    database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.schema-version', json(29), now)
    database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)').run('legacy.application-meta', json({
      appLastOpenedWith: snapshot.meta?.appLastOpenedWith ?? null,
      lastSeenReleaseNotesVersion: snapshot.meta?.lastSeenReleaseNotesVersion ?? null,
      skippedUpdateVersion: snapshot.meta?.skippedUpdateVersion ?? null,
      lastUpdateCheck: snapshot.meta?.lastUpdateCheck ?? null,
      onboarding: snapshot.meta?.onboarding ?? null,
    }), now)
  })
  migrate.immediate()
  return { projectId: 1, systemsWorkspaceId: 1, canvasWorkspaceId: 2 }
}
