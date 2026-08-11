import * as agents from './agents.ts'
import * as authentication from './authentication.ts'
import * as audits from './audits.ts'
import * as backups from './backups.ts'
import * as inventoryBase from './inventory-base.ts'
import * as inventoryComponents from './inventory-components.ts'
import * as inventoryHosts from './inventory-hosts.ts'
import * as inventoryNetwork from './inventory-network.ts'
import * as inventoryPower from './inventory-power.ts'
import * as notifications from './notifications.ts'
import * as projectBase from './project-base.ts'
import * as projects from './projects.ts'
import * as ports from './ports.ts'
import * as resources from './resources.ts'
import * as registry from './registry.ts'
import * as routing from './routing.ts'
import * as system from './system.ts'
import * as topology from './topology.ts'
import * as vocabularies from './vocabularies.ts'

export * from './agents.ts'
export * from './authentication.ts'
export * from './audits.ts'
export * from './backups.ts'
export * from './inventory-base.ts'
export * from './inventory-components.ts'
export * from './inventory-hosts.ts'
export * from './inventory-network.ts'
export * from './inventory-power.ts'
export * from './notifications.ts'
export * from './project-base.ts'
export * from './projects.ts'
export * from './ports.ts'
export * from './resources.ts'
export * from './registry.ts'
export * from './routing.ts'
export * from './system.ts'
export * from './topology.ts'
export * from './vocabularies.ts'

export const coreSchema = {
  ...agents,
  ...authentication,
  ...audits,
  ...backups,
  ...notifications,
  ...registry,
  ...system,
  ...projectBase,
  ...projects,
  ...ports,
  ...resources,
  ...routing,
  ...topology,
  ...inventoryBase,
  ...inventoryComponents,
  ...inventoryHosts,
  ...inventoryNetwork,
  ...inventoryPower,
  ...vocabularies,
}

export const inventorySubtypeTables = {
  server: inventoryHosts.servers,
  nas: inventoryHosts.nasSystems,
  pcBuild: inventoryHosts.pcBuilds,
  cpu: inventoryComponents.cpus,
  ram: inventoryComponents.memoryModules,
  storage: inventoryComponents.storageDevices,
  gpu: inventoryComponents.graphicsCards,
  network: inventoryNetwork.networkCards,
  motherboard: inventoryComponents.motherboards,
  cpuCooler: inventoryComponents.cpuCoolers,
  case: inventoryComponents.computerCases,
  powerSupply: inventoryPower.powerSupplies,
  soundCard: inventoryComponents.soundCards,
  wireless: inventoryComponents.wirelessCards,
  powerAdapter: inventoryPower.powerAdapters,
  switch: inventoryNetwork.networkSwitches,
  patchPanel: inventoryNetwork.patchPanels,
  monitor: inventoryNetwork.monitors,
  ups: inventoryPower.upsSystems,
  powerStrip: inventoryPower.powerStrips,
} as const
