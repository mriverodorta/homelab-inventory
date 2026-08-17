import type { SystemsTablePreferences } from '@/lib/systems-preferences'
import type { SystemsHostRow } from '@/types/systems'

const AGENT_ORDER = Object.freeze({
  online: 0,
  stale: 1,
  offline: 2,
  unknown: 3,
  unregistered: 4,
})

function text(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

function compareText(left: unknown, right: unknown) {
  return text(left).localeCompare(text(right), undefined, { numeric: true, sensitivity: 'base' })
}

function compareOptionalNumber(left: number | null, right: number | null, direction: 1 | -1) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return (left - right) * direction
}

function visibleText(system: SystemsHostRow) {
  return [
    system.name,
    system.manufacturer,
    system.model,
    system.cpuLabel,
    system.memoryLabel,
    system.storageLabel,
    system.agentVersion,
    system.type,
    system.hardwareClass,
    system.usageRole,
  ].map(text).join(' ')
}

export function filterAndSortSystems(
  systems: readonly SystemsHostRow[],
  preferences: SystemsTablePreferences,
) {
  const query = text(preferences.query)
  const direction = preferences.sortDirection === 'ascending' ? 1 : -1
  return systems
    .filter((system) => !query || visibleText(system).includes(query))
    .filter((system) => !preferences.types.length || preferences.types.includes(system.type))
    .filter((system) => !preferences.registrations.length || preferences.registrations.includes(
      system.agentRegistered ? 'registered' : 'unregistered',
    ))
    .filter((system) => !preferences.registryStates.length || preferences.registryStates.includes(
      system.registryLinked ? 'linked' : 'unlinked',
    ))
    .toSorted((left, right) => {
      let comparison = 0
      switch (preferences.sortKey) {
        case 'type': comparison = compareText(left.type, right.type) * direction; break
        case 'manufacturer': comparison = compareText(
          `${left.manufacturer ?? ''} ${left.model ?? ''}`,
          `${right.manufacturer ?? ''} ${right.model ?? ''}`,
        ) * direction; break
        case 'cpu': comparison = compareOptionalNumber(left.cpuPercent, right.cpuPercent, direction); break
        case 'memory': comparison = compareOptionalNumber(left.memoryPercent, right.memoryPercent, direction); break
        case 'storage': comparison = compareOptionalNumber(left.storagePercent, right.storagePercent, direction); break
        case 'agent': comparison = (AGENT_ORDER[left.agentState] - AGENT_ORDER[right.agentState]) * direction; break
        case 'registry': comparison = (Number(right.registryLinked) - Number(left.registryLinked)) * direction; break
        case 'name': comparison = compareText(left.name, right.name) * direction; break
      }
      return comparison || compareText(left.name, right.name)
    })
}

export function mergeSystemsLive(
  systems: readonly SystemsHostRow[],
  live: ReadonlyMap<number, Partial<SystemsHostRow>>,
) {
  return systems.map((system) => ({ ...system, ...live.get(system.itemId) }))
}
