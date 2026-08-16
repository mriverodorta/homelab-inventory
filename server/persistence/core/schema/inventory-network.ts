import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems, inventoryPorts } from './inventory-base.ts'

export const networkAdapters = sqliteTable('network_adapters', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  networkTechnology: text('network_technology').notNull(),
  controller: text('controller'),
  formFactor: text('form_factor').notNull(),
  cardHeight: text('card_height'),
  slotWidth: integer('slot_width'),
  powerMw: integer('power_mw'),
  maxSpeedBps: integer('max_speed_bps'),
  maxPhyRateBps: integer('max_phy_rate_bps'),
  spatialStreams: integer('spatial_streams'),
  bluetoothVersion: text('bluetooth_version'),
  antennaTopology: text('antenna_topology'),
  hardwareRevision: text('hardware_revision'),
  discontinued: integer('discontinued', { mode: 'boolean' }),
}, (table) => [
  check('network_adapters_technology_check', sql`${table.networkTechnology} IN (
    'ethernet', 'wifi', 'fibre-channel', 'infiniband', 'converged', 'cellular', 'other'
  )`),
  check('network_adapters_form_factor_check', sql`length(trim(${table.formFactor})) > 0`),
  check('network_adapters_height_check', sql`
    ${table.cardHeight} IS NULL OR ${table.cardHeight} IN ('full-height', 'low-profile')
  `),
  check('network_adapters_slot_width_check', sql`${table.slotWidth} IS NULL OR ${table.slotWidth} > 0`),
  check('network_adapters_power_check', sql`${table.powerMw} IS NULL OR ${table.powerMw} >= 0`),
  check('network_adapters_speed_check', sql`${table.maxSpeedBps} IS NULL OR ${table.maxSpeedBps} > 0`),
  check('network_adapters_phy_rate_check', sql`${table.maxPhyRateBps} IS NULL OR ${table.maxPhyRateBps} > 0`),
  check('network_adapters_spatial_streams_check', sql`${table.spatialStreams} IS NULL OR ${table.spatialStreams} > 0`),
  check('network_adapters_discontinued_check', sql`${table.discontinued} IS NULL OR ${table.discontinued} IN (0, 1)`),
  check('network_adapters_radio_speed_check', sql`
    ${table.networkTechnology} NOT IN ('wifi', 'cellular') OR ${table.maxSpeedBps} IS NULL
  `),
])

export const networkAdapterHostInterfaces = sqliteTable('network_adapter_host_interfaces', {
  adapterId: integer('adapter_id').primaryKey().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  family: text('family').notNull(),
  pcieGeneration: integer('pcie_generation'),
  connectorLanes: integer('connector_lanes'),
  minimumElectricalLanes: integer('minimum_electrical_lanes'),
  key: text('key'),
  moduleSize: text('module_size'),
  usbGeneration: text('usb_generation'),
  connector: text('connector'),
  ocpVersion: text('ocp_version'),
  interfaceKey: text('interface_key'),
}, (table) => [
  check('network_adapter_host_interfaces_family_check', sql`${table.family} IN (
    'pcie', 'm2-ae', 'm2-bm', 'mini-pcie', 'usb', 'ocp', 'mezzanine', 'onboard', 'proprietary'
  )`),
  check('network_adapter_host_interfaces_pcie_generation_check', sql`${table.pcieGeneration} IS NULL OR ${table.pcieGeneration} > 0`),
  check('network_adapter_host_interfaces_connector_lanes_check', sql`${table.connectorLanes} IS NULL OR ${table.connectorLanes} > 0`),
  check('network_adapter_host_interfaces_minimum_lanes_check', sql`${table.minimumElectricalLanes} IS NULL OR ${table.minimumElectricalLanes} > 0`),
  check('network_adapter_host_interfaces_lane_order_check', sql`
    ${table.connectorLanes} IS NULL OR ${table.minimumElectricalLanes} IS NULL
    OR ${table.minimumElectricalLanes} <= ${table.connectorLanes}
  `),
])

export const networkAdapterOperatingModes = sqliteTable('network_adapter_operating_modes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_operating_modes_unique').on(table.adapterId, table.mode),
  check('network_adapter_operating_modes_value_check', sql`length(trim(${table.mode})) > 0`),
])

export const networkAdapterWifiGenerations = sqliteTable('network_adapter_wifi_generations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  generation: text('generation').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_wifi_generations_unique').on(table.adapterId, table.generation),
  check('network_adapter_wifi_generations_value_check', sql`length(trim(${table.generation})) > 0`),
])

export const networkAdapterFrequencyBands = sqliteTable('network_adapter_frequency_bands', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  frequencyMhz: integer('frequency_mhz').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_frequency_bands_unique').on(table.adapterId, table.frequencyMhz),
  check('network_adapter_frequency_bands_value_check', sql`${table.frequencyMhz} > 0`),
])

export const networkAdapterCapabilities = sqliteTable('network_adapter_capabilities', {
  adapterId: integer('adapter_id').primaryKey().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  sriov: integer('sriov', { mode: 'boolean' }),
  ptp: integer('ptp', { mode: 'boolean' }),
  pxe: integer('pxe', { mode: 'boolean' }),
  uefiBoot: integer('uefi_boot', { mode: 'boolean' }),
  wakeOnLan: integer('wake_on_lan', { mode: 'boolean' }),
}, (table) => [
  check('network_adapter_capabilities_sriov_check', sql`${table.sriov} IS NULL OR ${table.sriov} IN (0, 1)`),
  check('network_adapter_capabilities_ptp_check', sql`${table.ptp} IS NULL OR ${table.ptp} IN (0, 1)`),
  check('network_adapter_capabilities_pxe_check', sql`${table.pxe} IS NULL OR ${table.pxe} IN (0, 1)`),
  check('network_adapter_capabilities_uefi_boot_check', sql`${table.uefiBoot} IS NULL OR ${table.uefiBoot} IN (0, 1)`),
  check('network_adapter_capabilities_wake_on_lan_check', sql`${table.wakeOnLan} IS NULL OR ${table.wakeOnLan} IN (0, 1)`),
])

export const networkAdapterRdmaModes = sqliteTable('network_adapter_rdma_modes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_rdma_modes_unique').on(table.adapterId, table.mode),
  check('network_adapter_rdma_modes_value_check', sql`length(trim(${table.mode})) > 0`),
])

export const networkAdapterOffloads = sqliteTable('network_adapter_offloads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  offload: text('offload').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_offloads_unique').on(table.adapterId, table.offload),
  check('network_adapter_offloads_value_check', sql`length(trim(${table.offload})) > 0`),
])

export const networkAdapterPorts = sqliteTable('network_adapter_ports', {
  portId: integer('port_id').primaryKey().references(() => inventoryPorts.id, { onDelete: 'cascade' }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  networkTechnology: text('network_technology').notNull(),
  vendorLock: integer('vendor_lock', { mode: 'boolean' }),
}, (table) => [
  index('network_adapter_ports_adapter_index').on(table.adapterId),
  check('network_adapter_ports_technology_check', sql`${table.networkTechnology} IN (
    'ethernet', 'fibre-channel', 'infiniband', 'converged', 'other'
  )`),
  check('network_adapter_ports_vendor_lock_check', sql`${table.vendorLock} IS NULL OR ${table.vendorLock} IN (0, 1)`),
])

export const networkAdapterPortSupportedSpeeds = sqliteTable('network_adapter_port_supported_speeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  portId: integer('port_id').notNull().references(() => networkAdapterPorts.portId, { onDelete: 'cascade' }),
  speedBps: integer('speed_bps').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_port_supported_speeds_unique').on(table.portId, table.speedBps),
  check('network_adapter_port_supported_speeds_value_check', sql`${table.speedBps} > 0`),
])

export const networkAdapterPortOperatingModes = sqliteTable('network_adapter_port_operating_modes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  portId: integer('port_id').notNull().references(() => networkAdapterPorts.portId, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_port_operating_modes_unique').on(table.portId, table.mode),
  check('network_adapter_port_operating_modes_value_check', sql`length(trim(${table.mode})) > 0`),
])

export const networkAdapterPortMedia = sqliteTable('network_adapter_port_media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  portId: integer('port_id').notNull().references(() => networkAdapterPorts.portId, { onDelete: 'cascade' }),
  medium: text('medium').notNull(),
}, (table) => [
  uniqueIndex('network_adapter_port_media_unique').on(table.portId, table.medium),
  check('network_adapter_port_media_value_check', sql`${table.medium} IN (
    'dac', 'aoc', 'optical-transceiver', 'copper-transceiver', 'active-copper', 'passive-copper'
  )`),
])

export const networkPortLocalOverrides = sqliteTable('network_port_local_overrides', {
  portId: integer('port_id').primaryKey().references(() => networkAdapterPorts.portId, { onDelete: 'cascade' }),
  label: text('label'),
  ipAddress: text('ip_address'),
  macAddress: text('mac_address'),
  role: text('role'),
  adminState: text('admin_state'),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('network_port_local_overrides_role_check', sql`
    ${table.role} IS NULL OR ${table.role} IN ('access', 'trunk', 'uplink', 'management', 'disabled')
  `),
  check('network_port_local_overrides_admin_state_check', sql`
    ${table.adminState} IS NULL OR ${table.adminState} IN ('enabled', 'disabled')
  `),
])

export const networkAdapterExtensionValues = sqliteTable('network_adapter_extension_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapterId: integer('adapter_id').notNull().references(() => networkAdapters.id, { onDelete: 'cascade' }),
  fieldPath: text('field_path').notNull(),
  valueType: text('value_type').notNull(),
  textValue: text('text_value'),
  integerValue: integer('integer_value'),
  realValue: real('real_value'),
  booleanValue: integer('boolean_value', { mode: 'boolean' }),
  nullValue: integer('null_value', { mode: 'boolean' }),
}, (table) => [
  uniqueIndex('network_adapter_extension_values_unique').on(table.adapterId, table.fieldPath),
  check('network_adapter_extension_values_path_check', sql`length(trim(${table.fieldPath})) > 0`),
  check('network_adapter_extension_values_type_check', sql`
    ${table.valueType} IN ('text', 'integer', 'real', 'boolean', 'null', 'object', 'array')
  `),
  check('network_adapter_extension_values_boolean_check', sql`${table.booleanValue} IS NULL OR ${table.booleanValue} IN (0, 1)`),
  check('network_adapter_extension_values_null_check', sql`${table.nullValue} IS NULL OR ${table.nullValue} = 1`),
  check('network_adapter_extension_values_single_value_check', sql`
    (${table.valueType} = 'text' AND ${table.textValue} IS NOT NULL AND ${table.integerValue} IS NULL AND ${table.realValue} IS NULL AND ${table.booleanValue} IS NULL AND ${table.nullValue} IS NULL)
    OR (${table.valueType} = 'integer' AND ${table.textValue} IS NULL AND ${table.integerValue} IS NOT NULL AND ${table.realValue} IS NULL AND ${table.booleanValue} IS NULL AND ${table.nullValue} IS NULL)
    OR (${table.valueType} = 'real' AND ${table.textValue} IS NULL AND ${table.integerValue} IS NULL AND ${table.realValue} IS NOT NULL AND ${table.booleanValue} IS NULL AND ${table.nullValue} IS NULL)
    OR (${table.valueType} = 'boolean' AND ${table.textValue} IS NULL AND ${table.integerValue} IS NULL AND ${table.realValue} IS NULL AND ${table.booleanValue} IS NOT NULL AND ${table.nullValue} IS NULL)
    OR (${table.valueType} = 'null' AND ${table.textValue} IS NULL AND ${table.integerValue} IS NULL AND ${table.realValue} IS NULL AND ${table.booleanValue} IS NULL AND ${table.nullValue} = 1)
    OR (${table.valueType} IN ('object', 'array') AND ${table.textValue} IS NULL AND ${table.integerValue} IS NULL AND ${table.realValue} IS NULL AND ${table.booleanValue} IS NULL AND ${table.nullValue} IS NULL)
  `),
])

export const networkSwitches = sqliteTable('network_switches', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  managementType: text('management_type'),
  switchingCapacityBps: integer('switching_capacity_bps'),
  fanless: integer('fanless', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  check('network_switches_capacity_check', sql`${table.switchingCapacityBps} IS NULL OR ${table.switchingCapacityBps} >= 0`),
  check('network_switches_fanless_check', sql`${table.fanless} IN (0, 1)`),
])

export const patchPanels = sqliteTable('patch_panels', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  rackUnits: integer('rack_units'),
  mount: text('mount'),
}, (table) => [
  check('patch_panels_rack_units_check', sql`${table.rackUnits} IS NULL OR ${table.rackUnits} >= 0`),
])

export const monitors = sqliteTable('monitors', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  diagonalMm: integer('diagonal_mm'),
  diagonalSourceText: text('diagonal_source_text'),
  resolution: text('resolution'),
  refreshRateMillihz: integer('refresh_rate_millihz'),
}, (table) => [
  check('monitors_diagonal_check', sql`${table.diagonalMm} IS NULL OR ${table.diagonalMm} >= 0`),
  check('monitors_refresh_rate_check', sql`${table.refreshRateMillihz} IS NULL OR ${table.refreshRateMillihz} >= 0`),
])
