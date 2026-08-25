import { useEffect, useMemo, useState } from 'react'
import { Copy, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { copyCanvasHostConfiguration } from '@/lib/canvas-configuration'
import { loadWorkspace, type WorkspaceSummary } from '@/lib/workbook-api'
import type { ProjectState } from '@/types/inventory'

type CopyHostConfigurationDialogProps = Readonly<{
  open: boolean
  project: ProjectState
  hostId: string
  workspaces: readonly WorkspaceSummary[]
  onOpenChange(open: boolean): void
  onApply(project: ProjectState): void
}>

export function CopyHostConfigurationDialog({
  open,
  project,
  hostId,
  workspaces,
  onOpenChange,
  onApply,
}: CopyHostConfigurationDialogProps) {
  const sources = useMemo(() => workspaces.filter((workspace) => (
    workspace.type === 'canvas' && workspace.id !== project.metadata.workspaceId
  )), [project.metadata.workspaceId, workspaces])
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [source, setSource] = useState<ProjectState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [includeComponents, setIncludeComponents] = useState(true)
  const [includeConnections, setIncludeConnections] = useState(false)

  useEffect(() => {
    if (!open) {
      setSourceId(null)
      setSource(null)
      setLoadError(null)
      setIncludeComponents(true)
      setIncludeConnections(false)
      return
    }
    if (sourceId === null && sources.length > 0) setSourceId(sources[0].id)
  }, [open, sourceId, sources])

  useEffect(() => {
    if (!open || sourceId === null) return
    let active = true
    setLoading(true)
    setLoadError(null)
    setSource(null)
    void loadWorkspace(project.metadata.projectId ?? 1, sourceId)
      .then((value) => { if (active) setSource(value) })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'The source canvas could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, project.metadata.projectId, sourceId])

  const preview = useMemo(() => {
    if (!source || (!includeComponents && !includeConnections)) return null
    try {
      return {
        result: copyCanvasHostConfiguration({
          source,
          destination: project,
          hostId,
          includeComponents,
          includeConnections,
        }),
        error: null,
      }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'The configuration cannot be copied.',
      }
    }
  }, [hostId, includeComponents, includeConnections, project, source])

  const changes = (preview?.result?.copiedAssignmentCount ?? 0) + (preview?.result?.copiedConnectionCount ?? 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Copy host configuration</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-2 text-sm font-medium">
            Source canvas
            <Select value={sourceId === null ? '' : String(sourceId)} onValueChange={(value) => setSourceId(Number(value))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a canvas" /></SelectTrigger>
              <SelectContent>{sources.map((workspace) => <SelectItem key={workspace.id} value={String(workspace.id)}>{workspace.name}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeComponents} onCheckedChange={(checked) => setIncludeComponents(checked === true)} />
            Installed components
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeConnections} onCheckedChange={(checked) => setIncludeConnections(checked === true)} />
            Cable connections
          </label>
          {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading configuration...</div> : null}
          {loadError || preview?.error ? <p className="text-sm text-destructive">{loadError ?? preview?.error}</p> : null}
          {preview?.result?.unavailableConnections.length ? (
            <p className="text-sm text-muted-foreground">{preview.result.unavailableConnections.length} cable connections cannot be copied to this canvas.</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={loading || !preview?.result || changes === 0}
            onClick={() => {
              if (!preview?.result) return
              onApply(preview.result.project)
              onOpenChange(false)
            }}
          >
            <Copy />Copy configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
