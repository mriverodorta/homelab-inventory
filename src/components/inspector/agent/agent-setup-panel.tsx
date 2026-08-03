import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Terminal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { formatBytes, formatRelativeAge } from '@/components/inspector/shared/item-formatters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePermission } from '@/hooks/use-permission'
import {
  clearAgentStatus,
  createAgentEnrollment,
  revokeAgentRegistration,
} from '@/lib/agent-api'
import type { AgentServerStatus, AgentState } from '@/types/agent'
import type { InventoryItem } from '@/types/inventory'

const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

function agentStateTone(state: AgentState): string {
  if (state === 'online') {
    return 'bg-[#d3eee7] text-[#143733]'
  }

  if (state === 'stale') {
    return 'bg-[#fff2c7] text-[#3d2a08]'
  }

  if (state === 'offline') {
    return 'bg-[#fff4ee] text-[#7a2c1d]'
  }

  if (state === 'unknown') {
    return 'bg-[#d7eef2] text-[#102f36]'
  }

  return 'bg-[#f3f0ea] text-[#75695d]'
}

function getAgentString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key]

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatAgentPort(port: Record<string, unknown>): { primary: string; secondary: string } {
  const protocol = getAgentString(port, 'protocol')?.toUpperCase() ?? 'PORT'
  const address = getAgentString(port, 'address') ?? '0.0.0.0'
  const rawPort = port.port
  const portValue = typeof rawPort === 'number' || typeof rawPort === 'string' ? rawPort : '?'
  const process = getAgentString(port, 'process') ?? ''

  return {
    primary: `${protocol} ${address}:${portValue}`,
    secondary: process.replace(/\s+/g, ' '),
  }
}

function AgentTelemetryLine({
  primary,
  secondary,
}: {
  primary: string
  secondary?: string | null
}) {
  return (
    <div className="min-w-0 rounded-md bg-[#f7f2eb] px-2 py-1.5">
      <div className="truncate text-xs font-black text-[#20242c]">{primary}</div>
      {secondary ? (
        <div className="truncate text-[11px] font-semibold text-[#75695d]">{secondary}</div>
      ) : null}
    </div>
  )
}

function AgentTelemetrySection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]">
          {title}
        </div>
        {typeof count === 'number' ? (
          <span className="rounded bg-[#f3f0ea] px-1.5 py-0.5 text-[10px] font-black text-[#75695d]">
            {count}
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5">{children}</div>
    </div>
  )
}

export function AgentSetupPanel({
  server,
  status,
  registered,
  hasSavedStatus,
  demoMode,
}: {
  server: InventoryItem
  status: AgentServerStatus
  registered: boolean
  hasSavedStatus: boolean
  demoMode: boolean
}) {
  const canManage = usePermission('agents.manage')
  const queryClient = useQueryClient()
  const [endpoint, setEndpoint] = useState(() => window.location.origin)
  const [copied, setCopied] = useState(false)
  const enrollmentMutation = useMutation({
    mutationFn: () => createAgentEnrollment(server.id, endpoint),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const revokeMutation = useMutation({
    mutationFn: () => revokeAgentRegistration(server.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const clearStatusMutation = useMutation({
    mutationFn: () => clearAgentStatus(server.id),
    onSuccess: (summary) => queryClient.setQueryData(['agent-status'], summary),
  })
  const command = enrollmentMutation.data?.installCommand ?? ''
  const firstDisk = status.disks?.[0]
  const ips = status.network?.flatMap((network) => network.addresses ?? []) ?? []
  const cpuModel = typeof status.cpu?.model === 'string' ? status.cpu.model : null
  const memoryUsed = status.memory?.usedBytes
  const memoryTotal = status.memory?.totalBytes
  const diskUsed = firstDisk?.usedBytes
  const diskTotal = firstDisk?.sizeBytes
  const containers = status.containers ?? []
  const services = status.services ?? []
  const listeningPorts = status.listeningPorts ?? []
  const kubernetesRole = getAgentString(status.kubernetes, 'role')
  const kubernetesVersion = getAgentString(status.kubernetes, 'version')
  const loadAverage = status.loadAverage?.slice(0, 3).map((value) => value.toFixed(2)).join(' / ')

  async function copyCommand() {
    if (!command) {
      return
    }

    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <InspectorSection
      title="Agent"
      icon={Terminal}
      badge={<span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${agentStateTone(status.state)}`}>{status.state}</span>}
    >
      <div className="rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[#75695d]">Last Seen</dt>
            <dd className="font-semibold text-[#20242c]">{formatRelativeAge(status.ageMs)}</dd>
          </div>
          {status.hostname ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">Hostname</dt>
              <dd className="truncate font-semibold text-[#20242c]">{status.hostname}</dd>
            </div>
          ) : null}
          {ips.length > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">IPs</dt>
              <dd className="truncate text-right font-semibold text-[#20242c]">{ips.join(', ')}</dd>
            </div>
          ) : null}
          {cpuModel ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">CPU</dt>
              <dd className="truncate text-right font-semibold text-[#20242c]">{cpuModel}</dd>
            </div>
          ) : null}
          {typeof memoryUsed === 'number' || typeof memoryTotal === 'number' ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">RAM</dt>
              <dd className="font-semibold text-[#20242c]">
                {formatBytes(memoryUsed)} / {formatBytes(memoryTotal)}
              </dd>
            </div>
          ) : null}
          {typeof diskUsed === 'number' || typeof diskTotal === 'number' ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">Disk</dt>
              <dd className="font-semibold text-[#20242c]">
                {formatBytes(diskUsed)} / {formatBytes(diskTotal)}
              </dd>
            </div>
          ) : null}
          {loadAverage ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">Load Avg</dt>
              <dd className="font-semibold text-[#20242c]">{loadAverage}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {containers.length > 0 || listeningPorts.length > 0 || services.length > 0 || kubernetesRole ? (
        <div className="mt-3 grid gap-2">
          {containers.length > 0 ? (
            <AgentTelemetrySection title="Containers" count={containers.length}>
              {containers.slice(0, 5).map((container, index) => (
                <AgentTelemetryLine
                  key={`${getAgentString(container, 'id') ?? index}`}
                  primary={getAgentString(container, 'name') ?? getAgentString(container, 'image') ?? 'Container'}
                  secondary={[
                    getAgentString(container, 'image'),
                    getAgentString(container, 'status'),
                    getAgentString(container, 'ports'),
                  ].filter(Boolean).join(' / ')}
                />
              ))}
            </AgentTelemetrySection>
          ) : null}

          {kubernetesRole ? (
            <AgentTelemetrySection title="K3s">
              <AgentTelemetryLine
                primary={kubernetesRole === 'control-plane' ? 'Control plane' : 'Worker'}
                secondary={kubernetesVersion}
              />
            </AgentTelemetrySection>
          ) : null}

          {listeningPorts.length > 0 ? (
            <AgentTelemetrySection title="LAN Listening Ports" count={listeningPorts.length}>
              {listeningPorts.slice(0, 6).map((port, index) => {
                const formatted = formatAgentPort(port)

                return (
                  <AgentTelemetryLine
                    key={`${formatted.primary}-${index}`}
                    primary={formatted.primary}
                    secondary={formatted.secondary}
                  />
                )
              })}
            </AgentTelemetrySection>
          ) : null}

          {services.length > 0 ? (
            <AgentTelemetrySection title="Running Services" count={services.length}>
              {services.slice(0, 6).map((service, index) => (
                <AgentTelemetryLine
                  key={`${getAgentString(service, 'unit') ?? index}`}
                  primary={getAgentString(service, 'unit') ?? 'service'}
                  secondary={getAgentString(service, 'description')}
                />
              ))}
            </AgentTelemetrySection>
          ) : null}
        </div>
      ) : null}

      {demoMode ? (
        <div className="mt-3 rounded-md border border-[#dfc483] bg-[#fff8df] p-3 text-sm font-semibold text-[#5d4814]">
          Agent setup is disabled in public demo mode.
        </div>
      ) : !canManage ? (
        <div className="mt-3 rounded-md border border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-semibold text-[#75695d]">
          Agent telemetry is read-only for your account. An administrator can manage enrollment and saved telemetry.
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          <label className={formLabelClass}>
            Agent endpoint
            <Input
              type="url"
              inputMode="url"
              value={endpoint}
              placeholder="http://192.168.1.10:8798"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            className="justify-start gap-2"
            disabled={enrollmentMutation.isPending || endpoint.trim() === ''}
            onClick={() => enrollmentMutation.mutate()}
          >
            <Terminal data-icon="inline-start" />
            {enrollmentMutation.isPending ? 'Generating...' : 'Setup Agent'}
          </Button>
          {enrollmentMutation.isError ? (
            <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-2 text-xs font-semibold text-[#7a2c1d]">
              {enrollmentMutation.error instanceof Error
                ? enrollmentMutation.error.message
                : 'Agent setup command could not be generated.'}
            </div>
          ) : null}
          {command ? (
            <div className="grid gap-2">
              <textarea
                readOnly
                value={command}
                className="min-h-28 resize-y rounded-md border border-[#d6ccbd] bg-[#20242c] p-2 font-mono text-xs leading-relaxed text-[#fffdf8]"
                aria-label="Agent install command"
              />
              <Button type="button" className="gap-2" onClick={() => void copyCommand()}>
                <Copy data-icon="inline-start" />
                {copied ? 'Copied' : 'Copy Command'}
              </Button>
            </div>
          ) : null}
          {registered || hasSavedStatus ? (
            <div className="mt-2 grid gap-2 border-t border-[#e5dccf] pt-3">
              <div className="text-xs font-semibold leading-relaxed text-[#75695d]">
                Revoke the registration before clearing saved telemetry. These actions also remove agent blockers reported by inventory archive checks.
              </div>
              {registered ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={revokeMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Revoke the agent registration for ${server.name}?`)) {
                      revokeMutation.mutate()
                    }
                  }}
                >
                  {revokeMutation.isPending ? 'Revoking...' : 'Revoke Registration'}
                </Button>
              ) : null}
              {hasSavedStatus ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={registered || clearStatusMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Clear saved agent telemetry for ${server.name}?`)) {
                      clearStatusMutation.mutate()
                    }
                  }}
                >
                  {clearStatusMutation.isPending ? 'Clearing...' : 'Clear Saved Telemetry'}
                </Button>
              ) : null}
              {revokeMutation.isError || clearStatusMutation.isError ? (
                <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-2 text-xs font-semibold text-[#7a2c1d]">
                  {(revokeMutation.error ?? clearStatusMutation.error) instanceof Error
                    ? (revokeMutation.error ?? clearStatusMutation.error)?.message
                    : 'Agent cleanup could not be completed.'}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </InspectorSection>
  )
}
