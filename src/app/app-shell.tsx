import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { DndWorkspace } from '@/components/lazy-dnd-workspace'
import { TooltipProvider } from '@/components/ui/tooltip'

type DndWorkspaceProps = ComponentProps<typeof DndWorkspace>

interface AppShellProps {
  drag: Pick<
    DndWorkspaceProps,
    'onDragStart' | 'onDragOver' | 'onDragCancel' | 'onDragEnd' | 'overlay'
  >
  children: ReactNode
  projectControl?: ReactNode
  workbookTabs?: ReactNode
  projectControlOffset?: number
}

export function AppShell({
  drag,
  children,
  projectControl,
  workbookTabs,
  projectControlOffset = 16,
}: AppShellProps) {
  return (
    <TooltipProvider>
      <DndWorkspace {...drag}>
        <div className="relative flex h-dvh w-screen flex-col overflow-hidden bg-[#e8e2d8] lg:min-w-[1080px]">
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {children}
            {projectControl ? (
              <div
                className="pointer-events-none absolute left-3 top-3 z-30 transition-[left] duration-200 lg:left-[var(--project-control-left)]"
                style={{ '--project-control-left': `${projectControlOffset}px` } as CSSProperties}
              >
                {projectControl}
              </div>
            ) : null}
          </div>
          {workbookTabs}
        </div>
      </DndWorkspace>
    </TooltipProvider>
  )
}
