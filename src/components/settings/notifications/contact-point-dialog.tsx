import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ContactPointInput } from '@/lib/notification-api'
import type { NotificationContactPoint } from '@/types/notifications'

const fieldClass = 'grid gap-1.5 text-sm font-bold text-[#20242c]'

function configString(point: NotificationContactPoint | null, key: string, fallback = '') {
  const value = point?.config[key]
  return typeof value === 'string' ? value : fallback
}

export function ContactPointDialog({
  open,
  point,
  expectedRevision,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  point: NotificationContactPoint | null
  expectedRevision: number
  pending: boolean
  error: string | null
  onOpenChange(open: boolean): void
  onSubmit(input: ContactPointInput): void
}) {
  const [type, setType] = useState<'ntfy' | 'webhook'>(point?.type ?? 'ntfy')
  const [name, setName] = useState(point?.name ?? '')
  const [enabled, setEnabled] = useState(point?.enabled ?? true)
  const [destination, setDestination] = useState(point?.type === 'webhook' ? '' : configString(point, 'serverUrl', 'https://ntfy.sh'))
  const [topic, setTopic] = useState(configString(point, 'topic'))
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [hmacSecret, setHmacSecret] = useState('')
  const [removeCredentials, setRemoveCredentials] = useState(false)

  function submit() {
    const credentials = removeCredentials
      ? null
      : type === 'ntfy'
        ? token || username || password ? { token, username, password } : undefined
        : token || username || password || hmacSecret
          ? { bearerToken: token, basicUsername: username, basicPassword: password, hmacSecret }
          : undefined
    onSubmit({
      expectedRevision,
      type,
      name: name.trim(),
      enabled,
      config: type === 'ntfy'
        ? { serverUrl: destination.trim(), topic: topic.trim(), priorityMap: { info: 'default', warning: 'high', critical: 'max' } }
        : destination.trim() ? { url: destination.trim() } : {},
      credentials,
    })
  }

  const valid = name.trim() !== '' && (Boolean(point) || destination.trim() !== '') && (type === 'webhook' || topic.trim() !== '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{point ? 'Edit contact point' : 'Add contact point'}</DialogTitle>
          <DialogDescription>Credentials are encrypted with this installation's local notification key and never returned to the browser.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <label className={fieldClass}>Type<Select value={type} disabled={Boolean(point)} onValueChange={(value) => setType(value as typeof type)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ntfy">Ntfy</SelectItem><SelectItem value="webhook">Generic webhook</SelectItem></SelectContent></Select></label>
          <label className={fieldClass}>Name<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Primary alerts" /></label>
          <label className={`${fieldClass} sm:col-span-2`}>{type === 'ntfy' ? 'Ntfy server URL' : 'Webhook URL'}<Input type="url" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder={type === 'ntfy' ? 'https://ntfy.example.com' : point ? 'Leave blank to keep the encrypted URL' : 'https://hooks.example.com/inventory'} /></label>
          {type === 'ntfy' ? <label className={`${fieldClass} sm:col-span-2`}>Topic<Input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="homelab-alerts" /></label> : null}
          <div className="sm:col-span-2 border-t border-[#e8e1d6] pt-4">
            <div className="mb-3 flex items-center gap-2"><KeyRound className="size-4 text-[#756d62]" /><p className="text-sm font-black text-[#20242c]">Optional authentication</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>{type === 'ntfy' ? 'Access token' : 'Bearer token'}<Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={point?.hasSecret ? 'Leave blank to keep saved value' : 'Optional'} /></label>
              {type === 'webhook' ? <label className={fieldClass}>HMAC secret<Input type="password" value={hmacSecret} onChange={(event) => setHmacSecret(event.target.value)} placeholder={point?.hasSecret ? 'Leave blank to keep saved value' : 'Optional'} /></label> : <span />}
              <label className={fieldClass}>Basic username<Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Optional" /></label>
              <label className={fieldClass}>Basic password<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Optional" /></label>
            </div>
            {point?.hasSecret ? <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#5f554b]"><Checkbox checked={removeCredentials} onCheckedChange={(checked) => setRemoveCredentials(checked === true)} />Remove saved credentials</label> : null}
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-[#20242c] sm:col-span-2"><Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />Contact point enabled</label>
        </div>
        {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || pending}>{pending ? 'Saving…' : 'Save contact point'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
