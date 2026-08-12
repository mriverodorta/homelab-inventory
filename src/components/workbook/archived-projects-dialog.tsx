import { useState } from 'react'
import { Archive, ArchiveRestore, LoaderCircle, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProjectIcon } from '@/components/workbook/project-icon'
import { useArchivedProjects } from '@/components/workbook/use-archived-projects'
import type { ProjectSummary, ProjectWorkbook } from '@/lib/workbook-api'

const IMPACT_LABELS = [
  ['workspaces', 'Workspaces'],
  ['projectBoundItems', 'Project inventory'],
  ['globalMemberships', 'Global memberships'],
  ['placements', 'Canvas placements'],
  ['assignments', 'Assignments'],
  ['connections', 'Cable connections'],
  ['historicalAgentBindings', 'Past agent links'],
  ['incidents', 'Incidents'],
] as const

type ArchivedProjectsDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  onRestored(workbook: ProjectWorkbook): void
  onDeleted(projectId: number): void
}

export function ArchivedProjectsDialog({
  open,
  onOpenChange,
  onRestored,
  onDeleted,
}: ArchivedProjectsDialogProps) {
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const manager = useArchivedProjects({
    open,
    deletionProjectId: deleteTarget?.id ?? null,
    onRestored,
    onDeleted,
  })
  const deletionBlocked = Boolean(
    manager.impact
    && (manager.impact.activeAgentBindings > 0 || manager.impact.externalProjectDependencies > 0),
  )

  return (
    <>
      <Dialog open={open} onOpenChange={manager.busy ? undefined : onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Archived projects</DialogTitle>
            <DialogDescription>
              Restore a project or permanently remove its project-bound data. Global inventory is never deleted here.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[min(62vh,560px)] pr-3">
            {manager.loading ? (
              <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading archived projects
              </div>
            ) : manager.projects.length === 0 ? (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-6 text-center">
                <Archive className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">No archived projects</p>
                <p className="text-xs text-muted-foreground">Archived projects remain recoverable until you delete them permanently.</p>
              </div>
            ) : (
              <div className="grid gap-2">
                {manager.projects.map((project) => (
                  <div key={project.id} className="flex items-center gap-3 rounded-md border bg-card p-3">
                    <ProjectIcon iconKey={project.iconKey} className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {project.archivedAtMs ? `Archived ${new Date(project.archivedAtMs).toLocaleDateString()}` : 'Archived'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={manager.busy}
                      onClick={() => void manager.restore(project.id).catch(() => {})}
                    >
                      <ArchiveRestore /> Restore
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Delete ${project.name} permanently`}
                      disabled={manager.busy}
                      onClick={() => setDeleteTarget(project)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {manager.error && !deleteTarget ? <p role="alert" className="text-sm font-medium text-destructive">{manager.error}</p> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(next) => { if (!next && !manager.busy) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The archived project, its workspaces, and its project-bound inventory will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {manager.impactLoading ? (
            <div className="flex items-center py-4 text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" /> Calculating exact impact
            </div>
          ) : manager.impact ? (
            <div className="grid grid-cols-2 gap-x-5 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              {IMPACT_LABELS.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-semibold tabular-nums">{manager.impact![key]}</span>
                </div>
              ))}
            </div>
          ) : null}

          {manager.impact?.activeAgentBindings ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Unlink {manager.impact.activeAgentBindings} active host agent(s) before deleting this project.
            </p>
          ) : null}
          {manager.impact?.externalProjectDependencies ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Resolve {manager.impact.externalProjectDependencies} unexpected cross-project dependency record(s) first.
            </p>
          ) : null}
          {manager.error ? <p role="alert" className="text-sm font-medium text-destructive">{manager.error}</p> : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={manager.busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={manager.busy || manager.impactLoading || !manager.impact || deletionBlocked}
              onClick={(event) => {
                event.preventDefault()
                if (!deleteTarget) return
                void manager.remove(deleteTarget.id)
                  .then(() => setDeleteTarget(null))
                  .catch(() => {})
              }}
            >
              {manager.busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
