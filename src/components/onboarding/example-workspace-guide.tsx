import type { CSSProperties } from 'react'
import { ChevronRight, Network, PlugZap, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const steps = [
  { icon: Server, title: 'Inspect the example host', body: 'Open Atlas to see its CPU, memory, storage, board ports, and power adapter.' },
  { icon: Network, title: 'Follow the network path', body: 'Select the sample network cable to trace Atlas through Bridge to Relay.' },
  { icon: PlugZap, title: 'Follow the power path', body: 'Select the sample power cable to trace Atlas through Beam to Anchor.' },
]

export function ExampleWorkspaceGuide({
  step, desktopOffset, busy, onShowMe, onSkip,
}: {
  step: number
  desktopOffset: number
  busy: boolean
  onShowMe: () => void
  onSkip: () => void
}) {
  const current = steps[Math.min(step, steps.length - 1)]
  const Icon = current.icon
  const style = { '--onboarding-guide-left': `${desktopOffset}px` } as CSSProperties

  return (
    <aside
      aria-label="Example workspace guide"
      aria-live="polite"
      style={style}
      className="absolute inset-x-3 bottom-3 z-40 border border-[#3a414b] bg-[#171b22] text-[#f8f1e8] shadow-xl lg:inset-x-auto lg:bottom-auto lg:left-[var(--onboarding-guide-left)] lg:top-4 lg:w-[310px]"
    >
      <header className="flex items-center justify-between border-b border-[#333a44] px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#c6bbae]">Example workspace</p>
          <p className="mt-0.5 text-xs font-bold text-[#f1e9dd]">Step {Math.min(step + 1, 3)} of 3</p>
        </div>
        <button type="button" aria-label="Skip example walkthrough" onClick={onSkip} disabled={busy} className="flex size-11 items-center justify-center text-[#c6bbae] hover:text-white lg:size-8">
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#2a3039] text-[#e1b769]"><Icon className="size-4" aria-hidden="true" /></span>
          <div><h2 className="text-sm font-black">{current.title}</h2><p className="mt-1 text-xs font-semibold leading-5 text-[#c6bbae]">{current.body}</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-1" aria-hidden="true">
          {steps.map((_, index) => <span key={index} className={cn('h-1 bg-[#3a414b]', index <= step && 'bg-[#d7ad5e]')} />)}
        </div>
        <Button type="button" size="sm" className="mt-4 min-h-11 w-full" onClick={onShowMe} disabled={busy}>
          Show me <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </aside>
  )
}
