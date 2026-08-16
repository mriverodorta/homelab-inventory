import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { inventoryItems, inventoryResources } from './inventory-base.ts'
import {
  cpuSocketTypes,
  expansionSlotTypes,
  memoryGenerations,
  memoryModuleTypes,
  storageFormFactors,
  storageInterfaces,
} from './vocabularies.ts'

export const hostCompatibilityProfiles = sqliteTable('host_compatibility_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  topologyCompleteness: text('topology_completeness'),
  maxExpansionPowerMw: integer('max_expansion_power_mw'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('host_compatibility_profiles_host_unique').on(table.hostItemId),
  check('host_compatibility_profiles_completeness_check', sql`
    ${table.topologyCompleteness} IS NULL
    OR ${table.topologyCompleteness} IN ('complete', 'partial', 'conflicting')
  `),
  check('host_compatibility_profiles_power_check', sql`
    ${table.maxExpansionPowerMw} IS NULL OR ${table.maxExpansionPowerMw} >= 0
  `),
])

export const hostResourceGroups = sqliteTable('host_resource_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceIdentityId: integer('resource_identity_id').notNull().references(
    () => inventoryResources.id,
    { onDelete: 'restrict' },
  ),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(),
  semanticKey: text('semantic_key').notNull(),
  label: text('label').notNull(),
  slotCount: integer('slot_count').notNull(),
  requiredCpuSockets: integer('required_cpu_sockets'),
  location: text('location'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('host_resource_groups_identity_unique').on(table.resourceIdentityId),
  uniqueIndex('host_resource_groups_host_key_unique').on(table.hostItemId, table.semanticKey),
  uniqueIndex('host_resource_groups_host_id_unique').on(table.hostItemId, table.id),
  index('host_resource_groups_host_type_index').on(table.hostItemId, table.resourceType),
  check('host_resource_groups_type_check', sql`${table.resourceType} IN (
    'cpu', 'memory', 'storage', 'expansion', 'optionalModule', 'controllerSlot',
    'bootDeviceSlot', 'coolingProfile', 'motherboard', 'cooling', 'power',
    'case', 'psuBay', 'powerAdapter'
  )`),
  check('host_resource_groups_key_check', sql`length(trim(${table.semanticKey})) > 0`),
  check('host_resource_groups_label_check', sql`length(trim(${table.label})) > 0`),
  check('host_resource_groups_slot_count_check', sql`${table.slotCount} >= 0`),
  check('host_resource_groups_cpu_dependency_check', sql`
    ${table.requiredCpuSockets} IS NULL OR ${table.requiredCpuSockets} > 0
  `),
])

export const hostResourceSlots = sqliteTable('host_resource_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceGroupId: integer('resource_group_id').notNull(),
  hostItemId: integer('host_item_id').notNull(),
  parentSlotId: integer('parent_slot_id'),
  position: integer('position').notNull(),
  label: text('label').notNull(),
  singleCapacity: integer('single_capacity', { mode: 'boolean' }).notNull().default(true),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('host_resource_slots_group_position_unique').on(table.resourceGroupId, table.position),
  uniqueIndex('host_resource_slots_host_id_unique').on(table.hostItemId, table.id),
  index('host_resource_slots_parent_index').on(table.parentSlotId),
  foreignKey({
    name: 'host_resource_slots_group_host_fk',
    columns: [table.hostItemId, table.resourceGroupId],
    foreignColumns: [hostResourceGroups.hostItemId, hostResourceGroups.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'host_resource_slots_parent_fk',
    columns: [table.hostItemId, table.parentSlotId],
    foreignColumns: [table.hostItemId, table.id],
  }).onDelete('restrict'),
  check('host_resource_slots_position_check', sql`${table.position} > 0`),
  check('host_resource_slots_label_check', sql`length(trim(${table.label})) > 0`),
  check('host_resource_slots_single_capacity_check', sql`${table.singleCapacity} IN (0, 1)`),
])

function slotSubtypeTable(name: string) {
  return sqliteTable(name, {
    id: integer('id').primaryKey().references(() => hostResourceSlots.id, { onDelete: 'cascade' }),
  })
}

export const cpuSocketSlots = slotSubtypeTable('cpu_socket_slots')
export const memorySlots = slotSubtypeTable('memory_slots')
export const storageSlots = slotSubtypeTable('storage_slots')
export const expansionSlots = slotSubtypeTable('expansion_slots')
export const optionalModuleSlots = slotSubtypeTable('optional_module_slots')
export const controllerSlots = slotSubtypeTable('controller_slots')
export const bootDeviceSlots = slotSubtypeTable('boot_device_slots')
export const psuBays = slotSubtypeTable('psu_bays')
export const powerAdapterSlots = slotSubtypeTable('power_adapter_slots')

export const hostCpuProfiles = sqliteTable('host_cpu_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostProfileId: integer('host_profile_id').notNull().references(
    () => hostCompatibilityProfiles.id,
    { onDelete: 'cascade' },
  ),
  socketCount: integer('socket_count'),
  maxTdpMw: integer('max_tdp_mw'),
}, (table) => [
  uniqueIndex('host_cpu_profiles_host_profile_unique').on(table.hostProfileId),
  check('host_cpu_profiles_socket_count_check', sql`${table.socketCount} IS NULL OR ${table.socketCount} > 0`),
  check('host_cpu_profiles_tdp_check', sql`${table.maxTdpMw} IS NULL OR ${table.maxTdpMw} >= 0`),
])

export const hostCpuSocketSupport = sqliteTable('host_cpu_socket_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cpuProfileId: integer('cpu_profile_id').notNull().references(() => hostCpuProfiles.id, { onDelete: 'cascade' }),
  socketTypeId: integer('socket_type_id').notNull().references(() => cpuSocketTypes.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('host_cpu_socket_support_unique').on(table.cpuProfileId, table.socketTypeId),
  index('host_cpu_socket_support_socket_index').on(table.socketTypeId),
])

export const hostCpuGenerationSupport = sqliteTable('host_cpu_generation_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cpuProfileId: integer('cpu_profile_id').notNull().references(() => hostCpuProfiles.id, { onDelete: 'cascade' }),
  generation: text('generation').notNull(),
}, (table) => [
  uniqueIndex('host_cpu_generation_support_unique').on(table.cpuProfileId, table.generation),
])

export const hostCpuPopulationModes = sqliteTable('host_cpu_population_modes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cpuProfileId: integer('cpu_profile_id').notNull().references(() => hostCpuProfiles.id, { onDelete: 'cascade' }),
  populatedSocketCount: integer('populated_socket_count').notNull(),
}, (table) => [
  uniqueIndex('host_cpu_population_modes_unique').on(table.cpuProfileId, table.populatedSocketCount),
  check('host_cpu_population_modes_count_check', sql`${table.populatedSocketCount} > 0`),
])

export const hostMemoryProfiles = sqliteTable('host_memory_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostProfileId: integer('host_profile_id').notNull().references(
    () => hostCompatibilityProfiles.id,
    { onDelete: 'cascade' },
  ),
  slotCount: integer('slot_count'),
  slotsPerCpu: integer('slots_per_cpu'),
  maxCapacityMib: integer('max_capacity_mib'),
  maxModuleCapacityMib: integer('max_module_capacity_mib'),
  oemMaxCapacityMib: integer('oem_max_capacity_mib'),
  oemMaxModuleCapacityMib: integer('oem_max_module_capacity_mib'),
  verifiedMaxCapacityMib: integer('verified_max_capacity_mib'),
  verifiedMaxModuleCapacityMib: integer('verified_max_module_capacity_mib'),
  maxSpeedMtps: integer('max_speed_mtps'),
  eccSupport: text('ecc_support'),
}, (table) => [
  uniqueIndex('host_memory_profiles_host_profile_unique').on(table.hostProfileId),
  check('host_memory_profiles_slot_count_check', sql`${table.slotCount} IS NULL OR ${table.slotCount} >= 0`),
  check('host_memory_profiles_slots_per_cpu_check', sql`${table.slotsPerCpu} IS NULL OR ${table.slotsPerCpu} >= 0`),
  check('host_memory_profiles_capacity_check', sql`${table.maxCapacityMib} IS NULL OR ${table.maxCapacityMib} >= 0`),
  check('host_memory_profiles_module_capacity_check', sql`
    ${table.maxModuleCapacityMib} IS NULL OR ${table.maxModuleCapacityMib} >= 0
  `),
  check('host_memory_profiles_oem_capacity_check', sql`
    (${table.oemMaxCapacityMib} IS NULL OR ${table.oemMaxCapacityMib} >= 0)
    AND (${table.oemMaxModuleCapacityMib} IS NULL OR ${table.oemMaxModuleCapacityMib} >= 0)
  `),
  check('host_memory_profiles_verified_capacity_check', sql`
    (${table.verifiedMaxCapacityMib} IS NULL OR ${table.verifiedMaxCapacityMib} >= 0)
    AND (${table.verifiedMaxModuleCapacityMib} IS NULL OR ${table.verifiedMaxModuleCapacityMib} >= 0)
  `),
  check('host_memory_profiles_zero_slot_module_capacity_check', sql`
    ${table.slotCount} IS NULL OR ${table.slotCount} > 0
    OR (${table.maxModuleCapacityMib} IS NULL
      AND ${table.oemMaxModuleCapacityMib} IS NULL
      AND ${table.verifiedMaxModuleCapacityMib} IS NULL)
  `),
  check('host_memory_profiles_speed_check', sql`${table.maxSpeedMtps} IS NULL OR ${table.maxSpeedMtps} >= 0`),
  check('host_memory_profiles_ecc_check', sql`
    ${table.eccSupport} IS NULL
    OR ${table.eccSupport} IN ('supported', 'unsupported', 'conditional', 'unknown')
  `),
])

export const hostMemoryGenerationSupport = sqliteTable('host_memory_generation_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memoryProfileId: integer('memory_profile_id').notNull().references(
    () => hostMemoryProfiles.id,
    { onDelete: 'cascade' },
  ),
  generationId: integer('generation_id').notNull().references(() => memoryGenerations.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('host_memory_generation_support_unique').on(table.memoryProfileId, table.generationId),
  index('host_memory_generation_support_generation_index').on(table.generationId),
])

export const hostMemoryFormFactorSupport = sqliteTable('host_memory_form_factor_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memoryProfileId: integer('memory_profile_id').notNull().references(
    () => hostMemoryProfiles.id,
    { onDelete: 'cascade' },
  ),
  formFactor: text('form_factor').notNull(),
}, (table) => [
  uniqueIndex('host_memory_form_factor_support_unique').on(table.memoryProfileId, table.formFactor),
])

export const hostMemoryModuleTypeSupport = sqliteTable('host_memory_module_type_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memoryProfileId: integer('memory_profile_id').notNull().references(
    () => hostMemoryProfiles.id,
    { onDelete: 'cascade' },
  ),
  moduleTypeId: integer('module_type_id').notNull().references(() => memoryModuleTypes.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('host_memory_module_type_support_unique').on(table.memoryProfileId, table.moduleTypeId),
  index('host_memory_module_type_support_type_index').on(table.moduleTypeId),
])

export const storageResourceGroups = sqliteTable('storage_resource_groups', {
  id: integer('id').primaryKey().references(() => hostResourceGroups.id, { onDelete: 'cascade' }),
  pcieGeneration: integer('pcie_generation'),
  hotSwap: integer('hot_swap', { mode: 'boolean' }),
  backplane: text('backplane'),
  directConnect: integer('direct_connect', { mode: 'boolean' }),
}, (table) => [
  check('storage_resource_groups_pcie_check', sql`${table.pcieGeneration} IS NULL OR ${table.pcieGeneration} > 0`),
  check('storage_resource_groups_hot_swap_check', sql`${table.hotSwap} IS NULL OR ${table.hotSwap} IN (0, 1)`),
  check('storage_resource_groups_direct_check', sql`${table.directConnect} IS NULL OR ${table.directConnect} IN (0, 1)`),
])

export const storageResourceInterfaces = sqliteTable('storage_resource_interfaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceGroupId: integer('resource_group_id').notNull().references(
    () => storageResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  interfaceId: integer('interface_id').notNull().references(() => storageInterfaces.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('storage_resource_interfaces_unique').on(table.resourceGroupId, table.interfaceId),
  index('storage_resource_interfaces_interface_index').on(table.interfaceId),
])

export const storageResourceFormFactors = sqliteTable('storage_resource_form_factors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceGroupId: integer('resource_group_id').notNull().references(
    () => storageResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  formFactorId: integer('form_factor_id').notNull().references(() => storageFormFactors.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('storage_resource_form_factors_unique').on(table.resourceGroupId, table.formFactorId),
  index('storage_resource_form_factors_factor_index').on(table.formFactorId),
])

export const storageResourceControllers = sqliteTable('storage_resource_controllers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storageResourceGroupId: integer('storage_resource_group_id').notNull().references(
    () => storageResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  controllerResourceGroupId: integer('controller_resource_group_id').notNull().references(
    () => hostResourceGroups.id,
    { onDelete: 'restrict' },
  ),
}, (table) => [
  uniqueIndex('storage_resource_controllers_unique').on(
    table.storageResourceGroupId,
    table.controllerResourceGroupId,
  ),
  index('storage_resource_controllers_controller_index').on(table.controllerResourceGroupId),
])

export const expansionResourceGroups = sqliteTable('expansion_resource_groups', {
  id: integer('id').primaryKey().references(() => hostResourceGroups.id, { onDelete: 'cascade' }),
  interfaceFamily: text('interface_family').notNull(),
  interfaceKey: text('interface_key'),
  keying: text('keying'),
  moduleSize: text('module_size'),
  usbGeneration: text('usb_generation'),
  connector: text('connector'),
  ocpVersion: text('ocp_version'),
  expansionSlotTypeId: integer('expansion_slot_type_id').references(
    () => expansionSlotTypes.id,
    { onDelete: 'restrict' },
  ),
  pcieGeneration: integer('pcie_generation'),
  mechanicalLanes: integer('mechanical_lanes'),
  electricalLanes: integer('electrical_lanes'),
  maxSlotWidth: integer('max_slot_width'),
  maxPowerMw: integer('max_power_mw'),
  proprietaryRiser: integer('proprietary_riser', { mode: 'boolean' }),
  riserCapability: text('riser_capability'),
  riserGroup: text('riser_group'),
}, (table) => [
  index('expansion_resource_groups_slot_type_index').on(table.expansionSlotTypeId),
  check('expansion_resource_groups_family_check', sql`
    ${table.interfaceFamily} IN (
      'pcie', 'm2-ae', 'm2-bm', 'mini-pcie', 'usb', 'ocp', 'mezzanine', 'onboard', 'proprietary'
    )
  `),
  check('expansion_resource_groups_generation_check', sql`${table.pcieGeneration} IS NULL OR ${table.pcieGeneration} > 0`),
  check('expansion_resource_groups_mechanical_check', sql`${table.mechanicalLanes} IS NULL OR ${table.mechanicalLanes} > 0`),
  check('expansion_resource_groups_electrical_check', sql`${table.electricalLanes} IS NULL OR ${table.electricalLanes} > 0`),
  check('expansion_resource_groups_width_check', sql`${table.maxSlotWidth} IS NULL OR ${table.maxSlotWidth} > 0`),
  check('expansion_resource_groups_power_check', sql`${table.maxPowerMw} IS NULL OR ${table.maxPowerMw} >= 0`),
  check('expansion_resource_groups_riser_check', sql`${table.proprietaryRiser} IS NULL OR ${table.proprietaryRiser} IN (0, 1)`),
])

export const expansionAcceptedHeights = sqliteTable('expansion_accepted_heights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceGroupId: integer('resource_group_id').notNull().references(
    () => expansionResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  height: text('height').notNull(),
}, (table) => [
  uniqueIndex('expansion_accepted_heights_unique').on(table.resourceGroupId, table.height),
  check('expansion_accepted_heights_value_check', sql`${table.height} IN ('full-height', 'low-profile')`),
])

export const resourceAcceptedKinds = sqliteTable('resource_accepted_kinds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceGroupId: integer('resource_group_id').notNull().references(
    () => hostResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  kind: text('kind').notNull(),
}, (table) => [
  uniqueIndex('resource_accepted_kinds_unique').on(table.resourceGroupId, table.kind),
  check('resource_accepted_kinds_value_check', sql`length(trim(${table.kind})) > 0`),
])

export const controllerResourceGroups = sqliteTable('controller_resource_groups', {
  id: integer('id').primaryKey().references(() => hostResourceGroups.id, { onDelete: 'cascade' }),
  interfaceFamily: text('interface_family'),
  dedicated: integer('dedicated', { mode: 'boolean' }),
}, (table) => [
  check('controller_resource_groups_dedicated_check', sql`${table.dedicated} IS NULL OR ${table.dedicated} IN (0, 1)`),
])

export const bootDeviceResourceGroups = sqliteTable('boot_device_resource_groups', {
  id: integer('id').primaryKey().references(() => hostResourceGroups.id, { onDelete: 'cascade' }),
  controllerResourceGroupId: integer('controller_resource_group_id').references(
    () => hostResourceGroups.id,
    { onDelete: 'restrict' },
  ),
}, (table) => [
  index('boot_device_resource_groups_controller_index').on(table.controllerResourceGroupId),
])

export const bootDeviceResourceInterfaces = sqliteTable('boot_device_resource_interfaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bootDeviceResourceGroupId: integer('boot_device_resource_group_id').notNull().references(
    () => bootDeviceResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  interfaceId: integer('interface_id').notNull().references(() => storageInterfaces.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('boot_device_resource_interfaces_unique').on(
    table.bootDeviceResourceGroupId,
    table.interfaceId,
  ),
  index('boot_device_resource_interfaces_interface_index').on(table.interfaceId),
])

export const bootDeviceResourceFormFactors = sqliteTable('boot_device_resource_form_factors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bootDeviceResourceGroupId: integer('boot_device_resource_group_id').notNull().references(
    () => bootDeviceResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  formFactorId: integer('form_factor_id').notNull().references(() => storageFormFactors.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('boot_device_resource_form_factors_unique').on(
    table.bootDeviceResourceGroupId,
    table.formFactorId,
  ),
  index('boot_device_resource_form_factors_factor_index').on(table.formFactorId),
])

export const hostPowerConnectorGroups = sqliteTable('host_power_connector_groups', {
  id: integer('id').primaryKey().references(() => hostResourceGroups.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  connector: text('connector').notNull(),
  count: integer('count').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull(),
}, (table) => [
  check('host_power_connector_groups_kind_check', sql`${table.kind} IN ('main-power', 'cpu-power')`),
  check('host_power_connector_groups_connector_check', sql`length(trim(${table.connector})) > 0`),
  check('host_power_connector_groups_count_check', sql`${table.count} > 0`),
  check('host_power_connector_groups_required_check', sql`${table.required} IN (0, 1)`),
])

export const coolingResourceGroups = sqliteTable('cooling_resource_groups', {
  id: integer('id').primaryKey().references(() => hostResourceGroups.id, { onDelete: 'cascade' }),
  fanCount: integer('fan_count'),
  redundant: integer('redundant', { mode: 'boolean' }),
}, (table) => [
  check('cooling_resource_groups_fan_check', sql`${table.fanCount} IS NULL OR ${table.fanCount} >= 0`),
  check('cooling_resource_groups_redundant_check', sql`${table.redundant} IS NULL OR ${table.redundant} IN (0, 1)`),
])

export const coolingConditions = sqliteTable('cooling_conditions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceGroupId: integer('resource_group_id').notNull().references(
    () => coolingResourceGroups.id,
    { onDelete: 'cascade' },
  ),
  condition: text('condition').notNull(),
}, (table) => [
  uniqueIndex('cooling_conditions_unique').on(table.resourceGroupId, table.condition),
])

export const managementControllers = sqliteTable('management_controllers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostProfileId: integer('host_profile_id').notNull().references(
    () => hostCompatibilityProfiles.id,
    { onDelete: 'cascade' },
  ),
  controllerFamily: text('controller_family'),
  controllerGeneration: text('controller_generation'),
  dedicatedPort: integer('dedicated_port', { mode: 'boolean' }),
  sharedNic: integer('shared_nic', { mode: 'boolean' }),
  portType: text('port_type'),
  speedBps: integer('speed_bps'),
}, (table) => [
  uniqueIndex('management_controllers_host_profile_unique').on(table.hostProfileId),
  check('management_controllers_dedicated_check', sql`${table.dedicatedPort} IS NULL OR ${table.dedicatedPort} IN (0, 1)`),
  check('management_controllers_shared_check', sql`${table.sharedNic} IS NULL OR ${table.sharedNic} IN (0, 1)`),
  check('management_controllers_speed_check', sql`${table.speedBps} IS NULL OR ${table.speedBps} >= 0`),
])

export const hostPowerProfiles = sqliteTable('host_power_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostProfileId: integer('host_profile_id').notNull().references(
    () => hostCompatibilityProfiles.id,
    { onDelete: 'cascade' },
  ),
  configuration: text('configuration'),
  adapterDisposition: text('adapter_disposition'),
  connector: text('connector'),
  adapterRequired: integer('adapter_required', { mode: 'boolean' }),
  adapterType: text('adapter_type'),
  redundancy: text('redundancy'),
  maxGraphicsPowerMw: integer('max_graphics_power_mw'),
  psuBayCount: integer('psu_bay_count'),
  psuType: text('psu_type'),
  mixedPsuAllowed: integer('mixed_psu_allowed', { mode: 'boolean' }),
}, (table) => [
  uniqueIndex('host_power_profiles_host_profile_unique').on(table.hostProfileId),
  check('host_power_profiles_configuration_check', sql`
    ${table.configuration} IS NULL OR ${table.configuration} IN ('internal-psu', 'external-adapter')
  `),
  check('host_power_profiles_adapter_disposition_check', sql`
    (${table.configuration} = 'external-adapter' AND ${table.adapterDisposition} IN ('fixed', 'replaceable'))
    OR (${table.configuration} IS NULL AND ${table.adapterDisposition} IS NULL)
    OR (${table.configuration} = 'internal-psu' AND ${table.adapterDisposition} IS NULL)
  `),
  check('host_power_profiles_adapter_required_check', sql`${table.adapterRequired} IS NULL OR ${table.adapterRequired} IN (0, 1)`),
  check('host_power_profiles_redundancy_check', sql`
    ${table.redundancy} IS NULL OR ${table.redundancy} IN ('none', 'optional', 'required', 'supported')
  `),
  check('host_power_profiles_graphics_power_check', sql`
    ${table.maxGraphicsPowerMw} IS NULL OR ${table.maxGraphicsPowerMw} >= 0
  `),
  check('host_power_profiles_psu_bay_check', sql`${table.psuBayCount} IS NULL OR ${table.psuBayCount} >= 0`),
  check('host_power_profiles_psu_type_check', sql`
    ${table.psuType} IS NULL OR ${table.psuType} IN ('fixed', 'cabled', 'hot-plug')
  `),
  check('host_power_profiles_mixed_check', sql`${table.mixedPsuAllowed} IS NULL OR ${table.mixedPsuAllowed} IN (0, 1)`),
])

export const hostPowerSupportedWattages = sqliteTable('host_power_supported_wattages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  powerProfileId: integer('power_profile_id').notNull().references(() => hostPowerProfiles.id, { onDelete: 'cascade' }),
  powerMw: integer('power_mw').notNull(),
}, (table) => [
  uniqueIndex('host_power_supported_wattages_unique').on(table.powerProfileId, table.powerMw),
  check('host_power_supported_wattages_power_check', sql`${table.powerMw} >= 0`),
])

export const hostPowerRedundancyModes = sqliteTable('host_power_redundancy_modes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  powerProfileId: integer('power_profile_id').notNull().references(() => hostPowerProfiles.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
}, (table) => [
  uniqueIndex('host_power_redundancy_modes_unique').on(table.powerProfileId, table.mode),
])

export const compatibilityConstraintGroups = sqliteTable('compatibility_constraint_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostProfileId: integer('host_profile_id').notNull().references(
    () => hostCompatibilityProfiles.id,
    { onDelete: 'cascade' },
  ),
  semanticKey: text('semantic_key').notNull(),
  label: text('label').notNull(),
  kind: text('kind').notNull(),
}, (table) => [
  uniqueIndex('compatibility_constraint_groups_key_unique').on(table.hostProfileId, table.semanticKey),
  check('compatibility_constraint_groups_kind_check', sql`${table.kind} = 'mutually-exclusive'`),
])

export const compatibilityConstraintMembers = sqliteTable('compatibility_constraint_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  constraintGroupId: integer('constraint_group_id').notNull().references(
    () => compatibilityConstraintGroups.id,
    { onDelete: 'cascade' },
  ),
  resourceGroupId: integer('resource_group_id').notNull().references(
    () => hostResourceGroups.id,
    { onDelete: 'cascade' },
  ),
}, (table) => [
  uniqueIndex('compatibility_constraint_members_unique').on(table.constraintGroupId, table.resourceGroupId),
  index('compatibility_constraint_members_resource_index').on(table.resourceGroupId),
])
