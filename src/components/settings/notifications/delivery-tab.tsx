import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { useNotificationMutations } from '@/hooks/use-notifications'
import type { NotificationConfig } from '@/types/notifications'

export function DeliveryTab({ config, exhausted, canManage, mutations }: { config: NotificationConfig; exhausted: number; canManage: boolean; mutations: ReturnType<typeof useNotificationMutations> }) {
  const [incidentDays, setIncidentDays] = useState(config.retention.incidentDays)
  const [attemptDays, setAttemptDays] = useState(config.retention.deliveryAttemptDays)
  return <div>
    <div className="grid gap-3 border-b border-[#e8e1d6] p-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-bold text-[#20242c]">Incident retention (days)<Input type="number" min={1} value={incidentDays} disabled={!canManage} onChange={(event) => setIncidentDays(Math.max(1, Number(event.target.value) || 1))} /><span className="text-xs font-normal leading-5 text-[#756d62]">Resolved and cancelled incidents are removed after this period. Open incidents are always preserved.</span></label>
      <label className="grid gap-1.5 text-sm font-bold text-[#20242c]">Delivery-attempt retention (days)<Input type="number" min={1} value={attemptDays} disabled={!canManage} onChange={(event) => setAttemptDays(Math.max(1, Number(event.target.value) || 1))} /><span className="text-xs font-normal leading-5 text-[#756d62]">HTTP status and redacted failure history are retained for troubleshooting.</span></label>
      {canManage ? <div className="sm:col-span-2 flex justify-end"><Button size="sm" variant="outline" disabled={mutations.settings.isPending} onClick={() => mutations.settings.mutate({ expectedRevision: config.revision, retention: { incidentDays, deliveryAttemptDays: attemptDays } })}>Save retention</Button></div> : null}
    </div>
    <div className="grid gap-1 p-4"><p className="text-sm font-black text-[#20242c]">Retry policy</p><p className="text-xs leading-5 text-[#756d62]">Failed deliveries retry after 30 seconds, 2 minutes, 10 minutes, 30 minutes, and 2 hours. Retries stop after six total attempts.</p><p className={`mt-2 text-sm font-bold ${exhausted > 0 ? 'text-[#9b3f32]' : 'text-[#557264]'}`}>{exhausted > 0 ? `${exhausted} exhausted ${exhausted === 1 ? 'delivery needs' : 'deliveries need'} attention in the Notification Center.` : 'No exhausted deliveries.'}</p></div>
  </div>
}
