import { apiRequest } from '@/lib/db'
import type { InventoryItemInput } from '@/lib/db'
import type {
  PrivateTemplateImportPreview,
  PrivateTemplatePack,
  CatalogSearchResult,
  CatalogUpdatePreview,
  CatalogUpdateSummary,
  RegistrySettings,
  RegistryState,
} from '@/types/registry'
import type { ProjectState } from '@/types/inventory'

export function loadRegistryState(): Promise<RegistryState> {
  return apiRequest<RegistryState>('/api/registry')
}

export function updateRegistrySettings(
  settings: Partial<Pick<RegistrySettings, 'mode' | 'defaultInventorySource' | 'automaticContributions'>>,
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
} = {}): Promise<CatalogSearchResult> {
  const query = new URLSearchParams()
  if (parameters.query) query.set('q', parameters.query)
  if (parameters.type) query.set('type', parameters.type)
  if (parameters.manufacturer) query.set('manufacturer', parameters.manufacturer)
  if (parameters.limit !== undefined) query.set('limit', String(parameters.limit))
  if (parameters.offset !== undefined) query.set('offset', String(parameters.offset))
  return apiRequest(`/api/registry/catalog/search?${query.toString()}`)
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

export function createInventoryFromCatalog(templateKey: string, quantity = 1): Promise<ProjectState> {
  return apiRequest(`/api/registry/catalog/templates/${encodeURIComponent(templateKey)}/create`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  })
}

export function loadCatalogUpdates(): Promise<{ updates: CatalogUpdateSummary[] }> {
  return apiRequest('/api/registry/updates')
}

export function loadCatalogUpdatePreview(linkId: number): Promise<CatalogUpdatePreview> {
  return apiRequest(`/api/registry/links/${linkId}/update-preview`)
}

export function applyCatalogUpdate(linkId: number): Promise<ProjectState> {
  return apiRequest(`/api/registry/links/${linkId}/apply-update`, { method: 'POST' })
}
