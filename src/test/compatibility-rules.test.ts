import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  evaluateAssignmentCompatibility,
  evaluateProjectCompatibility,
} from '@/lib/compatibility'
import type { NormalizedComponentRequirements } from '@/lib/compatibility'
import type { InventoryItem, ProjectState } from '@/types/inventory'

const host = (compatibility: InventoryItem['compatibility']): InventoryItem => ({
  id: 1,
  type: 'server',
  name: 'Test Host',
  compatibility,
})

const component = (
  type: InventoryItem['type'],
  compatibility?: InventoryItem['compatibility'],
  specs?: InventoryItem['specs'],
  id = 2,
): InventoryItem => ({ id, type, name: `Test ${type}`, compatibility, specs })

const evaluate = (
  hostItem: InventoryItem,
  item: InventoryItem,
  related: InventoryItem[] = [],
) =>
  evaluateAssignmentCompatibility({
    host: hostItem,
    component: item,
    assignments: related.map((entry, index) => ({
      id: index + 1,
      serverId: String(hostItem.id),
      itemId: String(entry.id),
      type: entry.type as 'cpu',
      assignedAt: `2026-01-01T00:00:0${index}Z`,
    })),
    items: Object.fromEntries([item, ...related].map((entry) => [String(entry.id), entry])),
  })

describe('compatibility rule evaluation', () => {
  it('keeps the normalized requirements union soundly discriminated', () => {
    const fallback = { type: 'switch' } as NormalizedComponentRequirements
    expectTypeOf(fallback.type).toEqualTypeOf<
      'cpu' | 'ram' | 'storage' | 'gpu' | 'network' | 'server' | 'nas' | 'switch' | 'patchPanel' | undefined
    >()

    if (fallback.type === 'cpu') {
      expectTypeOf(fallback.socket).toEqualTypeOf<string | undefined>()
    } else if (fallback.type === 'switch') {
      expectTypeOf(fallback).toEqualTypeOf<{ type?: 'server' | 'nas' | 'switch' | 'patchPanel' }>()
    }
  })

  it('blocks known CPU socket, generation, and TDP mismatches', () => {
    const result = evaluate(
      host({ host: { cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 65 } } }),
      component('cpu', {
        requirements: { cpu: { socket: 'AM5', generation: 'Zen 4', tdpWatts: 105 } },
      }),
    )

    expect(result.status).toBe('incompatible')
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'cpu.socket.mismatch', severity: 'error' }),
        expect.objectContaining({ code: 'cpu.generation.unsupported', severity: 'error' }),
        expect.objectContaining({ code: 'cpu.tdp.exceeded', severity: 'error' }),
      ]),
    )
  })

  it('treats Intel FC package socket names as aliases of their physical socket', () => {
    const result = evaluate(
      host({ host: { cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 65 } } }),
      component('cpu', {
        requirements: { cpu: { socket: 'FCLGA1200', generation: '10', tdpWatts: 35 } },
      }),
    )

    expect(result.status).toBe('compatible')
    expect(result.findings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'cpu.socket.mismatch' })]),
    )
  })

  it('reports missing CPU facts as unknown with the exact field', () => {
    const result = evaluate(
      host({ host: { cpu: { sockets: ['LGA1200'], generations: ['10'] } } }),
      component('cpu', { requirements: { cpu: { generation: '10', tdpWatts: 35 } } }),
    )

    expect(result.status).toBe('unknown')
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'compatibility.data.missing',
        severity: 'unknown',
        field: 'component.cpu.socket',
      }),
    )
  })

  it('evaluates RAM generation, aggregate limits, module limits, and speed negotiation', () => {
    const first = component('ram', undefined, {
      capacityGb: 32,
      moduleCount: 2,
      generation: 'DDR5',
      speedMt: 3600,
    })
    const second = component(
      'ram',
      undefined,
      { capacityGb: 48, moduleCount: 2, generation: 'DDR4', speedMt: 3200 },
      3,
    )
    const result = evaluate(
      host({
        host: {
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 64,
            maxModuleCapacityGb: 16,
            maxSpeedMt: 3200,
          },
        },
      }),
      first,
      [first, second],
    )

    expect(result.status).toBe('incompatible')
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'memory.generation.mismatch', severity: 'error' }),
        expect.objectContaining({ code: 'memory.slots.exceeded', severity: 'error' }),
        expect.objectContaining({ code: 'memory.capacity.exceeded', severity: 'error' }),
        expect.objectContaining({ code: 'memory.module-capacity.exceeded', severity: 'error' }),
        expect.objectContaining({ code: 'memory.speed.negotiated', severity: 'warning' }),
      ]),
    )
  })

  it('treats absent RAM limits and module details as unknown', () => {
    const result = evaluate(host({ host: { memory: {} } }), component('ram', undefined, {}))
    expect(result.status).toBe('unknown')
    expect(result.findings.every((finding) => finding.field)).toBe(true)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ field: 'host.memory.slots', severity: 'unknown' }),
    )
  })

  it('treats malformed host memory numeric facts as missing instead of coercing them', () => {
    const result = evaluate(
      host({
        host: {
          memory: {
            generations: ['DDR4'],
            slots: [2] as never,
            maxCapacityGb: { value: 64 } as never,
            maxModuleCapacityGb: 'many' as never,
            maxSpeedMt: '3200 MT/s' as never,
          },
        },
      }),
      component('ram', undefined, {
        capacityGb: 32,
        moduleCount: 2,
        generation: 'DDR4',
        speedMt: 3200,
      }),
    )

    expect(result.status).toBe('unknown')
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'host.memory.slots',
        }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'host.memory.maxCapacityGb',
        }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'host.memory.maxModuleCapacityGb',
        }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'host.memory.maxSpeedMt',
        }),
      ]),
    )
    expect(result.findings.some((finding) => finding.severity === 'error')).toBe(false)
  })

  it('reports RAM lower-bound limit errors alongside missing aggregate data', () => {
    const known = component(
      'ram',
      undefined,
      { capacityGb: 48, moduleCount: 3, generation: 'DDR4' },
      2,
    )
    const unknown = component('ram', undefined, { generation: 'DDR4' }, 3)
    const result = evaluate(
      host({
        host: {
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 32,
            maxModuleCapacityGb: 32,
          },
        },
      }),
      known,
      [known, unknown],
    )

    expect(result.status).toBe('incompatible')
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'memory.slots.exceeded', severity: 'error' }),
        expect.objectContaining({ code: 'memory.capacity.exceeded', severity: 'error' }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'component.memory.moduleCount',
        }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'component.memory.capacityGb',
        }),
      ]),
    )
  })

  it('matches storage interface and form factor explicitly', () => {
    const compatible = evaluate(
      host({
        host: {
          storageSlots: [
            { id: 'm2', label: 'M.2 Slot', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] },
          ],
        },
      }),
      component('storage', undefined, { interface: 'NVMe', formFactor: '2280' }),
    )
    expect(compatible).toEqual({ status: 'compatible', findings: [] })

    const mismatch = evaluate(
      host({
        host: {
          storageSlots: [
            { id: 'bay', label: 'Drive Bay', count: 1, interfaces: ['SATA'], formFactors: ['3.5-inch'] },
          ],
        },
      }),
      component('storage', undefined, { interface: 'SATA', formFactor: '2.5-inch' }),
    )
    expect(mismatch.status).toBe('incompatible')
    expect(mismatch.findings).toContainEqual(
      expect.objectContaining({
        code: 'storage.form-factor.mismatch',
        severity: 'error',
      }),
    )
  })

  it('reports storage interface mismatches and newer NVMe negotiation', () => {
    const mismatch = evaluate(
      host({
        host: {
          storageSlots: [
            { id: 'sata', label: 'SATA Bay', count: 1, interfaces: ['SATA'], formFactors: ['2.5-inch'] },
          ],
        },
      }),
      component('storage', undefined, { interface: 'NVMe', formFactor: '2280' }),
    )
    expect(mismatch.findings).toContainEqual(
      expect.objectContaining({ code: 'storage.interface.mismatch' }),
    )

    const negotiated = evaluate(
      host({
        host: {
          storageSlots: [
            {
              id: 'm2',
              label: 'M.2 Slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
              pcieGeneration: 3,
            },
          ],
        },
      }),
      component('storage', undefined, {
        interface: 'NVMe',
        formFactor: '2280',
        pcie: 'PCIe 4.0 x4',
      }),
    )
    expect(negotiated.status).toBe('compatible')
    expect(negotiated.findings).toContainEqual(
      expect.objectContaining({
        code: 'storage.pcie-generation.negotiated',
        severity: 'warning',
        resourceId: 'm2',
      }),
    )
  })

  it('keeps a known storage interface mismatch when form factor is missing', () => {
    const result = evaluate(
      host({
        host: {
          storageSlots: [
            { id: 'sata', label: 'SATA Bay', count: 1, interfaces: ['SATA'], formFactors: ['2.5-inch'] },
          ],
        },
      }),
      component('storage', undefined, { interface: 'NVMe' }),
    )

    expect(result.status).toBe('incompatible')
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'storage.interface.mismatch' }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'component.storage.formFactor',
        }),
      ]),
    )
  })

  it('keeps storage compatibility unknown when slot metadata is incomplete', () => {
    const unknownInterface = evaluate(
      host({
        host: {
          storageSlots: [
            { id: 'unknown', label: 'Unknown Slot', count: 1 },
            { id: 'sata', label: 'SATA Bay', count: 1, interfaces: ['SATA'] },
          ],
        },
      }),
      component('storage', undefined, { interface: 'NVMe', formFactor: '2280' }),
    )
    expect(unknownInterface.status).toBe('unknown')
    expect(unknownInterface.findings).toContainEqual(
      expect.objectContaining({
        code: 'compatibility.data.missing',
        field: 'host.storageSlots.interfaces',
        resourceId: 'unknown',
      }),
    )
    expect(
      unknownInterface.findings.some((finding) => finding.code === 'storage.interface.mismatch'),
    ).toBe(false)

    const unknownFormFactor = evaluate(
      host({
        host: {
          storageSlots: [
            { id: 'm2', label: 'M.2 Slot', count: 1, interfaces: ['NVMe'] },
          ],
        },
      }),
      component('storage', undefined, { interface: 'NVMe', formFactor: '2280' }),
    )
    expect(unknownFormFactor.status).toBe('unknown')
    expect(unknownFormFactor.findings).toContainEqual(
      expect.objectContaining({
        code: 'compatibility.data.missing',
        field: 'host.storageSlots.formFactors',
        resourceId: 'm2',
      }),
    )
  })

  it('enforces expansion interface, mechanical fit, height, width, and power', () => {
    const result = evaluate(
      host({
        host: {
          expansionSlots: [
            {
              id: 'pcie',
              label: 'PCIe x4',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 3,
              mechanicalLanes: 4,
              electricalLanes: 4,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 25,
            },
          ],
          maxExpansionPowerWatts: 50,
        },
      }),
      component(
        'gpu',
        {
          requirements: {
            expansion: {
              interfaceFamily: 'pcie',
              pcieGeneration: 4,
              connectorLanes: 8,
              height: 'full-height',
              slotWidth: 2,
              powerWatts: 75,
            },
          },
        },
        undefined,
      ),
    )

    expect(result.status).toBe('incompatible')
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'expansion.mechanical-lanes.insufficient', resourceId: 'pcie' }),
        expect.objectContaining({ code: 'expansion.height.unsupported', resourceId: 'pcie' }),
        expect.objectContaining({ code: 'expansion.width.exceeded', resourceId: 'pcie' }),
        expect.objectContaining({ code: 'expansion.slot-power.exceeded', resourceId: 'pcie' }),
        expect.objectContaining({ code: 'expansion.total-power.exceeded', severity: 'error' }),
      ]),
    )
  })

  it('warns for reduced electrical lanes unless a hard minimum is missed', () => {
    const baseHost = host({
      host: {
        expansionSlots: [
          {
            id: 'pcie',
            label: 'PCIe x16',
            count: 1,
            interfaceFamily: 'pcie',
            pcieGeneration: 3,
            mechanicalLanes: 16,
            electricalLanes: 4,
            acceptedHeights: ['low-profile'],
            maxSlotWidth: 1,
            maxPowerWatts: 75,
          },
        ],
        maxExpansionPowerWatts: 100,
      },
    })
    const warning = evaluate(
      baseHost,
      component('network', {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            pcieGeneration: 4,
            connectorLanes: 8,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 20,
          },
        },
      }),
    )
    expect(warning.status).toBe('compatible')
    expect(warning.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'expansion.electrical-lanes.reduced', severity: 'warning' }),
        expect.objectContaining({ code: 'expansion.pcie-generation.negotiated', severity: 'warning' }),
      ]),
    )

    const blocked = evaluate(
      baseHost,
      component('network', {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 8,
            minimumElectricalLanes: 8,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 20,
          },
        },
      }),
    )
    expect(blocked.findings).toContainEqual(
      expect.objectContaining({ code: 'expansion.minimum-lanes.insufficient', severity: 'error' }),
    )
  })

  it('selects the first fully fitting expansion group without leaking rejected-group errors', () => {
    const result = evaluate(
      host({
        host: {
          expansionSlots: [
            {
              id: 'x4',
              label: 'PCIe x4',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 4,
              mechanicalLanes: 4,
              electricalLanes: 4,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
            {
              id: 'x16',
              label: 'PCIe x16',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 4,
              mechanicalLanes: 16,
              electricalLanes: 16,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
          ],
          maxExpansionPowerWatts: 100,
        },
      }),
      component('network', {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            pcieGeneration: 4,
            connectorLanes: 8,
            minimumElectricalLanes: 8,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 20,
          },
        },
      }),
    )

    expect(result).toEqual({ status: 'compatible', findings: [] })
  })

  it('deterministically selects the first viable expansion group', () => {
    const result = evaluate(
      host({
        host: {
          expansionSlots: [
            {
              id: 'first',
              label: 'First Slot',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 3,
              mechanicalLanes: 8,
              electricalLanes: 8,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
            {
              id: 'second',
              label: 'Second Slot',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 4,
              mechanicalLanes: 8,
              electricalLanes: 8,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
          ],
          maxExpansionPowerWatts: 100,
        },
      }),
      component('network', {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            pcieGeneration: 4,
            connectorLanes: 8,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 20,
          },
        },
      }),
    )

    expect(result.status).toBe('compatible')
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'expansion.pcie-generation.negotiated',
        resourceId: 'first',
      }),
    )
  })

  it('prefers the first unknown expansion candidate over a known-incompatible candidate', () => {
    const result = evaluate(
      host({
        host: {
          expansionSlots: [
            {
              id: 'unknown-width',
              label: 'Unknown Width',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 4,
              electricalLanes: 8,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
            {
              id: 'too-small',
              label: 'Too Small',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 4,
              mechanicalLanes: 4,
              electricalLanes: 4,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
          ],
          maxExpansionPowerWatts: 100,
        },
      }),
      component('network', {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            pcieGeneration: 4,
            connectorLanes: 8,
            minimumElectricalLanes: 8,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 20,
          },
        },
      }),
    )

    expect(result.status).toBe('unknown')
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'compatibility.data.missing',
        resourceId: 'unknown-width',
      }),
    )
    expect(result.findings.some((finding) => finding.resourceId === 'too-small')).toBe(false)
  })

  it.each(['m2-ae', 'usb', 'onboard'] as const)(
    'does not implicitly match %s expansion with PCIe',
    (interfaceFamily) => {
      const result = evaluate(
        host({
          host: {
            expansionSlots: [
              { id: 'pcie', label: 'PCIe Slot', count: 1, interfaceFamily: 'pcie' },
            ],
          },
        }),
        component('network', {
          requirements: { expansion: { interfaceFamily } },
        }),
      )
      expect(result.findings).toContainEqual(
        expect.objectContaining({ code: 'expansion.interface.mismatch', severity: 'error' }),
      )
    },
  )

  it('calculates total expansion power from the complete assignment state', () => {
    const first = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 1,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 30,
          },
        },
      },
      undefined,
      2,
    )
    const second = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 1,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 30,
          },
        },
      },
      undefined,
      3,
    )
    const result = evaluate(
      host({
        host: {
          expansionSlots: [
            {
              id: 'pcie',
              label: 'PCIe Slots',
              count: 2,
              interfaceFamily: 'pcie',
              mechanicalLanes: 1,
              electricalLanes: 1,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 40,
            },
          ],
          maxExpansionPowerWatts: 50,
        },
      }),
      first,
      [first, second],
    )
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'expansion.total-power.exceeded', severity: 'error' }),
    )
  })

  it('reports expansion power lower-bound errors alongside unknown assigned power', () => {
    const known = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 1,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 60,
          },
        },
      },
      undefined,
      2,
    )
    const unknown = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 1,
            height: 'low-profile',
            slotWidth: 1,
          },
        },
      },
      undefined,
      3,
    )
    const result = evaluate(
      host({
        host: {
          expansionSlots: [
            {
              id: 'pcie',
              label: 'PCIe Slots',
              count: 2,
              interfaceFamily: 'pcie',
              mechanicalLanes: 1,
              electricalLanes: 1,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            },
          ],
          maxExpansionPowerWatts: 50,
        },
      }),
      known,
      [known, unknown],
    )

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'expansion.total-power.exceeded', severity: 'error' }),
        expect.objectContaining({
          code: 'compatibility.data.missing',
          field: 'host.expansionPowerAssignments.powerWatts',
        }),
      ]),
    )
  })

  it('emits host total-power findings once while retaining per-assignment findings', () => {
    const hostItem = host({
      host: {
        expansionSlots: [
          {
            id: 'pcie',
            label: 'PCIe Slots',
            count: 2,
            interfaceFamily: 'pcie',
            mechanicalLanes: 1,
            electricalLanes: 1,
            acceptedHeights: ['low-profile'],
            maxSlotWidth: 1,
            maxPowerWatts: 20,
          },
        ],
        maxExpansionPowerWatts: 50,
      },
    })
    const first = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 1,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 30,
          },
        },
      },
      undefined,
      2,
    )
    const second = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 1,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 30,
          },
        },
      },
      undefined,
      3,
    )
    const project = {
      id: 'default',
      metadata: { name: 'Test', version: 1, updatedAt: '2026-01-01T00:00:00Z' },
      items: { host: hostItem, first, second },
      placements: [],
      assignments: [
        { id: 11, serverId: 'host', itemId: 'first', type: 'network', assignedAt: '2026-01-01' },
        { id: 12, serverId: 'host', itemId: 'second', type: 'network', assignedAt: '2026-01-02' },
      ],
      connections: [],
    } as ProjectState

    const results = evaluateProjectCompatibility(project)
    expect(
      results.flatMap((result) => result.findings).filter(
        (finding) => finding.code === 'expansion.total-power.exceeded',
      ),
    ).toHaveLength(1)
    expect(
      results.flatMap((result) => result.findings).filter(
        (finding) => finding.code === 'expansion.slot-power.exceeded',
      ),
    ).toHaveLength(2)
    expect(
      results.find((result) => result.assignmentId === 11)?.findings,
    ).toContainEqual(expect.objectContaining({ code: 'expansion.total-power.exceeded' }))
  })

  it('counts expansion items with the same category-local numeric ID independently', () => {
    const hostItem = host({
      host: {
        expansionSlots: [
          {
            id: 'pcie',
            label: 'PCIe Slots',
            count: 2,
            interfaceFamily: 'pcie',
            mechanicalLanes: 16,
            electricalLanes: 16,
            acceptedHeights: ['low-profile'],
            maxSlotWidth: 1,
            maxPowerWatts: 40,
          },
        ],
        maxExpansionPowerWatts: 50,
      },
    })
    const nic = component(
      'network',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 4,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 30,
          },
        },
      },
      undefined,
      1,
    )
    const gpu = component(
      'gpu',
      {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            connectorLanes: 8,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 30,
          },
        },
      },
      undefined,
      1,
    )

    const result = evaluateAssignmentCompatibility({
      host: hostItem,
      component: nic,
      assignments: [
        { id: 1, serverId: 'server:1', itemId: 'network:1', type: 'network', assignedAt: '2026-01-01' },
        { id: 2, serverId: 'server:1', itemId: 'gpu:1', type: 'gpu', assignedAt: '2026-01-02' },
      ],
      items: { 'network:1': nic, 'gpu:1': gpu },
    })

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'expansion.total-power.exceeded', severity: 'error' }),
    )
  })

  it('evaluates assigned project components without mutating the project', () => {
    const hostItem = host({
      host: { cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 65 } },
    })
    const cpu = component('cpu', {
      requirements: { cpu: { socket: 'LGA1200', generation: '10', tdpWatts: 35 } },
    })
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Test', version: 1, updatedAt: '2026-01-01T00:00:00Z' },
      items: { 'server:1': hostItem, 'cpu:2': cpu },
      placements: [],
      assignments: [
        { id: 1, serverId: 'server:1', itemId: 'cpu:2', type: 'cpu', assignedAt: '2026-01-01' },
      ],
      connections: [],
    }
    const snapshot = structuredClone(project)

    expect(evaluateProjectCompatibility(project)).toEqual([
      expect.objectContaining({ assignmentId: 1, hostId: 'server:1', itemId: 'cpu:2' }),
    ])
    expect(project).toEqual(snapshot)
  })
})
