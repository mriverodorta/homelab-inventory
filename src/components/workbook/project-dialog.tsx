import { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProjectIcon } from '@/components/workbook/project-icon'
import type { ProjectIconKey, ProjectInput, ProjectSummary } from '@/lib/workbook-api'
import { cn } from '@/lib/utils'

const ICONS: ProjectIconKey[] = [
  'folder',
  'house',
  'server',
  'network',
  'boxes',
  'building-2',
  'layers-3',
]

type ProjectDialogProps = {
  open: boolean
  project?: ProjectSummary | null
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onSubmit(input: ProjectInput): Promise<void> | void
}

export function ProjectDialog({
  open,
  project = null,
  busy = false,
  error = null,
  onOpenChange,
  onSubmit,
}: ProjectDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconKey, setIconKey] = useState<ProjectIconKey>('folder')
  const [includesGlobalInventory, setIncludesGlobalInventory] = useState(true)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
    setIconKey(project?.iconKey ?? 'folder')
    setIncludesGlobalInventory(project?.includesGlobalInventory ?? true)
  }, [open, project])

  const title = project ? 'Edit project' : 'Create project'

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {project
              ? 'Update the project identity and inventory visibility.'
              : 'Create an isolated workbook with Systems and Canvas tabs.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void Promise.resolve(onSubmit({
              name: name.trim(),
              description: description.trim() || null,
              iconKey,
              includesGlobalInventory,
            })).catch(() => {})
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <Input
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium">
            Description
            <Input
              maxLength={240}
              value={description}
              placeholder="Optional"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Icon</legend>
            <div className="flex flex-wrap gap-2">
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
                  <ProjectIcon iconKey={candidate} />
                </Button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-3 rounded-md border border-[#d8d0c5] bg-[#faf8f4] p-3">
            <Checkbox
              checked={includesGlobalInventory}
              onCheckedChange={(checked) => setIncludesGlobalInventory(checked === true)}
            />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">Include global inventory</span>
              <span className="text-xs text-muted-foreground">
                Allow explicitly shared equipment to be added to this project.
              </span>
            </span>
          </label>

          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}

          <DialogFooter className={cn('mt-1', busy && 'pointer-events-none')}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
              {project ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
