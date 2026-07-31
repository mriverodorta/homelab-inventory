import { createLazySurface } from '@/components/lazy-surface'

const workbenchCanvasLoader = () => import('@/components/workbench-canvas').then((module) => ({
  default: module.WorkbenchCanvas,
}))

export const WorkbenchCanvas = createLazySurface(workbenchCanvasLoader, {
  displayName: 'Canvas',
  loadingLabel: 'Loading workspace canvas',
  loadingClassName: 'min-h-0 flex-1 rounded-none border-0 bg-[#fbf8f1]',
})
