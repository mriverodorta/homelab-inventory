import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ReleaseNoteEntry } from '@/release-notes'

type WhatsNewDialogProps = {
  open: boolean
  currentVersion: string
  entries: ReleaseNoteEntry[]
  acknowledging: boolean
  onAcknowledge: () => void
  onOpenChange: (open: boolean) => void
}

function ReleaseList({ title, items }: { title: string; items: string[] | undefined }) {
  if (!items?.length) {
    return null
  }

  return (
    <section className="grid gap-2">
      <h4 className="text-xs font-black uppercase tracking-[0.18em] text-[#756d62]">{title}</h4>
      <ul className="grid gap-2 text-sm font-semibold leading-6 text-[#2a2e36]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#cf7a2f]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function WhatsNewDialog({
  open,
  currentVersion,
  entries,
  acknowledging,
  onAcknowledge,
  onOpenChange,
}: WhatsNewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden bg-[#fffdf8] p-0 text-[#20242c] sm:max-w-2xl">
        <DialogHeader className="border-b border-[#ded8ce] px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#1f2430] text-[#fff7e8]">
              <Sparkles />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-2xl font-black">What's new in Homelab Inventory</DialogTitle>
              <DialogDescription className="mt-1 text-sm font-semibold text-[#756d62]">
                Updates included through version {currentVersion}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid max-h-[min(66dvh,680px)] gap-4 overflow-y-auto px-5 py-5">
          {entries.map((entry) => (
            <article key={entry.version} className="grid gap-4 rounded-xl border border-[#ded8ce] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="h-6 rounded-lg bg-[#1f2430] px-2.5 text-sm font-black text-white">
                  {entry.version}
                </Badge>
                <Badge
                  variant="secondary"
                  className="h-6 rounded-lg bg-[#eef0f4] px-2.5 text-xs font-black uppercase tracking-[0.12em] text-[#4b5563]"
                >
                  {entry.channel}
                </Badge>
                <span className="text-sm font-bold text-[#756d62]">{entry.date}</span>
              </div>

              <div className="grid gap-4">
                <h3 className="text-lg font-black text-[#20242c]">{entry.title}</h3>
                <ReleaseList title="Highlights" items={entry.highlights} />
                <ReleaseList title="Fixes" items={entry.fixes} />
                <ReleaseList title="Notes" items={entry.notes} />
              </div>
            </article>
          ))}
        </div>

        <DialogFooter className="!mx-0 !mb-0 rounded-b-xl border-t border-[#ded8ce] bg-[#f5f0e8] px-5 py-4">
          <Button type="button" onClick={onAcknowledge} disabled={acknowledging} className="min-w-28">
            {acknowledging ? 'Saving...' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
