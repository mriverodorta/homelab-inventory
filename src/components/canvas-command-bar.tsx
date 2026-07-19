import {
  AlertTriangle,
  Cloud,
  CloudAlert,
  Download,
  Eye,
  EyeOff,
  LayoutGrid,
  LoaderCircle,
  LocateFixed,
  PanelLeft,
  Redo2,
  RefreshCw,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type CanvasSaveStatus = 'saved' | 'saving' | 'error'

export interface CanvasCommandBarProps {
  desktopInventoryVisible: boolean
  saveStatus: CanvasSaveStatus
  canUndo: boolean
  canRedo: boolean
  updateAvailable: boolean
  updateStatusLoading: boolean
  auditWarningCount: number
  autoCenterOnSelect: boolean
  cablesVisible: boolean
  onInventory: () => void
  onUndo: () => void
  onRedo: () => void
  onOpenUpdate: () => void
  onOpenAudit: () => void
  onToggleAutoCenterOnSelect: () => void
  onAutoArrange: () => void
  onToggleCablesVisible: () => void
  className?: string
}

interface ToolbarButtonProps {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  indicator?: ReactNode
}

const SAVE_STATUS: Record<CanvasSaveStatus, { label: string; icon: LucideIcon; className: string }> = {
  saved: {
    label: 'Saved',
    icon: Cloud,
    className: 'text-[#557264]',
  },
  saving: {
    label: 'Saving',
    icon: LoaderCircle,
    className: 'animate-spin text-[#75695d]',
  },
  error: {
    label: 'Save failed',
    icon: CloudAlert,
    className: 'text-[#a84834]',
  },
}

function ToolbarButton({
  label,
  children,
  onClick,
  disabled = false,
  pressed,
  indicator,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? 'default' : 'ghost'}
          size="icon"
          className={cn(
            'relative size-10 rounded-md',
            pressed && 'bg-[#20242c] text-[#fffdf8] hover:bg-[#2f3642]',
          )}
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
          {indicator}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarSeparator() {
  return <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-[#e5dccf]" />
}

function SaveStatusIndicator({ status }: { status: CanvasSaveStatus }) {
  const config = SAVE_STATUS[status]
  const Icon = config.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={config.label}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md"
        >
          <Icon className={cn('size-4', config.className)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {config.label}
      </TooltipContent>
    </Tooltip>
  )
}

export function CanvasCommandBar({
  desktopInventoryVisible,
  saveStatus,
  canUndo,
  canRedo,
  updateAvailable,
  updateStatusLoading,
  auditWarningCount,
  autoCenterOnSelect,
  cablesVisible,
  onInventory,
  onUndo,
  onRedo,
  onOpenUpdate,
  onOpenAudit,
  onToggleAutoCenterOnSelect,
  onAutoArrange,
  onToggleCablesVisible,
  className,
}: CanvasCommandBarProps) {
  const inventoryLabel = desktopInventoryVisible ? 'Hide inventory' : 'Show inventory'
  const updateLabel = updateStatusLoading
    ? 'Checking update status'
    : updateAvailable
      ? 'Update available'
      : 'Open update status'
  const auditLabel = auditWarningCount === 0
    ? 'Open audit, no warnings'
    : `Open audit, ${auditWarningCount} ${auditWarningCount === 1 ? 'warning' : 'warnings'}`
  const centerLabel = autoCenterOnSelect ? 'Disable selection centering' : 'Enable selection centering'
  const cablesLabel = cablesVisible ? 'Hide cables' : 'Show cables'

  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center pl-14 pr-3 sm:px-3',
        className,
      )}
    >
      <div className="pointer-events-auto max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-[#d6ccbd] bg-[#fffdf8]/96 p-1 shadow-[0_12px_30px_rgba(32,36,44,0.2)] backdrop-blur">
        <div className="flex w-max items-center gap-1">
          <ToolbarButton label={inventoryLabel} onClick={onInventory} pressed={desktopInventoryVisible}>
            <PanelLeft className="size-4" />
          </ToolbarButton>

          <ToolbarSeparator />

          <SaveStatusIndicator status={saveStatus} />
          <ToolbarButton label="Undo" onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton label="Redo" onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="size-4" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            label={updateLabel}
            onClick={onOpenUpdate}
            disabled={updateStatusLoading}
            indicator={updateAvailable ? (
              <>
                <span className="sr-only">Update available</span>
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#2f8a62] ring-2 ring-[#fffdf8]"
                />
              </>
            ) : undefined}
          >
            {updateStatusLoading ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : updateAvailable ? (
              <Download className="size-4" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </ToolbarButton>
          <ToolbarButton
            label={auditLabel}
            onClick={onOpenAudit}
            indicator={(
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[9px] font-black leading-4',
                  auditWarningCount > 0
                    ? 'bg-[#fff2c7] text-[#3d2a08]'
                    : 'bg-[#efebe5] text-[#75695d]',
                )}
              >
                {auditWarningCount}
              </span>
            )}
          >
            <AlertTriangle className={cn('size-4', auditWarningCount > 0 && 'text-[#a66f1f]')} />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            label={centerLabel}
            onClick={onToggleAutoCenterOnSelect}
            pressed={autoCenterOnSelect}
          >
            <LocateFixed className="size-4" />
          </ToolbarButton>
          <ToolbarButton label="Auto arrange canvas" onClick={onAutoArrange}>
            <LayoutGrid className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={cablesLabel} onClick={onToggleCablesVisible} pressed={cablesVisible}>
            {cablesVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </ToolbarButton>
        </div>
      </div>
    </div>
  )
}
