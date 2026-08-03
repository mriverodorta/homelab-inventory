import { useContext } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AuditIgnoreContext } from '@/components/inspector/audit/audit-context'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { Button } from '@/components/ui/button'
import type { AuditWarning } from '@/lib/audit'
import { cn } from '@/lib/utils'

export type InspectorAuditWarning = AuditWarning & { ignored: boolean }

export function AuditSection({ warnings }: { warnings: InspectorAuditWarning[] }) {
  const onSetWarningIgnored = useContext(AuditIgnoreContext)

  if (warnings.length === 0) {
    return null
  }

  const openWarningCount = warnings.filter((warning) => !warning.ignored).length

  return (
    <InspectorSection
      title="Audit"
      icon={AlertTriangle}
      badge={(
        <StatusBadge tone="warning">
          <span data-testid="inspector-audit-open-count">{openWarningCount}</span>
        </StatusBadge>
      )}
    >
      <div className="space-y-2">
        {warnings.map((warning) => (
          <div
            key={warning.id}
            data-ignored={warning.ignored ? 'true' : 'false'}
            className={cn(
              'flex items-start gap-2 rounded-md border p-2 text-xs font-semibold leading-snug',
              warning.ignored
                ? 'border-[#d8d1c7] bg-[#f3efe9] text-[#75695d]'
                : 'border-[#e8d392] bg-[#fff8df] text-[#5d4814]',
            )}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{warning.message}</span>
            {onSetWarningIgnored ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 px-2 text-[11px]"
                onClick={() => onSetWarningIgnored(warning.id, !warning.ignored)}
              >
                {warning.ignored ? 'Unignore' : 'Ignore'}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </InspectorSection>
  )
}
