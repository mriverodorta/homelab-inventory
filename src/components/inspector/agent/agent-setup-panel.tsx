import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, RefreshCw, ScanSearch, ShieldCheck, Terminal } from 'lucide-react'
import { useState } from 'react'
import { AgentHeartbeatTimeline } from '@/components/inspector/agent/agent-heartbeat-timeline'
import { AgentMetricsPanel } from '@/components/inspector/agent/agent-metrics-panel'
import { agentMetrics, metricNumber } from '@/components/inspector/agent/agent-status-utils'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { formatBytes, formatRelativeAge } from '@/components/inspector/shared/item-formatters'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePermission } from '@/hooks/use-permission'
import {
  clearAgentStatus,
  createAgentEnrollment,
  loadAgentHardwareSnapshot,
  loadAgentTelemetry,
  revokeAgentRegistration,
} from '@/lib/agent-api'
import type { AgentHostStatus, AgentState } from '@/types/agent'
import type { InventoryItem } from '@/types/inventory'

const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

function agentStateTone(state: AgentState): string {
  if (state === 'online') return 'bg-[#d3eee7] text-[#143733]'
  if (state === 'stale') return 'bg-[#fff2c7] text-[#3d2a08]'
  if (state === 'offline') return 'bg-[#fff4ee] text-[#7a2c1d]'
  if (state === 'unknown') return 'bg-[#d7eef2] text-[#102f36]'
  return 'bg-[#f3f0ea] text-[#75695d]'
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#ece5da] py-2.5 last:border-b-0">
      <dt className="text-sm text-[#75695d]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-bold text-[#20242c]">{value}</dd>
    </div>
  )
}

function HardwareEvidence({ host }: { host: InventoryItem }) {
  const query = useQuery({
    queryKey: ['agent-hardware-snapshot', host.type, host.id],
    queryFn: () => loadAgentHardwareSnapshot(host.type as 'server' | 'nas' | 'pcBuild', host.id),
    retry: 1,
    staleTime: 60_000,
  })
  const [copied, setCopied] = useState(false)
  const components = query.data?.snapshot?.components ?? []
  const counts = Object.entries(components.reduce<Record<string, number>>((result, component) => {
    result[component.kind] = (result[component.kind] ?? 0) + 1
    return result
  }, {})).sort(([first], [second]) => first.localeCompare(second))

  async function copyScanCommand() {
    await navigator.clipboard.writeText('sudo homelab-inventory-agent inventory')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <InspectorSection
      title="Detected Hardware"
      icon={ScanSearch}
      badge={query.data?.stale ? <span className="text-xs font-bold text-[#a05b26]">Stale</span> : null}
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm font-semibold text-[#75695d]"><RefreshCw className="size-4 animate-spin" />Loading detected hardware</div>
      ) : query.isError ? (
        <p className="text-sm font-semibold text-[#7a2c1d]">{query.error instanceof Error ? query.error.message : 'Detected hardware could not be loaded.'}</p>
      ) : components.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {counts.map(([kind, count]) => <span key={kind} className="rounded-md bg-[#f3f0ea] px-2 py-1 text-xs font-bold text-[#3c342b]">{kind} {count}</span>)}
          </div>
          <p className="text-xs font-medium leading-relaxed text-[#75695d]">
            Collected {formatRelativeAge(query.data?.ageMs ?? null)}. Private identifiers stay in this installation and are never shown here or sent to the public registry.
          </p>
          <p className="text-xs font-bold text-[#3c342b]">{query.data?.suggestions.length ?? 0} reviewable field suggestions</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold leading-relaxed text-[#75695d]">Run one reviewed elevated scan on the host to detect board, CPU, memory, storage, PCI, network, and power hardware.</p>
          <Button type="button" variant="outline" className="gap-2" onClick={() => void copyScanCommand()}>
            <Copy data-icon="inline-start" />{copied ? 'Copied' : 'Copy scan command'}
          </Button>
        </div>
      )}
    </InspectorSection>
  )
}

export function AgentSetupPanel({
  server: host,
  status,
  registered,
  hasSavedStatus,
  demoMode,
}: {
  server: InventoryItem
  status: AgentHostStatus
  registered: boolean
  hasSavedStatus: boolean
  demoMode: boolean
}) {
  const canManage = usePermission('agents.manage')
  const queryClient = useQueryClient()
  const [endpoint, setEndpoint] = useState(() => window.location.origin)
  const [copied, setCopied] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'revoke' | 'clear' | null>(null)
  const enrollmentMutation = useMutation({
    mutationFn: () => createAgentEnrollment(host.id, endpoint),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const revokeMutation = useMutation({
    mutationFn: () => revokeAgentRegistration(host.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const clearStatusMutation = useMutation({
    mutationFn: () => clearAgentStatus(host.id),
    onSuccess: (summary) => queryClient.setQueryData(['agent-status'], summary),
  })
  const telemetry = useQuery({
    queryKey: ['agent-telemetry', host.type, host.id, '30m'],
    queryFn: () => {
      const to = Date.now()
      return loadAgentTelemetry(host.type as 'server' | 'nas' | 'pcBuild', host.id, { from: to - (30 * 60_000), to, limit: 30 })
    },
    enabled: registered || hasSavedStatus,
    retry: 1,
    refetchInterval: status.state === 'online' ? 60_000 : false,
  })
  const command = enrollmentMutation.data?.installCommand ?? ''
  const metrics = agentMetrics(status)
  const cpuPercent = metricNumber(metrics.cpu, 'percent')
  const memoryUsed = metricNumber(metrics.memory, 'usedBytes')
  const memoryTotal = metricNumber(metrics.memory, 'totalBytes')
  const loadAverage = metrics.loadAverage?.slice(0, 3).map((value) => value.toFixed(2)).join(' / ')
  const system = metrics.system
  const operatingSystem = typeof system?.operatingSystem === 'string' ? system.operatingSystem : null
  const architecture = typeof system?.architecture === 'string' ? system.architecture : null

  async function copyCommand() {
    if (!command) return
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  function confirmLifecycleAction() {
    if (confirmAction === 'revoke') revokeMutation.mutate()
    if (confirmAction === 'clear') clearStatusMutation.mutate()
    setConfirmAction(null)
  }

  return (
    <div className="space-y-4">
      <InspectorSection
        title="Agent Health"
        icon={ShieldCheck}
        badge={<span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${agentStateTone(status.state)}`}>{status.state}</span>}
      >
        <dl>
          <DetailRow label="Last seen" value={formatRelativeAge(status.ageMs)} />
          {status.hostname ? <DetailRow label="Hostname" value={status.hostname} /> : null}
          {status.agentVersion ? <DetailRow label="Agent version" value={status.agentVersion} /> : null}
          {operatingSystem || architecture ? <DetailRow label="Platform" value={[operatingSystem, architecture].filter(Boolean).join(' / ')} /> : null}
          {cpuPercent !== null ? <DetailRow label="CPU" value={`${cpuPercent.toFixed(1)}%`} /> : null}
          {memoryUsed !== null || memoryTotal !== null ? <DetailRow label="Memory" value={`${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`} /> : null}
          {loadAverage ? <DetailRow label="Load average" value={loadAverage} /> : null}
          {typeof status.droppedSamples === 'number' && status.droppedSamples > 0 ? <DetailRow label="Dropped samples" value={String(status.droppedSamples)} /> : null}
        </dl>
      </InspectorSection>

      {(registered || hasSavedStatus) ? (
        <>
          <AgentHeartbeatTimeline samples={telemetry.data?.samples ?? []} expected={status.connected} />
          {telemetry.isError ? (
            <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">
              {telemetry.error instanceof Error ? telemetry.error.message : 'Telemetry history could not be loaded.'}
            </div>
          ) : <AgentMetricsPanel samples={telemetry.data?.samples ?? []} />}
          <HardwareEvidence host={host} />
        </>
      ) : null}

      <InspectorSection title="Agent Setup" icon={Terminal}>
        {demoMode ? (
          <p className="text-sm font-semibold text-[#75695d]">Agent setup is disabled in public demo mode.</p>
        ) : !canManage ? (
          <p className="text-sm font-semibold text-[#75695d]">Agent telemetry is read-only for your account. An administrator can manage enrollment and saved telemetry.</p>
        ) : host.type !== 'server' ? (
          <p className="text-sm font-semibold text-[#75695d]">Compiled agent setup for this host type will become available with the embedded agent release.</p>
        ) : (
          <div className="grid gap-3">
            <label className={formLabelClass}>
              Agent endpoint
              <Input type="url" inputMode="url" value={endpoint} placeholder="http://192.168.1.10:8798" onChange={(event) => setEndpoint(event.target.value)} />
            </label>
            <Button type="button" variant="outline" className="justify-start gap-2" disabled={enrollmentMutation.isPending || endpoint.trim() === ''} onClick={() => enrollmentMutation.mutate()}>
              <Terminal data-icon="inline-start" />{enrollmentMutation.isPending ? 'Generating...' : 'Setup agent'}
            </Button>
            {enrollmentMutation.isError ? <p className="text-sm font-semibold text-[#7a2c1d]">{enrollmentMutation.error instanceof Error ? enrollmentMutation.error.message : 'Agent setup command could not be generated.'}</p> : null}
            {command ? (
              <div className="grid gap-2">
                <textarea readOnly value={command} className="min-h-28 resize-y rounded-md border border-[#d6ccbd] bg-[#20242c] p-2 font-mono text-xs leading-relaxed text-[#fffdf8]" aria-label="Agent install command" />
                <Button type="button" className="gap-2" onClick={() => void copyCommand()}><Copy data-icon="inline-start" />{copied ? 'Copied' : 'Copy command'}</Button>
              </div>
            ) : null}
            {registered || hasSavedStatus ? (
              <div className="grid gap-2 border-t border-[#e5dccf] pt-3">
                {registered ? <Button type="button" variant="outline" disabled={revokeMutation.isPending} onClick={() => setConfirmAction('revoke')}>{revokeMutation.isPending ? 'Revoking...' : 'Revoke Registration'}</Button> : null}
                {hasSavedStatus ? <Button type="button" variant="outline" disabled={registered || clearStatusMutation.isPending} onClick={() => setConfirmAction('clear')}>{clearStatusMutation.isPending ? 'Clearing...' : 'Clear Saved Telemetry'}</Button> : null}
              </div>
            ) : null}
          </div>
        )}
      </InspectorSection>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction === 'revoke' ? 'Revoke agent registration?' : 'Clear saved telemetry?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'revoke'
                ? `${host.name} will stop accepting signed telemetry from its current agent identity.`
                : `Saved runtime telemetry and detected hardware evidence for ${host.name} will be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmLifecycleAction}>{confirmAction === 'revoke' ? 'Revoke' : 'Clear telemetry'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
