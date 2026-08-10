import { useEffect, useMemo, useState } from 'react'
import { BellRing } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNotificationMutations, useNotificationSnapshot } from '@/hooks/use-notifications'
import { usePermission } from '@/hooks/use-permission'
import type { AgentHostStatus, AgentHostType } from '@/types/agent'
import type { NotificationHostOverride, NotificationResourceInput } from '@/types/notifications'

function containerKey(container: NonNullable<AgentHostStatus['containers']>[number]) {
  const runtime = container.runtime ?? 'docker'
  return container.composeService ? `${runtime}\u0000compose\u0000${container.composeService}` : `${runtime}\u0000name\u0000${container.name ?? container.runtimeId ?? 'unknown'}`
}

export function HostNotificationSettings({ hostType, hostId, status }: { hostType: AgentHostType; hostId: number; status: AgentHostStatus }) {
  const canView = usePermission('notifications.view')
  const canManage = usePermission('notifications.manage')
  const query = useNotificationSnapshot(canView)
  const mutations = useNotificationMutations()
  const config = query.data?.config
  const saved = config?.hostOverrides.find((candidate) => candidate.hostType === hostType && candidate.hostId === hostId)
  const [mode, setMode] = useState<NotificationHostOverride['mode']>(saved?.mode ?? 'inherit')
  const [mutedUntil, setMutedUntil] = useState<string | null>(saved?.mutedUntil ?? null)
  const available = useMemo<NotificationResourceInput[]>(() => [
    ...(status.services ?? []).filter((service) => service.name).map((service) => ({ family: 'service' as const, key: service.name!, name: service.name! })),
    ...(status.containers ?? []).map((container) => ({ family: 'container' as const, key: containerKey(container), name: container.composeService ?? container.name ?? container.runtimeId ?? 'Container' })),
    ...(status.storageHealth ?? []).flatMap((storage) => {
      const key = typeof storage.deviceId === 'string' ? storage.deviceId : null
      return key ? [{ family: 'storage-health' as const, key, name: typeof storage.name === 'string' ? storage.name : key }] : []
    }),
  ], [status.containers, status.services, status.storageHealth])
  const savedResources = useMemo(
    () => config?.monitoredResources.filter((resource) => resource.hostType === hostType && resource.hostId === hostId && resource.enabled) ?? [],
    [config, hostId, hostType],
  )
  const resourceOptions = useMemo(() => {
    const resources = new Map<string, NotificationResourceInput>()
    for (const resource of savedResources) resources.set(`${resource.family}:${resource.key}`, resource)
    for (const resource of available) resources.set(`${resource.family}:${resource.key}`, resource)
    return [...resources.values()]
  }, [available, savedResources])
  const [selectedKeys, setSelectedKeys] = useState<string[]>(savedResources.map((resource) => `${resource.family}:${resource.key}`))

  useEffect(() => {
    setMode(saved?.mode ?? 'inherit')
    setMutedUntil(saved?.mutedUntil ?? null)
    setSelectedKeys(savedResources.map((resource) => `${resource.family}:${resource.key}`))
  }, [saved?.mode, saved?.mutedUntil, savedResources])

  if (!canView || !query.data?.available) return null
  if (!config) return null
  const expectedRevision = config.revision
  const supportsMonitoringPolicy = status.capabilities?.['notifications.monitoring-policy']?.state === 'available'
  const appliedRevision = status.monitoringRevision ?? 0
  const policyStatus = !supportsMonitoringPolicy
    ? 'Agent update required for revisioned monitoring policy.'
    : appliedRevision >= expectedRevision
      ? `Monitoring policy revision ${appliedRevision} is active.`
      : `Monitoring policy revision ${expectedRevision} is pending agent acknowledgement (currently ${appliedRevision}).`
  const muteValue = mutedUntil && Date.parse(mutedUntil) > Date.now() ? 'muted' : 'none'
  function setMute(value: string) {
    if (value === 'none') setMutedUntil(null)
    else setMutedUntil(new Date(Date.now() + Number(value) * 3_600_000).toISOString())
  }
  function save() {
    mutations.updateHost.mutate({
      hostType,
      hostId,
      input: {
        expectedRevision,
        mode,
        mutedUntil,
        resources: resourceOptions
          .filter((resource) => selectedKeys.includes(`${resource.family}:${resource.key}`))
          .map(({ family, key, name }) => ({ family, key, name })),
        rules: saved?.rules ?? [],
      },
    })
  }
  return <InspectorSection title="Notifications" icon={BellRing} badge={!config.enabled ? <span className="text-[10px] font-black uppercase text-[#8a8175]">Global off</span> : undefined}>
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Host policy<Select value={mode} disabled={!canManage} onValueChange={(value) => setMode(value as NotificationHostOverride['mode'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Inherit workspace rules</SelectItem><SelectItem value="custom">Custom selected resources</SelectItem><SelectItem value="disabled">Disabled for this host</SelectItem></SelectContent></Select></label>
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Temporary mute<Select value={muteValue} disabled={!canManage || mode === 'disabled'} onValueChange={setMute}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not muted</SelectItem>{muteValue === 'muted' ? <SelectItem value="muted" disabled>Currently muted</SelectItem> : null}<SelectItem value="1">1 hour</SelectItem><SelectItem value="8">8 hours</SelectItem><SelectItem value="24">24 hours</SelectItem></SelectContent></Select>{mutedUntil && Date.parse(mutedUntil) > Date.now() ? <span className="font-normal text-[#756d62]">Muted until {new Date(mutedUntil).toLocaleString()}</span> : null}</label>
      {mode === 'custom' ? <fieldset className="grid gap-2"><legend className="text-xs font-bold text-[#5f554b]">Selected services, containers, and storage</legend>{resourceOptions.length === 0 ? <p className="text-xs leading-5 text-[#756d62]">No monitorable resources have been reported by this agent yet.</p> : <div className="grid max-h-52 gap-2 overflow-y-auto rounded-md border border-[#e5dccf] p-3">{resourceOptions.map((resource) => { const key = `${resource.family}:${resource.key}`; return <label key={key} className="flex items-center gap-2 text-sm font-semibold text-[#403a33]"><Checkbox disabled={!canManage} checked={selectedKeys.includes(key)} onCheckedChange={(checked) => setSelectedKeys((current) => checked === true ? [...new Set([...current, key])] : current.filter((candidate) => candidate !== key))} /><span className="min-w-0 truncate">{resource.name}</span><span className="ml-auto text-[10px] uppercase text-[#8a8175]">{resource.family}</span></label> })}</div>}</fieldset> : null}
      {config.enabled && mode !== 'disabled' ? <p className="rounded-md border border-[#e5dccf] bg-[#fbf8f3] px-3 py-2 text-xs font-semibold leading-5 text-[#756d62]">{policyStatus}</p> : null}
      {canManage ? <Button size="sm" variant="outline" disabled={mutations.updateHost.isPending} onClick={save}>{mutations.updateHost.isPending ? 'Saving…' : 'Save host policy'}</Button> : null}
      {mutations.updateHost.isError ? <p role="alert" className="text-xs font-semibold text-[#7a2c1d]">{mutations.updateHost.error.message}</p> : null}
    </div>
  </InspectorSection>
}
