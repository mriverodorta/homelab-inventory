import type { ProjectWorkbook, WorkspaceSummary } from '@/lib/workbook-api'
import type { ProjectState } from '@/types/inventory'

export function shouldLoadCanvasProject(canvasActive: boolean, settingsOpen: boolean) {
  return canvasActive || settingsOpen
}

export function createSystemsProjectScope(
  workbook: ProjectWorkbook | null,
  workspace: WorkspaceSummary | null,
): ProjectState | null {
  if (!workbook || workspace?.type !== 'systems') return null

  return {
    id: `project-${workbook.project.id}-systems`,
    revision: workbook.project.revision,
    metadata: {
      name: workbook.project.name,
      version: workbook.project.revision,
      updatedAt: '',
      projectId: workbook.project.id,
      workspaceId: workspace.id,
    },
    items: {},
    placements: [],
    assignments: [],
    connections: [],
  }
}
