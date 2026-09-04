import type { Database } from 'bun:sqlite'
import type { InventoryItem, InventoryPort, ProjectState } from '../../../../src/types/inventory.ts'
import { withCanonicalPowerPorts } from '../../../../shared/power-ports.mjs'
import { LEGACY_TABLE_BY_TYPE } from '../../legacy/identity-plan.ts'

type Row = Record<string, any>

function one(database: Database, sql: string, ...values: any[]) {
  return database.query(sql).get(...values) as Row | null
}

function all(database: Database, sql: string, ...values: any[]) {
  return database.query(sql).all(...values) as Row[]
}

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return structuredClone(fallback)
  return JSON.parse(value) as T
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)) as T
}

function mergeRecords(base: unknown, override: unknown): Row | undefined {
  const left = base && typeof base === 'object' && !Array.isArray(base) ? base as Row : undefined
  const right = override && typeof override === 'object' && !Array.isArray(override) ? override as Row : undefined
  if (!left && !right) return undefined
  const result: Row = structuredClone(left ?? {})
  for (const [key, value] of Object.entries(right ?? {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeRecords(result[key], value)
      : structuredClone(value)
  }
  return result
}

const AUTHORITATIVE_HOST_RESOURCE_COLLECTIONS = [
  'storageSlots',
  'expansionSlots',
  'optionalModuleSlots',
  'controllerSlots',
  'bootDeviceSlots',
  'coolingProfiles',
]

function mergeCompatibilityProjection(base: unknown, relational: unknown) {
  const merged = mergeRecords(base, relational)
  const relationalHost = relational && typeof relational === 'object' && !Array.isArray(relational)
    ? (relational as Row).host
    : undefined
  if (!merged?.host || !relationalHost) return merged
  for (const collection of AUTHORITATIVE_HOST_RESOURCE_COLLECTIONS) {
    if (Object.hasOwn(relationalHost, collection)) {
      merged.host[collection] = structuredClone(relationalHost[collection])
    } else {
      delete merged.host[collection]
    }
  }
  return merged
}

function pointerSegments(path: string) {
  return path.split('/').slice(1).map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function extensionRowValue(row: Row) {
  switch (row.value_type) {
    case 'text': return row.text_value
    case 'integer': return row.integer_value
    case 'real': return row.real_value
    case 'boolean': return Boolean(row.boolean_value)
    case 'null': return null
    case 'array': return []
    case 'object': return {}
    default: throw new Error(`Unknown network extension value type ${String(row.value_type)}.`)
  }
}

function setPointerValue(root: Row, path: string, value: unknown) {
  const segments = pointerSegments(path)
  if (!segments.length) return
  let target: Row | unknown[] = root
  for (const [index, segment] of segments.entries()) {
    const final = index === segments.length - 1
    const key = Array.isArray(target) ? Number(segment) : segment
    if (final) {
      ;(target as any)[key] = value
      return
    }
    const nextIsArray = /^\d+$/u.test(segments[index + 1])
    if ((target as any)[key] == null) (target as any)[key] = nextIsArray ? [] : {}
    target = (target as any)[key]
  }
}

function networkExtensions(database: Database, adapterId: number) {
  const result: Row = {}
  const rows = all(database, `
    SELECT * FROM network_adapter_extension_values
    WHERE adapter_id = ?
    ORDER BY length(field_path), field_path
  `, adapterId)
  for (const row of rows) setPointerValue(result, row.field_path, extensionRowValue(row))
  return result
}

function aliasKey(row: Row) {
  return `${row.legacy_type_key}:${row.legacy_id}`
}

function vocabulary(database: Database, table: string, id: number | null) {
  if (id == null) return undefined
  const row = database.query(`SELECT key, label FROM ${table} WHERE id = ?`).get(id) as { key: string; label: string } | null
  if (!row) return undefined
  if (table === 'storage_form_factors' && row.key.startsWith('m2-')) return row.key.slice(3)
  return row.label
}

function speedLabel(value: number | null) {
  if (value == null) return undefined
  if (value >= 1_000_000_000 && value % 100_000_000 === 0) return `${value / 1_000_000_000}G`
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`
  return `${value}bps`
}

function legacyPort(database: Database, row: Row, itemType: string): InventoryPort {
  const kind = row.kind_key === 'power-input' || row.kind_key === 'power-output'
    ? 'power-port'
    : itemType === 'switch' ? 'switch-port'
      : itemType === 'patchPanel' ? 'keystone'
        : ['server', 'nas', 'pcBuild'].includes(itemType) && row.kind_key === 'network' ? 'server-port'
          : row.kind_key
  const type = row.kind_key === 'power-input'
    ? 'ac-input'
    : row.kind_key === 'power-output' ? 'ac-outlet' : row.connector_key
  const endpoints = all(database, 'SELECT endpoint_number AS id, side FROM port_endpoint_faces WHERE port_id = ? ORDER BY endpoint_number', row.port_id)
  return defined({
    id: row.legacy_port_id,
    key: row.semantic_key,
    kind,
    type,
    slotNumber: row.slot_number,
    label: row.label,
    notes: row.notes,
    ipAddress: row.ip_address,
    role: row.role,
    speed: speedLabel(row.speed_bps),
    poe: row.poe == null ? undefined : Boolean(row.poe),
    origin: row.origin,
    endpoints: endpoints.length ? endpoints : undefined,
  }) as InventoryPort
}

function itemPorts(database: Database, itemId: number, itemType: string) {
  return all(database, `
    SELECT ip.id AS port_id, pia.legacy_port_id, d.semantic_key, d.slot_number,
           d.label, d.notes, d.ip_address, d.role, d.speed_bps, d.poe, d.origin,
           pk.key AS kind_key, ct.key AS connector_key
    FROM inventory_ports ip
    JOIN port_identity_aliases pia ON pia.port_id = ip.id
    JOIN item_port_details d ON d.port_id = ip.id
    JOIN port_kinds pk ON pk.id = d.kind_id
    JOIN connector_types ct ON ct.id = d.connector_type_id
    WHERE ip.item_id = ?
    ORDER BY d.slot_number, pia.legacy_port_id
  `, itemId).map((row) => {
    const port = legacyPort(database, row, itemType) as Row
    if (itemType !== 'network') return port as InventoryPort
    const network = one(database, 'SELECT * FROM network_adapter_ports WHERE port_id = ?', row.port_id)
    if (!network) return port as InventoryPort
    const local = one(database, 'SELECT * FROM network_port_local_overrides WHERE port_id = ?', row.port_id)
    return defined({
      ...port,
      speed: undefined,
      label: local?.label ?? port.label,
      ipAddress: local?.ip_address ?? port.ipAddress,
      macAddress: local?.mac_address,
      role: local?.role ?? port.role,
      adminState: local?.admin_state,
      speedBps: row.speed_bps,
      networkTechnology: network.network_technology,
      vendorLock: network.vendor_lock == null ? undefined : Boolean(network.vendor_lock),
      supportedSpeedsBps: all(database, 'SELECT speed_bps FROM network_adapter_port_supported_speeds WHERE port_id = ? ORDER BY speed_bps', row.port_id).map((entry) => entry.speed_bps),
      operatingModes: all(database, 'SELECT mode FROM network_adapter_port_operating_modes WHERE port_id = ? ORDER BY mode', row.port_id).map((entry) => entry.mode),
      media: all(database, 'SELECT medium FROM network_adapter_port_media WHERE port_id = ? ORDER BY medium', row.port_id).map((entry) => entry.medium),
    }) as InventoryPort
  })
}

function subtypeSpecs(database: Database, item: Row) {
  const id = item.id
  switch (item.type_key) {
    case 'server': {
      const row = one(database, `SELECT s.*, c.label AS chassis FROM servers s LEFT JOIN chassis_types c ON c.id = s.chassis_type_id WHERE s.id = ?`, id)!
      return { fields: defined({ hardwareClass: row.hardware_class, usageRole: row.usage_role }), specs: defined({ formFactor: row.chassis ?? row.form_factor_text, networkSlot: row.network_slot, wireless: row.wireless }) }
    }
    case 'nas': {
      const row = one(database, 'SELECT * FROM nas_systems WHERE id = ?', id)!
      return { specs: defined({
        driveBays: row.drive_bay_count,
        m2Slots: row.m2_slot_count,
        powerConfiguration: row.power_configuration,
        formFactor: row.form_factor_text,
        platformFamily: row.platform_family,
        variantKey: row.variant_key,
        hardwareRevision: row.hardware_revision,
        boardRevision: row.board_revision,
        releaseDate: row.release_date_text,
        discontinued: row.discontinued == null ? undefined : Boolean(row.discontinued),
        widthMm: row.width_mm,
        heightMm: row.height_mm,
        depthMm: row.depth_mm,
        massGrams: row.mass_grams,
        rackUnits: row.rack_units,
      }) }
    }
    case 'pcBuild': { const row = one(database, 'SELECT * FROM pc_builds WHERE id = ?', id)!; return { fields: defined({ usageRole: row.usage_role }), specs: defined({ operatingSystem: row.operating_system }) } }
    case 'cpu': { const row = one(database, 'SELECT * FROM cpus WHERE id = ?', id)!; return { specs: defined({ cores: row.core_count, threads: row.thread_count, baseClockGhz: row.base_clock_mhz == null ? undefined : row.base_clock_mhz / 1000, boostClockGhz: row.boost_clock_mhz == null ? undefined : row.boost_clock_mhz / 1000 }) } }
    case 'ram': { const row = one(database, 'SELECT * FROM memory_modules WHERE id = ?', id)!; return { specs: defined({ capacityGb: row.capacity_mib == null ? undefined : row.capacity_mib / 1024, generation: vocabulary(database, 'memory_generations', row.memory_generation_id), speedMt: row.speed_mtps, formFactor: row.form_factor, moduleType: vocabulary(database, 'memory_module_types', row.module_type_id), ecc: row.ecc == null ? undefined : Boolean(row.ecc), rank: row.rank, voltageVolts: row.voltage_mv == null ? undefined : row.voltage_mv / 1000 }) } }
    case 'storage': { const row = one(database, 'SELECT * FROM storage_devices WHERE id = ?', id)!; return { specs: defined({ capacityGb: row.capacity_bytes == null ? undefined : row.capacity_bytes / 1_000_000_000, interface: vocabulary(database, 'storage_interfaces', row.interface_id) ?? row.interface_text, formFactor: vocabulary(database, 'storage_form_factors', row.form_factor_id) ?? row.form_factor_text, partitionTable: row.partition_table }) } }
    case 'gpu': { const row = one(database, 'SELECT * FROM graphics_cards WHERE id = ?', id)!; return { specs: defined({ vramGb: row.vram_mib == null ? undefined : row.vram_mib / 1024, formFactor: row.form_factor, slotWidth: row.slot_width, pcie: row.pcie }) } }
    case 'network': {
      const row = one(database, 'SELECT * FROM network_adapters WHERE id = ?', id)!
      const hostInterface = one(database, 'SELECT * FROM network_adapter_host_interfaces WHERE adapter_id = ?', id)
      const capabilities = one(database, 'SELECT * FROM network_adapter_capabilities WHERE adapter_id = ?', id)
      const operatingModes = all(database, 'SELECT mode FROM network_adapter_operating_modes WHERE adapter_id = ? ORDER BY mode', id).map((entry) => entry.mode)
      const wifiGenerations = all(database, 'SELECT generation FROM network_adapter_wifi_generations WHERE adapter_id = ? ORDER BY generation', id).map((entry) => entry.generation)
      const frequencyBandsGhz = all(database, 'SELECT frequency_mhz FROM network_adapter_frequency_bands WHERE adapter_id = ? ORDER BY frequency_mhz', id).map((entry) => entry.frequency_mhz / 1000)
      const requiredBuses = all(database, `
        SELECT family, minimum_lanes, minimum_pcie_generation, minimum_usb_generation
        FROM network_adapter_required_buses WHERE adapter_id = ? ORDER BY family
      `, id).map((entry) => defined({
        family: entry.family,
        minimumLanes: entry.minimum_lanes,
        minimumPcieGeneration: entry.minimum_pcie_generation,
        minimumUsbGeneration: entry.minimum_usb_generation,
      }))
      const requirements = defined({
        interfaceFamily: hostInterface?.family,
        interfaceKey: hostInterface?.interface_key,
        key: hostInterface?.key,
        moduleSize: hostInterface?.module_size,
        usbGeneration: hostInterface?.usb_generation,
        connector: hostInterface?.connector,
        ocpVersion: hostInterface?.ocp_version,
        pcieGeneration: hostInterface?.pcie_generation,
        connectorLanes: hostInterface?.connector_lanes,
        minimumElectricalLanes: hostInterface?.minimum_electrical_lanes,
        requiredBuses: requiredBuses.length ? requiredBuses : undefined,
        height: row.card_height,
        slotWidth: row.slot_width,
        powerMw: row.power_mw,
      })
      return { specs: defined({
        networkTechnology: row.network_technology,
        controller: row.controller,
        formFactor: row.form_factor,
        maxSpeedBps: row.max_speed_bps,
        maxPhyRateBps: row.max_phy_rate_bps,
        spatialStreams: row.spatial_streams,
        bluetoothVersion: row.bluetooth_version,
        antennaTopology: row.antenna_topology,
        hardwareRevision: row.hardware_revision,
        discontinued: row.discontinued == null ? undefined : Boolean(row.discontinued),
        hostInterface: hostInterface ? defined({
          family: hostInterface.family,
          pcieGeneration: hostInterface.pcie_generation,
          connectorLanes: hostInterface.connector_lanes,
          minimumElectricalLanes: hostInterface.minimum_electrical_lanes,
          key: hostInterface.key,
          moduleSize: hostInterface.module_size,
          usbGeneration: hostInterface.usb_generation,
          connector: hostInterface.connector,
          ocpVersion: hostInterface.ocp_version,
          interfaceKey: hostInterface.interface_key,
          requiredBuses: requiredBuses.length ? requiredBuses : undefined,
        }) : undefined,
        operatingModes: operatingModes.length > 0 ? operatingModes : undefined,
        wifiGenerations: wifiGenerations.length > 0 ? wifiGenerations : undefined,
        frequencyBandsGhz: frequencyBandsGhz.length > 0 ? frequencyBandsGhz : undefined,
        capabilities: capabilities ? defined({
          sriov: capabilities.sriov == null ? undefined : Boolean(capabilities.sriov),
          ptp: capabilities.ptp == null ? undefined : Boolean(capabilities.ptp),
          pxe: capabilities.pxe == null ? undefined : Boolean(capabilities.pxe),
          uefiBoot: capabilities.uefi_boot == null ? undefined : Boolean(capabilities.uefi_boot),
          wakeOnLan: capabilities.wake_on_lan == null ? undefined : Boolean(capabilities.wake_on_lan),
          rdmaModes: all(database, 'SELECT mode FROM network_adapter_rdma_modes WHERE adapter_id = ? ORDER BY mode', id).map((entry) => entry.mode),
          offloads: all(database, 'SELECT offload FROM network_adapter_offloads WHERE adapter_id = ? ORDER BY offload', id).map((entry) => entry.offload),
        }) : undefined,
      }), compatibility: Object.keys(requirements).length ? { requirements: { expansion: requirements } } : undefined }
    }
    case 'motherboard': { const row = one(database, 'SELECT * FROM motherboards WHERE id = ?', id)!; return { specs: defined({ chipset: row.chipset, formFactor: row.form_factor, boardRevision: row.board_revision, launchDate: row.launch_date_text, discontinued: row.discontinued == null ? undefined : Boolean(row.discontinued), wifiGeneration: row.wifi_generation, bluetooth: row.bluetooth }) } }
    case 'cpuCooler': { const row = one(database, 'SELECT * FROM cpu_coolers WHERE id = ?', id)!; return { specs: defined({ coolerType: row.cooler_type }) } }
    case 'case': return { specs: defined({ formFactors: all(database, 'SELECT form_factor FROM case_form_factor_support WHERE case_id = ? ORDER BY id', id).map((row) => row.form_factor) }) }
    case 'powerSupply': { const row = one(database, 'SELECT * FROM power_supplies WHERE id = ?', id)!; const connectors = all(database, `SELECT coalesce(v.label, c.connector_text) AS type, c.count FROM power_supply_connectors c LEFT JOIN power_connector_types v ON v.id = c.connector_type_id WHERE c.power_supply_id = ? ORDER BY c.id`, id); return { specs: defined({ formFactor: row.form_factor, wattageWatts: row.rated_power_mw == null ? undefined : row.rated_power_mw / 1000, efficiency: row.efficiency_rating, connectors: connectors.length ? connectors : undefined }) } }
    case 'soundCard': { const row = one(database, 'SELECT * FROM sound_cards WHERE id = ?', id)!; return { specs: defined({ interface: row.interface }) } }
    case 'powerAdapter': { const row = one(database, 'SELECT * FROM power_adapters WHERE id = ?', id)!; return { specs: defined({ wattageWatts: row.rated_power_mw == null ? undefined : row.rated_power_mw / 1000, connector: vocabulary(database, 'power_connector_types', row.connector_type_id) ?? row.connector_text }) } }
    case 'switch': { const row = one(database, 'SELECT * FROM network_switches WHERE id = ?', id)!; return { specs: defined({ management: row.management_type, switchingCapacityGbps: row.switching_capacity_bps == null ? undefined : row.switching_capacity_bps / 1_000_000_000, fanless: Boolean(row.fanless) }) } }
    case 'patchPanel': { const row = one(database, 'SELECT * FROM patch_panels WHERE id = ?', id)!; return { specs: defined({ rackUnits: row.rack_units, mount: row.mount }) } }
    case 'monitor': { const row = one(database, 'SELECT * FROM monitors WHERE id = ?', id)!; return { specs: defined({ sizeInches: row.diagonal_mm == null ? undefined : row.diagonal_mm / 25.4, resolution: row.resolution, refreshRateHz: row.refresh_rate_millihz == null ? undefined : row.refresh_rate_millihz / 1000 }) } }
    case 'ups': { const row = one(database, 'SELECT * FROM ups_systems WHERE id = ?', id)!; return { specs: defined({ wattageWatts: row.rated_power_mw == null ? undefined : row.rated_power_mw / 1000, capacityVa: row.capacity_millivolt_amps == null ? undefined : row.capacity_millivolt_amps / 1000, batteryBackupOutlets: row.battery_outlet_count, surgeProtectedOutlets: row.surge_outlet_count, outlets: row.outlet_count }) } }
    case 'powerStrip': { const row = one(database, 'SELECT * FROM power_strips WHERE id = ?', id)!; return { specs: defined({ outlets: row.outlet_count, surgeProtected: row.surge_protected == null ? undefined : Boolean(row.surge_protected), surgeProtectedOutlets: row.surge_outlet_count }) } }
    default: return { specs: {} }
  }
}

function hostCompatibility(database: Database, itemId: number) {
  const profile = one(database, 'SELECT * FROM host_compatibility_profiles WHERE host_item_id = ?', itemId)
  if (!profile) return undefined
  const host: Row = defined({ topologyCompleteness: profile.topology_completeness, maxExpansionPowerWatts: profile.max_expansion_power_mw == null ? undefined : profile.max_expansion_power_mw / 1000 })
  const cpu = one(database, 'SELECT * FROM host_cpu_profiles WHERE host_profile_id = ?', profile.id)
  if (cpu) host.cpu = defined({
    socketCount: cpu.socket_count,
    sockets: all(database, 'SELECT v.label FROM host_cpu_socket_support s JOIN cpu_socket_types v ON v.id = s.socket_type_id WHERE s.cpu_profile_id = ? ORDER BY s.id', cpu.id).map((row) => row.label),
    generations: all(database, 'SELECT generation FROM host_cpu_generation_support WHERE cpu_profile_id = ? ORDER BY id', cpu.id).map((row) => row.generation),
    maxTdpWatts: cpu.max_tdp_mw == null ? undefined : cpu.max_tdp_mw / 1000,
    populationModes: all(database, 'SELECT populated_socket_count FROM host_cpu_population_modes WHERE cpu_profile_id = ? ORDER BY populated_socket_count', cpu.id).map((row) => row.populated_socket_count),
  })
  const memory = one(database, 'SELECT * FROM host_memory_profiles WHERE host_profile_id = ?', profile.id)
  if (memory) host.memory = defined({
    slots: memory.slot_count,
    slotsPerCpu: memory.slots_per_cpu,
    maxCapacityGb: memory.max_capacity_mib == null ? undefined : memory.max_capacity_mib / 1024,
    maxModuleCapacityGb: memory.max_module_capacity_mib == null ? undefined : memory.max_module_capacity_mib / 1024,
    oemMaxCapacityMib: memory.oem_max_capacity_mib,
    oemMaxModuleCapacityMib: memory.oem_max_module_capacity_mib,
    verifiedMaxCapacityMib: memory.verified_max_capacity_mib,
    verifiedMaxModuleCapacityMib: memory.verified_max_module_capacity_mib,
    maxSpeedMt: memory.max_speed_mtps,
    eccSupport: memory.ecc_support,
    generations: all(database, 'SELECT v.label FROM host_memory_generation_support s JOIN memory_generations v ON v.id = s.generation_id WHERE s.memory_profile_id = ? ORDER BY s.id', memory.id).map((row) => row.label),
    formFactors: all(database, 'SELECT form_factor FROM host_memory_form_factor_support WHERE memory_profile_id = ? ORDER BY id', memory.id).map((row) => row.form_factor),
    moduleTypes: all(database, 'SELECT v.label FROM host_memory_module_type_support s JOIN memory_module_types v ON v.id = s.module_type_id WHERE s.memory_profile_id = ? ORDER BY s.id', memory.id).map((row) => row.label),
  })
  const groups = all(database, `
    SELECT g.*, a.legacy_resource_key, a.legacy_resource_group_id,
           s.pcie_generation AS storage_pcie_generation,
           s.hot_swap, s.backplane, s.direct_connect,
           e.pcie_generation AS expansion_pcie_generation,
           e.interface_family, e.interface_key, e.keying, e.module_size,
           e.usb_generation, e.connector, e.ocp_version,
           est.label AS expansion_slot_type,
           e.mechanical_lanes, e.electrical_lanes, e.max_slot_width,
           e.max_power_mw, e.proprietary_riser, e.riser_capability, e.riser_group,
           om.interface_family AS optional_module_interface_family,
           om.bus_evidence_state AS optional_module_bus_evidence_state
    FROM host_resource_groups g
    JOIN resource_identity_aliases a ON a.resource_id = g.resource_identity_id
    LEFT JOIN storage_resource_groups s ON s.id = g.id
    LEFT JOIN expansion_resource_groups e ON e.id = g.id
    LEFT JOIN optional_module_resource_groups om ON om.id = g.id
    LEFT JOIN expansion_slot_types est ON est.id = e.expansion_slot_type_id
    WHERE g.host_item_id = ? AND g.resource_type NOT IN ('cpu', 'memory', 'powerAdapter', 'psuBay', 'power')
    ORDER BY g.id
  `, itemId)
  const collectionByType: Record<string, string> = { storage: 'storageSlots', expansion: 'expansionSlots', optionalModule: 'optionalModuleSlots', controllerSlot: 'controllerSlots', bootDeviceSlot: 'bootDeviceSlots', coolingProfile: 'coolingProfiles' }
  const groupIds = new Map<number, number>()
  const collectionCounts = new Map<string, number>()
  for (const group of groups) {
    const collection = collectionByType[group.resource_type]
    if (!collection) continue
    host[collection] ??= []
    const id = group.legacy_resource_group_id ?? ((collectionCounts.get(collection) ?? 0) + 1)
    collectionCounts.set(collection, Math.max(collectionCounts.get(collection) ?? 0, id))
    groupIds.set(group.id, id)
    const entry: Row = defined({ id, key: group.semantic_key, label: group.label, count: group.slot_count, requiredCpuSockets: group.required_cpu_sockets, location: group.location })
    const acceptedKinds = all(database, 'SELECT kind FROM resource_accepted_kinds WHERE resource_group_id = ? ORDER BY id', group.id).map((row) => row.kind)
    if (group.resource_type === 'storage') {
      entry.interfaces = all(database, 'SELECT v.label FROM storage_resource_interfaces r JOIN storage_interfaces v ON v.id = r.interface_id WHERE r.resource_group_id = ? ORDER BY r.id', group.id).map((row) => row.label)
      entry.formFactors = all(database, `SELECT CASE WHEN v.key LIKE 'm2-%' THEN substr(v.key, 4) ELSE v.label END AS value FROM storage_resource_form_factors r JOIN storage_form_factors v ON v.id = r.form_factor_id WHERE r.resource_group_id = ? ORDER BY r.id`, group.id).map((row) => row.value)
      Object.assign(entry, defined({ pcieGeneration: group.storage_pcie_generation, hotSwap: group.hot_swap == null ? undefined : Boolean(group.hot_swap), backplane: group.backplane, directConnect: group.direct_connect == null ? undefined : Boolean(group.direct_connect) }))
    }
    if (group.resource_type === 'expansion') Object.assign(entry, defined({ interfaceFamily: group.interface_family, interfaceKey: group.interface_key, keying: group.keying, moduleSize: group.module_size, usbGeneration: group.usb_generation, connector: group.connector, ocpVersion: group.ocp_version, slotType: group.expansion_slot_type, pcieGeneration: group.expansion_pcie_generation, mechanicalLanes: group.mechanical_lanes, electricalLanes: group.electrical_lanes, acceptedHeights: all(database, 'SELECT height FROM expansion_accepted_heights WHERE resource_group_id = ? ORDER BY id', group.id).map((row) => row.height), maxSlotWidth: group.max_slot_width, maxPowerWatts: group.max_power_mw == null ? undefined : group.max_power_mw / 1000, proprietaryRiser: group.proprietary_riser == null ? undefined : Boolean(group.proprietary_riser), riserCapability: group.riser_capability, riserGroup: group.riser_group }))
    if (group.resource_type === 'optionalModule') {
      const aliases = all(database, `
        SELECT alias FROM optional_module_resource_aliases
        WHERE resource_group_id = ? ORDER BY id
      `, group.id).map((row) => row.alias).filter((alias) => alias !== group.semantic_key)
      const socketKeys = all(database, `
        SELECT key FROM optional_module_accepted_keys
        WHERE resource_group_id = ? ORDER BY id
      `, group.id).map((row) => row.key)
      const moduleSizes = all(database, `
        SELECT module_size FROM optional_module_sizes
        WHERE resource_group_id = ? ORDER BY id
      `, group.id).map((row) => row.module_size)
      const availableBuses = all(database, `
        SELECT family, lanes, pcie_generation, usb_generation
        FROM optional_module_available_buses
        WHERE resource_group_id = ? ORDER BY id
      `, group.id).map((row) => defined({
        family: row.family,
        lanes: row.lanes,
        pcieGeneration: row.pcie_generation,
        usbGeneration: row.usb_generation,
      }))
      const intendedModuleKinds = all(database, `
        SELECT kind FROM optional_module_intended_kinds
        WHERE resource_group_id = ? ORDER BY id
      `, group.id).map((row) => row.kind)
      Object.assign(entry, defined({
        acceptedModuleKinds: acceptedKinds.length ? acceptedKinds : undefined,
        keyAliases: aliases.length ? aliases : undefined,
        interfaceFamily: group.optional_module_interface_family,
        socketKeys: socketKeys.length ? socketKeys : undefined,
        moduleSizes: moduleSizes.length ? moduleSizes : undefined,
        availableBuses: group.optional_module_bus_evidence_state === 'recorded'
          ? availableBuses
          : undefined,
        intendedModuleKinds: intendedModuleKinds.length ? intendedModuleKinds : undefined,
      }))
    }
    if (group.resource_type === 'controllerSlot') {
      const controller = one(database, 'SELECT * FROM controller_resource_groups WHERE id = ?', group.id)
      Object.assign(entry, defined({ acceptedControllerKinds: acceptedKinds.length ? acceptedKinds : undefined, interfaceFamily: controller?.interface_family, dedicated: controller?.dedicated == null ? undefined : Boolean(controller.dedicated) }))
    }
    if (group.resource_type === 'bootDeviceSlot') {
      const boot = one(database, 'SELECT * FROM boot_device_resource_groups WHERE id = ?', group.id)
      entry.acceptedDeviceKinds = acceptedKinds.length ? acceptedKinds : undefined
      entry.interfaces = all(database, 'SELECT v.label FROM boot_device_resource_interfaces r JOIN storage_interfaces v ON v.id = r.interface_id WHERE r.boot_device_resource_group_id = ? ORDER BY r.id', group.id).map((row) => row.label)
      entry.formFactors = all(database, `SELECT CASE WHEN v.key LIKE 'm2-%' THEN substr(v.key, 4) ELSE v.label END AS value FROM boot_device_resource_form_factors r JOIN storage_form_factors v ON v.id = r.form_factor_id WHERE r.boot_device_resource_group_id = ? ORDER BY r.id`, group.id).map((row) => row.value)
      if (boot?.controller_resource_group_id != null) entry.__controllerResourceGroupId = boot.controller_resource_group_id
    }
    if (group.resource_type === 'coolingProfile') {
      const cooling = one(database, 'SELECT * FROM cooling_resource_groups WHERE id = ?', group.id)
      delete entry.count
      Object.assign(entry, defined({ fanCount: cooling?.fan_count, redundant: cooling?.redundant == null ? undefined : Boolean(cooling.redundant), conditions: all(database, 'SELECT condition FROM cooling_conditions WHERE resource_group_id = ? ORDER BY id', group.id).map((row) => row.condition) }))
    }
    host[collection].push(entry)
  }
  for (const entry of host.bootDeviceSlots ?? []) {
    if (entry.__controllerResourceGroupId != null) entry.controllerSlotId = groupIds.get(entry.__controllerResourceGroupId)
    delete entry.__controllerResourceGroupId
  }
  for (const group of groups.filter((entry) => entry.resource_type === 'storage')) {
    const entry = host.storageSlots?.find((candidate: Row) => candidate.key === group.semantic_key)
    if (!entry) continue
    const controllerSlotIds = all(database, 'SELECT controller_resource_group_id FROM storage_resource_controllers WHERE storage_resource_group_id = ? ORDER BY id', group.id).map((row) => groupIds.get(row.controller_resource_group_id)).filter(Boolean)
    if (controllerSlotIds.length) entry.controllerSlotIds = controllerSlotIds
  }
  const power = one(database, 'SELECT * FROM host_power_profiles WHERE host_profile_id = ?', profile.id)
  if (power) host.power = defined({
    configuration: power.configuration,
    adapterDisposition: power.adapter_disposition,
    connector: power.connector,
    supportedPowerMw: all(database, 'SELECT power_mw FROM host_power_supported_wattages WHERE power_profile_id = ? ORDER BY power_mw', power.id).map((row) => row.power_mw),
    supportedWattagesWatts: all(database, 'SELECT power_mw FROM host_power_supported_wattages WHERE power_profile_id = ? ORDER BY power_mw', power.id).map((row) => row.power_mw / 1000),
    adapterRequired: power.adapter_required == null ? undefined : Boolean(power.adapter_required),
    adapterType: power.adapter_type,
    redundancy: power.redundancy,
    maxGraphicsPowerWatts: power.max_graphics_power_mw == null ? undefined : power.max_graphics_power_mw / 1000,
    psuBayCount: power.psu_bay_count,
    psuType: power.psu_type,
    mixedPsuAllowed: power.mixed_psu_allowed == null ? undefined : Boolean(power.mixed_psu_allowed),
    redundancyModes: all(database, 'SELECT mode FROM host_power_redundancy_modes WHERE power_profile_id = ? ORDER BY id', power.id).map((row) => row.mode),
  })
  const management = one(database, 'SELECT * FROM management_controllers WHERE host_profile_id = ?', profile.id)
  if (management) host.management = defined({ controllerFamily: management.controller_family, controllerGeneration: management.controller_generation, dedicatedPort: management.dedicated_port == null ? undefined : Boolean(management.dedicated_port), sharedNic: management.shared_nic == null ? undefined : Boolean(management.shared_nic), portType: management.port_type, speed: speedLabel(management.speed_bps) })
  const powerConnectors = all(database, `SELECT g.id, g.semantic_key, g.label, p.kind, p.connector, p.count, p.required FROM host_resource_groups g JOIN host_power_connector_groups p ON p.id = g.id WHERE g.host_item_id = ? ORDER BY g.id`, itemId)
  if (powerConnectors.length) host.powerConnectors = powerConnectors.map((entry, index) => ({ id: index + 1, key: entry.semantic_key, label: entry.label, kind: entry.kind, connector: entry.connector, count: entry.count, required: Boolean(entry.required) }))
  const constraints = all(database, 'SELECT * FROM compatibility_constraint_groups WHERE host_profile_id = ? ORDER BY id', profile.id)
  if (constraints.length) host.constraintGroups = constraints.map((constraint, index) => ({
    id: index + 1,
    key: constraint.semantic_key,
    label: constraint.label,
    kind: constraint.kind,
    members: all(database, `SELECT g.id, g.resource_type FROM compatibility_constraint_members m JOIN host_resource_groups g ON g.id = m.resource_group_id WHERE m.constraint_group_id = ? ORDER BY m.id`, constraint.id).map((member) => ({
      resourceType: ({ storage: 'storage-slot', expansion: 'expansion-slot', optionalModule: 'optional-module-slot', controllerSlot: 'controller-slot', bootDeviceSlot: 'boot-device-slot', coolingProfile: 'cooling-profile' } as Row)[member.resource_type],
      resourceId: groupIds.get(member.id),
    })),
  }))
  return { host }
}

function inventoryItem(database: Database, row: Row): InventoryItem {
  const extension = parse<Row>(row.extensions_json, {})
  const subtype = subtypeSpecs(database, row)
  const relationalExtension = row.type_key === 'network' ? networkExtensions(database, row.id) : undefined
  const properties = Object.fromEntries(all(database, 'SELECT key, value FROM inventory_item_properties WHERE item_id = ? ORDER BY id', row.id).map((entry) => [entry.key, entry.value]))
  const aliases = all(database, 'SELECT alias FROM inventory_item_aliases WHERE item_id = ? ORDER BY id', row.id).map((entry) => entry.alias)
  const secondaryManufacturer = one(database, `SELECT coalesce(m.name, s.manufacturer_text) AS name FROM inventory_secondary_manufacturers s LEFT JOIN manufacturers m ON m.id = s.manufacturer_id WHERE s.item_id = ?`, row.id)?.name
  const smartRow = row.type_key === 'powerStrip' ? one(database, 'SELECT * FROM power_strip_smart_configurations WHERE power_strip_id = ? AND enabled = 1', row.id) : null
  const smart = smartRow ? defined({ enabled: true, displayName: smartRow.display_name, managementIp: smartRow.management_ip, macAddress: smartRow.mac_address, outlets: all(database, `SELECT pia.legacy_port_id AS portId, n.name FROM power_strip_outlet_names n JOIN port_identity_aliases pia ON pia.port_id = n.port_id WHERE n.smart_configuration_id = ? ORDER BY n.id`, smartRow.id) }) : undefined
  const legacyCompatibility = extension.catalogCompatibility
    ?? (extension.compatibilityRequirements ? { requirements: extension.compatibilityRequirements } : undefined)
  const compatibility = mergeCompatibilityProjection(
    mergeRecords(mergeRecords(legacyCompatibility, subtype.compatibility), relationalExtension?.compatibility),
    hostCompatibility(database, row.id),
  )
  const portExtensions = relationalExtension?.ports && typeof relationalExtension.ports === 'object'
    ? relationalExtension.ports as Row
    : {}
  const ports = itemPorts(database, row.id, row.type_key).map((port) => (
    mergeRecords(port, portExtensions[String(port.id)]) ?? port
  ))
  const fixedComponents = all(database, `
    SELECT * FROM host_fixed_components
    WHERE host_item_id = ?
    ORDER BY catalog_component_id
  `, row.id).map((component) => defined({
    ...parse<Row>(component.extensions_json, {}),
    id: component.catalog_component_id,
    componentType: component.component_type,
    disposition: component.disposition,
    label: component.label,
    templateKey: component.template_key,
    templateRevision: component.template_revision,
    item: parse<Row>(component.item_json, {}),
  }))
  return defined({
    ...(extension.legacyFields ?? {}),
    ...Object.fromEntries(Object.entries(relationalExtension ?? {}).filter(([key]) => !['specs', 'compatibility', 'ports'].includes(key))),
    id: row.legacy_id,
    inventoryId: row.id,
    key: aliasKey(row),
    name: row.name,
    type: row.type_key,
    scope: row.scope,
    ownerProjectId: row.owner_project_id,
    ...(subtype.fields ?? {}),
    subtype: row.subtype,
    manufacturer: row.manufacturer_name ?? row.manufacturer_text,
    secondaryManufacturer,
    family: row.family,
    model: row.model,
    number: row.product_number,
    aliases: aliases.length ? aliases : undefined,
    specs: extension.legacySpecs ?? mergeRecords(subtype.specs, relationalExtension?.specs),
    properties: Object.keys(properties).length ? properties : undefined,
    ports: ports.length ? ports : undefined,
    fixedComponents: fixedComponents.length ? fixedComponents : undefined,
    smart,
    compatibility,
    notes: row.notes,
    archivedAt: row.archived_at_ms == null ? undefined : new Date(row.archived_at_ms).toISOString(),
  }) as InventoryItem
}

export function buildLegacyInventoryProjection(database: Database) {
  const inventory = {
    ...Object.fromEntries(
      Object.values(LEGACY_TABLE_BY_TYPE).map((table) => [table, [] as InventoryItem[]]),
    ),
    // Retain the schema-29 boundary collection after wireless hardware moved to network.
    wirelessCards: [] as InventoryItem[],
  } as Record<string, InventoryItem[]>
  const rows = all(database, `
    SELECT i.*, t.key AS type_key, m.name AS manufacturer_name,
           a.legacy_type_key, a.legacy_id
    FROM inventory_items i
    JOIN inventory_item_types t ON t.id = i.type_id
    JOIN inventory_identity_aliases a ON a.item_id = i.id
    LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
    ORDER BY t.sort_order, a.legacy_id
  `)
  for (const row of rows) {
    const item = withCanonicalPowerPorts(inventoryItem(database, row)) as InventoryItem
    const table = LEGACY_TABLE_BY_TYPE[row.type_key as keyof typeof LEGACY_TABLE_BY_TYPE]
    if (table) inventory[table].push(item)
  }
  return inventory
}

function endpoint(database: Database, projectId: number, workspaceId: number, row: Row) {
  const ownerKey = `${row.owner_type}:${row.owner_legacy_id}`
  const host = one(database, `
    SELECT ha.legacy_type_key, ha.legacy_id
    FROM component_assignments a
    JOIN inventory_identity_aliases ha ON ha.item_id = a.host_item_id
    WHERE a.project_id = ? AND a.workspace_id = ? AND a.component_item_id = ?
  `, projectId, workspaceId, row.owner_item_id)
  return defined({
    itemId: host ? `${host.legacy_type_key}:${host.legacy_id}` : ownerKey,
    portId: row.legacy_port_id,
    endpointId: row.endpoint_number,
    hostedItemId: host ? ownerKey : undefined,
  })
}

export function buildLegacyProjectProjection({
  database,
  projectId,
  workspaceId,
}: {
  database: Database
  projectId: number
  workspaceId?: number
}): ProjectState {
  const project = one(database, 'SELECT * FROM projects WHERE id = ? AND archived_at_ms IS NULL', projectId)
  if (!project) throw new Error(`Active project ${projectId} was not found.`)
  const canvas = workspaceId == null
    ? one(database, `SELECT w.id FROM workspaces w JOIN project_preferences p ON p.default_workspace_id = w.id WHERE p.project_id = ? AND w.type = 'canvas' AND w.archived_at_ms IS NULL`, projectId)
      ?? one(database, `SELECT id FROM workspaces WHERE project_id = ? AND type = 'canvas' AND archived_at_ms IS NULL ORDER BY sort_order LIMIT 1`, projectId)
    : one(database, `SELECT id FROM workspaces WHERE id = ? AND project_id = ? AND type = 'canvas' AND archived_at_ms IS NULL`, workspaceId, projectId)
  if (!canvas) throw new Error(`Project ${projectId} has no active Canvas workspace.`)
  const itemRows = all(database, `
    SELECT i.*, t.key AS type_key, m.name AS manufacturer_name,
           a.legacy_type_key, a.legacy_id
    FROM inventory_items i
    JOIN inventory_item_types t ON t.id = i.type_id
    JOIN inventory_identity_aliases a ON a.item_id = i.id
    LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
    LEFT JOIN project_inventory_memberships pm ON pm.item_id = i.id AND pm.project_id = ?
    WHERE (i.owner_project_id = ? OR pm.id IS NOT NULL)
    ORDER BY t.sort_order, a.legacy_id
  `, projectId, projectId)
  const items = Object.fromEntries(itemRows.map((row) => {
    const item = inventoryItem(database, row)
    return [item.key!, item]
  }))
  const placements = all(database, `
    SELECT p.*, a.legacy_type_key, a.legacy_id
    FROM workspace_placements p
    JOIN inventory_identity_aliases a ON a.item_id = p.item_id
    WHERE p.project_id = ? AND p.workspace_id = ? ORDER BY p.id
  `, projectId, canvas.id).map((row) => ({ serverId: aliasKey(row), x: row.x, y: row.y }))
  const assignments = all(database, `
    SELECT a.*, ha.legacy_type_key AS host_type, ha.legacy_id AS host_legacy_id,
           ca.legacy_type_key AS component_type, ca.legacy_id AS component_legacy_id,
           g.resource_type, g.semantic_key, s.position,
           ra.legacy_resource_group_id AS legacy_group_id
    FROM component_assignments a
    JOIN inventory_identity_aliases ha ON ha.item_id = a.host_item_id
    JOIN inventory_identity_aliases ca ON ca.item_id = a.component_item_id
    LEFT JOIN host_resource_slots s ON s.id = a.resource_slot_id
    LEFT JOIN host_resource_groups g ON g.id = s.resource_group_id
    LEFT JOIN resource_identity_aliases ra ON ra.resource_id = g.resource_identity_id
    WHERE a.project_id = ? AND a.workspace_id = ? ORDER BY a.id
  `, projectId, canvas.id).map((row) => {
    const positions = all(database, `
      SELECT s.position
      FROM component_assignment_slots assigned
      JOIN host_resource_slots s ON s.id = assigned.resource_slot_id
      WHERE assigned.assignment_id = ?
      ORDER BY assigned.position
    `, row.id).map((slot) => slot.position - 1)
    return defined({
      id: row.id,
      serverId: `${row.host_type}:${row.host_legacy_id}`,
      itemId: `${row.component_type}:${row.component_legacy_id}`,
      type: row.component_type,
      assignedAt: new Date(row.assigned_at_ms).toISOString(),
      allocation: row.resource_type ? defined({
        resourceType: row.resource_type,
        resourceKey: row.semantic_key,
        groupId: row.legacy_group_id,
        positions: positions.length ? positions : [row.position - 1],
      }) : undefined,
    })
  })
  const connections = all(
    database,
    'SELECT * FROM project_connections WHERE project_id = ? AND workspace_id = ? ORDER BY id',
    projectId,
    canvas.id,
  ).map((connection) => {
    const endpoints = all(database, `
      SELECT e.role, ip.item_id AS owner_item_id, ia.legacy_type_key AS owner_type,
             ia.legacy_id AS owner_legacy_id, pa.legacy_port_id, f.endpoint_number
      FROM connection_endpoints e
      JOIN inventory_ports ip ON ip.id = e.port_id
      JOIN inventory_identity_aliases ia ON ia.item_id = ip.item_id
      JOIN port_identity_aliases pa ON pa.port_id = ip.id
      LEFT JOIN port_endpoint_faces f ON f.id = e.endpoint_face_id
      WHERE e.connection_id = ? ORDER BY CASE e.role WHEN 'source' THEN 0 ELSE 1 END
    `, connection.id)
    const bends = all(database, 'SELECT x, y FROM workspace_manual_bend_points WHERE workspace_id = ? AND connection_id = ? ORDER BY position', canvas.id, connection.id)
    return defined({
      id: connection.id,
      from: endpoint(database, projectId, canvas.id, endpoints[0]),
      to: endpoint(database, projectId, canvas.id, endpoints[1]),
      type: connection.connection_type,
      negotiatedSpeedBps: connection.negotiated_speed_bps ?? undefined,
      label: connection.label,
      route: defined({ sourceSide: connection.source_side, targetSide: connection.target_side, bendPoints: bends.length ? bends : undefined, avoidCableOverlap: Boolean(connection.avoid_cable_overlap) }),
      createdAt: new Date(connection.created_at_ms).toISOString(),
    })
  })
  const policy = parse(
    one(database, 'SELECT policy_json FROM project_compatibility_policies WHERE project_id = ?', projectId)?.policy_json
      ?? (projectId === 1
        ? one(database, `SELECT value_json FROM application_metadata WHERE key = 'legacy.compatibility-policy'`)?.value_json
        : null),
    { disabledHosts: [], ignoredWarningIds: [] },
  )
  const legacyMetadata = parse<Row>(one(database, `SELECT value_json FROM application_metadata WHERE key = 'legacy.project-metadata'`)?.value_json, {})
  return {
    id: projectId === 1 ? 'default' : String(projectId),
    revision: project.revision,
    nextAssignmentId: one(database, `
      SELECT max(
        coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'component_assignments'), 0),
        coalesce((SELECT max(id) FROM component_assignments), 0)
      ) + 1 AS id
    `)!.id,
    nextConnectionId: one(database, `
      SELECT max(
        coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'project_connections'), 0),
        coalesce((SELECT max(id) FROM project_connections), 0)
      ) + 1 AS id
    `)!.id,
    metadata: {
      name: project.name,
      version: Number.isSafeInteger(legacyMetadata.version) ? legacyMetadata.version : 1,
      updatedAt: new Date(project.updated_at_ms).toISOString(),
    },
    items,
    placements,
    assignments,
    connections,
    compatibilityPolicy: policy,
  } as ProjectState
}
