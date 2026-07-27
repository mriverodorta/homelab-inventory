import { BadgeCheck, Clock3, Database } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { RegistryState } from '@/types/registry'

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function CatalogSourceStatus({ registry }: { registry: RegistryState }) {
  const snapshot = registry.snapshot
  if (!snapshot) {
    return <p className="text-sm text-[#746b60]">No verified official catalog is active on this installation.</p>
  }
  return (
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
  )
}
