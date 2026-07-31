import type { ComponentProps, ReactNode } from 'react'
import { DndWorkspace } from '@/components/lazy-dnd-workspace'
import { TooltipProvider } from '@/components/ui/tooltip'

type DndWorkspaceProps = ComponentProps<typeof DndWorkspace>

interface AppShellProps {
  drag: Pick<
    DndWorkspaceProps,
    'onDragStart' | 'onDragOver' | 'onDragCancel' | 'onDragEnd' | 'overlay'
  >
  children: ReactNode
}

export function AppShell({ drag, children }: AppShellProps) {
  return (
    <TooltipProvider>
      <DndWorkspace {...drag}>
        <div className="relative flex h-dvh w-screen overflow-hidden bg-[#e8e2d8] lg:min-w-[1080px]">
          {children}
        </div>
      </DndWorkspace>
    </TooltipProvider>
  )
}
