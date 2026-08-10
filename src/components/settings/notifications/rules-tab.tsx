import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { useNotificationMutations } from '@/hooks/use-notifications'
import type { NotificationConfig, NotificationRule, NotificationSeverity } from '@/types/notifications'

const EVENT_LABELS: Record<NotificationRule['eventType'], { title: string; description: string }> = {
  'host.offline': { title: 'Host offline', description: 'The agent has not reported for five minutes and the debounce period has elapsed.' },
  'service.unhealthy': { title: 'Service unhealthy', description: 'A selected service is inactive or reports a failed result twice, at least one minute apart.' },
  'container.unhealthy': { title: 'Container unhealthy', description: 'A selected container is stopped or reports an unhealthy runtime state.' },
  'container.missing': { title: 'Container missing', description: 'A selected container is no longer present in the agent payload.' },
  'storage.warning': { title: 'Storage warning', description: 'A selected physical storage device reports a warning health state.' },
  'storage.failed': { title: 'Storage failed', description: 'A selected physical storage device reports a failed health state.' },
}

function RuleEditor({ rule, config, canManage, save, pending }: {
  rule: NotificationRule
  config: NotificationConfig
  canManage: boolean
  save(input: Partial<NotificationRule>): void
  pending: boolean
}) {
  const [enabled, setEnabled] = useState(rule.enabled)
  const [severity, setSeverity] = useState(rule.severity)
  const [contactPointIds, setContactPointIds] = useState(rule.contactPointIds)
  const [debounceSeconds, setDebounceSeconds] = useState(rule.debounceSeconds)
  const [cooldownSeconds, setCooldownSeconds] = useState(rule.cooldownSeconds)
  const [reminder, setReminder] = useState(rule.reminderIntervalSeconds?.toString() ?? 'off')
  const label = EVENT_LABELS[rule.eventType]

  return <div className="border-b border-[#e8e1d6] p-4 last:border-b-0">
    <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black text-[#20242c]">{label.title}</p><p className="mt-1 max-w-2xl text-xs leading-5 text-[#756d62]">{label.description}</p></div><Checkbox checked={enabled} disabled={!canManage} onCheckedChange={(checked) => setEnabled(checked === true)} aria-label={`Enable ${label.title}`} /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Severity<Select value={severity} disabled={!canManage} onValueChange={(value) => setSeverity(value as NotificationSeverity)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></label>
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Debounce (seconds)<Input type="number" min={0} value={debounceSeconds} disabled={!canManage} onChange={(event) => setDebounceSeconds(Math.max(0, Number(event.target.value) || 0))} /></label>
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Cooldown (seconds)<Input type="number" min={0} value={cooldownSeconds} disabled={!canManage} onChange={(event) => setCooldownSeconds(Math.max(0, Number(event.target.value) || 0))} /></label>
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Reminder<Select value={reminder} disabled={!canManage} onValueChange={setReminder}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="off">Off</SelectItem><SelectItem value="3600">Every hour</SelectItem><SelectItem value="21600">Every 6 hours</SelectItem><SelectItem value="86400">Every day</SelectItem></SelectContent></Select></label>
      <fieldset className="grid gap-2 sm:col-span-2"><legend className="text-xs font-bold text-[#5f554b]">Deliver to</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{config.contactPoints.filter((point) => point.enabled).map((point) => <label key={point.id} className="flex items-center gap-2 text-sm font-semibold text-[#403a33]"><Checkbox disabled={!canManage} checked={contactPointIds.includes(point.id)} onCheckedChange={(checked) => setContactPointIds((current) => checked === true ? [...new Set([...current, point.id])] : current.filter((id) => id !== point.id))} />{point.name}</label>)}{config.contactPoints.length === 0 ? <span className="text-xs text-[#8a8175]">Add a contact point first.</span> : null}</div></fieldset>
    </div>
    {canManage ? <div className="mt-4 flex justify-end"><Button size="sm" variant="outline" disabled={pending} onClick={() => save({ enabled, severity, contactPointIds, debounceSeconds, cooldownSeconds, reminderIntervalSeconds: reminder === 'off' ? null : Number(reminder) })}>{pending ? 'Saving…' : 'Save rule'}</Button></div> : null}
  </div>
}

export function RulesTab({ config, canManage, mutations }: { config: NotificationConfig; canManage: boolean; mutations: ReturnType<typeof useNotificationMutations> }) {
  return <div>{config.rules.map((rule) => <RuleEditor key={`${rule.id}:${config.revision}`} rule={rule} config={config} canManage={canManage} pending={mutations.updateRule.isPending} save={(input) => mutations.updateRule.mutate({ id: rule.id, expectedRevision: config.revision, input })} />)}{mutations.updateRule.isError ? <p role="alert" className="border-t border-[#dfb3a5] bg-[#fff4ee] px-4 py-3 text-xs font-semibold text-[#7a2c1d]">{mutations.updateRule.error.message}</p> : null}</div>
}
