import { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { WorkspaceIcon } from '@/components/workbook/workspace-icon'
import { WORKSPACE_COLORS } from '@/components/workbook/workspace-style'
import type {
  WorkspaceColorKey,
  WorkspaceIconKey,
  WorkspaceInput,
  WorkspaceSummary,
} from '@/lib/workbook-api'

const ICONS: WorkspaceIconKey[] = [
  'network',
  'layout-grid',
  'boxes',
  'route',
  'chart-no-axes-column',
]

type WorkspaceDialogProps = {
  open: boolean
  workspace?: WorkspaceSummary | null
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onSubmit(input: WorkspaceInput): Promise<void> | void
}

export function WorkspaceDialog({
  open,
  workspace = null,
  busy = false,
  error = null,
  onOpenChange,
  onSubmit,
}: WorkspaceDialogProps) {
  const [name, setName] = useState('Canvas')
  const [iconKey, setIconKey] = useState<WorkspaceIconKey>('network')
  const [colorKey, setColorKey] = useState<WorkspaceColorKey>('blue')

  useEffect(() => {
    if (!open) return
    setName(workspace?.name ?? 'Canvas')
    setIconKey((workspace?.iconKey as WorkspaceIconKey | undefined) ?? 'network')
    setColorKey((workspace?.colorKey as WorkspaceColorKey | undefined) ?? 'blue')
  }, [open, workspace])

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{workspace ? 'Edit workspace' : 'New Canvas workspace'}</DialogTitle>
          <DialogDescription>
            Canvas workspaces keep independent layouts and cable routes inside this project.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void Promise.resolve(onSubmit({ type: 'canvas', name: name.trim(), iconKey, colorKey })).catch(() => {})
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <Input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Icon</legend>
            <div className="flex gap-2">
              {ICONS.map((candidate) => (
                <Button
                  key={candidate}
                  type="button"
                  size="icon"
                  variant={candidate === iconKey ? 'default' : 'outline'}
                  aria-label={`Use ${candidate} icon`}
                  aria-pressed={candidate === iconKey}
                  onClick={() => setIconKey(candidate)}
                >
                  <WorkspaceIcon iconKey={candidate} />
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(WORKSPACE_COLORS) as WorkspaceColorKey[]).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="relative size-8 rounded-full border-2 border-white shadow-[0_0_0_1px_#bdb4a8] focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ backgroundColor: WORKSPACE_COLORS[candidate].edge }}
                  aria-label={`Use ${candidate} color`}
                  aria-pressed={candidate === colorKey}
                  onClick={() => setColorKey(candidate)}
                >
                  {candidate === colorKey ? <Check className="absolute inset-1.5 size-4 text-white" /> : null}
                </button>
              ))}
            </div>
          </fieldset>
          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
              {workspace ? 'Save changes' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
