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
  onApply(previous: ProjectState, project: ProjectState): Promise<void> | void
}>

export function CopyHostConfigurationDialog({
  open,
  project,
  hostId,
  workspaces,
  onOpenChange,
  onApply,
}: CopyHostConfigurationDialogProps) {
  const destinations = useMemo(() => workspaces.filter((workspace) => (
    workspace.type === 'canvas'
    && workspace.projectId === project.metadata.projectId
    && workspace.id !== project.metadata.workspaceId
  )), [project.metadata.projectId, project.metadata.workspaceId, workspaces])
  const [destinationId, setDestinationId] = useState<number | null>(null)
  const [destination, setDestination] = useState<ProjectState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [includeComponents, setIncludeComponents] = useState(true)
  const [includeConnections, setIncludeConnections] = useState(false)

  useEffect(() => {
    if (!open) {
      setDestinationId(null)
      setDestination(null)
      setLoadError(null)
      setSaving(false)
      setIncludeComponents(true)
      setIncludeConnections(false)
      return
    }
    if (destinationId === null && destinations.length > 0) setDestinationId(destinations[0].id)
  }, [destinationId, destinations, open])

  useEffect(() => {
    const projectId = project.metadata.projectId
    if (!open || destinationId === null || !projectId) return
    let active = true
    setLoading(true)
    setLoadError(null)
    setDestination(null)
    void loadWorkspace(projectId, destinationId)
      .then((value) => { if (active) setDestination(value) })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'The destination canvas could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [destinationId, open, project.metadata.projectId])

  const preview = useMemo(() => {
    if (!destination || (!includeComponents && !includeConnections)) return null
    try {
      return {
        result: copyCanvasHostConfiguration({
          source: project,
          destination,
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
  }, [destination, hostId, includeComponents, includeConnections, project])

  const changes = (preview?.result?.placedHost ? 1 : 0)
    + (preview?.result?.copiedAssignmentCount ?? 0)
    + (preview?.result?.copiedConnectionCount ?? 0)

  async function applyConfiguration() {
    if (!destination || !preview?.result || saving) return
    setSaving(true)
    setLoadError(null)
    try {
      await onApply(destination, preview.result.project)
      onOpenChange(false)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The destination canvas could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Copy host configuration</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-2 text-sm font-medium">
            Destination canvas
            <Select value={destinationId === null ? '' : String(destinationId)} onValueChange={(value) => setDestinationId(Number(value))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a canvas" /></SelectTrigger>
              <SelectContent>{destinations.map((workspace) => <SelectItem key={workspace.id} value={String(workspace.id)}>{workspace.name}</SelectItem>)}</SelectContent>
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
            disabled={loading || saving || !preview?.result || changes === 0}
            onClick={() => { void applyConfiguration() }}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Copy />}Copy configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
