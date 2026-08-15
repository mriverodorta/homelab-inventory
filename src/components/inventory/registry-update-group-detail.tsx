import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadCatalogUpdateGroup } from '@/lib/registry-api'
import type { CatalogUpdateGroup, CatalogUpdateGroupDetail } from '@/types/registry'
import { RegistryUpdateChange } from './registry-update-change'
import { RegistryUpdateResolutionPreview } from './registry-update-resolution-preview'

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
  const unavailable = detail.members?.find((member) => member.resolution && !member.resolution.available)
  return (
    <div className="mt-3 border-t border-[#e5ddd1] pt-3">
      <div className="grid gap-2">
        {changes.length === 0 ? <p className="text-xs text-[#746b60]">No material definition changes.</p> : changes.map((change, index) => (
          <RegistryUpdateChange key={`${change.path}:${index}`} change={change} />
        ))}
      </div>
      {resolvable ? (
        <div className="mt-3 grid gap-3 rounded-md border border-[#d8c6a8] bg-[#fff9ec] p-3">
          <div>
            <strong className="text-sm text-[#4e3c20]">What resolve and apply will do</strong>
            <p className="mt-1 text-xs text-[#67563b]">{resolvable.resolution.reason || 'A deterministic topology resolution is available.'}</p>
          </div>
          <RegistryUpdateResolutionPreview resolution={resolvable.resolution} />
          <Button type="button" size="sm" className="justify-self-end" onClick={() => onResolve(detail, resolvable.linkId)}><Wrench className="size-4" />Resolve and apply</Button>
        </div>
      ) : group.status === 'blocked' ? (
        <div className="mt-3 rounded-md border border-[#e1b8ae] bg-[#fff4f1] p-3">
          <strong className="text-sm text-[#7e3027]">Why this is blocked</strong>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#8a4b26]">{unavailable?.resolution.reason || 'No deterministic resolution is available for the current relationships.'}</p>
        </div>
      ) : null}
    </div>
  )
}
