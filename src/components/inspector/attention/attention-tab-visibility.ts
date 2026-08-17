import { useSystemAttention } from '@/hooks/use-systems'
import type { SystemsAttentionSummary, SystemsHostType } from '@/types/systems'

export function shouldShowAttentionTab(
  summary: Pick<SystemsAttentionSummary, 'totalCount' | 'state'> | null | undefined,
  requestedTab?: string | null,
) {
  return requestedTab === 'attention'
    || Boolean(summary && (summary.totalCount > 0 || summary.state !== 'current'))
}

export function useAttentionTabVisibility({
  projectId,
  hostType,
  hostId,
  requestedTab,
}: {
  projectId: number
  hostType: SystemsHostType
  hostId: number
  requestedTab?: string | null
}) {
  const attention = useSystemAttention(projectId, hostType, hostId, true)
  return shouldShowAttentionTab(attention.data?.summary, requestedTab)
}
