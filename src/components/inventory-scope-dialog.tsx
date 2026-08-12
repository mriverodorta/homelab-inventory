import { useEffect, useMemo, useState } from 'react'
import { Copy, Globe2, LoaderCircle, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { InventoryScopeAction } from '@/app/use-inventory-lifecycle'
import type { ProjectSummary } from '@/lib/workbook-api'

type InventoryScopeDialogProps = {
  open: boolean
  action: InventoryScopeAction
  itemName: string
  activeProjectId: number
  projects: ProjectSummary[]
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onConfirm(targetProjectId?: number): void
}

function actionContent(action: InventoryScopeAction, itemName: string) {
  if (action === 'make-global') return {
    title: 'Make this item global?',
    description: `${itemName} will remain in this project and can be explicitly shared with other projects. Assignments and Canvas placement stay here.`,
    confirm: 'Make global',
    Icon: Globe2,
  }
  if (action === 'make-project-bound') return {
    title: 'Bind this item to the project?',
    description: `${itemName} will become exclusive to this project. This requires it to have no membership in another project.`,
    confirm: 'Bind to project',
    Icon: Unlink,
  }
  if (action === 'remove-from-project') return {
    title: 'Remove global item from this project?',
    description: `${itemName} will remain in the global inventory library but disappear from this project's inventory. Assigned, placed, or connected items must be released first.`,
    confirm: 'Remove from project',
    Icon: Unlink,
  }
  return {
    title: 'Duplicate to another project',
    description: `Create a project-bound copy of ${itemName}. Serial numbers, agent identity, registry links, telemetry, assignments, placements, and cables are not copied.`,
    confirm: 'Duplicate item',
    Icon: Copy,
  }
}

export function InventoryScopeDialog({
  open,
  action,
  itemName,
  activeProjectId,
  projects,
  busy = false,
  error = null,
  onOpenChange,
  onConfirm,
}: InventoryScopeDialogProps) {
  const targets = useMemo(
    () => projects.filter((project) => project.id !== activeProjectId),
    [activeProjectId, projects],
  )
  const firstTargetId = targets[0]?.id ?? null
  const [targetProjectId, setTargetProjectId] = useState('')
  const copy = actionContent(action, itemName)

  useEffect(() => {
    if (!open) return
    setTargetProjectId(firstTargetId ? String(firstTargetId) : '')
  }, [firstTargetId, open])

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <copy.Icon aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {action === 'duplicate-to-project' ? (
          <label className="grid gap-1.5 text-sm font-medium">
            Target project
            <Select value={targetProjectId} onValueChange={setTargetProjectId} disabled={busy || targets.length === 0}>
              <SelectTrigger aria-label="Target project"><SelectValue placeholder="Choose a project" /></SelectTrigger>
              <SelectContent>
                {targets.map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        {action === 'duplicate-to-project' && targets.length === 0 ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">Create another project before duplicating this item.</p>
        ) : null}
        {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={busy || (action === 'duplicate-to-project' && !targetProjectId)}
            onClick={() => onConfirm(action === 'duplicate-to-project' ? Number(targetProjectId) : undefined)}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
