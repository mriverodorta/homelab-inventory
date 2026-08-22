import { lazy, Suspense } from 'react'
import { DomainEngineGate } from '@/components/domain-engine-gate'
import { DomainEngineProvider } from '@/components/domain-engine-provider'
import { LazyWorkspaceApp } from '@/components/lazy-workspace-app'

const SharePreview = lazy(() => import('@/components/sharing/share-preview').then((module) => ({ default: module.SharePreview })))

export function ApplicationRoot() {
  const previewMatch = /^\/sharing\/preview\/([1-9]\d*)\/?$/u.exec(window.location.pathname)
  const previewShareId = previewMatch ? Number(previewMatch[1]) : null

  if (previewShareId) {
    return (
      <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-[#f5f1ea] text-sm font-bold text-[#756d62]">Loading privacy preview…</main>}>
        <SharePreview shareId={previewShareId} />
      </Suspense>
    )
  }

  return (
    <DomainEngineProvider enabled={false}>
      <DomainEngineGate>
        <LazyWorkspaceApp />
      </DomainEngineGate>
    </DomainEngineProvider>
  )
}
