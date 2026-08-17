import { describe, expect, it } from 'vitest'
import { filterAndSortSystems, mergeSystemsLive } from '@/components/workbook/systems/systems-table-model'
import { DEFAULT_SYSTEMS_TABLE_PREFERENCES } from '@/lib/systems-preferences'
import type { SystemsHostRow } from '@/types/systems'

const base: SystemsHostRow = {
  itemId: 1,
  itemKey: 'server:1',
  type: 'server',
  legacyId: 1,
  name: 'Alpha',
  manufacturer: 'Dell',
  model: 'Micro',
  hardwareClass: 'desktop',
  usageRole: 'server',
  cpuLabel: 'Intel i5',
  memoryLabel: '16GB DDR4 3200MHz',
  storageLabel: '1TB NVMe',
  agentRegistered: true,
  agentState: 'online',
  agentVersion: '0.1.0',
  agentUpdateAvailable: false,
  registryLinked: true,
  cpuPercent: 20,
  memoryPercent: 40,
  storagePercent: 60,
}

describe('Systems table model', () => {
  it('searches all visible text and composes multi-select filters', () => {
    const systems = [
      base,
      { ...base, itemId: 2, itemKey: 'nas:2', type: 'nas' as const, name: 'Vault', manufacturer: 'Synology', agentRegistered: false, agentState: 'unregistered' as const, registryLinked: false },
    ]
    expect(filterAndSortSystems(systems, { ...DEFAULT_SYSTEMS_TABLE_PREFERENCES, query: 'synology' }).map(({ name }) => name)).toEqual(['Vault'])
    expect(filterAndSortSystems(systems, {
      ...DEFAULT_SYSTEMS_TABLE_PREFERENCES,
      types: ['nas'],
      registrations: ['unregistered'],
      registryStates: ['unlinked'],
    }).map(({ name }) => name)).toEqual(['Vault'])
  })

  it('sorts utilization with missing values last in both directions', () => {
    const systems = [
      base,
      { ...base, itemId: 2, itemKey: 'server:2', name: 'Missing', cpuPercent: null },
      { ...base, itemId: 3, itemKey: 'server:3', name: 'Busy', cpuPercent: 90 },
    ]
    expect(filterAndSortSystems(systems, { ...DEFAULT_SYSTEMS_TABLE_PREFERENCES, sortKey: 'cpu' }).map(({ name }) => name)).toEqual(['Alpha', 'Busy', 'Missing'])
    expect(filterAndSortSystems(systems, { ...DEFAULT_SYSTEMS_TABLE_PREFERENCES, sortKey: 'cpu', sortDirection: 'descending' }).map(({ name }) => name)).toEqual(['Busy', 'Alpha', 'Missing'])
  })

  it('merges mutable live values without replacing static labels', () => {
    expect(mergeSystemsLive([base], new Map([[1, { cpuPercent: 75, agentState: 'stale' }]]))[0]).toMatchObject({
      name: 'Alpha',
      cpuLabel: 'Intel i5',
      cpuPercent: 75,
      agentState: 'stale',
    })
  })
})
