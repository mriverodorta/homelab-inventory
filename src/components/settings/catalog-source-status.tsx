import { AlertTriangle, BadgeCheck, Clock3, Database } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { RegistryState } from '@/types/registry'

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function CatalogSourceStatus({ registry }: { registry: RegistryState }) {
  const snapshot = registry.snapshot
  const source = registry.sources.find((candidate) => candidate.kind.startsWith('official-'))
  return (
    <div className="space-y-2">
      {snapshot ? (
        <div className="grid gap-2 text-left sm:grid-cols-3">
          <div className="rounded-md border border-[#ded8ce] bg-white p-3">
            <Badge variant="outline" className="gap-1 border-[#8daaa3] bg-[#e7f1ed] text-[#254f48]"><BadgeCheck className="size-3" />Verified</Badge>
            <div className="mt-2 text-sm font-black">Revision {snapshot.revision}</div>
          </div>
          <div className="rounded-md border border-[#ded8ce] bg-white p-3">
            <Database className="size-4 text-[#766e64]" />
            <div className="mt-2 text-sm font-black">{snapshot.templateCount.toLocaleString()} templates</div>
          </div>
          <div className="rounded-md border border-[#ded8ce] bg-white p-3">
            <Clock3 className="size-4 text-[#766e64]" />
            <div className="mt-2 text-xs font-bold text-[#5f574e]">Activated {formatDate(snapshot.activatedAt)}</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#746b60]">No verified official catalog is active on this installation.</p>
      )}
      {source?.lastError ? (
        <div role="alert" className="flex gap-2 rounded-md border border-[#d9b4a9] bg-[#fbefeb] px-3 py-2 text-sm text-[#7d3429]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-bold">Latest catalog refresh failed</div>
            <div>{source.lastError}</div>
            {source.lastErrorAt ? <div className="mt-1 text-xs text-[#8b554c]">Checked {formatDate(source.lastErrorAt)}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
