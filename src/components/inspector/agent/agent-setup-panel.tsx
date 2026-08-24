import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Copy, Download, ShieldCheck, Terminal } from 'lucide-react'
import { useState } from 'react'
import { AgentHardwareEvidence } from '@/components/inspector/agent/agent-hardware-evidence'
import { AgentHeartbeatTimeline } from '@/components/inspector/agent/agent-heartbeat-timeline'
import { AgentMetricsPanel } from '@/components/inspector/agent/agent-metrics-panel'
import { AgentStorageSummary } from '@/components/inspector/agent/agent-storage-summary'
import { AgentTelemetryDebugDialog } from '@/components/inspector/agent/agent-telemetry-debug-dialog'
import { HostNotificationSettings } from '@/components/inspector/agent/host-notification-settings'
import { agentMetrics, metricNumber } from '@/components/inspector/agent/agent-status-utils'
import { formatDuration, formatOperatingSystem } from '@/components/inspector/agent/agent-telemetry-formatters'
import { useAgentTelemetry } from '@/components/inspector/agent/use-agent-telemetry'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { usePermission } from '@/hooks/use-permission'
import {
  clearAgentStatus,
  createAgentEnrollment,
  revokeAgentRegistration,
} from '@/lib/agent-api'
import type { AgentCommandPlatform, AgentHostStatus, AgentState, AgentStatusSummary } from '@/types/agent'
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

export function AgentSetupPanel({
  server: host,
  status,
  registered,
  hasSavedStatus,
  demoMode,
  release,
}: {
  server: InventoryItem
  status: AgentHostStatus
  registered: boolean
  hasSavedStatus: boolean
  demoMode: boolean
  release: AgentStatusSummary['release']
}) {
  const canManage = usePermission('agents.manage')
  const queryClient = useQueryClient()
  const [endpoint, setEndpoint] = useState(() => window.location.origin)
  const [copied, setCopied] = useState(false)
  const [platform, setPlatform] = useState<AgentCommandPlatform>('linux')
  const [containersEnabled, setContainersEnabled] = useState(false)
  const [containerMode, setContainerMode] = useState<'proxy' | 'socket'>('proxy')
  const [containerRuntime, setContainerRuntime] = useState<'docker' | 'podman'>('docker')
  const [containerEndpoint, setContainerEndpoint] = useState('http://127.0.0.1:2375')
  const [confirmAction, setConfirmAction] = useState<'revoke' | 'clear' | null>(null)
  const [deleteTelemetry, setDeleteTelemetry] = useState(false)
  const enrollmentMutation = useMutation({
    mutationFn: () => createAgentEnrollment(
      host.type as 'server' | 'nas' | 'pcBuild',
      host.id,
      endpoint,
      {
        mode: containersEnabled ? containerMode : 'disabled',
        runtime: containerRuntime,
        endpoint: containersEnabled ? containerEndpoint : '',
      },
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const revokeMutation = useMutation({
    mutationFn: () => revokeAgentRegistration(host.type as 'server' | 'nas' | 'pcBuild', host.id, deleteTelemetry),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-telemetry', host.type, host.id] }),
        queryClient.invalidateQueries({ queryKey: ['agent-hardware-snapshot', host.type, host.id] }),
      ])
      setDeleteTelemetry(false)
    },
  })
  const clearStatusMutation = useMutation({
    mutationFn: () => clearAgentStatus(host.type as 'server' | 'nas' | 'pcBuild', host.id),
    onSuccess: (summary) => queryClient.setQueryData(['agent-status'], summary),
  })
  const telemetry = useAgentTelemetry({
    hostType: host.type as 'server' | 'nas' | 'pcBuild',
    hostId: host.id,
    enabled: registered || hasSavedStatus,
  })
  const liveStatus = telemetry.data?.status
    ? { ...status, ...telemetry.data.status, upgradeCommands: status.upgradeCommands }
    : status
  const command = enrollmentMutation.data?.installCommands?.[platform] ?? ''
  const metrics = agentMetrics(liveStatus)
  const cpuPercent = metricNumber(metrics.cpu, 'percent')
  const memoryUsed = metricNumber(metrics.memory, 'usedBytes')
  const memoryTotal = metricNumber(metrics.memory, 'totalBytes')
  const loadAverage = metrics.loadAverage?.slice(0, 3).map((value) => value.toFixed(2)).join(' / ')
  const system = metrics.system
  const operatingSystem = typeof system?.operatingSystem === 'string' ? system.operatingSystem : null
  const architecture = typeof system?.architecture === 'string' ? system.architecture : null
  const operatingSystemVersion = formatOperatingSystem(system)
  const uptime = formatDuration(metrics.uptimeSeconds)
  const commandPlatform = liveStatus.commandPlatform
    ?? (operatingSystem?.toLowerCase().includes('alpine')
      ? 'alpine'
      : operatingSystem?.toLowerCase().includes('freebsd') || operatingSystem?.toLowerCase().includes('opnsense')
        ? 'freebsd'
        : 'linux')
  const upgradeCommand = liveStatus.upgradeCommands?.[commandPlatform] ?? ''
  const updateAvailable = Boolean(registered && release?.version && upgradeCommand)

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
        badge={<span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${agentStateTone(liveStatus.state)}`}>{liveStatus.state}</span>}
      >
        <dl>
          <DetailRow label="Last seen" value={formatRelativeAge(liveStatus.ageMs)} />
          {liveStatus.hostname ? <DetailRow label="Hostname" value={liveStatus.hostname} /> : null}
          {liveStatus.agentVersion ? <DetailRow label="Agent version" value={liveStatus.agentVersion} /> : null}
          {operatingSystem || architecture ? <DetailRow label="Platform" value={[operatingSystem, architecture].filter(Boolean).join(' / ')} /> : null}
          {operatingSystemVersion ? <DetailRow label="OS version" value={operatingSystemVersion} /> : null}
          {uptime ? <DetailRow label="Uptime" value={uptime} /> : null}
          {cpuPercent !== null ? <DetailRow label="CPU" value={`${cpuPercent.toFixed(1)}%`} /> : null}
          {memoryUsed !== null || memoryTotal !== null ? <DetailRow label="Memory" value={`${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`} /> : null}
          {loadAverage ? <DetailRow label="Load average" value={loadAverage} /> : null}
          {typeof liveStatus.droppedSamples === 'number' && liveStatus.droppedSamples > 0 ? <DetailRow label="Dropped samples" value={String(liveStatus.droppedSamples)} /> : null}
        </dl>
        <AgentTelemetryDebugDialog latest={telemetry.data?.latest ?? null} />
      </InspectorSection>

      {(registered || hasSavedStatus) ? (
        <>
          <AgentHeartbeatTimeline
            buckets={telemetry.data?.heartbeatBuckets ?? []}
            expected={liveStatus.connected}
          />
          {telemetry.isError ? (
            <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">
              {telemetry.error instanceof Error ? telemetry.error.message : 'Telemetry history could not be loaded.'}
            </div>
          ) : <AgentMetricsPanel metricBuckets={telemetry.data?.metricBuckets ?? []} />}
          <AgentStorageSummary storage={telemetry.data?.storage} />
          <AgentHardwareEvidence host={host} commandPlatform={commandPlatform} />
          <HostNotificationSettings hostType={host.type as 'server' | 'nas' | 'pcBuild'} hostId={host.id} status={liveStatus} />
        </>
      ) : null}

      {!registered ? <InspectorSection title="Agent Setup" icon={Terminal}>
        {demoMode ? (
          <p className="text-sm font-semibold text-[#75695d]">Agent setup is disabled in public demo mode.</p>
        ) : !canManage ? (
          <p className="text-sm font-semibold text-[#75695d]">Agent telemetry is read-only for your account. An administrator can manage enrollment and saved telemetry.</p>
        ) : (
          <div className="grid gap-3">
            <label className={formLabelClass}>
              Host operating system
              <Select value={platform} onValueChange={(value) => setPlatform(value as AgentCommandPlatform)}>
                <SelectTrigger aria-label="Host operating system"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="linux">Linux</SelectItem>
                  <SelectItem value="alpine">Alpine Linux</SelectItem>
                  <SelectItem value="freebsd">FreeBSD / OPNsense</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className={formLabelClass}>
              Agent endpoint
              <Input type="url" inputMode="url" value={endpoint} placeholder="http://192.168.1.10:8798" onChange={(event) => setEndpoint(event.target.value)} />
            </label>
            <div className="flex items-center justify-between gap-3 rounded-md border border-[#d6ccbd] bg-[#fffdf8] p-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#20242c]">Container telemetry</p>
                <p className="text-xs font-medium leading-relaxed text-[#75695d]">Opt in to sanitized Docker or Podman metrics.</p>
              </div>
              <Switch checked={containersEnabled} onCheckedChange={setContainersEnabled} aria-label="Enable container telemetry" />
            </div>
            {containersEnabled ? (
              <div className="grid gap-3 border-l-2 border-[#d6ccbd] pl-3">
                <label className={formLabelClass}>
                  Access mode
                  <Select value={containerMode} onValueChange={(value) => {
                    const next = value as 'proxy' | 'socket'
                    setContainerMode(next)
                    setContainerEndpoint(next === 'proxy' ? 'http://127.0.0.1:2375' : containerRuntime === 'docker' ? '/var/run/docker.sock' : '/run/podman/podman.sock')
                  }}>
                    <SelectTrigger aria-label="Container access mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="proxy">Read-only socket proxy</SelectItem>
                      <SelectItem value="socket">Direct local socket</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className={formLabelClass}>
                  Runtime
                  <Select value={containerRuntime} onValueChange={(value) => {
                    const next = value as 'docker' | 'podman'
                    setContainerRuntime(next)
                    if (containerMode === 'socket') setContainerEndpoint(next === 'docker' ? '/var/run/docker.sock' : '/run/podman/podman.sock')
                  }}>
                    <SelectTrigger aria-label="Container runtime"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="docker">Docker</SelectItem><SelectItem value="podman">Podman</SelectItem></SelectContent>
                  </Select>
                </label>
                <label className={formLabelClass}>
                  {containerMode === 'proxy' ? 'Loopback proxy URL' : 'Runtime socket'}
                  <Input value={containerEndpoint} onChange={(event) => setContainerEndpoint(event.target.value)} />
                </label>
                {containerMode === 'socket' ? (
                  <div className="flex gap-2 rounded-md border border-[#e3c886] bg-[#fff8df] p-3 text-xs font-semibold leading-relaxed text-[#5f4514]">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />Direct socket access grants the agent the permissions exposed by that runtime socket. The service remains non-root, but may require explicit group access.
                  </div>
                ) : null}
              </div>
            ) : null}
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
            {hasSavedStatus ? (
              <div className="grid gap-2 border-t border-[#e5dccf] pt-3">
                <Button type="button" variant="outline" disabled={clearStatusMutation.isPending} onClick={() => setConfirmAction('clear')}>{clearStatusMutation.isPending ? 'Clearing...' : 'Clear Saved Telemetry'}</Button>
              </div>
            ) : null}
          </div>
        )}
      </InspectorSection> : null}

      {updateAvailable && upgradeCommand ? (
        <InspectorSection title="Agent Update" icon={Download} badge={<span className="text-xs font-bold text-[#a05b26]">{release?.version}</span>}>
          <p className="text-sm font-semibold leading-relaxed text-[#75695d]">This host reports agent {liveStatus.agentVersion}. Upgrades are manual so the host never replaces its own executable without an administrator action.</p>
          <textarea readOnly value={upgradeCommand} className="mt-3 min-h-24 w-full resize-y rounded-md border border-[#d6ccbd] bg-[#20242c] p-2 font-mono text-xs leading-relaxed text-[#fffdf8]" aria-label="Agent upgrade command" />
          <Button type="button" variant="outline" className="mt-2 gap-2" onClick={() => void navigator.clipboard.writeText(upgradeCommand)}><Copy data-icon="inline-start" />Copy upgrade command</Button>
        </InspectorSection>
      ) : null}

      {registered && !demoMode ? (
        <InspectorSection title="Agent Management" icon={Terminal}>
          {!canManage ? (
            <p className="text-sm font-semibold text-[#75695d]">Only an administrator can unlink this agent.</p>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm font-semibold leading-relaxed text-[#75695d]">Unlinking revokes this host's current agent identity. Saved telemetry is retained unless you explicitly delete it.</p>
              <Button
                type="button"
                variant="destructive"
                disabled={revokeMutation.isPending}
                onClick={() => {
                  setDeleteTelemetry(false)
                  setConfirmAction('revoke')
                }}
              >
                {revokeMutation.isPending ? 'Unlinking...' : 'Unlink agent'}
              </Button>
              {revokeMutation.isError ? <p className="text-sm font-semibold text-[#7a2c1d]">{revokeMutation.error instanceof Error ? revokeMutation.error.message : 'The agent could not be unlinked.'}</p> : null}
            </div>
          )}
        </InspectorSection>
      ) : null}

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => {
        if (!open) {
          setConfirmAction(null)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction === 'revoke' ? 'Unlink agent?' : 'Clear saved telemetry?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'revoke'
                ? `${host.name} will stop accepting telemetry from its current agent identity. The installed agent will become dormant and stop retrying.`
                : `Saved runtime telemetry and detected hardware evidence for ${host.name} will be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmAction === 'revoke' ? (
            <label className="flex items-start gap-3 rounded-md border border-[#d6ccbd] bg-[#fffdf8] p-3 text-sm font-semibold leading-relaxed text-[#3c342b]">
              <Checkbox
                className="mt-0.5"
                checked={deleteTelemetry}
                onCheckedChange={(checked) => setDeleteTelemetry(checked === true)}
              />
              <span>
                Delete all telemetry history for this host
                <span className="mt-1 block text-xs font-medium text-[#75695d]">This permanently removes saved samples, service and container state, storage events, and detected hardware evidence for this host only.</span>
              </span>
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmLifecycleAction}>{confirmAction === 'revoke' ? 'Unlink agent' : 'Clear telemetry'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
