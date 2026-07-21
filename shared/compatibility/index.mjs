function optionalNumber(value) {
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return undefined
  }

  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined
  }

  const normalized = typeof value === 'string' ? value.trim() : value
  if (
    typeof normalized === 'string' &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)
  ) {
    return undefined
  }

  const parsed = typeof normalized === 'number' ? normalized : Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalString(value) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized || undefined
}

function optionalStringArray(value) {
  return [...new Set(
    (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
      .map(optionalString)
      .filter(Boolean),
  )]
}

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const EXPANSION_TYPES = new Set(['gpu', 'network', 'soundCard', 'wireless'])

function isHost(item) {
  return HOST_TYPES.has(item?.type)
}

function isExpansion(itemOrType) {
  return EXPANSION_TYPES.has(typeof itemOrType === 'string' ? itemOrType : itemOrType?.type)
}

export function normalizeCompatibilityPolicy(policy) {
  const uniqueStrings = (values) => [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )]

  const disabledHosts = []
  for (const value of Array.isArray(policy?.disabledHosts) ? policy.disabledHosts : []) {
    if (
      HOST_TYPES.has(value?.hostType)
      && Number.isSafeInteger(value?.hostId)
      && value.hostId > 0
      && !disabledHosts.some((entry) => entry.hostType === value.hostType && entry.hostId === value.hostId)
    ) {
      disabledHosts.push({ hostType: value.hostType, hostId: value.hostId })
    }
  }

  return {
    disabledHosts,
    ignoredWarningIds: uniqueStrings(policy?.ignoredWarningIds),
  }
}

export function isHostCompatibilityEnabled(project, hostId) {
  const match = typeof hostId === 'string' ? hostId.match(/^([^:]+):([1-9]\d*)$/) : null
  if (!match) return true
  const hostType = match[1]
  const numericHostId = Number(match[2])
  return !normalizeCompatibilityPolicy(project?.compatibilityPolicy).disabledHosts
    .some((entry) => entry.hostType === hostType && entry.hostId === numericHostId)
}

export function normalizeProjectCompatibilityPolicy(project) {
  const policy = normalizeCompatibilityPolicy(project?.compatibilityPolicy)
  const disabledHosts = policy.disabledHosts.filter(({ hostType, hostId }) => {
    const item = project?.items?.[`${hostType}:${hostId}`]
    return isHost(item)
  })

  return {
    ...project,
    compatibilityPolicy: { ...policy, disabledHosts },
  }
}

function normalizeRamGeneration(value) {
  return optionalString(value)?.toUpperCase()
}

function normalizeCpuSocket(value) {
  const normalized = optionalString(value)
  if (!normalized) {
    return undefined
  }

  const compact = normalized.toUpperCase().replace(/[\s_-]+/g, '')
  return compact.replace(/^FC(?=(?:LGA|BGA|PGA)\d)/, '')
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

function normalizeNumericField(target, field) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, field)) {
    return
  }
  const normalized = optionalNumber(target[field])
  if (normalized === undefined) {
    delete target[field]
  } else {
    target[field] = normalized
  }
}

export function normalizeHostCapabilities(item) {
  const host = item?.compatibility?.host
  if (!host || typeof host !== 'object') {
    return {}
  }

  const normalized = structuredClone(host)
  if (Array.isArray(normalized.cpu?.sockets)) {
    normalized.cpu.sockets = normalized.cpu.sockets
      .map(normalizeCpuSocket)
      .filter(Boolean)
  }
  normalizeNumericField(normalized.cpu, 'maxTdpWatts')
  for (const field of ['slots', 'maxCapacityGb', 'maxModuleCapacityGb', 'maxSpeedMt']) {
    normalizeNumericField(normalized.memory, field)
  }
  for (const group of Array.isArray(normalized.storageSlots) ? normalized.storageSlots : []) {
    for (const field of ['count', 'pcieGeneration']) {
      normalizeNumericField(group, field)
    }
  }
  normalizeNumericField(normalized, 'maxExpansionPowerWatts')
  for (const group of Array.isArray(normalized.expansionSlots) ? normalized.expansionSlots : []) {
    for (const field of [
      'count',
      'pcieGeneration',
      'mechanicalLanes',
      'electricalLanes',
      'maxSlotWidth',
      'maxPowerWatts',
    ]) {
      normalizeNumericField(group, field)
    }
  }
  return normalized
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
    const structured = item.compatibility?.requirements?.cpu ?? {}
    const normalized = { type: 'cpu' }
    const socket = normalizeCpuSocket(structured.socket)
    const generation = optionalString(structured.generation)
    const tdpWatts = optionalNumber(structured.tdpWatts)
    if (socket !== undefined) normalized.socket = socket
    if (generation !== undefined) normalized.generation = generation
    if (tdpWatts !== undefined) normalized.tdpWatts = tdpWatts
    return normalized
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

  if (isExpansion(item)) {
    const legacyPcie = specs.pcie ?? specs.interface
    const legacy = parsePcieDescriptor(legacyPcie)
    const structured = item.compatibility?.requirements?.expansion
    const normalized = { type: item.type }
    const structuredNumber = (field, fallback) => {
      if (structured && Object.prototype.hasOwnProperty.call(structured, field)) {
        return optionalNumber(structured[field])
      }
      return fallback
    }
    const legacyInterface = optionalString(specs.interface ?? specs.slot ?? specs.pcie)
    const inferredInterfaceFamily = (item.type === 'soundCard' || item.type === 'wireless') && legacyInterface
      ? /m\.?2|a\+e/i.test(legacyInterface)
        ? 'm2-ae'
        : /usb/i.test(legacyInterface)
          ? 'usb'
          : /on[ -]?board/i.test(legacyInterface)
            ? 'onboard'
            : /pcie|pci express/i.test(legacyInterface)
              ? 'pcie'
              : undefined
      : undefined
    const interfaceFamily = optionalString(structured?.interfaceFamily ?? inferredInterfaceFamily)
    const height = optionalString(structured?.height)
    const pcieGeneration = structuredNumber('pcieGeneration', legacy.pcieGeneration)
    const connectorLanes = structuredNumber('connectorLanes', legacy.connectorLanes)
    const minimumElectricalLanes = structuredNumber('minimumElectricalLanes', undefined)
    const slotWidth = structuredNumber('slotWidth', undefined)
    const powerWatts = structuredNumber('powerWatts', optionalNumber(specs.powerWatts))
    const lengthMm = structuredNumber('lengthMm', optionalNumber(specs.lengthMm))
    const heightMm = structuredNumber('heightMm', optionalNumber(specs.heightMm))

    if (interfaceFamily !== undefined) normalized.interfaceFamily = interfaceFamily
    if (pcieGeneration !== undefined) normalized.pcieGeneration = pcieGeneration
    if (connectorLanes !== undefined) normalized.connectorLanes = connectorLanes
    if (minimumElectricalLanes !== undefined) {
      normalized.minimumElectricalLanes = minimumElectricalLanes
    }
    if (height !== undefined) normalized.height = height
    if (slotWidth !== undefined) normalized.slotWidth = slotWidth
    if (powerWatts !== undefined) normalized.powerWatts = powerWatts
    if (lengthMm !== undefined) normalized.lengthMm = lengthMm
    if (heightMm !== undefined) normalized.heightMm = heightMm
    return normalized
  }

  if (item?.type === 'cpuCooler') {
    const structured = item.compatibility?.requirements?.cooling ??
      item.compatibility?.requirements?.cpuCooler ?? {}
    return {
      type: 'cpuCooler',
      supportedSockets: optionalStringArray(
        structured.supportedSockets ?? structured.sockets ?? specs.supportedSockets ?? specs.sockets,
      ).map(normalizeCpuSocket).filter(Boolean),
      coolingCapacityWatts: optionalNumber(
        structured.coolingCapacityWatts ?? structured.maxTdpWatts ?? specs.coolingCapacityWatts ??
          specs.maxTdpWatts ?? specs.tdpWatts,
      ),
      heightMm: optionalNumber(structured.heightMm ?? specs.heightMm ?? specs.coolerHeightMm),
      radiatorSizeMm: optionalNumber(structured.radiatorSizeMm ?? specs.radiatorSizeMm),
    }
  }

  if (item?.type === 'powerSupply') {
    return {
      type: 'powerSupply',
      wattageWatts: optionalNumber(specs.wattageWatts ?? specs.wattage ?? specs.powerWatts),
      formFactor: optionalString(specs.formFactor),
    }
  }

  if (item?.type === 'case') {
    return {
      type: 'case',
      supportedMotherboardFormFactors: optionalStringArray(
        specs.supportedMotherboardFormFactors ?? specs.motherboardFormFactors ?? specs.formFactors,
      ),
      supportedPsuFormFactors: optionalStringArray(
        specs.supportedPsuFormFactors ?? specs.psuFormFactors,
      ),
      maxCoolerHeightMm: optionalNumber(specs.maxCoolerHeightMm ?? specs.cpuCoolerHeightMm),
      maxExpansionLengthMm: optionalNumber(specs.maxExpansionLengthMm ?? specs.maxGpuLengthMm),
      maxExpansionHeightMm: optionalNumber(specs.maxExpansionHeightMm ?? specs.maxGpuHeightMm),
      maxExpansionSlotWidth: optionalNumber(specs.maxExpansionSlotWidth ?? specs.maxGpuSlotWidth),
      supportedRadiatorSizesMm: optionalStringArray(
        specs.supportedRadiatorSizesMm ?? specs.radiatorSizesMm,
      ).map(optionalNumber).filter((value) => value !== undefined),
    }
  }

  if (item?.type === 'motherboard') {
    return { type: 'motherboard', formFactor: optionalString(specs.formFactor) }
  }

  return { type: item?.type }
}

function normalizedText(value) {
  return optionalString(value)?.toLowerCase()
}

function includesNormalized(values, value) {
  const expected = normalizedText(value)
  return expected !== undefined && values.some((entry) => normalizedText(entry) === expected)
}

function addFinding(findings, finding) {
  const duplicate = findings.some(
    (entry) =>
      entry.code === finding.code &&
      entry.field === finding.field &&
      entry.resourceId === finding.resourceId,
  )
  if (!duplicate) {
    findings.push(finding)
  }
}

function addMissing(findings, field, message, resourceId) {
  addFinding(findings, {
    code: 'compatibility.data.missing',
    severity: 'unknown',
    message,
    field,
    ...(resourceId ? { resourceId } : {}),
  })
}

function statusFor(findings) {
  if (findings.some((finding) => finding.severity === 'error')) {
    return 'incompatible'
  }
  if (findings.some((finding) => finding.severity === 'unknown')) {
    return 'unknown'
  }
  return 'compatible'
}

function itemLookup(items, id) {
  if (!items) {
    return undefined
  }
  if (items instanceof Map) {
    return items.get(id) ?? items.get(String(id))
  }
  if (Array.isArray(items)) {
    return items.find(
      (item) => String(item?.id) === String(id) || (item?.key && item.key === String(id)),
    )
  }
  return (
    items[id] ??
    items[String(id)] ??
    Object.values(items).find(
      (item) => String(item?.id) === String(id) || (item?.key && item.key === String(id)),
    )
  )
}

function assignedComponents(assignments, items, component) {
  const assigned = new Map()
  for (const assignment of assignments ?? []) {
    const item = itemLookup(items, assignment.itemId)
    if (item) {
      assigned.set(item.key ?? `${item.type}:${String(item.id)}`, item)
    }
  }
  if (component) {
    assigned.set(component.key ?? `${component.type}:${String(component.id)}`, component)
  }
  return [...assigned.values()]
}

function assignedItemOfType(assignments, items, type, component) {
  return assignedComponents(assignments, items, component).find((item) => item.type === type)
}

function effectiveHostForAssignment(host, assignments, items, component) {
  if (host?.type !== 'pcBuild') {
    return host
  }
  const motherboard = assignedItemOfType(assignments, items, 'motherboard', component)
  if (!motherboard) {
    return host
  }
  return {
    ...host,
    compatibility: {
      ...(host.compatibility ?? {}),
      host: structuredClone(motherboard.compatibility?.host ?? {}),
    },
  }
}

function evaluateCpuCooler(hostCapabilities, requirements, assignments, items, component, findings) {
  const cpu = assignedItemOfType(assignments, items, 'cpu', component)
  const cpuRequirements = cpu ? normalizeComponentRequirements(cpu) : undefined
  const sockets = requirements.supportedSockets

  if (sockets.length === 0) {
    addMissing(findings, 'component.cooling.supportedSockets', 'CPU cooler socket support is not recorded.')
  } else {
    const targetSocket = cpuRequirements?.socket ?? hostCapabilities.cpu?.sockets?.[0]
    if (!targetSocket) {
      addMissing(findings, 'host.cpu.sockets', 'The active CPU socket is not known.')
    } else if (!includesNormalized(sockets, targetSocket)) {
      addFinding(findings, {
        code: 'cooling.socket.mismatch',
        severity: 'error',
        message: `The CPU cooler does not support the ${targetSocket} socket.`,
        field: 'component.cooling.supportedSockets',
      })
    }
  }

  if (!cpuRequirements || cpuRequirements.tdpWatts === undefined) {
    addMissing(findings, 'component.cpu.tdpWatts', 'CPU TDP is not recorded for cooler sizing.')
  } else if (requirements.coolingCapacityWatts === undefined) {
    addMissing(findings, 'component.cooling.coolingCapacityWatts', 'CPU cooler capacity is not recorded.')
  } else if (requirements.coolingCapacityWatts < cpuRequirements.tdpWatts) {
    addFinding(findings, {
      code: 'cooling.capacity.insufficient',
      severity: 'warning',
      message: `${requirements.coolingCapacityWatts}W cooler capacity is below the CPU's ${cpuRequirements.tdpWatts}W TDP.`,
      field: 'component.cooling.coolingCapacityWatts',
    })
  }
}

function evaluateCaseConstraint(caseItem, component, requirements, findings) {
  if (!caseItem || component.type === 'case') {
    return
  }
  const caseRequirements = normalizeComponentRequirements(caseItem)

  if (component.type === 'motherboard') {
    if (caseRequirements.supportedMotherboardFormFactors.length === 0) {
      addMissing(findings, 'case.supportedMotherboardFormFactors', 'Case motherboard form-factor support is not recorded.')
    } else if (!requirements.formFactor) {
      addMissing(findings, 'component.motherboard.formFactor', 'Motherboard form factor is not recorded.')
    } else if (!includesNormalized(caseRequirements.supportedMotherboardFormFactors, requirements.formFactor)) {
      addFinding(findings, {
        code: 'case.motherboard-form-factor.mismatch',
        severity: 'error',
        message: `${requirements.formFactor} motherboards are not supported by this case.`,
        field: 'component.motherboard.formFactor',
      })
    }
  }

  if (component.type === 'powerSupply') {
    if (caseRequirements.supportedPsuFormFactors.length === 0) {
      addMissing(findings, 'case.supportedPsuFormFactors', 'Case power-supply form-factor support is not recorded.')
    } else if (!requirements.formFactor) {
      addMissing(findings, 'component.powerSupply.formFactor', 'Power-supply form factor is not recorded.')
    } else if (!includesNormalized(caseRequirements.supportedPsuFormFactors, requirements.formFactor)) {
      addFinding(findings, {
        code: 'case.psu-form-factor.mismatch',
        severity: 'error',
        message: `${requirements.formFactor} power supplies are not supported by this case.`,
        field: 'component.powerSupply.formFactor',
      })
    }
  }

  if (component.type === 'cpuCooler') {
    if (requirements.heightMm !== undefined) {
      if (caseRequirements.maxCoolerHeightMm === undefined) {
        addMissing(findings, 'case.maxCoolerHeightMm', 'Case CPU cooler height limit is not recorded.')
      } else if (requirements.heightMm > caseRequirements.maxCoolerHeightMm) {
        addFinding(findings, {
          code: 'case.cooler-height.exceeded',
          severity: 'error',
          message: `${requirements.heightMm}mm cooler height exceeds the case limit of ${caseRequirements.maxCoolerHeightMm}mm.`,
          field: 'component.cooling.heightMm',
        })
      }
    }
    if (requirements.radiatorSizeMm !== undefined) {
      if (caseRequirements.supportedRadiatorSizesMm.length === 0) {
        addMissing(findings, 'case.supportedRadiatorSizesMm', 'Case radiator support is not recorded.')
      } else if (!caseRequirements.supportedRadiatorSizesMm.includes(requirements.radiatorSizeMm)) {
        addFinding(findings, {
          code: 'case.radiator-size.unsupported',
          severity: 'error',
          message: `${requirements.radiatorSizeMm}mm radiators are not supported by this case.`,
          field: 'component.cooling.radiatorSizeMm',
        })
      }
    }
  }

  if (isExpansion(component)) {
    const dimensions = [
      ['lengthMm', 'maxExpansionLengthMm', 'case.expansion-length.exceeded', 'length'],
      ['heightMm', 'maxExpansionHeightMm', 'case.expansion-height.exceeded', 'height'],
      ['slotWidth', 'maxExpansionSlotWidth', 'case.expansion-width.exceeded', 'slot width'],
    ]
    for (const [field, limitField, code, label] of dimensions) {
      if (requirements[field] === undefined) continue
      if (caseRequirements[limitField] === undefined) {
        addMissing(findings, `case.${limitField}`, `Case expansion ${label} limit is not recorded.`)
      } else if (requirements[field] > caseRequirements[limitField]) {
        addFinding(findings, {
          code,
          severity: 'error',
          message: `Expansion-card ${label} exceeds the case limit.`,
          field: `component.expansion.${field}`,
        })
      }
    }
  }
}

function evaluatePowerSupply(assignments, items, component, requirements, findings) {
  const poweredItems = assignedComponents(assignments, items, component)
    .filter((item) => item.type === 'cpu' || isExpansion(item))
  const draws = poweredItems.map((item) => normalizeComponentRequirements(item).tdpWatts ??
    normalizeComponentRequirements(item).powerWatts)
  const knownDraw = draws.filter((value) => value !== undefined)
  const totalDraw = knownDraw.reduce((total, value) => total + value, 0)

  if (requirements.wattageWatts === undefined) {
    addMissing(findings, 'component.powerSupply.wattageWatts', 'Power-supply wattage is not recorded.')
    return
  }
  if (knownDraw.length !== draws.length) {
    addMissing(findings, 'pcBuild.powerDrawWatts', 'Power draw is missing for installed CPU or expansion hardware.')
  }
  if (totalDraw > requirements.wattageWatts) {
    addFinding(findings, {
      code: 'power.capacity.exceeded',
      severity: 'error',
      message: `${totalDraw}W known component draw exceeds the ${requirements.wattageWatts}W power supply.`,
      field: 'component.powerSupply.wattageWatts',
    })
  } else if (totalDraw > requirements.wattageWatts * 0.8) {
    addFinding(findings, {
      code: 'power.headroom.low',
      severity: 'warning',
      message: `${totalDraw}W known component draw leaves less than 20% PSU headroom.`,
      field: 'component.powerSupply.wattageWatts',
    })
  }
}

function evaluateCpu(hostCapabilities, requirements, findings) {
  const support = hostCapabilities.cpu
  const checks = [
    ['socket', support?.sockets, requirements.socket, 'cpu.socket.mismatch'],
    ['generation', support?.generations, requirements.generation, 'cpu.generation.unsupported'],
  ]

  for (const [field, accepted, actual, code] of checks) {
    if (!Array.isArray(accepted) || accepted.length === 0) {
      addMissing(findings, `host.cpu.${field === 'socket' ? 'sockets' : 'generations'}`, `Host CPU ${field} support is not recorded.`)
    } else if (!actual) {
      addMissing(findings, `component.cpu.${field}`, `CPU ${field} is not recorded.`)
    } else if (!includesNormalized(accepted, actual)) {
      addFinding(findings, {
        code,
        severity: 'error',
        message: `CPU ${field} ${actual} is not supported by this host.`,
        field: `component.cpu.${field}`,
      })
    }
  }

  if (support?.maxTdpWatts === undefined) {
    addMissing(findings, 'host.cpu.maxTdpWatts', 'Host CPU TDP limit is not recorded.')
  } else if (requirements.tdpWatts === undefined) {
    addMissing(findings, 'component.cpu.tdpWatts', 'CPU TDP is not recorded.')
  } else if (requirements.tdpWatts > support.maxTdpWatts) {
    addFinding(findings, {
      code: 'cpu.tdp.exceeded',
      severity: 'error',
      message: `CPU TDP ${requirements.tdpWatts}W exceeds the host limit of ${support.maxTdpWatts}W.`,
      field: 'component.cpu.tdpWatts',
    })
  }
}

function evaluateMemory(hostCapabilities, requirements, assignments, items, component, findings) {
  const support = hostCapabilities.memory
  const ramItems = assignedComponents(assignments, items, component).filter((item) => item.type === 'ram')
  const normalized = ramItems.map(normalizeComponentRequirements)

  if (!Array.isArray(support?.generations) || support.generations.length === 0) {
    addMissing(findings, 'host.memory.generations', 'Host memory generations are not recorded.')
  } else if (!requirements.generation) {
    addMissing(findings, 'component.memory.generation', 'Memory generation is not recorded.')
  } else if (!includesNormalized(support.generations, requirements.generation)) {
    addFinding(findings, {
      code: 'memory.generation.mismatch',
      severity: 'error',
      message: `${requirements.generation} memory is not supported by this host.`,
      field: 'component.memory.generation',
    })
  }

  if (support?.slots === undefined) {
    addMissing(findings, 'host.memory.slots', 'Host memory slot count is not recorded.')
  } else {
    const knownCounts = normalized
      .map((entry) => entry.moduleCount)
      .filter((value) => value !== undefined)
    const moduleCount = knownCounts.reduce((total, value) => total + value, 0)
    if (knownCounts.length !== normalized.length) {
      addMissing(findings, 'component.memory.moduleCount', 'Memory module count is not recorded.')
    }
    if (moduleCount > support.slots) {
      addFinding(findings, {
        code: 'memory.slots.exceeded',
        severity: 'error',
        message: `${moduleCount} memory modules exceed the host's ${support.slots} slots.`,
        field: 'component.memory.moduleCount',
      })
    }
  }

  if (support?.maxCapacityGb === undefined) {
    addMissing(findings, 'host.memory.maxCapacityGb', 'Host memory capacity limit is not recorded.')
  } else {
    const knownCapacities = normalized
      .map((entry) => entry.capacityGb)
      .filter((value) => value !== undefined)
    const capacity = knownCapacities.reduce((total, value) => total + value, 0)
    if (knownCapacities.length !== normalized.length) {
      addMissing(findings, 'component.memory.capacityGb', 'Memory capacity is not recorded.')
    }
    if (capacity > support.maxCapacityGb) {
      addFinding(findings, {
        code: 'memory.capacity.exceeded',
        severity: 'error',
        message: `${capacity}GB installed memory exceeds the host limit of ${support.maxCapacityGb}GB.`,
        field: 'component.memory.capacityGb',
      })
    }
  }

  if (support?.maxModuleCapacityGb === undefined) {
    addMissing(findings, 'host.memory.maxModuleCapacityGb', 'Host per-module memory limit is not recorded.')
  } else {
    const knownModuleCapacities = normalized
      .map((entry) => entry.moduleCapacityGb)
      .filter((value) => value !== undefined)
    if (knownModuleCapacities.length !== normalized.length) {
      addMissing(findings, 'component.memory.moduleCapacityGb', 'Memory module capacity is not known.')
    }
    const largestModule =
      knownModuleCapacities.length > 0 ? Math.max(...knownModuleCapacities) : undefined
    if (largestModule !== undefined && largestModule > support.maxModuleCapacityGb) {
      addFinding(findings, {
        code: 'memory.module-capacity.exceeded',
        severity: 'error',
        message: `${largestModule}GB modules exceed the host limit of ${support.maxModuleCapacityGb}GB per module.`,
        field: 'component.memory.moduleCapacityGb',
      })
    }
  }

  if (support?.maxSpeedMt === undefined) {
    addMissing(findings, 'host.memory.maxSpeedMt', 'Host memory speed limit is not recorded.')
  } else if (requirements.speedMt === undefined) {
    addMissing(findings, 'component.memory.speedMt', 'Memory speed is not recorded.')
  } else if (requirements.speedMt > support.maxSpeedMt) {
    addFinding(findings, {
      code: 'memory.speed.negotiated',
      severity: 'warning',
      message: `${requirements.speedMt}MT/s memory will operate at up to ${support.maxSpeedMt}MT/s.`,
      field: 'component.memory.speedMt',
    })
  }
}

function evaluateStorage(hostCapabilities, requirements, findings) {
  const groups = hostCapabilities.storageSlots
  if (!Array.isArray(groups) || groups.length === 0) {
    addMissing(findings, 'host.storageSlots', 'Host storage slot capabilities are not recorded.')
    return
  }
  if (!requirements.interface) {
    addMissing(findings, 'component.storage.interface', 'Storage interface is not recorded.')
    if (!requirements.formFactor) {
      addMissing(findings, 'component.storage.formFactor', 'Storage form factor is not recorded.')
    }
    return
  }

  const interfaceGroups = groups.filter(
    (group) =>
      Array.isArray(group.interfaces) && includesNormalized(group.interfaces, requirements.interface),
  )
  if (interfaceGroups.length === 0) {
    const unknownInterfaceGroups = groups.filter(
      (group) => !Array.isArray(group.interfaces) || group.interfaces.length === 0,
    )
    if (unknownInterfaceGroups.length > 0) {
      for (const group of unknownInterfaceGroups) {
        addMissing(
          findings,
          'host.storageSlots.interfaces',
          'Accepted storage interfaces are not recorded for this slot group.',
          group.id,
        )
      }
      if (!requirements.formFactor) {
        addMissing(findings, 'component.storage.formFactor', 'Storage form factor is not recorded.')
      }
      return
    }
    addFinding(findings, {
      code: 'storage.interface.mismatch',
      severity: 'error',
      message: `No storage slot accepts the ${requirements.interface} interface.`,
      field: 'component.storage.interface',
    })
    if (!requirements.formFactor) {
      addMissing(findings, 'component.storage.formFactor', 'Storage form factor is not recorded.')
    }
    return
  }

  if (!requirements.formFactor) {
    addMissing(findings, 'component.storage.formFactor', 'Storage form factor is not recorded.')
    return
  }

  const group = interfaceGroups.find(
    (candidate) =>
      Array.isArray(candidate.formFactors) &&
      includesNormalized(candidate.formFactors, requirements.formFactor),
  )
  if (!group) {
    const unknownFormFactorGroups = interfaceGroups.filter(
      (candidate) => !Array.isArray(candidate.formFactors) || candidate.formFactors.length === 0,
    )
    if (unknownFormFactorGroups.length > 0) {
      for (const candidate of unknownFormFactorGroups) {
        addMissing(
          findings,
          'host.storageSlots.formFactors',
          'Accepted storage form factors are not recorded for this slot group.',
          candidate.id,
        )
      }
      return
    }
    addFinding(findings, {
      code: 'storage.form-factor.mismatch',
      severity: 'error',
      message: `No ${requirements.interface} storage slot accepts the ${requirements.formFactor} form factor.`,
      field: 'component.storage.formFactor',
    })
    return
  }

  if (
    normalizedText(requirements.interface) === 'nvme' &&
    requirements.pcieGeneration !== undefined &&
    group.pcieGeneration !== undefined &&
    requirements.pcieGeneration > group.pcieGeneration
  ) {
    addFinding(findings, {
      code: 'storage.pcie-generation.negotiated',
      severity: 'warning',
      message: `PCIe ${requirements.pcieGeneration} storage will negotiate at the slot's PCIe ${group.pcieGeneration} generation.`,
      field: 'component.storage.pcieGeneration',
      resourceId: group.id,
    })
  }
}

function expansionPowerItems(assignments, items, component) {
  return assignedComponents(assignments, items, component).filter(
    (item) => isExpansion(item),
  )
}

function evaluateExpansionGroup(group, requirements) {
  const findings = []
  if (requirements.interfaceFamily === 'pcie') {
    if (requirements.connectorLanes === undefined) {
      addMissing(findings, 'component.expansion.connectorLanes', 'Card connector width is not recorded.', group.id)
    } else if (group.mechanicalLanes === undefined) {
      addMissing(findings, 'host.expansionSlots.mechanicalLanes', 'Slot mechanical width is not recorded.', group.id)
    } else if (requirements.connectorLanes > group.mechanicalLanes) {
      addFinding(findings, {
        code: 'expansion.mechanical-lanes.insufficient',
        severity: 'error',
        message: `The card's x${requirements.connectorLanes} connector does not fit the x${group.mechanicalLanes} slot.`,
        field: 'component.expansion.connectorLanes',
        resourceId: group.id,
      })
    }

    if (requirements.pcieGeneration === undefined) {
      addMissing(findings, 'component.expansion.pcieGeneration', 'Card PCIe generation is not recorded.', group.id)
    } else if (group.pcieGeneration === undefined) {
      addMissing(findings, 'host.expansionSlots.pcieGeneration', 'Slot PCIe generation is not recorded.', group.id)
    } else if (requirements.pcieGeneration > group.pcieGeneration) {
      addFinding(findings, {
        code: 'expansion.pcie-generation.negotiated',
        severity: 'warning',
        message: `PCIe ${requirements.pcieGeneration} hardware will negotiate at PCIe ${group.pcieGeneration}.`,
        field: 'component.expansion.pcieGeneration',
        resourceId: group.id,
      })
    }

    if (group.electricalLanes === undefined) {
      addMissing(findings, 'host.expansionSlots.electricalLanes', 'Slot electrical lane count is not recorded.', group.id)
    } else if (
      requirements.minimumElectricalLanes !== undefined &&
      group.electricalLanes < requirements.minimumElectricalLanes
    ) {
      addFinding(findings, {
        code: 'expansion.minimum-lanes.insufficient',
        severity: 'error',
        message: `The slot provides x${group.electricalLanes}, below the card's required x${requirements.minimumElectricalLanes}.`,
        field: 'component.expansion.minimumElectricalLanes',
        resourceId: group.id,
      })
    } else if (
      requirements.connectorLanes !== undefined &&
      group.electricalLanes < requirements.connectorLanes
    ) {
      addFinding(findings, {
        code: 'expansion.electrical-lanes.reduced',
        severity: 'warning',
        message: `The card will operate with x${group.electricalLanes} electrical lanes instead of x${requirements.connectorLanes}.`,
        field: 'component.expansion.connectorLanes',
        resourceId: group.id,
      })
    }

    if (!requirements.height) {
      addMissing(findings, 'component.expansion.height', 'Card height is not recorded.', group.id)
    } else if (!Array.isArray(group.acceptedHeights) || group.acceptedHeights.length === 0) {
      addMissing(findings, 'host.expansionSlots.acceptedHeights', 'Accepted card heights are not recorded.', group.id)
    } else if (!group.acceptedHeights.includes(requirements.height)) {
      addFinding(findings, {
        code: 'expansion.height.unsupported',
        severity: 'error',
        message: `${requirements.height} cards are not supported by this slot.`,
        field: 'component.expansion.height',
        resourceId: group.id,
      })
    }

    if (requirements.slotWidth === undefined) {
      addMissing(findings, 'component.expansion.slotWidth', 'Card occupied width is not recorded.', group.id)
    } else if (group.maxSlotWidth === undefined) {
      addMissing(findings, 'host.expansionSlots.maxSlotWidth', 'Slot occupied-width limit is not recorded.', group.id)
    } else if (requirements.slotWidth > group.maxSlotWidth) {
      addFinding(findings, {
        code: 'expansion.width.exceeded',
        severity: 'error',
        message: `${requirements.slotWidth}-slot hardware exceeds the ${group.maxSlotWidth}-slot width limit.`,
        field: 'component.expansion.slotWidth',
        resourceId: group.id,
      })
    }
  }

  if (requirements.powerWatts === undefined) {
    addMissing(findings, 'component.expansion.powerWatts', 'Expansion-card power draw is not recorded.', group.id)
  } else if (group.maxPowerWatts === undefined) {
    addMissing(findings, 'host.expansionSlots.maxPowerWatts', 'Per-slot power limit is not recorded.', group.id)
  } else if (requirements.powerWatts > group.maxPowerWatts) {
    addFinding(findings, {
      code: 'expansion.slot-power.exceeded',
      severity: 'error',
      message: `${requirements.powerWatts}W card draw exceeds the slot limit of ${group.maxPowerWatts}W.`,
      field: 'component.expansion.powerWatts',
      resourceId: group.id,
    })
  }

  return findings
}

function expansionCandidateRank(candidate) {
  const errors = candidate.findings.filter((finding) => finding.severity === 'error').length
  const unknowns = candidate.findings.filter((finding) => finding.severity === 'unknown').length
  const category = errors === 0 && unknowns === 0 ? 0 : errors === 0 ? 1 : 2
  return [category, errors, unknowns, candidate.index]
}

function compareCandidateRank(left, right) {
  const leftRank = expansionCandidateRank(left)
  const rightRank = expansionCandidateRank(right)
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return leftRank[index] - rightRank[index]
    }
  }
  return 0
}

function evaluateExpansionPower(hostCapabilities, assignments, items, component, findings) {
  const powerItems = expansionPowerItems(assignments, items, component)
  const powerRequirements = powerItems.map(normalizeComponentRequirements)
  const knownPower = powerRequirements
    .map((entry) => entry.powerWatts)
    .filter((value) => value !== undefined)
  const totalKnownPower = knownPower.reduce((total, value) => total + value, 0)

  if (hostCapabilities.maxExpansionPowerWatts === undefined) {
    addMissing(findings, 'host.maxExpansionPowerWatts', 'Host expansion power budget is not recorded.')
  } else {
    if (knownPower.length !== powerRequirements.length) {
      addMissing(
        findings,
        'host.expansionPowerAssignments.powerWatts',
        'Power draw is missing for assigned expansion hardware.',
      )
    }
    if (totalKnownPower > hostCapabilities.maxExpansionPowerWatts) {
      addFinding(findings, {
        code: 'expansion.total-power.exceeded',
        severity: 'error',
        message: `${totalKnownPower}W known expansion draw exceeds the host budget of ${hostCapabilities.maxExpansionPowerWatts}W.`,
        field: 'host.maxExpansionPowerWatts',
      })
    }
  }
}

function evaluateExpansion(hostCapabilities, requirements, assignments, items, component, findings) {
  const groups = hostCapabilities.expansionSlots
  if (!Array.isArray(groups) || groups.length === 0) {
    addMissing(findings, 'host.expansionSlots', 'Host expansion slot capabilities are not recorded.')
  } else if (!requirements.interfaceFamily) {
    addMissing(findings, 'component.expansion.interfaceFamily', 'Expansion interface family is not recorded.')
  } else {
    const matchingGroups = groups.filter(
      (candidate) => candidate.interfaceFamily === requirements.interfaceFamily,
    )
    if (matchingGroups.length === 0) {
      addFinding(findings, {
        code: 'expansion.interface.mismatch',
        severity: 'error',
        message: `No expansion slot accepts the ${requirements.interfaceFamily} interface.`,
        field: 'component.expansion.interfaceFamily',
      })
    } else {
      const candidates = matchingGroups.map((group, index) => ({
        index,
        findings: evaluateExpansionGroup(group, requirements),
      }))
      const selected = candidates.reduce((best, candidate) =>
        compareCandidateRank(candidate, best) < 0 ? candidate : best,
      )
      for (const finding of selected.findings) {
        addFinding(findings, finding)
      }
    }
  }

  evaluateExpansionPower(hostCapabilities, assignments, items, component, findings)
}

export function evaluateAssignmentCompatibility({ host, component, assignments = [], items = {} }) {
  const findings = []
  const effectiveHost = effectiveHostForAssignment(host, assignments, items, component)
  const hostCapabilities = normalizeHostCapabilities(effectiveHost)
  const requirements = normalizeComponentRequirements(component)

  if (requirements.type === 'cpu') {
    evaluateCpu(hostCapabilities, requirements, findings)
  } else if (requirements.type === 'ram') {
    evaluateMemory(hostCapabilities, requirements, assignments, items, component, findings)
  } else if (requirements.type === 'storage') {
    evaluateStorage(hostCapabilities, requirements, findings)
  } else if (isExpansion(requirements.type)) {
    evaluateExpansion(hostCapabilities, requirements, assignments, items, component, findings)
  } else if (requirements.type === 'cpuCooler' && host?.type === 'pcBuild') {
    evaluateCpuCooler(hostCapabilities, requirements, assignments, items, component, findings)
  } else if (requirements.type === 'powerSupply' && host?.type === 'pcBuild') {
    evaluatePowerSupply(assignments, items, component, requirements, findings)
  }

  if (host?.type === 'pcBuild') {
    const caseItem = assignedItemOfType(assignments, items, 'case', component)
    evaluateCaseConstraint(caseItem, component, requirements, findings)
  }

  return { status: statusFor(findings), findings }
}

export function evaluateProjectCompatibility(project) {
  const hostsWithPowerFindings = new Set()
  return (project?.assignments ?? []).flatMap((assignment) => {
    const host = itemLookup(project.items, assignment.serverId)
    const component = itemLookup(project.items, assignment.itemId)
    if (!host || !component || !isHost(host)) {
      return []
    }
    const result = evaluateAssignmentCompatibility({
      host,
      component,
      assignments: project.assignments.filter(
        (entry) => String(entry.serverId) === String(assignment.serverId),
      ),
      items: project.items,
    })

    if (isExpansion(component)) {
      const hostId = String(assignment.serverId)
      if (hostsWithPowerFindings.has(hostId)) {
        result.findings = result.findings.filter(
          (finding) =>
            finding.code !== 'expansion.total-power.exceeded' &&
            finding.field !== 'host.maxExpansionPowerWatts' &&
            finding.field !== 'host.expansionPowerAssignments.powerWatts',
        )
        result.status = statusFor(result.findings)
      } else {
        hostsWithPowerFindings.add(hostId)
      }
    }

    return [{
      assignmentId: assignment.id,
      hostId: assignment.serverId,
      itemId: assignment.itemId,
      ...result,
    }]
  })
}

function compareAssignmentIds(left, right) {
  const leftNumber = optionalNumber(left)
  const rightNumber = optionalNumber(right)
  const leftIsNumeric = leftNumber !== undefined && String(left).trim() !== ''
  const rightIsNumeric = rightNumber !== undefined && String(right).trim() !== ''

  if (leftIsNumeric && rightIsNumeric && leftNumber !== rightNumber) {
    return leftNumber - rightNumber
  }
  if (leftIsNumeric !== rightIsNumeric) {
    return leftIsNumeric ? -1 : 1
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}

function compareAssignments(left, right) {
  const assignedAt = String(left.assignedAt ?? '').localeCompare(String(right.assignedAt ?? ''))
  return assignedAt || compareAssignmentIds(left.id, right.id)
}

function assignmentIdentity(hostId, assignmentId) {
  return JSON.stringify([String(hostId), typeof assignmentId, assignmentId])
}

function validResourceGroups(groups) {
  if (!Array.isArray(groups)) {
    return []
  }

  const idCounts = new Map()
  for (const group of groups) {
    const id = Number.isSafeInteger(group?.id) && group.id > 0 ? group.id : undefined
    if (id !== undefined) {
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    }
  }

  return groups.filter((group) => {
    const id = Number.isSafeInteger(group?.id) && group.id > 0 ? group.id : undefined
    return (
      id !== undefined
      && idCounts.get(id) === 1
      && optionalString(group?.key)
      && Number.isInteger(group.count)
      && group.count > 0
    )
  })
}

function allocationFinding(code, severity, message, field, resourceId) {
  return {
    code,
    severity,
    message,
    field,
    ...(resourceId ? { resourceId } : {}),
  }
}

function resultWithFinding(result, finding) {
  const findings = [...result.findings]
  addFinding(findings, finding)
  return { status: statusFor(findings), findings }
}

function allocationSize(requirements) {
  if (requirements.type === 'ram') {
    return Number.isInteger(requirements.moduleCount) && requirements.moduleCount > 0
      ? requirements.moduleCount
      : undefined
  }
  if (requirements.type === 'storage') {
    return 1
  }
  if (isExpansion(requirements.type)) {
    return Number.isInteger(requirements.slotWidth) && requirements.slotWidth > 0
      ? requirements.slotWidth
      : undefined
  }
  return 0
}

function resultCanOccupyResource(result, compatibilityEnabled) {
  return result.status === 'compatible' || (
    !compatibilityEnabled && (
      result.status === 'incompatible' || result.status === 'unknown'
    )
  )
}

function resourceTypeFor(requirements) {
  if (requirements.type === 'ram') return 'memory'
  if (requirements.type === 'storage') return 'storage'
  if (isExpansion(requirements.type)) return 'expansion'
  return undefined
}

function candidateHost(host, resourceType, group) {
  const compatibility = structuredClone(host.compatibility ?? {})
  compatibility.host ??= {}
  if (resourceType === 'storage') {
    compatibility.host.storageSlots = [group]
  } else if (resourceType === 'expansion') {
    compatibility.host.expansionSlots = [group]
  }
  return { ...host, compatibility }
}

function evaluateResourceCandidate({
  host,
  component,
  assignments,
  items,
  resourceType,
  group,
}) {
  return evaluateAssignmentCompatibility({
    host: group ? candidateHost(host, resourceType, group) : host,
    component,
    assignments,
    items,
  })
}

function requiredGroups(hostCapabilities, resourceType) {
  if (resourceType === 'storage') {
    return {
      all: Array.isArray(hostCapabilities.storageSlots) ? hostCapabilities.storageSlots : [],
      valid: validResourceGroups(hostCapabilities.storageSlots),
    }
  }
  if (resourceType === 'expansion') {
    return {
      all: Array.isArray(hostCapabilities.expansionSlots) ? hostCapabilities.expansionSlots : [],
      valid: validResourceGroups(hostCapabilities.expansionSlots),
    }
  }
  return { all: [], valid: [] }
}

function positionsAreConsecutive(positions, size) {
  return (
    Array.isArray(positions) &&
    positions.length === size &&
    positions.every((position) => Number.isInteger(position) && position >= 0) &&
    positions.every((position, index) => index === 0 || position === positions[index - 1] + 1)
  )
}

function occupancyKey(resourceType, groupId) {
  return `${resourceType}:${groupId ?? 'memory'}`
}

function occupiedSet(occupancy, resourceType, groupId) {
  const key = occupancyKey(resourceType, groupId)
  if (!occupancy.has(key)) {
    occupancy.set(key, new Set())
  }
  return occupancy.get(key)
}

function positionsAreFree(occupancy, resourceType, groupId, positions) {
  const occupied = occupiedSet(occupancy, resourceType, groupId)
  return positions.every((position) => !occupied.has(position))
}

function reservePositions(occupancy, allocation) {
  const occupied = occupiedSet(occupancy, allocation.resourceType, allocation.groupId)
  for (const position of allocation.positions) {
    occupied.add(position)
  }
}

function firstConsecutivePositions(occupancy, resourceType, groupId, count, size) {
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(size) || size <= 0 || size > count) {
    return undefined
  }
  const occupied = occupiedSet(occupancy, resourceType, groupId)
  for (let start = 0; start <= count - size; start += 1) {
    const positions = Array.from({ length: size }, (_, index) => start + index)
    if (positions.every((position) => !occupied.has(position))) {
      return positions
    }
  }
  return undefined
}

function memoryCapacity(hostCapabilities) {
  const slots = hostCapabilities.memory?.slots
  return Number.isInteger(slots) && slots > 0 ? slots : undefined
}

function allocationMatchesResource(allocation, resourceType, group, size, occupancy, capacity) {
  if (!allocation || allocation.resourceType !== resourceType) {
    return false
  }
  if (resourceType === 'memory') {
    if (allocation.groupId !== undefined || capacity === undefined) {
      return false
    }
  } else if (!group || allocation.groupId !== group.id) {
    return false
  }
  if (!positionsAreConsecutive(allocation.positions, size)) {
    return false
  }
  const limit = resourceType === 'memory' ? capacity : group.count
  return (
    allocation.positions.every((position) => position < limit) &&
    positionsAreFree(occupancy, resourceType, allocation.groupId, allocation.positions)
  )
}

function invalidResourceResult(baseResult, resourceType) {
  return resultWithFinding(
    baseResult,
    allocationFinding(
      'compatibility.resource.invalid',
      'unknown',
      `The host's ${resourceType} resource definition is missing, duplicated, or invalid.`,
      `host.${resourceType}Resources`,
    ),
  )
}

function exhaustedResourceResult(baseResult, resourceType) {
  return resultWithFinding(
    baseResult,
    allocationFinding(
      'compatibility.resource.exhausted',
      'error',
      `No available ${resourceType} positions can satisfy this component.`,
      `host.${resourceType}Resources`,
    ),
  )
}

function missingComponentResult() {
  return resultWithFinding(
    { status: 'compatible', findings: [] },
    allocationFinding(
      'compatibility.component.missing',
      'unknown',
      'The assigned inventory component could not be found.',
      'component',
    ),
  )
}

function planResult(assignment, result, allocation) {
  return {
    assignmentId: assignment.id,
    hostId: assignment.serverId,
    itemId: assignment.itemId,
    ...result,
    ...(allocation ? { allocation } : {}),
  }
}

function pcBuildResourceDefinition(component, motherboard, hostCapabilities) {
  const requirements = normalizeComponentRequirements(component)
  if (component.type === 'motherboard') return { resourceType: 'motherboard', count: 1, size: 1 }
  if (component.type === 'powerSupply') return { resourceType: 'power', count: 1, size: 1 }
  if (component.type === 'case') return { resourceType: 'case', count: 1, size: 1 }
  if (component.type === 'cpu' || component.type === 'cpuCooler') {
    const count = optionalNumber(motherboard?.specs?.cpuSocketCount ?? motherboard?.specs?.cpuSockets) ??
      (hostCapabilities.cpu?.sockets?.length ? 1 : undefined)
    return {
      resourceType: component.type === 'cpu' ? 'cpu' : 'cooling',
      count,
      size: 1,
    }
  }
  if (component.type === 'ram') {
    return {
      resourceType: 'memory',
      count: hostCapabilities.memory?.slots,
      size: requirements.moduleCount,
    }
  }
  if (component.type === 'storage') {
    const groups = validResourceGroups(hostCapabilities.storageSlots).filter((group) =>
      (!requirements.interface || includesNormalized(group.interfaces ?? [], requirements.interface)) &&
      (!requirements.formFactor || includesNormalized(group.formFactors ?? [], requirements.formFactor)))
    return { resourceType: 'storage', groups, size: 1 }
  }
  if (isExpansion(component)) {
    const groups = validResourceGroups(hostCapabilities.expansionSlots).filter((group) =>
      !requirements.interfaceFamily || group.interfaceFamily === requirements.interfaceFamily)
    return { resourceType: 'expansion', groups, size: requirements.slotWidth ?? 1 }
  }
  return undefined
}

function physicalResourceError(result, resourceType, code = 'compatibility.resource.invalid') {
  const message = code === 'compatibility.resource.exhausted'
    ? `No available ${resourceType} positions can satisfy this component.`
    : `The PC Build's ${resourceType} resource definition is missing or invalid.`
  return resultWithFinding(result, allocationFinding(
    code,
    'error',
    message,
    `host.${resourceType}Resources`,
  ))
}

function planPcBuildAllocations(project, hostId) {
  const host = itemLookup(project.items, hostId)
  const assignments = (project.assignments ?? [])
    .filter((assignment) => String(assignment.serverId) === String(hostId))
    .map((assignment) => ({ ...assignment }))
    .sort(compareAssignments)
  const motherboard = assignedItemOfType(assignments, project.items, 'motherboard')
  const effectiveHost = effectiveHostForAssignment(host, assignments, project.items, motherboard)
  const hostCapabilities = normalizeHostCapabilities(effectiveHost)
  const compatibilityEnabled = isHostCompatibilityEnabled(project, hostId)
  const occupancy = new Map()
  const plannedAssignments = []
  const results = []
  const processedAssignments = []

  for (const assignment of assignments) {
    const component = itemLookup(project.items, assignment.itemId)
    if (!component) {
      const clean = { ...assignment }
      delete clean.allocation
      plannedAssignments.push(clean)
      results.push(planResult(assignment, missingComponentResult()))
      continue
    }
    const clean = { ...assignment }
    delete clean.allocation
    const result = evaluateAssignmentCompatibility({
      host,
      component,
      assignments: processedAssignments,
      items: project.items,
    })
    const resource = pcBuildResourceDefinition(component, motherboard, hostCapabilities)
    if (!resource) {
      plannedAssignments.push(clean)
      results.push(planResult(assignment, result))
      processedAssignments.push(clean)
      continue
    }
    if (!resultCanOccupyResource(result, compatibilityEnabled)) {
      plannedAssignments.push(clean)
      results.push(planResult(assignment, result))
      processedAssignments.push(clean)
      continue
    }

    const size = resource.size
    let selected
    if (Array.isArray(resource.groups)) {
      for (const group of resource.groups) {
        const positions = firstConsecutivePositions(
          occupancy, resource.resourceType, group.id, group.count, size,
        )
        if (positions) {
          selected = { groupId: group.id, positions }
          break
        }
      }
    } else if (Number.isInteger(resource.count) && Number.isInteger(size) && size > 0) {
      const positions = firstConsecutivePositions(
        occupancy, resource.resourceType, resource.groupId, resource.count, size,
      )
      if (positions) selected = { groupId: resource.groupId, positions }
    }

    if (!selected) {
      const hasDefinition = Array.isArray(resource.groups)
        ? resource.groups.length > 0 && Number.isInteger(size) && size > 0
        : Number.isInteger(resource.count) && resource.count > 0 && Number.isInteger(size) && size > 0
      const physical = physicalResourceError(
        result,
        resource.resourceType,
        hasDefinition ? 'compatibility.resource.exhausted' : 'compatibility.resource.invalid',
      )
      plannedAssignments.push(clean)
      results.push(planResult(assignment, physical))
    } else {
      const allocation = {
        resourceType: resource.resourceType,
        ...(selected.groupId ? { groupId: selected.groupId } : {}),
        positions: selected.positions,
      }
      reservePositions(occupancy, allocation)
      const planned = { ...clean, allocation }
      plannedAssignments.push(planned)
      results.push(planResult(assignment, result, allocation))
      processedAssignments.push(planned)
    }
  }
  return { assignments: plannedAssignments, results }
}

export function planHostAllocations(project, hostId) {
  const host = itemLookup(project?.items, hostId)
  if (!host || !isHost(host)) {
    return { assignments: [], results: [] }
  }
  if (host.type === 'pcBuild') {
    return planPcBuildAllocations(project, hostId)
  }

  const assignments = (project.assignments ?? [])
    .filter((assignment) => String(assignment.serverId) === String(hostId))
    .map((assignment) => ({ ...assignment }))
    .sort(compareAssignments)
  const compatibilityEnabled = isHostCompatibilityEnabled(project, hostId)
  const hostCapabilities = normalizeHostCapabilities(host)
  const occupancy = new Map()
  const preserved = new Map()
  const priorAssignments = []

  // Reserve valid persisted allocations first so recalculation does not move hardware unnecessarily.
  for (const assignment of assignments) {
    const component = itemLookup(project.items, assignment.itemId)
    if (!component) {
      priorAssignments.push(assignment)
      continue
    }
    const requirements = normalizeComponentRequirements(component)
    const resourceType = resourceTypeFor(requirements)
    const size = allocationSize(requirements)
    if (!resourceType || !size || !assignment.allocation) {
      priorAssignments.push(assignment)
      continue
    }

    if (resourceType === 'memory') {
      const result = evaluateResourceCandidate({
        host,
        component,
        assignments: priorAssignments,
        items: project.items,
        resourceType,
      })
      const capacity = memoryCapacity(hostCapabilities)
      if (
        resultCanOccupyResource(result, compatibilityEnabled) &&
        allocationMatchesResource(
          assignment.allocation,
          resourceType,
          undefined,
          size,
          occupancy,
          capacity,
        )
      ) {
        reservePositions(occupancy, assignment.allocation)
        preserved.set(assignment.id, { allocation: assignment.allocation, result })
      }
    } else {
      const groups = requiredGroups(hostCapabilities, resourceType).valid
      const group = groups.find((candidate) => candidate.id === assignment.allocation.groupId)
      if (group) {
        const result = evaluateResourceCandidate({
          host,
          component,
          assignments: priorAssignments,
          items: project.items,
          resourceType,
          group,
        })
        if (
          resultCanOccupyResource(result, compatibilityEnabled) &&
          allocationMatchesResource(
            assignment.allocation,
            resourceType,
            group,
            size,
            occupancy,
          )
        ) {
          reservePositions(occupancy, assignment.allocation)
          preserved.set(assignment.id, { allocation: assignment.allocation, result })
        }
      }
    }
    priorAssignments.push(assignment)
  }

  const plannedAssignments = []
  const results = []
  const processedAssignments = []

  for (const assignment of assignments) {
    const component = itemLookup(project.items, assignment.itemId)
    if (!component) {
      const cleanAssignment = { ...assignment }
      delete cleanAssignment.allocation
      plannedAssignments.push(cleanAssignment)
      results.push(planResult(assignment, missingComponentResult()))
      processedAssignments.push(assignment)
      continue
    }

    const persisted = preserved.get(assignment.id)
    if (persisted) {
      const planned = { ...assignment, allocation: structuredClone(persisted.allocation) }
      plannedAssignments.push(planned)
      results.push(planResult(assignment, persisted.result, planned.allocation))
      processedAssignments.push(planned)
      continue
    }

    const requirements = normalizeComponentRequirements(component)
    const resourceType = resourceTypeFor(requirements)
    const size = allocationSize(requirements)
    const cleanAssignment = { ...assignment }
    delete cleanAssignment.allocation

    if (!resourceType) {
      const result = evaluateAssignmentCompatibility({
        host,
        component,
        assignments: processedAssignments,
        items: project.items,
      })
      plannedAssignments.push(cleanAssignment)
      results.push(planResult(assignment, result))
      processedAssignments.push(cleanAssignment)
      continue
    }

    if (!size) {
      const result = invalidResourceResult(
        evaluateAssignmentCompatibility({
          host,
          component,
          assignments: processedAssignments,
          items: project.items,
        }),
        resourceType,
      )
      plannedAssignments.push(cleanAssignment)
      results.push(planResult(assignment, result))
      processedAssignments.push(cleanAssignment)
      continue
    }

    if (resourceType === 'memory') {
      const result = evaluateResourceCandidate({
        host,
        component,
        assignments: processedAssignments,
        items: project.items,
        resourceType,
      })
      const capacity = memoryCapacity(hostCapabilities)
      if (!resultCanOccupyResource(result, compatibilityEnabled)) {
        plannedAssignments.push(cleanAssignment)
        results.push(planResult(assignment, result))
      } else if (capacity === undefined) {
        const invalid = invalidResourceResult(result, resourceType)
        plannedAssignments.push(cleanAssignment)
        results.push(planResult(assignment, invalid))
      } else {
        const positions = firstConsecutivePositions(
          occupancy,
          resourceType,
          undefined,
          capacity,
          size,
        )
        if (!positions) {
          const exhausted = exhaustedResourceResult(result, resourceType)
          plannedAssignments.push(cleanAssignment)
          results.push(planResult(assignment, exhausted))
        } else {
          const allocation = { resourceType, positions }
          reservePositions(occupancy, allocation)
          const planned = { ...cleanAssignment, allocation }
          plannedAssignments.push(planned)
          results.push(planResult(assignment, result, allocation))
        }
      }
      processedAssignments.push(cleanAssignment)
      continue
    }

    const { all, valid } = requiredGroups(hostCapabilities, resourceType)
    let compatibleCandidate
    let unknownCandidate
    let unknownResult
    let exhaustedUnknownResult
    let incompatibleCandidate
    let exhaustedIncompatibleResult
    let incompatibleResult
    for (const group of valid) {
      const result = evaluateResourceCandidate({
        host,
        component,
        assignments: processedAssignments,
        items: project.items,
        resourceType,
        group,
      })
      if (result.status === 'compatible') {
        const positions = firstConsecutivePositions(
          occupancy,
          resourceType,
          group.id,
          group.count,
          size,
        )
        if (positions) {
          compatibleCandidate = { group, positions, result }
          break
        }
        incompatibleResult ??= exhaustedResourceResult(result, resourceType)
      } else if (result.status === 'unknown') {
        const positions = firstConsecutivePositions(
          occupancy,
          resourceType,
          group.id,
          group.count,
          size,
        )
        if (positions) {
          if (compatibilityEnabled) {
            unknownResult ??= result
          } else {
            unknownCandidate ??= { group, positions, result }
          }
        } else {
          exhaustedUnknownResult ??= exhaustedResourceResult(result, resourceType)
        }
      } else {
        incompatibleResult ??= result
        if (!compatibilityEnabled) {
          const positions = firstConsecutivePositions(
            occupancy,
            resourceType,
            group.id,
            group.count,
            size,
          )
          if (positions) {
            incompatibleCandidate ??= { group, positions, result }
          } else {
            exhaustedIncompatibleResult ??= exhaustedResourceResult(result, resourceType)
          }
        }
      }
    }

    const selectedCandidate = compatibleCandidate ?? unknownCandidate ?? incompatibleCandidate
    if (selectedCandidate) {
      const allocation = {
        resourceType,
        groupId: selectedCandidate.group.id,
        positions: selectedCandidate.positions,
      }
      reservePositions(occupancy, allocation)
      const planned = { ...cleanAssignment, allocation }
      plannedAssignments.push(planned)
      results.push(planResult(assignment, selectedCandidate.result, allocation))
    } else {
      const baseResult = evaluateAssignmentCompatibility({
        host,
        component,
        assignments: processedAssignments,
        items: project.items,
      })
      const result =
        unknownResult ??
        exhaustedUnknownResult ??
        (valid.length === 0 && all.length > 0
          ? invalidResourceResult(baseResult, resourceType)
          : exhaustedIncompatibleResult ?? incompatibleResult ?? baseResult)
      plannedAssignments.push(cleanAssignment)
      results.push(planResult(assignment, result))
    }
    processedAssignments.push(cleanAssignment)
  }

  return { assignments: plannedAssignments, results }
}

export function normalizeCompatibilityProject(project) {
  const hosts = Object.entries(project?.items ?? {})
    .filter(([, item]) => isHost(item))
    .map(([key]) => key)
  const plannedByAssignment = new Map()

  for (const hostId of hosts) {
    for (const assignment of planHostAllocations(project, hostId).assignments) {
      plannedByAssignment.set(assignmentIdentity(hostId, assignment.id), assignment)
    }
  }

  return {
    ...project,
    assignments: (project.assignments ?? []).map(
      (assignment) =>
        plannedByAssignment.get(assignmentIdentity(assignment.serverId, assignment.id)) ?? assignment,
    ),
  }
}
