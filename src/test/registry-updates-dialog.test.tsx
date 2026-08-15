import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegistryUpdatesDialog } from '@/components/inventory/registry-updates-dialog'
import { renderWithOpenAuth as render } from '@/test/open-auth-test-render'
import type { CatalogUpdateGroup } from '@/types/registry'

const api = vi.hoisted(() => ({
  loadCatalogUpdateSummary: vi.fn(),
  loadCatalogUpdateGroups: vi.fn(),
  loadCatalogUpdateGroup: vi.fn(),
  decideCatalogUpdateGroups: vi.fn(),
  resolveAndApplyCatalogUpdateGroup: vi.fn(),
  retryCatalogUpdates: vi.fn(),
}))

vi.mock('@/lib/registry-api', () => api)

const counts = { review: 2, blocked: 0, applied: 0, declined: 0 }

function renderDialog(onApplied?: ComponentProps<typeof RegistryUpdatesDialog>['onApplied']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><RegistryUpdatesDialog open onOpenChange={vi.fn()} onApplied={onApplied} /></QueryClientProvider>)
}

function reviewGroup(type: string, index: number): CatalogUpdateGroup {
  return {
    id: `review:${type}-example:2:${'a'.repeat(64)}`,
    concurrencyToken: String(index).repeat(64).slice(0, 64),
    status: 'review' as const,
    templateKey: `${type}-example`,
    fromRevision: 1,
    toRevision: 2,
    classification: 'review-required' as const,
    reasons: [],
    reconsiderable: false,
    evaluatedAt: '2026-08-14T13:00:00.000Z',
    projects: [],
    items: [{ linkId: index, itemType: type, itemId: index, itemName: `Example ${type.toUpperCase()}`, projects: [] }],
  }
}

function page(groups: CatalogUpdateGroup[]) {
  return { groups, run: null, nextCursor: null, total: groups.length }
}

beforeEach(() => {
  api.loadCatalogUpdateSummary.mockResolvedValue({ run: null, counts })
  api.loadCatalogUpdateGroups.mockResolvedValue(page([reviewGroup('cpu', 1), reviewGroup('gpu', 2)]))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RegistryUpdatesDialog', () => {
  it('loads compact groups and fetches definition changes only after expansion', async () => {
    api.loadCatalogUpdateGroup.mockResolvedValue({
      ...reviewGroup('cpu', 1),
      members: [{
        linkId: 1,
        itemId: 1,
        itemType: 'cpu',
        current: { specs: { cores: 4 } },
        proposed: { specs: { cores: 6 } },
        changes: [{ path: 'specs.cores', kind: 'changed', impact: 'metadata', current: 4, next: 6 }],
        resolution: { available: false, reason: null, operations: [], affectedRelationships: { connectionIds: [], assignmentIds: [] } },
      }],
    })
    renderDialog()

    const cpuCard = (await screen.findAllByText('Example CPU'))[0].closest('section')!
    expect(api.loadCatalogUpdateGroup).not.toHaveBeenCalled()
    fireEvent.click(within(cpuCard).getByRole('button', { name: 'Review catalog changes' }))

    expect(await within(cpuCard).findByText('specs.cores')).toBeInTheDocument()
    expect(api.loadCatalogUpdateGroup).toHaveBeenCalledOnce()
  })

  it('shows pending state only on the clicked group and submits stable identity', async () => {
    let resolveDecision!: (value: unknown) => void
    api.decideCatalogUpdateGroups.mockImplementation(() => new Promise((resolve) => { resolveDecision = resolve }))
    renderDialog()

    const cpuGroup = reviewGroup('cpu', 1)
    const cpuCard = (await screen.findAllByText('Example CPU'))[0].closest('section')!
    const gpuCard = screen.getAllByText('Example GPU')[0].closest('section')!
    fireEvent.click(within(cpuCard).getByRole('button', { name: 'Approve group' }))

    await waitFor(() => expect(api.decideCatalogUpdateGroups.mock.calls[0]?.[0]).toEqual({
      groups: [{ groupId: cpuGroup.id, concurrencyToken: cpuGroup.concurrencyToken }],
      decision: 'applied',
    }))
    expect(within(cpuCard).getByRole('button', { name: 'Approve group' })).toBeDisabled()
    expect(within(gpuCard).getByRole('button', { name: 'Approve group' })).not.toBeDisabled()

    resolveDecision({
      decisions: [{ groupId: 'applied', previousGroupId: cpuGroup.id, concurrencyToken: 'a'.repeat(64), templateKey: 'cpu-example', toRevision: 2, status: 'applied' }],
      summary: { run: null, counts: { review: 1, blocked: 0, applied: 1, declined: 0 } },
      affectedProjectIds: [], affectedProjectRevisions: {}, affectedLinkIds: [1],
    })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Review 1' })).toBeInTheDocument())
  })

  it('moves an authoritative decision to Applied and does not reappear after refetch', async () => {
    const cpu = reviewGroup('cpu', 1)
    api.loadCatalogUpdateGroups
      .mockResolvedValueOnce(page([cpu, reviewGroup('gpu', 2)]))
      .mockResolvedValue(page([reviewGroup('gpu', 2)]))
    api.decideCatalogUpdateGroups.mockResolvedValue({
      decisions: [{ groupId: 'applied', previousGroupId: cpu.id, concurrencyToken: 'a'.repeat(64), templateKey: cpu.templateKey, toRevision: 2, status: 'applied' }],
      summary: { run: null, counts: { review: 1, blocked: 0, applied: 1, declined: 0 } },
      affectedProjectIds: [], affectedProjectRevisions: {}, affectedLinkIds: [1],
    })
    renderDialog()

    fireEvent.click(within((await screen.findAllByText('Example CPU'))[0].closest('section')!).getByRole('button', { name: 'Approve group' }))
    await waitFor(() => expect(screen.queryByText('Example CPU')).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Applied 1' })).toBeInTheDocument()
    expect(api.loadCatalogUpdateGroups).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed decision on the original card', async () => {
    api.decideCatalogUpdateGroups.mockRejectedValue(new Error('Registry update state changed; refresh before continuing.'))
    renderDialog()
    const cpuCard = (await screen.findAllByText('Example CPU'))[0].closest('section')!
    fireEvent.click(within(cpuCard).getByRole('button', { name: 'Approve group' }))

    expect(await within(cpuCard).findByRole('alert')).toHaveTextContent('refresh before continuing')
    expect(screen.getAllByText('Example GPU')[0]).toBeInTheDocument()
  })

  it('loads blocked groups separately and confirms deterministic resolution', async () => {
    const user = userEvent.setup()
    const blocked = { ...reviewGroup('nas', 3), id: `blocked:nas-example:2:${'b'.repeat(64)}`, status: 'blocked' as const, classification: 'blocked' as const }
    api.loadCatalogUpdateGroups.mockImplementation(({ status }: { status: string }) => Promise.resolve(page(status === 'blocked' ? [blocked] : [])))
    api.loadCatalogUpdateSummary.mockResolvedValue({ run: null, counts: { review: 0, blocked: 1, applied: 0, declined: 0 } })
    api.loadCatalogUpdateGroup.mockResolvedValue({
      ...blocked,
      members: [{
        linkId: 3,
        itemId: 3,
        itemType: 'nas',
        current: {},
        proposed: {},
        changes: [{
          path: 'compatibility.host.storageSlots[0].key',
          kind: 'changed',
          impact: 'assignment',
          current: 'drive-bays',
          next: 'sata-bays',
        }],
        resolution: {
          available: true,
          reason: 'A deterministic relationship migration is available.',
          operations: [
            { kind: 'remap-resource-key', resourceType: 'storage', resourceId: 1, fromKey: 'drive-bays', toKey: 'sata-bays', assignmentIds: [14, 15, 16, 17, 18] },
            { kind: 'move-connection-endpoint', connectionId: 65 },
            { kind: 'unassign-item', assignmentId: 95, itemType: 'powerAdapter', itemId: 151, returnToInventory: true },
          ],
          affectedRelationships: { connectionIds: [65], assignmentIds: [14, 15, 16, 17, 18, 95] },
        },
      }],
    })
    api.resolveAndApplyCatalogUpdateGroup.mockResolvedValue({
      decisions: [{ groupId: 'applied', previousGroupId: blocked.id, concurrencyToken: 'c'.repeat(64), templateKey: blocked.templateKey, toRevision: 2, status: 'applied' }],
      summary: { run: null, counts: { review: 0, blocked: 0, applied: 1, declined: 0 } },
      affectedProjectIds: [1], affectedProjectRevisions: { 1: 2 }, affectedLinkIds: [3],
    })
    renderDialog()

    const blockedTab = await screen.findByRole('tab', { name: 'Blocked 1' })
    await user.click(blockedTab)
    await waitFor(() => expect(api.loadCatalogUpdateGroups).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked' })))
    const card = (await screen.findAllByText('Example NAS'))[0].closest('section')!
    fireEvent.click(within(card).getByRole('button', { name: 'Review catalog changes' }))
    expect(await within(card).findByText('Storage slot key')).toBeInTheDocument()
    expect(within(card).getByText('compatibility.host.storageSlots[0].key')).toBeInTheDocument()
    expect(within(card).getByText('Assignment')).toBeInTheDocument()
    expect(within(card).getByText('A deterministic relationship migration is available.')).toBeInTheDocument()
    fireEvent.click(await within(card).findByRole('button', { name: 'Resolve and apply' }))
    const resolutionDialog = (await screen.findByRole('heading', { name: 'Resolve Registry topology update' })).closest<HTMLElement>('[role="dialog"]')!
    expect(within(resolutionDialog).getByText(/Move cable 65/)).toBeInTheDocument()
    expect(within(resolutionDialog).getByText(/Preserve assignments 14, 15, 16, 17, and 18/)).toBeInTheDocument()
    expect(within(resolutionDialog).getByText(/Return powerAdapter 151/)).toBeInTheDocument()
    fireEvent.click(within(resolutionDialog).getByRole('button', { name: 'Resolve and apply' }))
    await waitFor(() => expect(api.resolveAndApplyCatalogUpdateGroup.mock.calls[0]?.[0]).toEqual({ groupId: blocked.id, concurrencyToken: blocked.concurrencyToken, linkId: 3 }))
  })

  it('shows the exact backend reason when a blocked update has no deterministic resolution', async () => {
    const user = userEvent.setup()
    const blocked = { ...reviewGroup('nas', 3), id: `blocked:nas-example:2:${'b'.repeat(64)}`, status: 'blocked' as const, classification: 'blocked' as const }
    api.loadCatalogUpdateGroups.mockImplementation(({ status }: { status: string }) => Promise.resolve(page(status === 'blocked' ? [blocked] : [])))
    api.loadCatalogUpdateSummary.mockResolvedValue({ run: null, counts: { review: 0, blocked: 1, applied: 0, declined: 0 } })
    api.loadCatalogUpdateGroup.mockResolvedValue({
      ...blocked,
      members: [{
        linkId: 3,
        itemId: 3,
        itemType: 'nas',
        current: {},
        proposed: {},
        changes: [],
        resolution: {
          available: false,
          reason: 'Connected port 7 has no unique target in the Registry definition.',
          operations: [],
          affectedRelationships: { connectionIds: [], assignmentIds: [] },
        },
      }],
    })
    renderDialog()

    await user.click(await screen.findByRole('tab', { name: 'Blocked 1' }))
    const card = (await screen.findAllByText('Example NAS'))[0].closest('section')!
    fireEvent.click(within(card).getByRole('button', { name: 'Review catalog changes' }))

    expect(await within(card).findByText('Connected port 7 has no unique target in the Registry definition.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Resolve and apply' })).not.toBeInTheDocument()
  })

  it('shows a persisted evaluation failure and provides an explicit retry', async () => {
    api.loadCatalogUpdateSummary.mockResolvedValue({
      counts: { review: 0, blocked: 0, applied: 0, declined: 0 },
      run: { id: 1, catalogRevision: 17, state: 'failed', automatic: true, appliedCount: 0, reviewCount: 0, blockedCount: 0, skippedCount: 0, attemptCount: 1, retryAfter: null, error: 'Catalog unavailable.', completedAt: null },
    })
    api.loadCatalogUpdateGroups.mockResolvedValue(page([]))
    api.retryCatalogUpdates.mockResolvedValue({ groups: [], run: null })
    renderDialog()

    expect(await screen.findByText(/Catalog revision 17 could not be evaluated/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry evaluation' }))
    await waitFor(() => expect(api.retryCatalogUpdates).toHaveBeenCalledOnce())
  })
})
