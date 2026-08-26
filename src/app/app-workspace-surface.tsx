import { useState, type ComponentProps } from 'react'
import {
  ExampleWorkspaceGuide,
  GettingStartedChecklist,
  InspectorPanel,
  SystemsInspectorPanel,
} from '@/components/lazy-app-surfaces'
import { CanvasSurfacePool } from '@/app/canvas-surface-pool'
import { PortConnectionPreviewOverlay } from '@/app/port-connection-preview-overlay'
import { SystemsWorkspace } from '@/components/workbook/systems-workspace'
import type { WorkbenchCanvasProps } from '@/components/workbench-canvas-contract'
import type { WorkspaceSummary } from '@/lib/workbook-api'
import type { ProjectState } from '@/types/inventory'

type ExampleGuideProps = ComponentProps<typeof ExampleWorkspaceGuide>
type GettingStartedProps = ComponentProps<typeof GettingStartedChecklist>
type InspectorProps = ComponentProps<typeof InspectorPanel>
type PortPreviewProps = ComponentProps<typeof PortConnectionPreviewOverlay>
type WorkbenchProps = WorkbenchCanvasProps

export interface CanvasSurfaceRuntimeProps {
  activeRuntimeKey: string | null
  activeReady: boolean
  retainedRuntimeKeys: readonly string[]
}

export interface AppWorkspaceSurfaceProps {
  canvas: WorkbenchProps
  inspector: InspectorProps
  exampleGuide?: ExampleGuideProps
  gettingStarted?: GettingStartedProps
  portPreview?: PortPreviewProps
  workbook?: WorkbookSurfaceProps
  canvasRuntime?: CanvasSurfaceRuntimeProps
}

export interface WorkbookSurfaceProps {
  workspace: WorkspaceSummary
  workspaces?: readonly WorkspaceSummary[]
  project: ProjectState
  selectedItemId: string | null
  onSelectItem(itemId: string): void
  onCloseInspector(): void
}

export function AppWorkspaceSurface({
  canvas,
  inspector,
  exampleGuide,
  gettingStarted,
  portPreview,
  workbook,
  canvasRuntime,
}: AppWorkspaceSurfaceProps) {
  const [systemsCanvasWorkspaceId, setSystemsCanvasWorkspaceId] = useState<number | null>(null)
  const systemsActive = workbook?.workspace.type === 'systems'
  const runtime = canvasRuntime ?? {
    activeRuntimeKey: systemsActive ? null : 'legacy-canvas',
    activeReady: !systemsActive,
    retainedRuntimeKeys: systemsActive ? [] : ['legacy-canvas'],
  }

  return (
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      <CanvasSurfacePool
        activeRuntimeKey={runtime.activeRuntimeKey}
        activeReady={runtime.activeReady}
        retainedRuntimeKeys={runtime.retainedRuntimeKeys}
        canvas={canvas}
      />
      {systemsActive && workbook ? (
        <div className="absolute inset-0 z-10 flex min-w-0 overflow-hidden bg-[#fbf8f1]">
          <SystemsWorkspace
            project={workbook.project}
            workspaces={workbook.workspaces}
            selectedItemId={workbook.selectedItemId}
            onSelectItem={workbook.onSelectItem}
            onCloseInspector={workbook.onCloseInspector}
            onCanvasScopeChange={setSystemsCanvasWorkspaceId}
          />
          <div
            data-testid="systems-inspector-region"
            data-open={inspector.open}
            className={`contents lg:relative lg:block lg:h-full lg:shrink-0 lg:overflow-hidden lg:transition-[width] lg:duration-200 lg:ease-out ${
              inspector.open ? 'lg:w-[min(42vw,680px)]' : 'lg:w-0'
            }`}
          >
            <SystemsInspectorPanel
              {...inspector}
              attentionWorkspaceId={systemsCanvasWorkspaceId}
              layout="systems-split"
            />
          </div>
        </div>
      ) : null}
      {!systemsActive && runtime.activeReady ? (
        <>
          {exampleGuide ? <ExampleWorkspaceGuide {...exampleGuide} /> : null}
          {gettingStarted ? <GettingStartedChecklist {...gettingStarted} /> : null}
          {portPreview ? <PortConnectionPreviewOverlay {...portPreview} /> : null}
          <InspectorPanel {...inspector} />
        </>
      ) : null}
    </div>
  )
}
