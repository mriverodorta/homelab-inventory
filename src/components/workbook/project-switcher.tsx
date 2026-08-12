import { useMemo, useState } from 'react'
import { Archive, Check, ChevronDown, Pencil, Plus, Search } from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ArchivedProjectsDialog } from '@/components/workbook/archived-projects-dialog'
import { ProjectDialog } from '@/components/workbook/project-dialog'
import { ProjectIcon } from '@/components/workbook/project-icon'
import type { ProjectInput, ProjectSummary, ProjectWorkbook } from '@/lib/workbook-api'

type ProjectSwitcherProps = {
  projects: ProjectSummary[]
  activeProjectId: number
  busy?: boolean
  error?: string | null
  onSelect(projectId: number): void
  onCreate(input: ProjectInput): Promise<void>
  onUpdate(projectId: number, input: ProjectInput): Promise<void>
  onArchive(projectId: number): Promise<void>
  onRestored(workbook: ProjectWorkbook): void
  onDeleted(projectId: number): void
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  busy = false,
  error = null,
  onSelect,
  onCreate,
  onUpdate,
  onArchive,
  onRestored,
  onDeleted,
}: ProjectSwitcherProps) {
  const [query, setQuery] = useState('')
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized
      ? projects.filter((project) => project.name.toLocaleLowerCase().includes(normalized))
      : projects
  }, [projects, query])

  if (!activeProject) return null

  return (
    <>
      <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-[#cfc5b7] bg-[#fffdf8]/95 p-1 shadow-sm backdrop-blur-sm">
        <DropdownMenu onOpenChange={(open) => { if (!open) setQuery('') }}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 max-w-[min(260px,60vw)] gap-2 px-2 text-[#292d33]"
              aria-label={`Project: ${activeProject.name}`}
            >
              <ProjectIcon iconKey={activeProject.iconKey} className="size-4 text-[#6a5c4d]" />
              <span className="truncate font-semibold">{activeProject.name}</span>
              <ChevronDown className="size-3.5 text-[#7b7166]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72" align="start">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {projects.length > 6 ? (
              <div className="relative px-1 pb-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  placeholder="Find project"
                  className="h-8 pl-8"
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : null}
            {filteredProjects.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
                <ProjectIcon iconKey={project.iconKey} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.id === activeProject.id ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialogMode('create')}>
              <Plus /> New project
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setArchivedProjectsOpen(true)}>
              <Archive /> Archived projects
            </DropdownMenuItem>
            {activeProject.id !== 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setArchiveOpen(true)}>
                  <Archive /> Archive current project
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Edit current project"
          title="Edit current project"
          onClick={() => setDialogMode('edit')}
        >
          <Pencil />
        </Button>
      </div>

      <ProjectDialog
        open={dialogMode !== null}
        project={dialogMode === 'edit' ? activeProject : null}
        busy={busy}
        error={error}
        onOpenChange={(open) => { if (!open) setDialogMode(null) }}
        onSubmit={async (input) => {
          if (dialogMode === 'edit') await onUpdate(activeProject.id, input)
          else await onCreate(input)
          setDialogMode(null)
        }}
      />

      <AlertDialog open={archiveOpen} onOpenChange={(open) => { if (!busy) setArchiveOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {activeProject.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The project will leave the active project list, but it can be restored from Archived projects.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void onArchive(activeProject.id)
                  .then(() => setArchiveOpen(false))
                  .catch(() => {})
              }}
            >
              Archive project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ArchivedProjectsDialog
        open={archivedProjectsOpen}
        onOpenChange={setArchivedProjectsOpen}
        onRestored={onRestored}
        onDeleted={onDeleted}
      />
    </>
  )
}
