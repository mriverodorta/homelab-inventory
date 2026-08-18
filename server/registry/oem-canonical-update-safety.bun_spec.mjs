import { describe, expect, it } from 'bun:test'
import fixture from '../../test/fixtures/catalog-import/canonical-units/oem-revision-23.json'
import { projectCatalogTemplateForRuntime } from './catalog-runtime-projection.mjs'
import { planCatalogUpdate } from './catalog-update-semantics.mjs'
import { catalogFieldDiff } from './update-service.mjs'
import { isLegacyWlanExpansionResource } from './wlan-resource-migration.mjs'

const AFFECTED_TEMPLATE_KEYS = [
  'desktop-dell-optiplex-micro-3000-standard',
  'desktop-dell-optiplex-micro-7060-standard',
  'desktop-lenovo-thinkcentre-tiny-m710q-standard',
  'desktop-lenovo-thinkcentre-tiny-m720q-b360-pcie-capable-single-nvme-platform',
  'desktop-lenovo-thinkcentre-tiny-m75q-gen-2-standard',
]

describe('OEM canonical catalog update safety', () => {
  it('recognizes equivalent normalized M.2 2230 A/E WLAN labels', () => {
    expect(isLegacyWlanExpansionResource({
      key: 'optional-wireless-slot',
      label: 'M.2 2230 A+E Wireless Slot',
    })).toBe(true)
  })

  for (const templateKey of AFFECTED_TEMPLATE_KEYS) {
    it(`compares ${templateKey} at runtime v9 without false removals or duplicate WLAN resources`, () => {
      const source = fixture.templates.find((template) => template.templateKey === templateKey)
      expect(source).toBeDefined()
      const projected = projectCatalogTemplateForRuntime(source)
      const expectedWlanLabel = projected.item.compatibility.host.optionalModuleSlots
        .find((resource) => resource.key === 'wlan-m2').label
      const current = structuredClone(projected.item)
      current.id = 71
      current.name = `Local ${current.name}`
      current.serialNumber = 'private-serial'
      current.notes = 'private note'
      current.compatibility.host.expansionSlots = [
        ...(current.compatibility.host.expansionSlots ?? []),
        { id: 91, key: 'm2-ae-slot', count: 1, label: 'M.2 2230 A/E WLAN slot' },
      ]

      const plan = planCatalogUpdate(current, projected.item, {
        sourceFingerprintVersion: projected.fingerprintVersion,
        runtimeCanonicalVersion: projected.runtimeCanonicalVersion,
      })

      const protectedPaths = [
        'compatibility.host.cpu.maxTdpMw',
        'compatibility.host.memory.maxCapacityMib',
        'compatibility.host.memory.maxModuleCapacityMib',
        'compatibility.host.maxExpansionPowerMw',
        'compatibility.host.power.supportedPowerMw',
      ]
      expect(plan.sourceFingerprintVersion).toBe(4)
      expect(plan.runtimeCanonicalVersion).toBe(9)
      expect(plan.changes.filter((change) => (
        change.kind === 'removed' && protectedPaths.includes(change.path)
      ))).toEqual([])
      expect(plan.changes.filter((change) => (
        change.kind === 'removed'
        && change.path.includes('expansionSlots')
      ))).toEqual([])
      expect(plan.changes.filter((change) => change.kind === 'reclassify-resource')).toEqual([{
        path: 'compatibility.host.resources',
        kind: 'reclassify-resource',
        impact: 'topology',
        operation: 'reclassify-resource',
        from: expect.objectContaining({
          resourceType: 'expansion',
          resourceId: 91,
          key: 'm2-ae-slot',
          label: 'M.2 2230 A/E WLAN slot',
        }),
        to: expect.objectContaining({
          resourceType: 'optionalModule',
          resourceId: 91,
          key: 'wlan-m2',
          label: expectedWlanLabel,
        }),
      }])
      expect(plan.nextItem).toMatchObject({
        id: 71,
        name: current.name,
        serialNumber: 'private-serial',
        notes: 'private note',
      })
      expect(plan.nextItem.compatibility.host.expansionSlots?.filter(
        (resource) => resource.key === 'm2-ae-slot',
      ) ?? []).toHaveLength(0)
      expect(plan.nextItem.compatibility.host.optionalModuleSlots.filter(
        (resource) => resource.key === 'wlan-m2',
      )).toEqual([expect.objectContaining({ id: 91 })])
      expect(planCatalogUpdate(current, projected.item, {
        sourceFingerprintVersion: projected.fingerprintVersion,
        runtimeCanonicalVersion: projected.runtimeCanonicalVersion,
      })).toEqual(plan)
      const persistedChanges = catalogFieldDiff(current, projected.item, {
        sourceFingerprintVersion: projected.fingerprintVersion,
        runtimeCanonicalVersion: projected.runtimeCanonicalVersion,
      })
      expect(persistedChanges.filter((change) => change.field === 'compatibility')).toEqual([])
      expect(persistedChanges.filter((change) => change.kind === 'reclassify-resource')).toHaveLength(1)
      expect(persistedChanges.some((change) => (
        change.kind === 'removed' && change.path?.includes('expansionSlots')
      ))).toBe(false)
    })
  }

  it('preserves the M720q WLAN resource ID by relocating only its new rear-I/O resource', () => {
    const source = fixture.templates.find((template) => (
      template.templateKey === 'desktop-lenovo-thinkcentre-tiny-m720q-b360-pcie-capable-single-nvme-platform'
    ))
    const projected = projectCatalogTemplateForRuntime(source)
    const current = structuredClone(projected.item)
    current.compatibility.host.optionalModuleSlots = []
    current.compatibility.host.expansionSlots.push({
      id: 2,
      key: 'm2-ae-slot',
      count: 1,
      label: 'M.2 2230 A/E network slot',
      interfaceFamily: 'm2-ae',
      keying: 'A+E',
      moduleSize: '2230',
    })

    const plan = planCatalogUpdate(current, projected.item, {
      sourceFingerprintVersion: projected.fingerprintVersion,
      runtimeCanonicalVersion: projected.runtimeCanonicalVersion,
    })

    expect(plan.changes.filter((change) => change.kind === 'reclassify-resource')).toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ resourceId: 2, key: 'm2-ae-slot' }),
        to: expect.objectContaining({ resourceId: 2, key: 'wlan-m2' }),
      }),
    ])
    expect(plan.nextItem.compatibility.host.optionalModuleSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 2, key: 'wlan-m2' }),
      expect.objectContaining({ id: 4, key: 'optional-rear-port-1' }),
      expect.objectContaining({ id: 3, key: 'optional-rear-port-2' }),
    ]))
    expect(plan.nextItem.compatibility.host.optionalModuleSlots.filter((resource) => resource.key === 'wlan-m2')).toHaveLength(1)
  })
})
