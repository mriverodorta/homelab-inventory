import type { ComponentProps } from 'react'
import {
  ExampleWorkspaceGuide,
  GettingStartedChecklist,
  InspectorPanel,
} from '@/components/lazy-app-surfaces'
import { WorkbenchCanvas } from '@/components/lazy-workbench-canvas'
import { PortConnectionPreviewOverlay } from '@/app/port-connection-preview-overlay'

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
}

export function AppWorkspaceSurface({
  canvas,
  inspector,
  exampleGuide,
  gettingStarted,
  portPreview,
}: AppWorkspaceSurfaceProps) {
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
