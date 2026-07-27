const RAM_TYPE = 'ram'

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`)
  return value
}

function optionalText(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/\s+/g, ' ')
  return text || undefined
}

function moduleCount(record) {
  const raw = record?.specs?.moduleCount
  if (raw === undefined || raw === null || raw === '') return 1
  const count = Number(raw)
  if (!Number.isSafeInteger(count) || count < 1 || count > 2) {
    throw new Error(`RAM ${String(record?.id)} has unsupported moduleCount ${String(raw)}.`)
  }
  return count
}

function totalCapacityGb(record) {
  const raw = record?.specs?.capacityGb ?? record?.specs?.capacityGB
  const capacity = Number(raw)
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error(`RAM ${String(record?.id)} must have a positive total capacity.`)
  }
  return capacity
}

function stickName(record, capacityGb) {
  const generation = optionalText(record?.specs?.generation)
  return generation ? `${String(capacityGb)}GB ${generation}` : `${String(capacityGb)}GB RAM`
}

function makeStick(record, id, index, count) {
  const total = totalCapacityGb(record)
  if (total % count !== 0) {
    throw new Error(`RAM ${String(record.id)} capacity ${String(total)}GB is not divisible by ${String(count)} modules.`)
  }
  const capacityGb = total / count
  const primaryManufacturer = optionalText(record.manufacturer)
  const secondaryManufacturer = optionalText(record.secondaryManufacturer) ?? primaryManufacturer
  const primarySpeed = record?.specs?.speedMt
  const secondarySpeed = record?.specs?.secondarySpeedMt ?? primarySpeed
  const manufacturer = index === 0 ? primaryManufacturer : secondaryManufacturer
  const speedMt = index === 0 ? primarySpeed : secondarySpeed
  const specs = { ...(record.specs ?? {}), capacityGb }
  delete specs.capacityGB
  delete specs.module
  delete specs.modules
  delete specs.moduleCount
  delete specs.secondarySpeedMt
  if (speedMt === undefined || speedMt === null || speedMt === '') delete specs.speedMt
  else specs.speedMt = speedMt

  const stick = {
    ...record,
    id,
    name: stickName(record, capacityGb),
    specs,
  }
  delete stick.secondaryManufacturer
  if (manufacturer) stick.manufacturer = manufacturer
  else delete stick.manufacturer
  return stick
}

function nextId(records, label) {
  const ids = new Set()
  let maximum = 0
  for (const record of records) {
    const id = positiveInteger(record?.id, `${label}.id`)
    if (ids.has(id)) throw new Error(`${label} contains duplicate id ${String(id)}.`)
    ids.add(id)
    maximum = Math.max(maximum, id)
  }
  return { ids, value: maximum + 1 }
}

function clearLegacyRamRegistryState(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return registry
  const notRam = (record) => record?.itemType !== RAM_TYPE
  return {
    ...registry,
    links: Array.isArray(registry.links) ? registry.links.filter(notRam) : [],
    contributionOutbox: Array.isArray(registry.contributionOutbox) ? registry.contributionOutbox.filter(notRam) : [],
    contributionLedger: Array.isArray(registry.contributionLedger) ? registry.contributionLedger.filter(notRam) : [],
    projectionCache: Array.isArray(registry.projectionCache) ? registry.projectionCache.filter(notRam) : [],
    contributionGroups: Array.isArray(registry.contributionGroups)
      ? registry.contributionGroups.filter((group) => !(group?.sources ?? []).some((source) => source?.itemType === RAM_TYPE))
      : [],
  }
}

export function migrateSchema15To16(inventory, project, registry) {
  const ramRecords = Array.isArray(inventory?.ram) ? inventory.ram : []
  const assignments = Array.isArray(project?.assignments) ? project.assignments : []
  const ramIds = nextId(ramRecords, 'inventory.ram')
  const assignmentIds = nextId(assignments, 'project.assignments')
  const ramAssignments = new Map()
  for (const assignment of assignments) {
    if (assignment?.itemType !== RAM_TYPE) continue
    positiveInteger(assignment.itemId, `RAM assignment ${String(assignment?.id)} itemId`)
    if (ramAssignments.has(assignment.itemId)) {
      throw new Error(`RAM ${String(assignment.itemId)} has more than one assignment.`)
    }
    ramAssignments.set(assignment.itemId, assignment)
  }

  const migratedRam = []
  const replacementAssignments = new Map()
  let splitRecords = 0
  let createdSticks = 0
  let createdAssignments = 0

  for (const record of ramRecords) {
    const count = moduleCount(record)
    const assignment = ramAssignments.get(record.id)
    const positions = assignment?.allocation?.resourceType === 'memory'
      ? assignment.allocation.positions
      : undefined
    if (assignment && (!Array.isArray(positions) || positions.length !== count)) {
      throw new Error(`RAM ${String(record.id)} assignment positions must match moduleCount ${String(count)}.`)
    }
    if (positions && (new Set(positions).size !== positions.length || positions.some((position) => !Number.isSafeInteger(position) || position < 0))) {
      throw new Error(`RAM ${String(record.id)} assignment positions are invalid.`)
    }

    const sticks = []
    for (let index = 0; index < count; index += 1) {
      const id = index === 0 ? record.id : ramIds.value++
      if (ramIds.ids.has(id) && id !== record.id) throw new Error(`RAM id allocation collided at ${String(id)}.`)
      ramIds.ids.add(id)
      sticks.push(makeStick(record, id, index, count))
    }
    migratedRam.push(...sticks)
    if (count > 1) {
      splitRecords += 1
      createdSticks += count - 1
    }

    if (assignment) {
      const next = sticks.map((stick, index) => {
        const id = index === 0 ? assignment.id : assignmentIds.value++
        if (assignmentIds.ids.has(id) && id !== assignment.id) throw new Error(`Assignment id allocation collided at ${String(id)}.`)
        assignmentIds.ids.add(id)
        return {
          ...assignment,
          id,
          itemId: stick.id,
          allocation: { ...assignment.allocation, positions: [positions[index]] },
        }
      })
      replacementAssignments.set(assignment.id, next)
      createdAssignments += Math.max(0, next.length - 1)
    }
  }

  const migratedAssignments = assignments.flatMap((assignment) => replacementAssignments.get(assignment.id) ?? [assignment])
  const beforeCapacityGb = ramRecords.reduce((total, record) => total + totalCapacityGb(record), 0)
  const afterCapacityGb = migratedRam.reduce((total, record) => total + totalCapacityGb(record), 0)
  if (beforeCapacityGb !== afterCapacityGb) throw new Error('RAM migration changed total inventory capacity.')

  return {
    inventory: { ...inventory, ram: migratedRam },
    project: { ...project, assignments: migratedAssignments },
    registry: clearLegacyRamRegistryState(registry),
    summary: {
      legacyRecords: ramRecords.length,
      physicalSticks: migratedRam.length,
      splitRecords,
      createdSticks,
      createdAssignments,
      totalCapacityGb: afterCapacityGb,
    },
  }
}
