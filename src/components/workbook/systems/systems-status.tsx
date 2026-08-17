import { Ban, Copy, Link, Link2, Link2Off } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SystemsHostRow } from '@/types/systems'

const AGENT_PRESENTATION = {
  online: { Icon: Link2, className: 'text-[#2f7d5c]', label: 'Agent online' },
  stale: { Icon: Link2, className: 'text-[#b17714]', label: 'Agent stale' },
  offline: { Icon: Link2Off, className: 'text-[#b34f43]', label: 'Agent offline' },
  unknown: { Icon: Ban, className: 'text-[#8a8176]', label: 'Agent status unknown' },
  unregistered: { Icon: Ban, className: 'text-[#8a8176]', label: 'Agent not configured' },
} as const

export function SystemsAgentStatus({ system }: { system: SystemsHostRow }) {
  const presentation = AGENT_PRESENTATION[system.agentState]
  const { Icon } = presentation
  const versionClass = system.agentUpdateAvailable ? 'text-[#a66c0d]' : 'text-[#39765c]'
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex', presentation.className)} aria-label={presentation.label}>
            <Icon className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{presentation.label}</TooltipContent>
      </Tooltip>
      {system.agentVersion ? <span className={cn('text-xs tabular-nums', versionClass)}>{system.agentVersion}</span> : null}
      {system.agentUpdateAvailable && system.agentUpdateCommand ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 text-[#a66c0d]"
              aria-label={`Copy agent update command for ${system.name}`}
              onClick={(event) => {
                event.stopPropagation()
                void navigator.clipboard.writeText(system.agentUpdateCommand!)
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy agent update command</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function SystemsRegistryStatus({ linked, name }: { linked: boolean; name: string }) {
  const Icon = linked ? Link : Link2Off
  const label = linked ? `${name} is linked to the registry` : `${name} is not linked to the registry`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', linked ? 'text-[#2f7d5c]' : 'text-[#8a8176]')} aria-label={label}>
          <Icon className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
