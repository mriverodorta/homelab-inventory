import { describe, expect, it } from 'vitest'
import {
  localInventoryTypeForCatalogType,
  materializeCatalogItem,
  projectLocalItemForCatalog,
} from './local-catalog-mapping.mjs'

describe('local catalog equipment mapping', () => {
  it('projects a locally used server by physical class without leaking its usage role', () => {
    expect(projectLocalItemForCatalog({
      id: 4,
      name: 'Mini PC',
      hardwareClass: 'desktop',
      usageRole: 'workstation',
    }, 'server')).toEqual({
      id: 4,
      name: 'Mini PC',
      type: 'desktop',
    })
  })

  it('materializes desktop, workstation, and server templates into the local server table', () => {
    expect(localInventoryTypeForCatalogType('desktop')).toBe('server')
    expect(localInventoryTypeForCatalogType('workstation')).toBe('server')
    expect(localInventoryTypeForCatalogType('server')).toBe('server')
    expect(materializeCatalogItem({ type: 'desktop', name: 'Mini PC' }, {
      usageRole: 'workstation',
    })).toEqual({
      type: 'server',
      name: 'Mini PC',
      hardwareClass: 'desktop',
      usageRole: 'workstation',
    })
    expect(materializeCatalogItem({ type: 'server', name: 'Rack server' })).toEqual({
      type: 'server',
      name: 'Rack server',
      hardwareClass: 'server',
      usageRole: 'server',
    })
    expect(materializeCatalogItem({ type: 'workstation', name: 'Precision workstation' }, {
      usageRole: 'server',
    })).toEqual({
      type: 'server',
      name: 'Precision workstation',
      hardwareClass: 'workstation',
      usageRole: 'server',
    })
  })

  it('leaves component categories unchanged', () => {
    const cpu = { type: 'cpu', name: 'Processor' }
    expect(projectLocalItemForCatalog(cpu)).toEqual(cpu)
    expect(materializeCatalogItem(cpu)).toEqual(cpu)
  })

  it('materializes the host-owned input for a fixed external NAS adapter', () => {
    const materialized = materializeCatalogItem({
      type: 'nas',
      name: 'Fixed adapter NAS',
      specs: { powerConfiguration: 'external-adapter' },
      compatibility: {
        host: {
          power: {
            configuration: 'external-adapter',
            adapterDisposition: 'fixed',
            connector: '4-pin DIN',
          },
        },
      },
    })

    expect(materialized.ports).toEqual([
      expect.objectContaining({ key: 'ac-input', type: 'ac-input' }),
    ])
  })

  it('does not create a host-owned input for a replaceable NAS adapter', () => {
    const materialized = materializeCatalogItem({
      type: 'nas',
      name: 'Replaceable adapter NAS',
      specs: { powerConfiguration: 'external-adapter' },
      compatibility: {
        host: {
          power: {
            configuration: 'external-adapter',
            adapterDisposition: 'replaceable',
          },
        },
      },
    })

    expect(materialized.ports ?? []).toEqual([])
  })
})
