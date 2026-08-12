export const INVENTORY_TYPES = [
  'server',
  'nas',
  'pcBuild',
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'motherboard',
  'cpuCooler',
  'case',
  'powerSupply',
  'soundCard',
  'wireless',
  'powerAdapter',
  'switch',
  'patchPanel',
  'monitor',
  'ups',
  'powerStrip',
] as const

export type InventoryType = typeof INVENTORY_TYPES[number]

export type InventoryFieldMapping = Readonly<{
  storage: 'column' | 'relation'
  target: string
}>

export type SupportedInventoryField = Readonly<{
  type: InventoryType
  path: string
}>

const COMMON_FIELD_MAPPINGS: Readonly<Record<string, InventoryFieldMapping>> = {
  type: { storage: 'column', target: 'inventory_items.type_id' },
  name: { storage: 'column', target: 'inventory_items.name' },
  aliases: { storage: 'relation', target: 'inventory_item_aliases' },
  manufacturer: { storage: 'relation', target: 'inventory_items.manufacturer_id' },
  secondaryManufacturer: { storage: 'relation', target: 'inventory_secondary_manufacturers' },
  model: { storage: 'column', target: 'inventory_items.model' },
  family: { storage: 'column', target: 'inventory_items.family' },
  number: { storage: 'column', target: 'inventory_items.product_number' },
  subtype: { storage: 'column', target: 'inventory_items.subtype' },
  properties: { storage: 'relation', target: 'inventory_item_properties' },
  compatibility: { storage: 'relation', target: 'compatibility_*' },
  notes: { storage: 'column', target: 'inventory_items.notes' },
  archivedAt: { storage: 'column', target: 'inventory_items.archived_at_ms' },
}

const TYPE_FIELD_MAPPINGS: Readonly<Record<InventoryType, Readonly<Record<string, InventoryFieldMapping>>>> = {
  server: {
    hardwareClass: { storage: 'column', target: 'servers.hardware_class' },
    usageRole: { storage: 'column', target: 'servers.usage_role' },
    'specs.formFactor': { storage: 'relation', target: 'servers.chassis_type_id' },
    'specs.networkSlot': { storage: 'column', target: 'servers.network_slot' },
    'specs.wireless': { storage: 'column', target: 'servers.wireless' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  nas: {
    'specs.driveBays': { storage: 'column', target: 'nas_systems.drive_bay_count' },
    'specs.m2Slots': { storage: 'column', target: 'nas_systems.m2_slot_count' },
    'specs.powerConfiguration': { storage: 'column', target: 'nas_systems.power_configuration' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  pcBuild: {
    'specs.operatingSystem': { storage: 'column', target: 'pc_builds.operating_system' },
    'specs.role': { storage: 'column', target: 'pc_builds.usage_role' },
  },
  cpu: {
    'specs.cores': { storage: 'column', target: 'cpus.core_count' },
    'specs.threads': { storage: 'column', target: 'cpus.thread_count' },
    'specs.baseClockMhz': { storage: 'column', target: 'cpus.base_clock_mhz' },
    'specs.baseClockGhz': { storage: 'column', target: 'cpus.base_clock_mhz' },
    'specs.boostClockMhz': { storage: 'column', target: 'cpus.boost_clock_mhz' },
    'specs.boostClockGhz': { storage: 'column', target: 'cpus.boost_clock_mhz' },
  },
  ram: {
    'specs.capacityMib': { storage: 'column', target: 'memory_modules.capacity_mib' },
    'specs.capacityGb': { storage: 'column', target: 'memory_modules.capacity_mib' },
    'specs.generation': { storage: 'relation', target: 'memory_modules.memory_generation_id' },
    'specs.speedMt': { storage: 'column', target: 'memory_modules.speed_mtps' },
    'specs.formFactor': { storage: 'column', target: 'memory_modules.form_factor' },
    'specs.moduleType': { storage: 'relation', target: 'memory_modules.module_type_id' },
    'specs.ecc': { storage: 'column', target: 'memory_modules.ecc' },
    'specs.rank': { storage: 'column', target: 'memory_modules.rank' },
    'specs.voltageMv': { storage: 'column', target: 'memory_modules.voltage_mv' },
    'specs.voltageVolts': { storage: 'column', target: 'memory_modules.voltage_mv' },
  },
  storage: {
    'specs.capacityBytes': { storage: 'column', target: 'storage_devices.capacity_bytes' },
    'specs.capacityGb': { storage: 'column', target: 'storage_devices.capacity_bytes' },
    'specs.capacityTb': { storage: 'column', target: 'storage_devices.capacity_bytes' },
    'specs.interface': { storage: 'relation', target: 'storage_devices.interface_id' },
    'specs.formFactor': { storage: 'relation', target: 'storage_devices.form_factor_id' },
    'specs.serialNumber': { storage: 'column', target: 'inventory_items.serial_number' },
    'specs.partitionTable': { storage: 'column', target: 'storage_devices.partition_table' },
  },
  gpu: {
    'specs.vramMib': { storage: 'column', target: 'graphics_cards.vram_mib' },
    'specs.vramGb': { storage: 'column', target: 'graphics_cards.vram_mib' },
    'specs.formFactor': { storage: 'column', target: 'graphics_cards.form_factor' },
    'specs.slotWidth': { storage: 'column', target: 'graphics_cards.slot_width' },
    'specs.pcie': { storage: 'column', target: 'graphics_cards.pcie' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  network: {
    'specs.ports': { storage: 'column', target: 'network_cards.port_count' },
    'specs.maxSpeedBps': { storage: 'column', target: 'network_cards.max_speed_bps' },
    'specs.speedMbps': { storage: 'column', target: 'network_cards.max_speed_bps' },
    'specs.interface': { storage: 'column', target: 'network_cards.interface' },
    'specs.formFactor': { storage: 'column', target: 'network_cards.form_factor' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  motherboard: {
    'specs.chipset': { storage: 'column', target: 'motherboards.chipset' },
    'specs.formFactor': { storage: 'column', target: 'motherboards.form_factor' },
    'specs.boardRevision': { storage: 'column', target: 'motherboards.board_revision' },
    'specs.launchDate': { storage: 'column', target: 'motherboards.launch_date_text' },
    'specs.discontinued': { storage: 'column', target: 'motherboards.discontinued' },
    'specs.wifiGeneration': { storage: 'column', target: 'motherboards.wifi_generation' },
    'specs.bluetooth': { storage: 'column', target: 'motherboards.bluetooth' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  cpuCooler: {
    'specs.coolerType': { storage: 'column', target: 'cpu_coolers.cooler_type' },
  },
  case: {
    'specs.formFactors': { storage: 'relation', target: 'case_form_factor_support' },
  },
  powerSupply: {
    'specs.formFactor': { storage: 'column', target: 'power_supplies.form_factor' },
    'specs.ratedPowerMw': { storage: 'column', target: 'power_supplies.rated_power_mw' },
    'specs.wattageWatts': { storage: 'column', target: 'power_supplies.rated_power_mw' },
    'specs.efficiency': { storage: 'column', target: 'power_supplies.efficiency_rating' },
    'specs.connectors': { storage: 'relation', target: 'power_supply_connectors' },
  },
  soundCard: {
    'specs.interface': { storage: 'column', target: 'sound_cards.interface' },
  },
  wireless: {
    'specs.interface': { storage: 'column', target: 'wireless_cards.interface' },
    'specs.wifiGeneration': { storage: 'column', target: 'wireless_cards.wifi_generation' },
    'specs.bluetooth': { storage: 'column', target: 'wireless_cards.bluetooth' },
  },
  powerAdapter: {
    'specs.ratedPowerMw': { storage: 'column', target: 'power_adapters.rated_power_mw' },
    'specs.wattageWatts': { storage: 'column', target: 'power_adapters.rated_power_mw' },
    'specs.connector': { storage: 'relation', target: 'power_adapters.connector_type_id' },
  },
  switch: {
    'specs.management': { storage: 'column', target: 'network_switches.management_type' },
    'specs.switchingCapacityBps': { storage: 'column', target: 'network_switches.switching_capacity_bps' },
    'specs.switchingCapacityGbps': { storage: 'column', target: 'network_switches.switching_capacity_bps' },
    'specs.fanless': { storage: 'column', target: 'network_switches.fanless' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  patchPanel: {
    'specs.rackUnits': { storage: 'column', target: 'patch_panels.rack_units' },
    'specs.mount': { storage: 'column', target: 'patch_panels.mount' },
    ports: { storage: 'relation', target: 'inventory_ports' },
  },
  monitor: {
    'specs.diagonalMm': { storage: 'column', target: 'monitors.diagonal_mm' },
    'specs.diagonalSourceText': { storage: 'column', target: 'monitors.diagonal_source_text' },
    'specs.sizeInches': { storage: 'column', target: 'monitors.diagonal_mm' },
    'specs.resolution': { storage: 'column', target: 'monitors.resolution' },
    'specs.refreshRateMillihz': { storage: 'column', target: 'monitors.refresh_rate_millihz' },
    'specs.refreshRateHz': { storage: 'column', target: 'monitors.refresh_rate_millihz' },
  },
  ups: {
    'specs.ratedPowerMw': { storage: 'column', target: 'ups_systems.rated_power_mw' },
    'specs.wattageWatts': { storage: 'column', target: 'ups_systems.rated_power_mw' },
    'specs.capacityMillivoltAmps': { storage: 'column', target: 'ups_systems.capacity_millivolt_amps' },
    'specs.capacityVa': { storage: 'column', target: 'ups_systems.capacity_millivolt_amps' },
    'specs.batteryBackupOutlets': { storage: 'column', target: 'ups_systems.battery_outlet_count' },
    'specs.surgeProtectedOutlets': { storage: 'column', target: 'ups_systems.surge_outlet_count' },
    'specs.outlets': { storage: 'column', target: 'ups_systems.outlet_count' },
  },
  powerStrip: {
    'specs.outlets': { storage: 'column', target: 'power_strips.outlet_count' },
    'specs.surgeProtected': { storage: 'column', target: 'power_strips.surge_protected' },
    'specs.surgeProtectedOutlets': { storage: 'column', target: 'power_strips.surge_outlet_count' },
    smart: { storage: 'relation', target: 'power_strip_smart_configurations' },
  },
}

export const INVENTORY_FIELD_CONTRACT = new Map<string, InventoryFieldMapping>()
export const SUPPORTED_INVENTORY_FIELDS: readonly SupportedInventoryField[] = INVENTORY_TYPES.flatMap((type) => {
  const mappings = {
    ...COMMON_FIELD_MAPPINGS,
    ...TYPE_FIELD_MAPPINGS[type],
  }
  return Object.entries(mappings).map(([path, mapping]) => {
    INVENTORY_FIELD_CONTRACT.set(`${type}.${path}`, mapping)
    return { type, path }
  })
})

const supportedExtensionKeys = new Map<InventoryType, Set<string>>(
  INVENTORY_TYPES.map((type) => [
    type,
    new Set(
      SUPPORTED_INVENTORY_FIELDS
        .filter((field) => field.type === type)
        .map((field) => field.path.startsWith('specs.') ? field.path.slice('specs.'.length) : field.path),
    ),
  ]),
)

export function assertExtensionsContainOnlyUnknownFields(
  type: InventoryType,
  extensions: Readonly<Record<string, unknown>>,
) {
  const supported = supportedExtensionKeys.get(type)
  for (const key of Object.keys(extensions)) {
    if (supported?.has(key)) {
      throw new Error(`Extension object contains supported field ${type}.${key}.`)
    }
  }
}
