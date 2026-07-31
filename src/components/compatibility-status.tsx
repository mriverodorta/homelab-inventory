import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Info,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  CompatibilityFinding,
  CompatibilityStatus,
} from '@/types/compatibility'

type CompatibilityStatusBandProps = {
  status: CompatibilityStatus
  findings?: CompatibilityFinding[]
}

type StatusPresentation = {
  label: string
  detail: string
  icon: LucideIcon
  className: string
}

function statusPresentation(
  status: CompatibilityStatus,
  findings: CompatibilityFinding[],
): StatusPresentation {
  if (status === 'incompatible') {
    return {
      label: 'Needs attention',
      detail: 'One or more known requirements are not supported by this host.',
      icon: AlertTriangle,
      className: 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
    }
  }

  if (status === 'unknown') {
    return {
      label: 'Not fully verified',
      detail: 'Compatibility data is incomplete for one or more checks.',
      icon: CircleHelp,
      className: 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]',
    }
  }

  if (findings.some((finding) => finding.severity === 'warning')) {
    return {
      label: 'Compatible',
      detail: 'The hardware can be used, with the performance notes shown below.',
      icon: Info,
      className: 'border-[#aac4dc] bg-[#f1f7fc] text-[#244a68]',
    }
  }

  return {
    label: 'Compatible',
    detail: 'All available compatibility checks passed.',
    icon: CheckCircle2,
    className: 'border-[#9fd3c7] bg-[#edf9f5] text-[#174c43]',
  }
}

export function CompatibilityStatusBand({
  status,
  findings = [],
}: CompatibilityStatusBandProps) {
  const presentation = statusPresentation(status, findings)
  const Icon = presentation.icon

  return (
    <div
      role="status"
      aria-label={`Compatibility status: ${presentation.label}`}
      data-compatibility-status={status}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border px-3 py-2.5',
        presentation.className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-black">{presentation.label}</div>
        <p className="mt-0.5 text-xs font-semibold leading-5 opacity-80">
          {presentation.detail}
        </p>
      </div>
    </div>
  )
}

type ContextualFinding = {
  finding: CompatibilityFinding
  itemName?: string
}

const findingGroups: Array<{
  severity: CompatibilityFinding['severity']
  title: string
  className: string
}> = [
  {
    severity: 'error',
    title: 'Errors',
    className: 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
  },
  {
    severity: 'warning',
    title: 'Warnings',
    className: 'border-[#aac4dc] bg-[#f1f7fc] text-[#244a68]',
  },
  {
    severity: 'unknown',
    title: 'Unknowns',
    className: 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]',
  },
]

export function CompatibilityFindingGroups({
  findings,
}: {
  findings: ContextualFinding[]
}) {
  return (
    <div className="space-y-3">
      {findingGroups.map((group) => {
        const matching = findings.filter(({ finding }) => finding.severity === group.severity)
        if (matching.length === 0) return null

        return (
          <section key={group.severity} aria-labelledby={`compatibility-${group.severity}-heading`}>
            <h3
              id={`compatibility-${group.severity}-heading`}
              className="mb-1.5 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d]"
            >
              {group.title}
            </h3>
            <ul className="space-y-1.5">
              {matching.map(({ finding, itemName }, index) => (
                <li
                  key={`${finding.code}:${finding.resourceId ?? ''}:${index}`}
                  className={cn('rounded-md border px-3 py-2 text-xs font-semibold leading-5', group.className)}
                >
                  {itemName ? <span className="font-black">{itemName}: </span> : null}
                  {finding.message}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
