import type { PointerEventHandler, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type DesktopInventoryShellProps = {
  expanded: boolean
  width: number
  children: ReactNode
  onResizePointerDown: PointerEventHandler<HTMLButtonElement>
}

export function DesktopInventoryShell({
  expanded,
  width,
  children,
  onResizePointerDown,
}: DesktopInventoryShellProps) {
  return (
    <div
      data-testid="desktop-inventory-shell"
      data-inventory-state={expanded ? 'expanded' : 'collapsed'}
      className="relative hidden min-h-0 shrink-0 transition-[width] duration-[220ms] ease-out motion-reduce:transition-none lg:flex"
      style={{ width: expanded ? width : 0 }}
    >
      <div className="absolute inset-y-0 left-0 w-full overflow-hidden">
        <div
          data-testid="desktop-inventory-content"
          aria-hidden={!expanded}
          inert={!expanded}
          className={cn(
            'relative flex h-full min-h-0 shrink-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            expanded
              ? 'translate-x-0 opacity-100'
              : 'pointer-events-none -translate-x-2 opacity-0',
          )}
          style={{ width }}
        >
          {children}
        </div>
      </div>

      <button
        type="button"
        aria-label="Resize inventory sidebar"
        disabled={!expanded}
        className={cn(
          'absolute right-0 top-0 z-30 h-full w-2 translate-x-1 cursor-col-resize border-r border-transparent transition-[border-color,opacity] hover:border-[#ddb668] focus-visible:border-[#ddb668] focus-visible:outline-none motion-reduce:transition-none',
          expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onPointerDown={expanded ? onResizePointerDown : undefined}
      />
    </div>
  )
}
