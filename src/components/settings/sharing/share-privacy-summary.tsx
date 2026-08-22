import { Check, EyeOff, FileJson2, Link2, Tags } from 'lucide-react'
import type { ShareConfiguration, SharePreview } from '@/lib/sharing-api'

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-0.5 border-r border-[#e8e1d6] px-3 last:border-r-0">
      <span className="text-lg font-black tabular-nums text-[#20242c]">{value.toLocaleString()}</span>
      <span className="text-[11px] font-semibold text-[#756d62]">{label}</span>
    </div>
  )
}

export function SharePrivacySummary({ preview, configuration }: { preview: SharePreview; configuration: ShareConfiguration }) {
  return (
    <section className="grid gap-4" aria-labelledby="sharing-privacy-heading">
      <div className="grid gap-1">
        <h3 id="sharing-privacy-heading" className="text-base font-black text-[#20242c]">Exact privacy preview</h3>
        <p className="text-xs leading-5 text-[#756d62]">This hash identifies the exact manifest and view data that publication will send.</p>
      </div>
      <div className="grid grid-cols-2 border-y border-[#e8e1d6] py-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryValue label="Views" value={preview.summary.views} />
        <SummaryValue label="Items" value={preview.summary.items} />
        <SummaryValue label="Connections" value={preview.summary.connections} />
        <SummaryValue label="Registry refs" value={preview.summary.registryReferences} />
        <SummaryValue label="Tags" value={preview.summary.tags} />
        <SummaryValue label="Custom fields" value={preview.summary.customFields} />
      </div>
      <div className="grid gap-2 text-xs leading-5 text-[#554b40] sm:grid-cols-2">
        <p className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#2f7658]" />Only the selected Systems and Canvas views are included.</p>
        <p className="flex items-start gap-2"><Link2 className="mt-0.5 size-4 shrink-0 text-[#2f7658]" />{preview.summary.registryReferences} linked item{preview.summary.registryReferences === 1 ? '' : 's'} use exact Registry references.</p>
        <p className="flex items-start gap-2"><Tags className="mt-0.5 size-4 shrink-0 text-[#2f7658]" />Tags and custom fields are limited to the explicit selections below.</p>
        <p className="flex items-start gap-2"><EyeOff className="mt-0.5 size-4 shrink-0 text-[#2f7658]" />Serials, addresses, credentials, agents, audit history, and telemetry history are excluded.</p>
      </div>
      <div className="grid gap-2 rounded-md bg-[#f5f1ea] p-3 text-xs text-[#554b40] sm:grid-cols-[auto_minmax(0,1fr)]">
        <FileJson2 className="size-4" />
        <div className="min-w-0">
          <p className="break-all font-mono">sha256:{preview.manifestHash}</p>
          <p className="mt-1">{preview.byteLength.toLocaleString()} bytes · {configuration.share.resourceSnapshotIncluded ? 'One-time resource snapshot included' : 'No resource snapshot'}</p>
        </div>
      </div>
    </section>
  )
}
