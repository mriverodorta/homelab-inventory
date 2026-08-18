import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import type { HostType } from '@/types/inventory'
import type {
  CompatibilityAuditClassification,
  CompatibilityAuditFindingsResponse,
  CompatibilityAuditSummaryResponse,
} from '@/types/compatibility-audit'

const etags = new Map<string, string>()
const responses = new Map<string, CompatibilityAuditSummaryResponse | CompatibilityAuditFindingsResponse>()

async function cachedJson<T extends CompatibilityAuditSummaryResponse | CompatibilityAuditFindingsResponse>(url: string): Promise<T> {
  const etag = etags.get(url)
  const response = await fetchWithTimeout(url, {
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  if (response.status === 304) {
    const cached = responses.get(url)
    if (cached) return cached as T
    throw new Error('Compatibility audit cache was unavailable after a not-modified response.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Compatibility audit request failed with status ${response.status}.`)
  }
  const payload = await response.json() as T
  const responseEtag = response.headers.get('etag')
  if (responseEtag) etags.set(url, responseEtag)
  responses.set(url, payload)
  return payload
}

export function loadCompatibilitySummary(projectId: number) {
  return cachedJson<CompatibilityAuditSummaryResponse>(`/api/projects/${projectId}/compatibility/summary`)
}

export function loadCompatibilityFindings(projectId: number, filters: {
  classification?: CompatibilityAuditClassification
  hostType?: HostType
  hostId?: number
  visibility?: 'open' | 'ignored' | 'all'
} = {}) {
  const search = new URLSearchParams()
  if (filters.classification) search.set('classification', filters.classification)
  if (filters.hostType) search.set('hostType', filters.hostType)
  if (filters.hostId) search.set('hostId', String(filters.hostId))
  if (filters.visibility) search.set('visibility', filters.visibility)
  const suffix = search.size > 0 ? `?${search.toString()}` : ''
  return cachedJson<CompatibilityAuditFindingsResponse>(`/api/projects/${projectId}/compatibility/findings${suffix}`)
}

export async function setCompatibilityFindingIgnored(projectId: number, findingId: number, ignored: boolean) {
  const response = await fetchWithTimeout(`/api/projects/${projectId}/compatibility/findings/${findingId}/ignore`, {
    method: ignored ? 'PUT' : 'DELETE',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Compatibility audit request failed with status ${response.status}.`)
  }
  resetCompatibilityAuditCache(projectId)
  return await response.json() as { findingId: number; ignored: boolean }
}

export function resetCompatibilityAuditCache(projectId?: number) {
  for (const key of etags.keys()) {
    if (projectId === undefined || key.startsWith(`/api/projects/${projectId}/compatibility/`)) etags.delete(key)
  }
  for (const key of responses.keys()) {
    if (projectId === undefined || key.startsWith(`/api/projects/${projectId}/compatibility/`)) responses.delete(key)
  }
}
