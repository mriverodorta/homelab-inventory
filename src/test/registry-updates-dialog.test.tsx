import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RegistryUpdatesDialog } from '@/components/inventory/registry-updates-dialog'
import { renderWithOpenAuth as render } from '@/test/open-auth-test-render'

const api = vi.hoisted(() => ({
  loadCatalogUpdateGroups: vi.fn(),
  decideCatalogUpdateGroups: vi.fn(),
  retryCatalogUpdates: vi.fn(),
}))

vi.mock('@/lib/registry-api', () => api)

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <RegistryUpdatesDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RegistryUpdatesDialog', () => {
  it('shows pending state only on the group being approved', async () => {
    let resolveDecision!: (value: unknown) => void
    api.loadCatalogUpdateGroups.mockResolvedValue({
      run: null,
      groups: ['cpu', 'gpu'].map((type, index) => ({
        id: `review:${type}-example:2`, status: 'review', templateKey: `${type}-example`, fromRevision: 1, toRevision: 2,
        classification: 'review-required', reasons: [], changes: [], evaluatedAt: '2026-08-14T13:00:00.000Z', projects: [],
        items: [{ linkId: index + 1, itemType: type, itemId: index + 1, itemName: `Example ${type.toUpperCase()}`, projects: [] }],
      })),
    })
    api.decideCatalogUpdateGroups.mockImplementation(() => new Promise((resolve) => { resolveDecision = resolve }))
    renderDialog()

    const cpuCard = (await screen.findAllByText('Example CPU'))[0].closest('section')!
    const gpuCard = screen.getAllByText('Example GPU')[0].closest('section')!
    fireEvent.click(within(cpuCard).getByRole('button', { name: 'Approve group' }))

    await waitFor(() => expect(api.decideCatalogUpdateGroups).toHaveBeenCalledOnce())
    expect(within(cpuCard).getByRole('button', { name: 'Approve group' })).toBeDisabled()
    expect(within(gpuCard).getByRole('button', { name: 'Approve group' })).not.toBeDisabled()

    resolveDecision({
      decisions: [{ templateKey: 'cpu-example', toRevision: 2, status: 'applied' }],
      summary: { run: null, counts: { review: 1, blocked: 0, applied: 1, declined: 0 } },
      affectedProjectIds: [],
      affectedLinkIds: [1],
    })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Review 1' })).toBeInTheDocument())
  })

  it('approves reviewable groups and prevents blocked groups from being applied', async () => {
    api.loadCatalogUpdateGroups.mockResolvedValue({
      run: null,
      groups: [
        {
          id: 'review:cpu-example:2', status: 'review', templateKey: 'cpu-example', fromRevision: 1, toRevision: 2,
          classification: 'review-required', reasons: ['new-compatibility-findings'], evaluatedAt: '2026-08-14T13:00:00.000Z',
          changes: [{ field: 'compatibility', current: {}, next: { requirements: { cpu: { socket: 'LGA1200' } } } }],
          projects: [{ id: 1, name: 'Default project' }],
          items: [{ linkId: 1, itemType: 'cpu', itemId: 7, itemName: 'Example CPU', projects: [{ id: 1, name: 'Default project' }] }],
        },
        {
          id: 'review:switch-example:3', status: 'review', templateKey: 'switch-example', fromRevision: 2, toRevision: 3,
          classification: 'blocked', reasons: ['connected-port-change'], evaluatedAt: '2026-08-14T13:00:00.000Z', changes: [],
          projects: [{ id: 2, name: 'Network plan' }],
          items: [{ linkId: 2, itemType: 'switch', itemId: 3, itemName: 'Example Switch', projects: [{ id: 2, name: 'Network plan' }] }],
        },
      ],
    })
    api.decideCatalogUpdateGroups.mockResolvedValue({
      decisions: [{ templateKey: 'cpu-example', toRevision: 2, status: 'applied' }],
      summary: { run: null, counts: { review: 0, blocked: 1, applied: 1, declined: 0 } },
      affectedProjectIds: [1],
      affectedLinkIds: [1],
    })
    renderDialog()

    const [cpu] = await screen.findAllByText('Example CPU')
    const cpuCard = cpu.closest('section')!
    fireEvent.click(within(cpuCard).getByRole('button', { name: 'Approve group' }))
    await waitFor(() => expect(api.decideCatalogUpdateGroups.mock.calls[0]?.[0]).toEqual({
      groups: [{ templateKey: 'cpu-example', toRevision: 2 }],
      decision: 'applied',
    }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Review 1' })).toBeInTheDocument())
    expect(api.loadCatalogUpdateGroups).toHaveBeenCalledOnce()

    const [blocked] = screen.getAllByText('Example Switch')
    const blockedCard = blocked.closest('section')!
    expect(within(blockedCard).getByRole('button', { name: 'Approve group' })).toBeDisabled()
  })

  it('shows a persisted evaluation failure and provides an explicit retry', async () => {
    api.loadCatalogUpdateGroups.mockResolvedValue({
      groups: [],
      run: {
        id: 1, catalogRevision: 17, state: 'failed', automatic: true,
        appliedCount: 0, reviewCount: 0, blockedCount: 0, skippedCount: 0,
        attemptCount: 1, retryAfter: '2026-08-14T13:01:00.000Z', error: 'Catalog unavailable.', completedAt: null,
      },
    })
    api.retryCatalogUpdates.mockResolvedValue({ groups: [], run: null })
    renderDialog()

    expect(await screen.findByText(/Catalog revision 17 could not be evaluated/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry evaluation' }))
    await waitFor(() => expect(api.retryCatalogUpdates).toHaveBeenCalledOnce())
  })
})
