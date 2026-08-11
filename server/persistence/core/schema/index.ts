import * as inventoryBase from './inventory-base.ts'
import * as inventoryComponents from './inventory-components.ts'
import * as inventoryHosts from './inventory-hosts.ts'
import * as inventoryNetwork from './inventory-network.ts'
import * as inventoryPower from './inventory-power.ts'
import * as projectBase from './project-base.ts'
import * as projects from './projects.ts'
import * as system from './system.ts'
import * as vocabularies from './vocabularies.ts'

export * from './inventory-base.ts'
export * from './inventory-components.ts'
export * from './inventory-hosts.ts'
export * from './inventory-network.ts'
export * from './inventory-power.ts'
export * from './project-base.ts'
export * from './projects.ts'
export * from './system.ts'
export * from './vocabularies.ts'

export const coreSchema = {
  ...system,
  ...projectBase,
  ...projects,
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
