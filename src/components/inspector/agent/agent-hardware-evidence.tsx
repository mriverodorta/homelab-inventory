import { useQuery } from '@tanstack/react-query'
import { Check, Copy, RefreshCw, ScanSearch } from 'lucide-react'
import { useMemo, useState } from 'react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { formatRelativeAge } from '@/components/inspector/shared/item-formatters'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { loadAgentHardwareSnapshot } from '@/lib/agent-api'
import type { InventoryItem } from '@/types/inventory'

const HARDWARE_REFRESH_INTERVAL_MS = 60_000
const INVENTORY_COMMAND = 'sudo homelab-inventory-agent inventory'

export function AgentHardwareEvidence({ host }: { host: InventoryItem }) {
  const query = useQuery({
    queryKey: ['agent-hardware-snapshot', host.type, host.id],
    queryFn: () => loadAgentHardwareSnapshot(host.type as 'server' | 'nas' | 'pcBuild', host.id),
    retry: 1,
    staleTime: HARDWARE_REFRESH_INTERVAL_MS,
    refetchInterval: HARDWARE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const snapshot = query.data?.snapshot ?? null
  const components = snapshot?.components ?? []
  const rawJson = useMemo(() => snapshot ? JSON.stringify(snapshot, null, 2) : '', [snapshot])
  const counts = Object.entries(components.reduce<Record<string, number>>((result, component) => {
    result[component.kind] = (result[component.kind] ?? 0) + 1
    return result
  }, {})).sort(([first], [second]) => first.localeCompare(second))

  async function copyText(value: string, setCopied: (copied: boolean) => void) {
    await navigator.clipboard.writeText(value)
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
      ) : (
        <div className="space-y-3">
          {components.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {counts.map(([kind, count]) => <span key={kind} className="rounded-md bg-[#f3f0ea] px-2 py-1 text-xs font-bold text-[#3c342b]">{kind} {count}</span>)}
              </div>
              <p className="text-xs font-medium leading-relaxed text-[#75695d]">
                Collected {formatRelativeAge(query.data?.ageMs ?? null)}. Private identifiers stay in this installation and are never sent to the public registry.
              </p>
              <p className="text-xs font-bold text-[#3c342b]">{query.data?.suggestions.length ?? 0} reviewable field suggestions</p>
            </>
          ) : (
            <p className="text-sm font-semibold leading-relaxed text-[#75695d]">Run one reviewed elevated scan on the host to detect board, CPU, memory, storage, PCI, network, and power hardware.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={() => void copyText(INVENTORY_COMMAND, setCopiedCommand)}>
              {copiedCommand ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copiedCommand ? 'Copied' : snapshot ? 'Copy again' : 'Copy scan command'}
            </Button>
            {snapshot ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline">View scan data</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[min(82vh,48rem)] sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Agent scan data</DialogTitle>
                    <DialogDescription>
                      Complete locally stored scan evidence. It may contain serial numbers, hardware fingerprints, and other private identifiers. Opening this viewer does not transmit the data.
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="h-[min(58vh,34rem)] rounded-md border border-[#d6ccbd] bg-[#17191d]">
                    <pre className="min-w-max p-4 font-mono text-xs leading-5 text-[#f5f1e8]">{rawJson}</pre>
                  </ScrollArea>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => void copyText(rawJson, setCopiedJson)}>
                      {copiedJson ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                      {copiedJson ? 'Copied' : 'Copy JSON'}
                    </Button>
                    <DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        </div>
      )}
    </InspectorSection>
  )
}
