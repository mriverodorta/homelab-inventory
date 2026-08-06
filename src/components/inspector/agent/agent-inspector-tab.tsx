import { lazy, Suspense } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentHostStatus } from '@/types/agent'
import type { InventoryItem } from '@/types/inventory'

const LazyAgentSetupPanel = lazy(async () => {
  const module = await import('./agent-setup-panel')
  return { default: module.AgentSetupPanel }
})

export function AgentInspectorTab({
  host,
  status,
  registered,
  hasSavedStatus,
  demoMode,
}: {
  host: InventoryItem
  status: AgentHostStatus
  registered: boolean
  hasSavedStatus: boolean
  demoMode: boolean
}) {
  return (
    <Suspense
      fallback={(
        <div className="flex items-center gap-2 rounded-md border border-[#e5dccf] bg-[#fffdf8] p-4 text-sm font-semibold text-[#75695d]">
          <RefreshCw className="size-4 animate-spin" />
          Loading agent workspace
        </div>
      )}
    >
      <LazyAgentSetupPanel
        server={host}
        status={status}
        registered={registered}
        hasSavedStatus={hasSavedStatus}
        demoMode={demoMode}
      />
    </Suspense>
  )
}
