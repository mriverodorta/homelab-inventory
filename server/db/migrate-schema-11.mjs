import { canonicalPowerPorts, withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

const TYPE_BY_TABLE = {
  monitors: 'monitor',
  upsSystems: 'ups',
  powerStrips: 'powerStrip',
  powerAdapters: 'powerAdapter',
  powerSupplies: 'powerSupply',
}

function sameCanonicalPort(actual, expected) {
  return actual.key === expected.key
    && actual.kind === expected.kind
    && actual.type === expected.type
    && actual.slotNumber === expected.slotNumber
}

function migrateRecord(record, type, field) {
  const expected = canonicalPowerPorts({ ...record, type })
  if (expected.length === 0) return record
  const expectedKeys = new Set(expected.map((port) => port.key))

  const existing = record.ports ?? []
  const ids = new Set()
  const keys = new Set()
  for (const port of existing) {
    if (!Number.isSafeInteger(port.id) || port.id < 1) {
      throw new Error(`${field}.ports contains invalid ID ${port.id}.`)
    }
    if (ids.has(port.id)) throw new Error(`${field}.ports contains duplicate ID ${port.id}.`)
    if (port.key && keys.has(port.key)) {
      throw new Error(`${field}.ports contains duplicate key ${port.key}.`)
    }
    ids.add(port.id)
    if (port.key) keys.add(port.key)
  }

  for (const canonical of expected) {
    const byKey = existing.find((port) => port.key === canonical.key)
    if (byKey) {
      if (!sameCanonicalPort(byKey, canonical)) {
        throw new Error(
          `${field}.ports key ${canonical.key} conflicts with the canonical power topology.`,
        )
      }
    }
  }

  for (const port of existing) {
    const isPowerEndpoint = port.kind === 'power-port'
      || port.type === 'ac-input'
      || port.type === 'ac-outlet'
    if (isPowerEndpoint && !expectedKeys.has(port.key)) {
      throw new Error(
        `${field}.ports contains noncanonical power endpoint ${port.key ?? port.id}.`,
      )
    }
  }

  const migrated = withCanonicalPowerPorts({ ...record, type })
  delete migrated.type
  return migrated
}

export function migrateSchema10To11(inventory) {
  const migrated = structuredClone(inventory)
  for (const [table, type] of Object.entries(TYPE_BY_TABLE)) {
    if (!Array.isArray(migrated[table])) continue
    migrated[table] = migrated[table].map((record, index) => (
      migrateRecord(record, type, `${table}[${index}]`)
    ))
  }
  return migrated
}
