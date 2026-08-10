import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import type { useNotificationMutations } from '@/hooks/use-notifications'
import type { NotificationConfig, NotificationQuietHours } from '@/types/notifications'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ScheduleEditor({ schedule, config, canManage, mutations }: { schedule: NotificationQuietHours; config: NotificationConfig; canManage: boolean; mutations: ReturnType<typeof useNotificationMutations> }) {
  const [value, setValue] = useState(schedule)
  return <div className="border-b border-[#e8e1d6] p-4 last:border-b-0">
    <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
      <label className="flex items-center gap-2 pb-2 text-sm font-bold"><Checkbox checked={value.enabled} disabled={!canManage} onCheckedChange={(checked) => setValue({ ...value, enabled: checked === true })} />Enabled</label>
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">Start<Input type="time" value={value.start} disabled={!canManage} onChange={(event) => setValue({ ...value, start: event.target.value })} /></label>
      <label className="grid gap-1.5 text-xs font-bold text-[#5f554b]">End<Input type="time" value={value.end} disabled={!canManage} onChange={(event) => setValue({ ...value, end: event.target.value })} /></label>
    </div>
    <label className="mt-3 grid gap-1.5 text-xs font-bold text-[#5f554b]">Time zone<Input value={value.timezone} disabled={!canManage} onChange={(event) => setValue({ ...value, timezone: event.target.value })} /></label>
    <div className="mt-3 flex flex-wrap gap-2">{DAYS.map((day, index) => <Button key={day} type="button" size="sm" variant={value.weekdays.includes(index) ? 'default' : 'outline'} disabled={!canManage} onClick={() => setValue({ ...value, weekdays: value.weekdays.includes(index) ? value.weekdays.filter((candidate) => candidate !== index) : [...value.weekdays, index].sort() })}>{day}</Button>)}</div>
    {canManage ? <div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="ghost" title="Delete quiet hours" onClick={() => mutations.deleteQuietHours.mutate({ id: schedule.id, expectedRevision: config.revision })}><Trash2 />Delete</Button><Button size="sm" variant="outline" onClick={() => mutations.updateQuietHours.mutate({ id: schedule.id, expectedRevision: config.revision, input: { enabled: value.enabled, timezone: value.timezone, start: value.start, end: value.end, weekdays: value.weekdays } })}>Save schedule</Button></div> : null}
  </div>
}

export function ScheduleTab({ config, canManage, mutations }: { config: NotificationConfig; canManage: boolean; mutations: ReturnType<typeof useNotificationMutations> }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e1d6] p-4"><div><p className="text-sm font-black text-[#20242c]">Quiet hours</p><p className="mt-1 text-xs leading-5 text-[#756d62]">Incidents are still recorded, but opening alerts and reminders are not sent during these windows.</p></div>{canManage ? <Button size="sm" onClick={() => mutations.createQuietHours.mutate({ expectedRevision: config.revision, input: { enabled: true, timezone, start: '22:00', end: '06:00', weekdays: [0, 1, 2, 3, 4, 5, 6] } })}><Plus />Add schedule</Button> : null}</div>
    {config.quietHours.length === 0 ? <p className="p-6 text-center text-sm font-semibold text-[#756d62]">No quiet-hours schedule is active.</p> : config.quietHours.map((schedule) => <ScheduleEditor key={`${schedule.id}:${config.revision}`} schedule={schedule} config={config} canManage={canManage} mutations={mutations} />)}
  </div>
}
