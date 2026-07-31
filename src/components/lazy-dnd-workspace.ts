import { createLazySurface } from '@/components/lazy-surface'
import type { DndWorkspaceProps } from '@/components/dnd-workspace'

const dndWorkspaceLoader = () => import('@/components/dnd-workspace').then((module) => ({
  default: module.DndWorkspace,
}))

export const DndWorkspace = createLazySurface<DndWorkspaceProps>(dndWorkspaceLoader, {
  displayName: 'Workspace interactions',
  loadingLabel: 'Preparing workspace interactions',
  loadingClassName: 'h-dvh min-h-dvh w-screen rounded-none border-0 bg-[#e8e2d8]',
})
