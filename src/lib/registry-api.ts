import { apiRequest, withWorkspaceScope, type WorkspaceMutationScope } from '@/lib/db'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
import type { InventoryItemInput } from '@/lib/db'
import type {
  PrivateTemplateImportPreview,
  PrivateTemplatePack,
  CatalogSearchResult,
  CatalogFacetResponse,
  CatalogSearchFilters,
  CatalogUpdatePreview,
  CatalogReviewSummary,
  CatalogUpdateGroup,
  CatalogUpdateDecisionResult,
  CatalogUpdateGroupsResponse,
  CatalogUpdateRunStatus,
  CatalogUpdateSummaryResponse,
  RegistrySettings,
  RegistryState,
} from '@/types/registry'
import type { ProjectState } from '@/types/inventory'

export function loadRegistryState(): Promise<RegistryState> {
  return consumeInitialBootstrap('registry', () => apiRequest<RegistryState>('/api/registry'))
}

export function updateRegistrySettings(
  settings: Partial<Pick<RegistrySettings, 'mode' | 'defaultInventorySource' | 'automaticContributions' | 'automaticSafeUpdates' | 'showRegistryLinkIndicators'>>,
  expectedUpdatedAt?: string | null,
): Promise<RegistryState> {
  return apiRequest<RegistryState>('/api/registry/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings, expectedUpdatedAt }),
  })
}

export function createPrivateTemplate(input: {
  name: string
  description?: string
  item: InventoryItemInput
}): Promise<RegistryState> {
  return apiRequest<RegistryState>('/api/registry/private-templates', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function duplicatePrivateTemplate(id: number): Promise<RegistryState> {
  return apiRequest<RegistryState>(`/api/registry/private-templates/${id}/duplicate`, { method: 'POST' })
}

export function deletePrivateTemplate(id: number): Promise<RegistryState> {
  return apiRequest<RegistryState>(`/api/registry/private-templates/${id}`, { method: 'DELETE' })
}

export function exportPrivateTemplates(ids?: number[]): Promise<PrivateTemplatePack> {
  return apiRequest<PrivateTemplatePack>('/api/registry/private-templates/export', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export function previewPrivateTemplateImport(pack: unknown): Promise<PrivateTemplateImportPreview> {
  return apiRequest<PrivateTemplateImportPreview>('/api/registry/private-templates/import/preview', {
    method: 'POST',
    body: JSON.stringify({ pack }),
  })
}

export function importPrivateTemplates(pack: unknown): Promise<{
  registry: RegistryState
  imported: number
  skipped: number
}> {
  return apiRequest('/api/registry/private-templates/import', {
    method: 'POST',
    body: JSON.stringify({ pack }),
  })
}

export function searchOfficialCatalog(parameters: {
  query?: string
  type?: string
  manufacturer?: string
  limit?: number
  offset?: number
  filters?: CatalogSearchFilters
} = {}): Promise<CatalogSearchResult> {
  const query = new URLSearchParams()
  if (parameters.query) query.set('q', parameters.query)
  if (parameters.type) query.set('type', parameters.type)
  if (parameters.manufacturer) query.set('manufacturer', parameters.manufacturer)
  if (parameters.limit !== undefined) query.set('limit', String(parameters.limit))
  if (parameters.offset !== undefined) query.set('offset', String(parameters.offset))
  for (const [key, values] of Object.entries(parameters.filters?.terms ?? {})) {
    for (const value of values) query.append('term', `${key}:${value}`)
  }
  for (const [key, bounds] of Object.entries(parameters.filters?.ranges ?? {})) {
    if (bounds.minimum !== undefined) query.append('min', `${key}:${bounds.minimum}`)
    if (bounds.maximum !== undefined) query.append('max', `${key}:${bounds.maximum}`)
  }
  return apiRequest(`/api/registry/catalog/search?${query.toString()}`)
}

export function loadCatalogFacets(): Promise<CatalogFacetResponse> {
  return apiRequest('/api/registry/catalog/facets')
}

export function importOfficialCatalog(artifact: unknown): Promise<{ registry: RegistryState }> {
  return apiRequest('/api/registry/catalog/import', {
    method: 'POST',
    body: JSON.stringify({ artifact }),
  })
}

export function refreshOfficialCatalog(): Promise<{ registry: RegistryState }> {
  return apiRequest('/api/registry/catalog/refresh', { method: 'POST' })
}

export function deliverRegistryContributions(): Promise<RegistryState['contributions']> {
  return apiRequest('/api/registry/contributions/deliver', { method: 'POST' })
}

export function revokeRegistryContributions(): Promise<RegistryState['contributions']> {
  return apiRequest('/api/registry/contributions/revoke', { method: 'POST' })
}

export function rotateRegistryContributionKey(): Promise<RegistryState['contributions']> {
  return apiRequest('/api/registry/contributions/rotate-key', { method: 'POST' })
}

export function resumeRegistryContributionRecovery(): Promise<RegistryState['contributions']> {
  return apiRequest('/api/registry/contributions/resume-recovery', { method: 'POST' })
}

export function resetRegistryContributionRecovery(): Promise<RegistryState['contributions']> {
  return apiRequest('/api/registry/contributions/reset-recovery', { method: 'POST' })
}

export function createInventoryFromCatalog(
  templateKey: string,
  quantity = 1,
  usageRole: 'server' | 'desktop' | 'workstation' | 'other' = 'server',
  scope?: WorkspaceMutationScope | null,
): Promise<ProjectState> {
  return apiRequest(withWorkspaceScope(`/api/registry/catalog/templates/${encodeURIComponent(templateKey)}/create`, scope), {
    method: 'POST',
    body: JSON.stringify({ quantity, usageRole }),
  })
}

export function loadCatalogUpdates(): Promise<{ updates: CatalogReviewSummary[]; groups: CatalogUpdateGroup[]; run: CatalogUpdateRunStatus | null }> {
  return apiRequest('/api/registry/updates')
}

export function loadCatalogUpdateSummary(): Promise<CatalogUpdateSummaryResponse> {
  return apiRequest('/api/registry/updates?view=summary')
}

export function loadCatalogUpdateGroups(): Promise<CatalogUpdateGroupsResponse> {
  return apiRequest('/api/registry/updates?view=groups')
}

export function retryCatalogUpdates(): Promise<{ groups: CatalogUpdateGroup[]; run: CatalogUpdateRunStatus | null }> {
  return apiRequest('/api/registry/updates/retry', { method: 'POST', body: '{}' })
}

export function decideCatalogUpdateGroups(input: {
  groups: Array<{ templateKey: string; toRevision: number }>
  decision: 'applied' | 'declined' | 'reconsider'
}): Promise<CatalogUpdateDecisionResult> {
  return apiRequest('/api/registry/update-groups/decision', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function selectCatalogVariant(variantMatchId: number, templateKey: string): Promise<{ updates: CatalogReviewSummary[] }> {
  return apiRequest(`/api/registry/variant-matches/${variantMatchId}/select`, {
    method: 'POST',
    body: JSON.stringify({ templateKey }),
  })
}

export function loadCatalogUpdatePreview(linkId: number): Promise<CatalogUpdatePreview> {
  return apiRequest(`/api/registry/links/${linkId}/update-preview`)
}

export function applyCatalogUpdate(linkId: number, scope?: WorkspaceMutationScope | null): Promise<ProjectState> {
  return apiRequest(withWorkspaceScope(`/api/registry/links/${linkId}/apply-update`, scope), { method: 'POST' })
}
