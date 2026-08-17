import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useProjectGeometrySync } from '@/app/use-project-geometry-sync'
import type { ProjectState } from '@/types/inventory'

const geometry = vi.hoisted(() => ({
  createProjectGeometrySnapshot: vi.fn(() => ({ fingerprint: 'fixture-geometry' })),
  syncProjectGeometry: vi.fn(async () => undefined),
}))

vi.mock('@/engine/geometry', () => geometry)

const project = { items: {}, assignments: [], placements: [] } as unknown as ProjectState

function domainEngine(enabled: boolean) {
  return {
    enabled,
    client: {},
    state: { phase: 'ready', revision: null },
  } as never
}

describe('useProjectGeometrySync', () => {
  it('does not contact an intentionally disabled workspace engine', () => {
    const setPersistenceWarning = vi.fn()
    renderHook(() => useProjectGeometrySync({
      project,
      domainEngine: domainEngine(false),
      setPersistenceWarning,
    }))

    expect(geometry.syncProjectGeometry).not.toHaveBeenCalled()
    expect(setPersistenceWarning).not.toHaveBeenCalled()
  })

  it('synchronizes geometry when the Canvas engine is enabled and ready', async () => {
    geometry.syncProjectGeometry.mockClear()
    renderHook(() => useProjectGeometrySync({
      project,
      domainEngine: domainEngine(true),
      setPersistenceWarning: vi.fn(),
    }))

    await waitFor(() => expect(geometry.syncProjectGeometry).toHaveBeenCalledTimes(1))
  })
})
