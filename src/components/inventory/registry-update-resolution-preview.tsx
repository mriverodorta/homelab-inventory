import type { CatalogUpdateResolution } from '@/types/registry'
import { registryResolutionOperationLabel } from './registry-update-presentation'

export function RegistryUpdateResolutionPreview({ resolution }: { resolution: CatalogUpdateResolution }) {
  return (
    <div className="grid gap-2">
      {resolution.operations.map((operation, index) => (
        <div key={`${String(operation.kind)}:${index}`} className="rounded-md border border-[#ded8ce] bg-[#faf7f1] p-3 text-xs leading-5">
          {registryResolutionOperationLabel(operation)}
        </div>
      ))}
    </div>
  )
}
