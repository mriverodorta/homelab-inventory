import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPrivateTemplate,
  loadCatalogFacets,
  loadRegistryState,
  updateRegistrySettings,
} from '@/lib/registry-api'

afterEach(() => vi.unstubAllGlobals())

describe('registry API', () => {
  it('loads state and serializes focused mutations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: {}, privateTemplates: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: {}, privateTemplates: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: {}, privateTemplates: [] }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await loadRegistryState()
    await updateRegistrySettings({
      defaultInventorySource: 'manual',
      showRegistryLinkIndicators: true,
    }, null)
    await createPrivateTemplate({ name: 'CPU', item: { type: 'cpu', name: 'CPU' } })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/registry', expect.any(Object))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      settings: { defaultInventorySource: 'manual', showRegistryLinkIndicators: true },
      expectedUpdatedAt: null,
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ name: 'CPU' })
  })

  it('surfaces structured server messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Registry settings changed in another session.' }),
      { status: 409 },
    )))
    await expect(updateRegistrySettings({ mode: 'offline' }, null)).rejects.toThrow(/another session/)
  })

  it('addresses catalog facets by exact signed snapshot identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: true,
      categories: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const digest = 'a'.repeat(64)

    await loadCatalogFacets({ revision: 24, digest })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/registry/catalog/facets?revision=24&digest=${digest}`,
      expect.any(Object),
    )
  })

  it.each([
    [{ revision: 0, digest: 'a'.repeat(64) }, 'revision'],
    [{ revision: 24, digest: 'invalid' }, 'digest'],
  ])('rejects invalid catalog facet snapshot identity %o', async (snapshot, message) => {
    vi.stubGlobal('fetch', vi.fn())

    await expect(loadCatalogFacets(snapshot)).rejects.toThrow(message)
    expect(fetch).not.toHaveBeenCalled()
  })
})
