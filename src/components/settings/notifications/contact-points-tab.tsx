import { useState } from 'react'
import { BellRing, Pencil, Plus, Send } from 'lucide-react'
import { ContactPointDialog } from './contact-point-dialog'
import { ConfirmSettingsAction } from '@/components/settings/settings-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ContactPointInput } from '@/lib/notification-api'
import type { NotificationConfig, NotificationContactPoint } from '@/types/notifications'

export function ContactPointsTab({ config, canManage, mutations }: {
  config: NotificationConfig
  canManage: boolean
  mutations: ReturnType<typeof import('@/hooks/use-notifications').useNotificationMutations>
}) {
  const [editor, setEditor] = useState<{ key: number; point: NotificationContactPoint | null } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const error = mutations.createContact.error ?? mutations.updateContact.error

  function save(input: ContactPointInput) {
    setMessage(null)
    const options = { onSuccess: () => { setEditor(null); setMessage('Contact point saved.') } }
    if (editor?.point) mutations.updateContact.mutate({ id: editor.point.id, input }, options)
    else mutations.createContact.mutate(input, options)
  }

  return <div className="grid gap-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e1d6] p-4">
      <div><p className="text-sm font-black text-[#20242c]">Reusable destinations</p><p className="mt-1 text-xs leading-5 text-[#756d62]">Rules can deliver to one or more Ntfy servers or generic webhooks.</p></div>
      {canManage ? <Button size="sm" onClick={() => setEditor({ key: Date.now(), point: null })}><Plus />Add contact point</Button> : null}
    </div>
    {config.contactPoints.length === 0 ? <div className="grid min-h-44 place-items-center p-6 text-center"><div><BellRing className="mx-auto size-6 text-[#9a8f81]" /><p className="mt-3 text-sm font-black text-[#20242c]">No destinations configured</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#756d62]">Add a destination before enabling delivery rules.</p></div></div> : config.contactPoints.map((point) => <div key={point.id} className="grid gap-3 border-b border-[#e8e1d6] p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-black text-[#20242c]">{point.name}</p><Badge variant="outline">{point.type === 'ntfy' ? 'Ntfy' : 'Webhook'}</Badge>{!point.enabled ? <Badge variant="secondary">Disabled</Badge> : null}{point.hasSecret ? <Badge variant="secondary">Authenticated</Badge> : null}</div><p className="mt-1 truncate text-xs text-[#756d62]">{String(point.config.serverUrl ?? point.config.displayUrl ?? '')}{point.config.topic ? ` / ${String(point.config.topic)}` : ''}</p></div>
      {canManage ? <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" title="Send test notification" onClick={() => mutations.testContact.mutate(point.id, { onSuccess: () => setMessage(`Test delivered through ${point.name}.`) })}><Send /></Button>
        <Button size="icon-sm" variant="ghost" title="Edit contact point" onClick={() => setEditor({ key: Date.now(), point })}><Pencil /></Button>
        <ConfirmSettingsAction title={`Delete ${point.name}?`} description="The contact point must first be removed from every workspace and host rule. Saved credentials are permanently removed." actionLabel="Delete" destructive onConfirm={() => mutations.deleteContact.mutateAsync({ id: point.id, expectedRevision: config.revision })} />
      </div> : null}
    </div>)}
    {message ? <p role="status" className="border-t border-[#e8e1d6] bg-[#f7f2e9] px-4 py-3 text-xs font-semibold text-[#557264]">{message}</p> : null}
    {mutations.testContact.isError ? <p role="alert" className="border-t border-[#dfb3a5] bg-[#fff4ee] px-4 py-3 text-xs font-semibold text-[#7a2c1d]">{mutations.testContact.error.message}</p> : null}
    {editor ? <ContactPointDialog key={editor.key} open point={editor.point} expectedRevision={config.revision} pending={mutations.createContact.isPending || mutations.updateContact.isPending} error={error instanceof Error ? error.message : null} onOpenChange={(open) => { if (!open) setEditor(null) }} onSubmit={save} /> : null}
  </div>
}
