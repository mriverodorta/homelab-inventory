import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from '@/lib/project'
import { useProjectHydration } from './use-project-hydration'
import type { useDomainEngine } from '@/hooks/use-domain-engine'

type DomainEngine = ReturnType<typeof useDomainEngine>

describe('useProjectHydration', () => {
  it('does not replay a handled synchronization event when the engine is re-enabled', async () => {
    const project = { ...createEmptyProject(), revision: 12 }
    const projectRef = { current: project }
    const engine = {
      enabled: true,
      runtimeKey: 'installation-local:1:2:canvas',
      syncEvent: {
        runtimeKey: 'installation-local:1:2:canvas',
        sequence: 4,
        kind: 'invalidation' as const,
      },
    } as DomainEngine
    const reloadProject = vi.fn(async () => project)
    const applyInventorySnapshot = vi.fn(async () => project)

    const { rerender } = renderHook(
      ({ domainEngine }) => useProjectHydration({
        loadedProject: project,
        project,
        projectRef,
        inventoryMetadataHistoryRef: { current: new Map() },
        lastPersistedProjectRef: { current: project },
        hasHydratedProjectRef: { current: true },
        domainEngine,
        queryClient: { setQueryData: vi.fn() } as never,
        setProject: vi.fn(),
        setHistory: vi.fn(),
        setSelectedItemId: vi.fn(),
        setSelectedConnectionId: vi.fn(),
        clearPendingConnection: vi.fn(),
        clearNetworkTrace: vi.fn(),
        setPersistenceWarning: vi.fn(),
        setSaveStatus: vi.fn(),
        applyInventorySnapshot,
        reloadProject,
        queryKey: ['project'],
      }),
      { initialProps: { domainEngine: engine } },
    )

    await waitFor(() => expect(applyInventorySnapshot).toHaveBeenCalledOnce())

    act(() => rerender({ domainEngine: { ...engine, enabled: false } as DomainEngine }))
    act(() => rerender({ domainEngine: { ...engine, enabled: true } as DomainEngine }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reloadProject).toHaveBeenCalledOnce()
    expect(applyInventorySnapshot).toHaveBeenCalledOnce()
  })
})
