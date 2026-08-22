import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { createSharedCanvasModel, createSharedSystemsModel, createSharedWorkbookModel } from '@homelab-inventory/viewer-model'
import { SharedWorkbookViewer } from '@homelab-inventory/viewer-react'
import '../../../packages/viewer-react/src/viewer.css'
import { Button } from '@/components/ui/button'
import { previewShare } from '@/lib/sharing-api'

export function SharePreview({ shareId }: { shareId: number }) {
  const query = useQuery({ queryKey: ['sharing', 'preview', shareId], queryFn: () => previewShare(shareId), staleTime: Infinity })
  const models = useMemo(() => {
    if (!query.data?.views) return null
    const workbook = createSharedWorkbookModel(query.data.manifest)
    const viewModels = Object.fromEntries(query.data.views.map((view) => {
      const viewType = typeof view.viewType === 'string' ? view.viewType : null
      const model = viewType === 'canvas' ? createSharedCanvasModel(view) : createSharedSystemsModel(view)
      return [model.publicViewId, model]
    }))
    return { workbook, viewModels }
  }, [query.data])

  if (query.isLoading) return <main className="grid min-h-dvh place-items-center bg-[#f5f1ea] text-sm font-bold text-[#756d62]">Preparing exact preview…</main>
  if (query.isError || !models) return <main className="grid min-h-dvh place-items-center bg-[#f5f1ea] p-6"><div className="max-w-md text-center"><h1 className="text-lg font-black text-[#20242c]">Preview unavailable</h1><p className="mt-2 text-sm leading-5 text-[#756d62]">{query.error instanceof Error ? query.error.message : 'The selected share could not be rendered.'}</p><Button className="mt-4" variant="outline" onClick={() => window.close()}><ArrowLeft />Close preview</Button></div></main>
  const preview = query.data
  if (!preview) return null
  return (
    <main className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] bg-[#f5f1ea]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ded8ce] bg-white px-4 py-3"><div><p className="flex items-center gap-2 text-sm font-black text-[#20242c]"><ShieldCheck className="size-4 text-[#2f7658]" />Local privacy preview</p><p className="mt-0.5 text-xs text-[#756d62]">Nothing is published by opening this page.</p></div><code className="max-w-full truncate text-[11px] text-[#665d52]">sha256:{preview.manifestHash}</code></header>
      <div className="min-h-0"><SharedWorkbookViewer model={models.workbook} viewModels={models.viewModels} onIntent={() => {}} /></div>
    </main>
  )
}
