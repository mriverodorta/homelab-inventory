import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteArchivedProject,
  loadArchivedProjects,
  loadProjectDeletionImpact,
  restoreProject,
  type ProjectWorkbook,
} from '@/lib/workbook-api'

export function useArchivedProjects({
  open,
  deletionProjectId,
  onRestored,
  onDeleted,
}: {
  open: boolean
  deletionProjectId: number | null
  onRestored(workbook: ProjectWorkbook): void
  onDeleted(projectId: number): void
}) {
  const queryClient = useQueryClient()
  const projectsQuery = useQuery({
    queryKey: ['archived-projects'],
    queryFn: loadArchivedProjects,
    enabled: open,
  })
  const impactQuery = useQuery({
    queryKey: ['project-deletion-impact', deletionProjectId],
    queryFn: () => loadProjectDeletionImpact(deletionProjectId!),
    enabled: open && deletionProjectId !== null,
  })
  const restoreMutation = useMutation({
    mutationFn: restoreProject,
    onSuccess: async (workbook) => {
      onRestored(workbook)
      await queryClient.invalidateQueries({ queryKey: ['archived-projects'] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deleteArchivedProject,
    onSuccess: async ({ impact }) => {
      onDeleted(impact.projectId)
      queryClient.removeQueries({ queryKey: ['project-deletion-impact', impact.projectId] })
      await queryClient.invalidateQueries({ queryKey: ['archived-projects'] })
    },
  })

  const error = projectsQuery.error
    ?? impactQuery.error
    ?? restoreMutation.error
    ?? deleteMutation.error

  return {
    projects: projectsQuery.data ?? [],
    loading: projectsQuery.isLoading,
    impact: impactQuery.data ?? null,
    impactLoading: impactQuery.isLoading,
    busy: restoreMutation.isPending || deleteMutation.isPending,
    error: error instanceof Error ? error.message : error ? 'The archived project operation failed.' : null,
    restore: restoreMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
  }
}
