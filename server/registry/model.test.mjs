import { describe, expect, it } from 'vitest'
import {
  assertRegistryStoreShape,
  createRegistryStore,
  MAX_PRIVATE_TEMPLATE_IMPORT_COUNT,
  normalizeRegistryStore,
  previewPrivateTemplatePack,
} from './model.mjs'

describe('registry store model', () => {
  it('defaults to a disconnected private local state', () => {
    const store = createRegistryStore()
    expect(store.settings).toEqual({
      mode: 'disabled',
      defaultInventorySource: 'catalog',
      automaticContributions: false,
      showRegistryLinkIndicators: false,
      updatedAt: null,
    })
    expect(store.privateTemplates).toEqual([])
    expect(() => assertRegistryStoreShape(store)).not.toThrow()
  })

  it('normalizes unsupported settings without inventing records', () => {
    const store = normalizeRegistryStore({
      settings: { mode: 'other', defaultInventorySource: 'remote', automaticContributions: true },
    })
    expect(store.settings).toMatchObject({
      mode: 'disabled',
      defaultInventorySource: 'catalog',
      automaticContributions: false,
      showRegistryLinkIndicators: false,
    })
    expect(store.privateTemplates).toEqual([])
  })

  it('normalizes the optional canvas indicator preference without requiring a migration', () => {
    expect(normalizeRegistryStore({ settings: {} }).settings.showRegistryLinkIndicators).toBe(false)
    expect(normalizeRegistryStore({
      settings: { showRegistryLinkIndicators: true },
    }).settings.showRegistryLinkIndicators).toBe(true)
  })

  it('rejects duplicate and non-numeric private-template identifiers', () => {
    const template = {
      id: 1,
      name: 'CPU template',
      checksum: 'a'.repeat(64),
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      item: { type: 'cpu', name: 'Example CPU' },
    }
    expect(() => assertRegistryStoreShape({
      ...createRegistryStore(),
      privateTemplates: [template, { ...template }],
    })).toThrow(/must be unique/)
    expect(() => assertRegistryStoreShape({
      ...createRegistryStore(),
      privateTemplates: [{ ...template, id: '1' }],
    })).toThrow(/positive safe integer/)
  })

  it('rejects oversized private template packs before hashing their entries', async () => {
    const result = await previewPrivateTemplatePack({
      format: 'homelab-inventory-private-templates',
      version: 1,
      templates: Array.from({ length: MAX_PRIVATE_TEMPLATE_IMPORT_COUNT + 1 }, () => ({})),
      checksum: 'a'.repeat(64),
    })

    expect(result.valid).toBe(false)
    expect(result.templates).toEqual([])
    expect(result.errors).toContain(`Template pack cannot contain more than ${MAX_PRIVATE_TEMPLATE_IMPORT_COUNT} templates.`)
  })
})
