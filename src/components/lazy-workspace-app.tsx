import { lazy, Suspense } from 'react'

const App = lazy(() => import('@/App'))

export function LazyWorkspaceApp() {
  return (
    <Suspense fallback={<div role="status" className="p-4 text-sm font-semibold text-[#75695d]">Loading workspace</div>}>
      <App />
    </Suspense>
  )
}
