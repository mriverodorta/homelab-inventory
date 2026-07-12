import { useState } from 'react'
import {
  Check,
  Container,
  Copy,
  Download,
  RefreshCw,
} from 'lucide-react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import type { UpdateStatus } from '@/lib/update-api'
import type { ReleaseNoteEntry } from '@/release-notes'

const COMPOSE_COMMANDS = 'docker compose pull\ndocker compose up -d'

export type UpdateAvailableButtonProps = {
  updateAvailable: boolean
  checking?: boolean
  onClick: () => void
}

export type UpdateDialogProps = {
  open: boolean
  status: UpdateStatus
  checking: boolean
  skipping: boolean
  clearingSkip: boolean
  onOpenChange: (open: boolean) => void
  onCheck: () => void
  onSkip: () => void
  onClearSkip: () => void
}

function VersionCard({
  label,
  version,
  revision,
  emphasized = false,
}: {
  label: string
  version: string
  revision: string
  emphasized?: boolean
}) {
  return (
    <section
      className={
        emphasized
          ? 'min-w-0 rounded-lg border border-[#9bcab4] bg-[#edf8f2] p-3'
          : 'min-w-0 rounded-lg border border-[#ded8ce] bg-white p-3'
      }
    >
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#756d62]">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-[#20242c]">{version}</p>
      <p className="mt-1 break-all font-mono text-[11px] leading-4 text-[#756d62]" title={revision}>
        {revision}
      </p>
    </section>
  )
}

function ReleaseList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null

  return (
    <section className="grid gap-1.5">
      <h4 className="text-[11px] font-black uppercase tracking-[0.16em] text-[#756d62]">{title}</h4>
      <ul className="grid gap-1.5 text-sm font-semibold leading-5 text-[#30343c]">
        {items.map((item) => (
          <li key={item} className="flex min-w-0 gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#cf7a2f]" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ReleaseNoteList({ entries }: { entries: ReleaseNoteEntry[] }) {
  if (!entries.length) {
    return (
      <p className="rounded-lg border border-dashed border-[#d6ccbd] bg-[#f8f4ed] p-3 text-sm font-semibold text-[#756d62]">
        Release details are not available for this image yet.
      </p>
    )
  }

  return (
    <section className="grid gap-3" aria-labelledby="update-release-notes-title">
      <h3 id="update-release-notes-title" className="text-sm font-black text-[#20242c]">
        What&apos;s included
      </h3>
      {entries.map((entry) => (
        <article key={entry.version} className="grid min-w-0 gap-3 rounded-lg border border-[#ded8ce] bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-md bg-[#1f2430] font-black text-white">{entry.version}</Badge>
            <span className="text-xs font-bold text-[#756d62]">{entry.date}</span>
          </div>
          <h4 className="break-words text-sm font-black text-[#20242c]">{entry.title}</h4>
          <ReleaseList title="Highlights" items={entry.highlights} />
          <ReleaseList title="Fixes" items={entry.fixes} />
          <ReleaseList title="Notes" items={entry.notes} />
        </article>
      ))}
    </section>
  )
}

export function UpdateAvailableButton({ updateAvailable, checking = false, onClick }: UpdateAvailableButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={checking}
      className={updateAvailable
        ? 'h-9 gap-2 border-[#b6d5c5] bg-[#f3fbf7] px-3 text-xs font-black text-[#245c43] shadow-sm hover:bg-[#e6f6ed]'
        : 'h-9 gap-2 border-[#d6ccbd] bg-[#fffdf8] px-3 text-xs font-bold text-[#5f554b] shadow-sm'}
      aria-label={checking ? 'Checking update status' : updateAvailable ? 'Update available' : 'Open update status'}
    >
      {updateAvailable ? <Download className="size-4" /> : <RefreshCw className={checking ? 'size-4 animate-spin' : 'size-4'} />}
      {checking ? 'Checking' : updateAvailable ? 'Update available' : 'Updates'}
    </Button>
  )
}

export function UpdateDialog({
  open,
  status,
  checking,
  skipping,
  clearingSkip,
  onOpenChange,
  onCheck,
  onSkip,
  onClearSkip,
}: UpdateDialogProps) {
  const [copied, setCopied] = useState(false)
  const availableVersion = status.availableVersion ?? 'Unknown'
  const availableRevision = status.availableRevision ?? 'Revision unavailable'
  const title = status.state === 'disabled'
    ? 'Update checks disabled'
    : status.state === 'unknown'
      ? 'Update status unavailable'
      : status.updateAvailable
        ? status.skipped ? 'Update skipped' : 'Update available'
        : 'Up to date'
  const description = status.state === 'disabled'
    ? 'Enable update checks with UPDATE_CHECK_ENABLED=true.'
    : status.state === 'unknown'
      ? 'Docker Hub could not be reached. The last confirmed result is shown when available.'
      : status.updateAvailable
        ? `A newer ${status.channel} image is available on Docker Hub.`
        : `This installation matches the current ${status.channel} image.`

  async function copyCommands() {
    try {
      await navigator.clipboard.writeText(COMPOSE_COMMANDS)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-[#fffdf8] p-0 text-[#20242c] sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b border-[#ded8ce] px-5 py-4 pr-12">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#1f2430] text-[#fff7e8]">
              <Container className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-xl font-black">{title}</DialogTitle>
                <Badge
                  variant="secondary"
                  className="rounded-md bg-[#e7f4ed] px-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#245c43]"
                >
                  {status.channel} channel
                </Badge>
              </div>
              <DialogDescription className="mt-1 text-sm font-semibold text-[#756d62]">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div data-testid="update-dialog-body" className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="grid min-w-0 gap-4 px-5 py-4">
              <div data-testid="update-version-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <VersionCard
                  label="Running"
                  version={status.runningVersion}
                  revision={status.runningRevision}
                />
                <VersionCard
                  label="Available"
                  version={availableVersion}
                  revision={availableRevision}
                  emphasized
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#756d62]">
                <span>
                  Last checked: {status.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'Never'}
                </span>
                {status.state === 'unknown' ? (
                  <Badge variant="outline" className="border-[#e3c67b] bg-[#fff7d8] text-[#6b4b14]">
                    Check failed
                  </Badge>
                ) : null}
                {status.skipped ? (
                  <Badge variant="outline" className="border-[#d6ccbd] bg-[#f5f0e8] text-[#5f554b]">
                    Skipped
                  </Badge>
                ) : null}
              </div>

              <ReleaseNoteList entries={status.entries} />

              <section className="grid min-w-0 gap-3 rounded-lg border border-[#ded8ce] bg-[#f5f0e8] p-3">
                <div className="flex items-center gap-2">
                  <Download className="size-4 text-[#756d62]" />
                  <h3 className="text-sm font-black text-[#20242c]">Update with Docker Compose</h3>
                </div>
                <pre
                  data-testid="update-commands"
                  className="min-w-0 whitespace-pre-wrap break-words rounded-md bg-[#20242c] p-3 font-mono text-xs leading-5 text-[#fff7e8]"
                >
                  <code>{COMPOSE_COMMANDS}</code>
                </pre>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-semibold leading-5 text-[#756d62]">
                    Watchtower users may receive this image automatically.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full bg-white sm:w-auto"
                    onClick={() => void copyCommands()}
                    aria-label={copied ? 'Commands copied' : 'Copy commands'}
                  >
                    {copied ? <Check className="size-4 text-[#2f7b57]" /> : <Copy className="size-4" />}
                    {copied ? 'Copied' : 'Copy commands'}
                  </Button>
                </div>
              </section>
            </div>
          </ScrollArea>
        </div>

        <DialogFooter
          data-testid="update-dialog-footer"
          className="!mx-0 !mb-0 shrink-0 !flex-col-reverse rounded-b-xl border-t border-[#ded8ce] bg-[#f5f0e8] px-5 py-4 sm:!flex-row"
        >
          {status.updateAvailable && !status.skipped ? (
            <Button type="button" variant="ghost" disabled={skipping} onClick={onSkip} className="w-full sm:w-auto">
              {skipping ? 'Skipping...' : 'Skip this version'}
            </Button>
          ) : null}
          {status.skipped ? (
            <Button type="button" variant="ghost" disabled={clearingSkip} onClick={onClearSkip} className="w-full sm:w-auto">
              {clearingSkip ? 'Restoring...' : 'Show this version'}
            </Button>
          ) : null}
          {status.enabled ? (
            <Button type="button" variant="outline" disabled={checking} onClick={onCheck} className="w-full bg-white sm:w-auto">
              <RefreshCw className={checking ? 'size-4 animate-spin' : 'size-4'} />
              {checking ? 'Checking...' : 'Check now'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
