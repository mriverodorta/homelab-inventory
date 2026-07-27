import { CloudOff, Database, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CatalogBrowser } from '@/components/inventory/catalog-browser'
import type { RegistryState } from '@/types/registry'

export function CatalogSourcePanel({
  registry,
  onOpenSettings,
  onCreate,
}: {
  registry: RegistryState
  onOpenSettings?: () => void
  onCreate?: (templateKey: string, quantity: number) => Promise<void>
}) {
  const offline = registry.settings.mode === 'offline'
  const disabled = registry.settings.mode === 'disabled'
  const Icon = disabled ? CloudOff : offline ? FileDown : Database
  const title = disabled
    ? 'Official catalog is off'
    : offline
      ? 'Import an official catalog file'
      : 'No verified catalog is available yet'
  const description = disabled
    ? 'Manual creation and private templates remain fully local. Enable Offline file or Connected mode in Settings when you want to use the verified catalog.'
    : offline
      ? 'Import a signed official catalog snapshot in Settings. Search remains entirely local after verification.'
      : 'Refresh the official signed catalog in Settings. Search runs against the local index and never sends your query.'

  if (registry.snapshot && onCreate) return <CatalogBrowser onCreate={onCreate} />

  return (
    <div className="flex min-h-72 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-md bg-[#20242c] text-white">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-lg font-black text-[#20242c]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[#6f665c]">{description}</p>
        {onOpenSettings ? (
          <Button type="button" variant="outline" className="mt-5" onClick={onOpenSettings}>
            Registry settings
          </Button>
        ) : null}
      </div>
    </div>
  )
}
