import type { ReactNode } from 'react'
import { LockKeyhole } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const ENVIRONMENT_TOOLTIP = 'Read-only because this value is derived from the Docker Compose environment. Update the environment value and recreate the container to apply changes.'

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-4" aria-labelledby={`settings-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <header className="grid gap-1">
        <h2
          id={`settings-${title.toLowerCase().replaceAll(' ', '-')}`}
          className="text-lg font-black text-[#20242c]"
        >
          {title}
        </h2>
        {description ? <p className="max-w-2xl text-sm leading-5 text-[#756d62]">{description}</p> : null}
      </header>
      <div className="overflow-hidden rounded-lg border border-[#ded8ce] bg-white shadow-sm">
        {children}
      </div>
    </section>
  )
}

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 border-b border-[#e8e1d6] p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-black text-[#20242c]">{label}</p>
        {description ? <p className="mt-1 text-xs leading-5 text-[#756d62]">{description}</p> : null}
      </div>
      <div className="min-w-0 sm:justify-self-end">{children}</div>
    </div>
  )
}

export function EnvironmentValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex min-h-9 w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-[#ded8ce] bg-[#f7f2e9] px-3 py-2 text-left text-sm font-bold text-[#403a33] sm:w-[280px]"
          aria-label={`${label}: read-only environment value`}
          tabIndex={0}
        >
          <span className="min-w-0 select-text break-words">{value}</span>
          <LockKeyhole className="size-4 shrink-0 text-[#756d62]" aria-hidden="true" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-sm leading-5">
        {ENVIRONMENT_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  )
}

export function ConfirmSettingsAction({
  title,
  description,
  actionLabel,
  onConfirm,
  destructive = false,
}: {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => void
  destructive?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={destructive ? 'destructive' : 'outline'}>
          {actionLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} variant={destructive ? 'destructive' : 'default'}>
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ENVIRONMENT_TOOLTIP }
