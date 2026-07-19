function optionalNumber(value) {
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalString(value) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized || undefined
}

function normalizeRamGeneration(value) {
  return optionalString(value)?.toUpperCase()
}

function normalizeStorageInterface(value) {
  const normalized = optionalString(value)
  if (!normalized) {
    return undefined
  }

  const canonicalInterfaces = new Map([
    ['m.2', 'M.2'],
    ['nvme', 'NVMe'],
    ['pcie', 'PCIe'],
    ['sas', 'SAS'],
    ['sata', 'SATA'],
    ['u.2', 'U.2'],
    ['usb', 'USB'],
  ])

  return canonicalInterfaces.get(normalized.toLowerCase()) ?? normalized
}

export function normalizeHostCapabilities(item) {
  const host = item?.compatibility?.host
  return host && typeof host === 'object' ? structuredClone(host) : {}
}

export function parsePcieDescriptor(value) {
  if (typeof value !== 'string') {
    return {}
  }

  const match = value.match(/PCIe\s*([\d.]+)\s*x(\d+)/i)
  if (!match) {
    return {}
  }

  const pcieGeneration = optionalNumber(match[1])
  const connectorLanes = optionalNumber(match[2])
  return pcieGeneration !== undefined && connectorLanes !== undefined
    ? { pcieGeneration, connectorLanes }
    : {}
}

export function normalizeComponentRequirements(item) {
  const specs = item?.specs ?? {}

  if (item?.type === 'cpu') {
    return {
      type: 'cpu',
      ...(item.compatibility?.requirements?.cpu ?? {}),
    }
  }

  if (item?.type === 'ram') {
    const capacityGb = optionalNumber(specs.capacityGb)
    const moduleCount = optionalNumber(specs.moduleCount)
    const hasModuleCapacity =
      capacityGb !== undefined && moduleCount !== undefined && moduleCount !== 0

    return {
      type: 'ram',
      capacityGb,
      moduleCount,
      moduleCapacityGb: hasModuleCapacity ? capacityGb / moduleCount : undefined,
      generation: normalizeRamGeneration(specs.generation),
      speedMt: optionalNumber(specs.speedMt),
    }
  }

  if (item?.type === 'storage') {
    return {
      type: 'storage',
      capacityGb: optionalNumber(specs.capacityGb),
      capacityTb: optionalNumber(specs.capacityTb),
      interface: normalizeStorageInterface(specs.interface),
      formFactor: optionalString(specs.formFactor),
      ...parsePcieDescriptor(specs.pcie),
    }
  }

  if (item?.type === 'gpu' || item?.type === 'network') {
    const legacyPcie = item.type === 'network' ? (specs.pcie ?? specs.interface) : specs.pcie

    return {
      type: item.type,
      ...parsePcieDescriptor(legacyPcie),
      powerWatts: optionalNumber(specs.powerWatts),
      ...(item.compatibility?.requirements?.expansion ?? {}),
    }
  }

  return { type: item?.type }
}
