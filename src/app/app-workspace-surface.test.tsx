import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppWorkspaceSurface } from '@/app/app-workspace-surface'
import type { ProjectState } from '@/types/inventory'

vi.mock('@/components/lazy-app-surfaces', () => ({
  ExampleWorkspaceGuide: () => null,
  GettingStartedChecklist: () => null,
  InspectorPanel: () => <aside data-testid="overlay-inspector" />,
  SystemsInspectorPanel: ({ layout }: { layout?: string }) => <aside data-testid="systems-inspector" data-layout={layout} />,
}))

vi.mock('@/components/lazy-workbench-canvas', () => ({
  WorkbenchCanvas: () => <main data-testid="canvas" />,
}))

vi.mock('@/components/workbook/systems-workspace', () => ({
  SystemsWorkspace: () => <main data-testid="systems-workspace" />,
}))

vi.mock('@/app/port-connection-preview-overlay', () => ({
  PortConnectionPreviewOverlay: () => null,
}))

const project: ProjectState = {
  id: 'project-1',
  metadata: { name: 'Default Project', version: 1, updatedAt: '2026-08-17T00:00:00.000Z', projectId: 1, workspaceId: 1 },
  items: {},
  placements: [],
  assignments: [],
  connections: [],
}

function renderSystems(open: boolean) {
  return render(<AppWorkspaceSurface
    canvas={{} as never}
    inspector={{ open } as never}
    workbook={{
      workspace: { id: 1, projectId: 1, type: 'systems', name: 'Systems' } as never,
      project,
      selectedItemId: open ? 'server:1' : null,
      onSelectItem: () => undefined,
      onCloseInspector: () => undefined,
    }}
  />)
}

describe('AppWorkspaceSurface Systems layout', () => {
  it('reserves responsive desktop width for the inline inspector when open', () => {
    renderSystems(true)
    expect(screen.getByTestId('systems-workspace')).toBeVisible()
    expect(screen.getByTestId('systems-inspector')).toHaveAttribute('data-layout', 'systems-split')
    expect(screen.getByTestId('systems-inspector-region')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('systems-inspector-region')).toHaveClass('lg:w-[min(42vw,680px)]')
  })

  it('collapses the desktop inspector region when closed', () => {
    renderSystems(false)
    expect(screen.getByTestId('systems-inspector-region')).toHaveClass('lg:w-0')
  })
})
