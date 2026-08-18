import { Badge } from '@/components/ui/badge'
import type { CatalogFieldChange } from '@/types/registry'
import {
  registryChangeLabel,
  registryReclassificationTitle,
  registryResourceDisplayLabel,
  registryResourceTypeLabel,
} from './registry-update-presentation'

function formatValue(value: unknown) {
  if (value === undefined) return 'Not recorded'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function RegistryUpdateChange({ change }: { change: CatalogFieldChange }) {
  const impact = change.impact.charAt(0).toUpperCase() + change.impact.slice(1)
  const reclassification = change.kind === 'reclassify-resource' && change.from && change.to
    ? { from: change.from, to: change.to }
    : null
  const title = reclassification ? registryReclassificationTitle(change) : registryChangeLabel(change.path)
  return (
    <div className="rounded-md border border-[#e5ddd1] bg-[#f7f2e9] p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block text-sm text-[#28231f]">{title}</strong>
          <code className="mt-1 block break-all text-[11px] text-[#746b60]">
            {reclassification
              ? `${reclassification.from.resourceType}/${reclassification.from.key} -> ${reclassification.to.resourceType}/${reclassification.to.key}`
              : change.path}
          </code>
        </div>
        <Badge variant="outline">{impact}</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded border border-[#e2dbd0] bg-white p-2">
          <span className="font-bold text-[#81786e]">Current</span>
          {reclassification ? (
            <p className="mt-1 break-words text-[11px] font-semibold text-[#3f3933]">
              {registryResourceTypeLabel(reclassification.from.resourceType)} — {registryResourceDisplayLabel(reclassification.from)}
            </p>
          ) : (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{formatValue(change.current)}</pre>
          )}
        </div>
        <div className="min-w-0 rounded border border-[#c9dcd5] bg-[#f8fcfa] p-2">
          <span className="font-bold text-[#3c655d]">Proposed</span>
          {reclassification ? (
            <p className="mt-1 break-words text-[11px] font-semibold text-[#294f46]">
              {registryResourceTypeLabel(reclassification.to.resourceType)} — {registryResourceDisplayLabel(reclassification.to)}
            </p>
          ) : (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{formatValue(change.next)}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
