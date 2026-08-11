import { INVENTORY_TYPES, type InventoryType } from '../core/inventory/field-contract.ts'

const TABLE_BY_TYPE: Readonly<Record<InventoryType, string>> = {
  server: 'servers', nas: 'nas', pcBuild: 'pcBuilds', cpu: 'cpus', ram: 'ram',
  storage: 'storage', gpu: 'gpus', network: 'networkCards', motherboard: 'motherboards',
  cpuCooler: 'cpuCoolers', case: 'cases', powerSupply: 'powerSupplies', soundCard: 'soundCards',
  wireless: 'wirelessCards', powerAdapter: 'powerAdapters', switch: 'switches',
  patchPanel: 'patchPanels', monitor: 'monitors', ups: 'upsSystems', powerStrip: 'powerStrips',
}

function values(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function whole(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

export function legacySemanticSnapshot(snapshot: Record<string, any>) {
  const byType: Record<string, number> = {}
  let total = 0
  let memoryCapacityMiB = 0
  let storageCapacityBytes = 0
  for (const type of INVENTORY_TYPES) {
    const records = values(snapshot.inventory?.[TABLE_BY_TYPE[type]])
    if (records.length) byType[type] = records.length
    total += records.length
    if (type === 'ram') {
      memoryCapacityMiB += records.reduce((sum, item) => sum + whole(item.specs?.capacityGb) * 1024, 0)
    }
    if (type === 'storage') {
      storageCapacityBytes += records.reduce((sum, item) => {
        if (whole(item.specs?.capacityBytes)) return sum + whole(item.specs.capacityBytes)
        if (whole(item.specs?.capacityTb)) return sum + whole(item.specs.capacityTb) * 1_000_000_000_000
        return sum + whole(item.specs?.capacityGb) * 1_000_000_000
      }, 0)
    }
  }
  return {
    schemaVersion: snapshot.meta?.schemaVersion,
    inventory: { total, byType, memoryCapacityMiB, storageCapacityBytes },
    topology: {
      assignments: values(snapshot.project?.assignments).length,
      placements: values(snapshot.project?.placements).length,
      connections: values(snapshot.project?.connections).length,
    },
    identity: {
      inventoryAliases: total,
      registryLinks: values(snapshot.registry?.links).length,
      agents: values(snapshot.agents?.devices).length,
      users: values(snapshot.authentication?.accounts).length,
    },
    registry: {
      sources: values(snapshot.registry?.sources).length,
      links: values(snapshot.registry?.links).length,
      outbox: values(snapshot.registry?.contributionOutbox).length,
      ledger: values(snapshot.registry?.contributionLedger).length,
    },
    notifications: {
      contactPoints: values(snapshot.notifications?.contactPoints).length,
      incidents: values(snapshot.notificationState?.incidents).length,
      deliveries: values(snapshot.notificationState?.deliveryJobs).length,
    },
    backups: {
      backups: values(snapshot.backupManagement?.backups).length,
      restores: values(snapshot.backupManagement?.restores).length,
    },
    project: {
      revision: snapshot.project?.revision ?? 0,
      disabledCompatibilityHosts: values(snapshot.project?.compatibilityPolicy?.disabledHosts).length,
      ignoredCompatibilityWarnings: values(snapshot.project?.compatibilityPolicy?.ignoredWarningIds).length,
    },
  }
}
