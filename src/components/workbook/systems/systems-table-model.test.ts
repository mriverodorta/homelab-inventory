import { describe, expect, it } from 'vitest'
import { filterAndSortSystems, mergeSystemsLive, shouldVirtualizeSystems, systemsColumnTrack, systemsViewConfigurationsEqual } from '@/components/workbook/systems/systems-table-model'
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
  operatingSystem: 'Ubuntu 24.04',
  lanIp: '192.0.2.10',
  agentRegistered: true,
  agentState: 'online',
  agentVersion: '0.1.0',
  agentUpdateAvailable: false,
  registryLinked: true,
  cpuPercent: 20,
  memoryPercent: 40,
  storagePercent: 60,
  uptimeSeconds: 3600,
  attentionCount: 0,
  attentionState: 'current',
  attentionRevision: 1,
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

  it('compares synchronized columns independently of object property insertion order', () => {
    const local = {
      ...DEFAULT_SYSTEMS_TABLE_PREFERENCES,
      columns: DEFAULT_SYSTEMS_TABLE_PREFERENCES.columns.map(({ key, order, visible }) => ({ key, order, visible })),
    }
    const server = {
      ...DEFAULT_SYSTEMS_TABLE_PREFERENCES,
      columns: DEFAULT_SYSTEMS_TABLE_PREFERENCES.columns.map(({ key, visible, order }) => ({ key, visible, order })),
    }
    expect(systemsViewConfigurationsEqual(local, server)).toBe(true)
  })

  it('virtualizes only fleets larger than 100 filtered rows', () => {
    expect(shouldVirtualizeSystems(100)).toBe(false)
    expect(shouldVirtualizeSystems(101)).toBe(true)
  })

  it('fixes user-resized tracks while untouched content columns remain responsive', () => {
    expect(systemsColumnTrack('name', 260, true)).toBe('260px')
    expect(systemsColumnTrack('name', 220, false)).toBe('minmax(220px, 1.25fr)')
    expect(systemsColumnTrack('registry', 52, false)).toBe('52px')
  })
})
