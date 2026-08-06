import { Activity, Info } from 'lucide-react'
import { AuditSection, type InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { InventorySpecsFormContent } from '@/components/inventory-form/specs-tab-content'
import {
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import { Input } from '@/components/ui/input'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import { cn } from '@/lib/utils'
import type { AgentHardwareSuggestion } from '@/types/agent'

const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

export function ComingSoonSection() {
  return (
    <InspectorSection title="Services" icon={Activity}>
      <div className="rounded-lg border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-5 text-center">
        <div className="text-sm font-black text-[#20242c]">Coming Soon</div>
        <p className="mt-1 text-xs font-medium text-[#75695d]">
          Service discovery and app health will live here.
        </p>
      </div>
    </InspectorSection>
  )
}

export function EditableSpecsSection({
  title,
  editor,
  auditWarnings,
  displayName = false,
  onChange,
  agentSuggestions = [],
}: {
  title: string
  editor: ReturnType<typeof useInventoryItemEditor>
  auditWarnings: InspectorAuditWarning[]
  displayName?: boolean
  onChange?: (
    patch: Partial<InventoryFormValues>,
    mode?: 'debounced' | 'immediate',
  ) => void
  agentSuggestions?: AgentHardwareSuggestion[]
}) {
  return (
    <>
      <InspectorSection title={title} icon={Info}>
        <InventorySpecsFormContent
          values={editor.values}
          errors={editor.errors}
          onChange={onChange ?? editor.updateValues}
          includeCompatibility={false}
          agentSuggestions={agentSuggestions}
        />
        {displayName ? (
          <label className={cn(formLabelClass, 'mt-3')}>
            Display name
            <Input
              aria-label="Display name"
              value={editor.values.properties?.displayName ?? ''}
              placeholder="Server name"
              onChange={(event) => editor.updateValues({
                properties: {
                  ...editor.values.properties,
                  displayName: event.target.value,
                },
              })}
            />
          </label>
        ) : null}
      </InspectorSection>
      <AuditSection warnings={auditWarnings} />
    </>
  )
}
