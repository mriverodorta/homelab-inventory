import { Check, ChevronDown, X } from 'lucide-react'
import { useState } from 'react'
import type { OnboardingMilestones } from '@/lib/onboarding-api'
import { cn } from '@/lib/utils'

const tasks = [
  { key: 'created' as const, title: 'Create equipment', body: 'Add a server, NAS, switch, UPS, custom PC, or other canvas equipment.' },
  { key: 'placed' as const, title: 'Place it on the canvas', body: 'Drag the equipment from inventory into the workspace.' },
  { key: 'related' as const, title: 'Make one relationship', body: 'Assign a component or connect two compatible ports.' },
]

export function GettingStartedChecklist({
  milestones, desktopOffset, onDismiss,
}: {
  milestones: OnboardingMilestones
  desktopOffset: number
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const completed = tasks.filter((task) => milestones[task.key]).length

  return (
    <aside style={{ left: desktopOffset }} className="absolute bottom-3 z-30 hidden w-[290px] border border-[#d3cabd] bg-[#fffdf8] text-[#20242c] shadow-lg lg:block" aria-label="Getting started checklist">
      <header className="flex min-h-12 items-center gap-2 border-b border-[#e2dbcf] px-3">
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="flex min-h-11 min-w-0 flex-1 items-center justify-between text-left">
          <span><span className="block text-xs font-black">Getting started</span><span className="block text-[10px] font-bold text-[#756d62]">{completed} of 3 complete</span></span>
          <ChevronDown className={cn('size-4 transition-transform', !expanded && '-rotate-90')} />
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss getting started checklist" className="flex size-11 items-center justify-center text-[#756d62] hover:text-[#20242c]"><X className="size-4" /></button>
      </header>
      {expanded ? <div className="p-3">{tasks.map((task, index) => {
        const done = milestones[task.key]
        return <div key={task.key} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 border-b border-[#eee7dc] py-2 last:border-0"><span className={cn('flex size-5 items-center justify-center rounded-full border border-[#a79d90] text-[10px] font-black', done && 'border-[#78936c] bg-[#dce8d4] text-[#395533]')}>{done ? <Check className="size-3" /> : index + 1}</span><span><strong className="block text-xs">{task.title}</strong><small className="mt-0.5 block text-[10px] font-semibold leading-4 text-[#756d62]">{task.body}</small></span></div>
      })}</div> : null}
    </aside>
  )
}
