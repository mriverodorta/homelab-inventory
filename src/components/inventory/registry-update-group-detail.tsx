import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadCatalogUpdateGroup } from '@/lib/registry-api'
import type { CatalogUpdateGroup, CatalogUpdateGroupDetail } from '@/types/registry'

function formatValue(value: unknown) {
  if (value === undefined) return 'Not recorded'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function RegistryUpdateGroupDetail({ group, onResolve }: {
  group: CatalogUpdateGroup
  onResolve: (detail: CatalogUpdateGroupDetail, linkId: number) => void
}) {
  const query = useQuery({
    queryKey: ['registry', 'update-group', group.id, group.concurrencyToken],
    queryFn: () => loadCatalogUpdateGroup(group.id, group.concurrencyToken),
  })
  if (query.isLoading) return <div className="flex items-center gap-2 py-4 text-xs text-[#746b60]"><LoaderCircle className="size-4 animate-spin" />Loading catalog changes...</div>
  if (query.error) return <p role="alert" className="py-3 text-xs font-semibold text-[#a33d31]">{query.error instanceof Error ? query.error.message : 'Catalog changes could not be loaded.'}</p>
  const detail = query.data
  if (!detail) return null
  const changes = detail.members?.flatMap((member) => member.changes ?? []) ?? detail.changes ?? []
  const resolvable = detail.members?.find((member) => member.resolution?.available)
  return (
    <div className="mt-3 border-t border-[#e5ddd1] pt-3">
      <div className="grid gap-2">
        {changes.length === 0 ? <p className="text-xs text-[#746b60]">No material definition changes.</p> : changes.map((change, index) => (
          <div key={`${change.field}:${index}`} className="rounded border border-[#e5ddd1] bg-[#f7f2e9] p-2 text-xs">
            <strong>{change.field}</strong>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><span className="font-bold text-[#81786e]">Current</span><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{formatValue(change.current)}</pre></div>
              <div><span className="font-bold text-[#3c655d]">Proposed</span><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{formatValue(change.next)}</pre></div>
            </div>
          </div>
        ))}
      </div>
      {resolvable ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded border border-[#d8c6a8] bg-[#fff9ec] p-3 text-xs">
          <span>{resolvable.resolution.reason || 'A deterministic topology resolution is available.'}</span>
          <Button type="button" size="sm" onClick={() => onResolve(detail, resolvable.linkId)}><Wrench className="size-4" />Resolve and apply</Button>
        </div>
      ) : group.status === 'blocked' ? <p className="mt-3 text-xs font-semibold text-[#8a4b26]">This topology change cannot be resolved automatically.</p> : null}
    </div>
  )
}
