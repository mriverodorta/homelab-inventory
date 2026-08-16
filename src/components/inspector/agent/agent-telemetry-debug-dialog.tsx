import { Braces, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { AgentTelemetryRange } from '@/types/agent'

export function AgentTelemetryDebugDialog({ latest }: { latest: AgentTelemetryRange['latest'] }) {
  const [copied, setCopied] = useState(false)
  const rawJson = useMemo(() => JSON.stringify(latest, null, 2), [latest])

  if (!latest) return null

  async function copyJson() {
    await navigator.clipboard.writeText(rawJson)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mt-3 w-full justify-start gap-2">
          <Braces data-icon="inline-start" />View latest telemetry
        </Button>
      </DialogTrigger>
      <DialogContent className="h-[min(82vh,48rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Latest agent telemetry</DialogTitle>
          <DialogDescription>
            Reconstructed from compact current-state records. This is not an original heartbeat payload.
          </DialogDescription>
        </DialogHeader>
        <pre className="min-h-0 overflow-auto rounded-md border border-[#d6ccbd] bg-[#20242c] p-3 font-mono text-xs leading-relaxed text-[#fffdf8]">
          {rawJson}
        </pre>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copyJson}>
            <Copy data-icon="inline-start" />{copied ? 'Copied' : 'Copy JSON'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
