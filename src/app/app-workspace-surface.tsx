import type { ComponentProps } from 'react'
import {
  ExampleWorkspaceGuide,
  GettingStartedChecklist,
  InspectorPanel,
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
  if (workbook?.workspace.type === 'systems') {
    return (
      <>
        <SystemsWorkspace
          project={workbook.project}
          selectedItemId={workbook.selectedItemId}
          onSelectItem={workbook.onSelectItem}
          onCloseInspector={workbook.onCloseInspector}
        />
        <InspectorPanel {...inspector} />
      </>
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
