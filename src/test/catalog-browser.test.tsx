import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogBrowser } from '@/components/inventory/catalog-browser'
import type { CatalogSearchItem } from '@/types/registry'

const registryHooks = vi.hoisted(() => ({
  useCatalogFacets: vi.fn(),
  useInfiniteCatalogSearch: vi.fn(),
}))

vi.mock('@/hooks/use-registry', () => registryHooks)

const cpu: CatalogSearchItem = {
  templateKey: 'cpu-intel-core-i5-10500t',
  revision: 2,
  fingerprintVersion: 6,
  identityHash: 'a'.repeat(64),
  identityAliases: [],
  contentHash: 'b'.repeat(64),
  type: 'cpu',
  manufacturer: 'Intel',
  name: 'Intel Core i5-10500T',
  item: {
    type: 'cpu',
    name: 'Intel Core i5-10500T',
    manufacturer: 'Intel',
    model: 'i5-10500T',
    specs: { cores: 6 },
  },
}

describe('CatalogBrowser', () => {
  beforeEach(() => {
    registryHooks.useCatalogFacets.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        available: true,
        schemaVersion: 1,
        catalogRevision: 4,
        categories: [
          {
            type: 'cpu',
            label: 'Processors',
            count: 81,
            facets: [{
              key: 'manufacturer',
              label: 'Manufacturer',
              kind: 'terms',
              values: [{ value: 'Intel', label: 'Intel', count: 40 }],
            }],
          },
        ],
      },
    })
    registryHooks.useInfiniteCatalogSearch.mockImplementation((_parameters, enabled) => ({
      data: enabled ? {
        pages: [{ total: 81, limit: 40, offset: 0, hasMore: true, nextOffset: 40, items: [cpu] }],
      } : undefined,
      isLoading: false,
      isError: false,
      isFetchingNextPage: false,
      hasNextPage: enabled,
      fetchNextPage: vi.fn(),
      error: null,
    }))
  })

  it('opens with categories and does not query results until one is chosen', async () => {
    const user = userEvent.setup()
    render(<CatalogBrowser onCreate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'What hardware are you adding?' })).toBeInTheDocument()
    expect(registryHooks.useInfiniteCatalogSearch).toHaveBeenLastCalledWith(expect.any(Object), false)

    await user.click(screen.getByRole('button', { name: /Processors/ }))

    expect(registryHooks.useInfiniteCatalogSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'cpu' }),
      true,
    )
    expect(screen.getAllByText('Intel Core i5-10500T')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Load more \(1 of 81\)/ })).toBeInTheDocument()
  })

  it('forwards multi-select filter values into the local catalog query', async () => {
    const user = userEvent.setup()
    render(<CatalogBrowser onCreate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Processors/ }))

    const manufacturer = screen.getAllByRole('checkbox').find((checkbox) => checkbox.parentElement?.textContent?.includes('Intel'))
    expect(manufacturer).toBeDefined()
    await user.click(manufacturer!)

    expect(registryHooks.useInfiniteCatalogSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: { terms: { manufacturer: ['Intel'] }, ranges: {} } }),
      true,
    )
  })

  it('gives each desktop catalog pane independent vertical overflow', async () => {
    const user = userEvent.setup()
    render(<CatalogBrowser onCreate={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Processors/ }))

    expect(screen.getByTestId('catalog-browser')).toHaveClass('overflow-visible', 'lg:overflow-hidden')
    expect(screen.getByTestId('catalog-filter-pane')).toHaveClass('min-h-0', 'overflow-hidden')
    expect(screen.getByTestId('catalog-filter-scroll')).toHaveClass('overflow-y-auto')
    expect(screen.getByTestId('catalog-results-scroll')).toHaveClass('overflow-y-auto')
    expect(screen.getByTestId('catalog-detail-pane')).toHaveClass('min-h-0', 'overflow-y-auto')
  })
})
