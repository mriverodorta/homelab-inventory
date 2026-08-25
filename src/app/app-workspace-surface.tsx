import { useState, type ComponentProps } from 'react'
import {
  ExampleWorkspaceGuide,
  GettingStartedChecklist,
  InspectorPanel,
  SystemsInspectorPanel,
} from '@/components/lazy-app-surfaces'
import { WorkbenchCanvas } from '@/components/lazy-workbench-canvas'
import { PortConnectionPreviewOverlay } from '@/app/port-connection-preview-overlay'
import { SystemsWorkspace } from '@/components/workbook/systems-workspace'
import type { WorkspaceSummary } from '@/lib/workbook-api'
import type { ProjectState } from '@/types/inventory'

type ExampleGuideProps = ComponentProps<typeof ExampleWorkspaceGuide>
type GettingStartedProps = ComponentProps<typeof GettingStartedChecklist>
type InspectorProps = ComponentProps<typeof InspectorPanel>
type PortPreviewProps = ComponentProps<typeof PortConnectionPreviewOverlay>
type WorkbenchProps = ComponentProps<typeof WorkbenchCanvas>

export interface AppWorkspaceSurfaceProps {
  canvas: WorkbenchProps
  inspector: InspectorProps
  exampleGuide?: ExampleGuideProps
  gettingStarted?: GettingStartedProps
  portPreview?: PortPreviewProps
  workbook?: WorkbookSurfaceProps
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
}: AppWorkspaceSurfaceProps) {
  const [systemsCanvasWorkspaceId, setSystemsCanvasWorkspaceId] = useState<number | null>(null)
  if (workbook?.workspace.type === 'systems') {
    return (
      <div className="flex min-w-0 flex-1 overflow-hidden">
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
    )
  }

  return (
    <>
      <WorkbenchCanvas {...canvas} />
      {exampleGuide ? <ExampleWorkspaceGuide {...exampleGuide} /> : null}
      {gettingStarted ? <GettingStartedChecklist {...gettingStarted} /> : null}
      {portPreview ? <PortConnectionPreviewOverlay {...portPreview} /> : null}
      <InspectorPanel {...inspector} />
    </>
  )
}
