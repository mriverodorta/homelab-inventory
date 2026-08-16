import { describe, expect, it } from 'vitest'
import {
  normalizeCatalogUpdateItem,
  planCatalogUpdate,
} from './catalog-update-semantics.mjs'

describe('catalog update semantic planning', () => {
  it('normalizes equivalent network speeds and default fixed port origins', () => {
    const current = {
      type: 'switch',
      name: 'Local switch name',
      ports: [{
        id: 1,
        kind: 'switch-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '2500M',
        origin: 'fixed',
      }],
    }
    const incoming = {
      type: 'switch',
      name: 'Canonical switch name',
      ports: [{
        id: 1,
        kind: 'switch-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '2.5G',
      }],
    }

    const plan = planCatalogUpdate(current, incoming)

    expect(plan.changes).toEqual([])
    expect(plan.portPlan).toMatchObject({ attachmentChanges: [], representationChanges: [] })
    expect(plan.nextItem.name).toBe('Local switch name')
  })

  it('canonicalizes the local runtime view before evaluating v11 Network Adapter updates', () => {
    const incoming = {
      type: 'network',
      name: 'Intel X710-DA2',
      manufacturer: 'Intel',
      model: 'X710-DA2',
      specs: {
        networkTechnology: 'ethernet',
        formFactor: 'low-profile',
        hostInterface: {
          family: 'pcie', pcieGeneration: 3, connectorLanes: 8, minimumElectricalLanes: 8,
        },
        maxSpeedBps: 10_000_000_000,
        operatingModes: ['ethernet'],
      },
      ports: [{
        id: 1,
        key: 'port-1',
        kind: 'network',
        type: 'sfp-plus',
        slotNumber: 1,
        speedBps: 10_000_000_000,
        supportedSpeedsBps: [1_000_000_000, 10_000_000_000],
        networkTechnology: 'ethernet',
        operatingModes: ['ethernet'],
        origin: 'module',
      }],
      compatibility: { requirements: { expansion: {
        interfaceFamily: 'pcie', pcieGeneration: 3, connectorLanes: 8, minimumElectricalLanes: 8,
      } } },
    }
    const current = structuredClone(incoming)
    current.specs.speedMbps = 10_000
    delete current.specs.maxSpeedBps
    delete current.specs.networkTechnology
    delete current.specs.formFactor
    delete current.specs.hostInterface
    delete current.compatibility
    current.ports[0].speed = '10G'
    delete current.ports[0].speedBps

    const plan = planCatalogUpdate(current, incoming, 11)

    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'specs.networkTechnology', kind: 'added' }),
      expect.objectContaining({ path: 'specs.hostInterface', kind: 'added' }),
      expect.objectContaining({ path: 'compatibility', kind: 'added' }),
    ]))
    expect(plan.nextItem.specs.speedMbps).toBe(10_000)
    expect(plan.nextItem.ports[0].speed).toBe('10G')
    expect(plan.nextItem.specs.networkTechnology).toBe('ethernet')
  })

  it('treats compatible port kind and slot renumbering as representation changes', () => {
    const current = {
      type: 'powerStrip',
      name: 'Rack strip',
      ports: [
        { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1, origin: 'fixed' },
        { id: 2, key: 'outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 2, origin: 'fixed' },
      ],
    }
    const incoming = {
      type: 'powerStrip',
      name: 'TP-Link HS300',
      ports: [
        { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 0 },
        { id: 2, key: 'outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1 },
      ],
    }

    const plan = planCatalogUpdate(current, incoming)

    expect(plan.portPlan.attachmentChanges).toEqual([])
    expect(plan.portPlan.representationChanges).toHaveLength(2)
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'ports[1].slotNumber', impact: 'representation' }),
      expect.objectContaining({ path: 'ports[2].slotNumber', impact: 'representation' }),
    ]))
  })

  it('normalizes equivalent storage form-factor spelling and collection order', () => {
    const current = {
      type: 'nas',
      name: 'NAS',
      compatibility: { host: { storageSlots: [{
        id: 1,
        key: 'bays',
        count: 2,
        interfaces: ['SATA', 'NVMe'],
        formFactors: ['2.5 inch'],
      }] } },
    }
    const incoming = {
      type: 'nas',
      name: 'NAS model',
      compatibility: { host: { storageSlots: [{
        id: 1,
        key: 'bays',
        count: 2,
        interfaces: ['NVMe', 'SATA'],
        formFactors: ['2.5-inch'],
      }] } },
    }

    expect(planCatalogUpdate(current, incoming).changes).toEqual([])
  })

  it('classifies a missing model supplied by the linked template as enrichment', () => {
    const plan = planCatalogUpdate({
      type: 'cpu',
      name: 'Intel Core i7-13700T',
      manufacturer: 'Intel',
      specs: { cores: 16 },
    }, {
      type: 'cpu',
      name: 'Intel Core i7-13700T',
      manufacturer: 'Intel',
      model: 'i7-13700T',
      specs: { cores: 16, socket: 'LGA1700' },
    })

    expect(plan.identityImpact).toBe('enrichment')
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'model', kind: 'added', impact: 'identity-enrichment' }),
      expect.objectContaining({ path: 'specs.socket', kind: 'added' }),
    ]))
  })

  it('classifies conflicting non-empty identity as a conflict', () => {
    const plan = planCatalogUpdate({
      type: 'cpu', name: 'CPU', manufacturer: 'Intel', model: 'i7-12700T',
    }, {
      type: 'cpu', name: 'CPU', manufacturer: 'Intel', model: 'i7-13700T',
    })

    expect(plan.identityImpact).toBe('conflict')
  })

  it('preserves local nested and unknown fields while retaining incoming extensions', () => {
    const plan = planCatalogUpdate({
      type: 'nas',
      name: 'My NAS',
      serialNumber: 'private',
      specs: { memoryMib: 16_384, driveBays: 6 },
      compatibility: { host: { memory: { slots: 2 }, localProbe: { installed: true } } },
      privateExtension: { keep: true },
    }, {
      type: 'nas',
      name: 'Synology DS620slim',
      specs: { driveBays: 6, widthMm: 151 },
      compatibility: { host: { memory: { slots: 2, maxSpeedMt: 1866 } } },
      futureRegistryField: { supported: true },
    }, 10)

    expect(plan.nextItem).toMatchObject({
      name: 'My NAS',
      serialNumber: 'private',
      specs: { memoryMib: 16_384, driveBays: 6, widthMm: 151 },
      compatibility: {
        host: {
          memory: { slots: 2, maxSpeedMt: 1866 },
          localProbe: { installed: true },
        },
      },
      privateExtension: { keep: true },
      futureRegistryField: { supported: true },
    })
  })

  it('returns a stable canonical comparison representation', () => {
    expect(normalizeCatalogUpdateItem({
      type: 'switch',
      name: 'Switch',
      ports: [{ id: 2, kind: 'switch-port', type: 'rj45', slotNumber: 2 }, { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1 }],
    }).ports.map((port) => port.id)).toEqual([1, 2])
  })
})
