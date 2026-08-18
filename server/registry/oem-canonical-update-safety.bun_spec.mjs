import { describe, expect, it } from 'bun:test'
import fixture from '../../test/fixtures/catalog-import/canonical-units/oem-revision-23.json'
import { projectCatalogTemplateForRuntime } from './catalog-runtime-projection.mjs'
import { planCatalogUpdate } from './catalog-update-semantics.mjs'
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
      )).toHaveLength(1)
    })
  }
})
