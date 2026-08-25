import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import type {
  SystemsAttentionResponse,
  SystemsInitialResponse,
  SystemsLiveResponse,
  SystemsSavedView,
  SystemsViewConfiguration,
} from '@/types/systems'

const liveEtags = new Map<string, string>()
const liveResponses = new Map<string, SystemsLiveResponse>()
const viewEtags = new Map<number, string>()
const viewResponses = new Map<number, readonly SystemsSavedView[]>()
const attentionEtags = new Map<string, string>()
const attentionResponses = new Map<string, SystemsAttentionResponse>()

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`)
  }
  return await response.json() as T
}

function canvasQuery(workspaceId: number | null = null) {
  return workspaceId === null ? '' : `?workspaceId=${workspaceId}`
}

function liveCacheKey(projectId: number, workspaceId: number | null = null) {
  return `${projectId}:${workspaceId ?? 'all'}`
}

export async function loadSystems(projectId: number, workspaceId: number | null = null): Promise<SystemsInitialResponse> {
  return responseJson(await fetchWithTimeout(`/api/projects/${projectId}/systems${canvasQuery(workspaceId)}`))
}

export async function loadSystemsLive(projectId: number, workspaceId: number | null = null): Promise<SystemsLiveResponse> {
  const key = liveCacheKey(projectId, workspaceId)
  const etag = liveEtags.get(key)
  const response = await fetchWithTimeout(`/api/projects/${projectId}/systems/live${canvasQuery(workspaceId)}`, {
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  if (response.status === 304) {
    const cached = liveResponses.get(key)
    if (cached) return cached
    throw new Error('Systems live cache was unavailable after a not-modified response.')
  }
  const payload = await responseJson<SystemsLiveResponse>(response)
  const responseEtag = response.headers.get('etag')
  if (responseEtag) liveEtags.set(key, responseEtag)
  liveResponses.set(key, payload)
  return payload
}

export async function loadSystemsViews(projectId: number): Promise<readonly SystemsSavedView[]> {
  const etag = viewEtags.get(projectId)
  const response = await fetchWithTimeout(`/api/projects/${projectId}/systems/views`, {
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  if (response.status === 304) return viewResponses.get(projectId) ?? []
  const payload = await responseJson<{ views: SystemsSavedView[] }>(response)
  const responseEtag = response.headers.get('etag')
  if (responseEtag) viewEtags.set(projectId, responseEtag)
  viewResponses.set(projectId, payload.views)
  return payload.views
}

type SavedViewInput = SystemsViewConfiguration & { name: string }

export async function createSystemsView(projectId: number, input: SavedViewInput) {
  const payload = await responseJson<{ view: SystemsSavedView }>(await fetchWithTimeout(`/api/projects/${projectId}/systems/views`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }))
  resetSystemsViewsCache(projectId)
  return payload.view
}

export async function replaceSystemsView(projectId: number, viewId: number, expectedRevision: number, input: SavedViewInput) {
  const payload = await responseJson<{ view: SystemsSavedView }>(await fetchWithTimeout(`/api/projects/${projectId}/systems/views/${viewId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, expectedRevision }),
  }))
  resetSystemsViewsCache(projectId)
  return payload.view
}

export async function deleteSystemsView(projectId: number, viewId: number, expectedRevision: number) {
  const payload = await responseJson<{ deleted: boolean; id: number }>(await fetchWithTimeout(`/api/projects/${projectId}/systems/views/${viewId}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision }),
  }))
  resetSystemsViewsCache(projectId)
  return payload
}

export async function setDefaultSystemsView(projectId: number, viewId: number, expectedRevision: number) {
  const payload = await responseJson<{ view: SystemsSavedView }>(await fetchWithTimeout(`/api/projects/${projectId}/systems/views/${viewId}/default`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision }),
  }))
  resetSystemsViewsCache(projectId)
  return payload.view
}

export async function loadSystemAttention(projectId: number, hostType: string, hostId: number, workspaceId: number | null = null) {
  const key = `${projectId}:${workspaceId ?? 'all'}:${hostType}:${hostId}`
  const etag = attentionEtags.get(key)
  const response = await fetchWithTimeout(`/api/projects/${projectId}/systems/${hostType}/${hostId}/attention${canvasQuery(workspaceId)}`, {
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  if (response.status === 304) return attentionResponses.get(key) ?? { summary: null, findings: [] }
  const payload = await responseJson<SystemsAttentionResponse>(response)
  const responseEtag = response.headers.get('etag')
  if (responseEtag) attentionEtags.set(key, responseEtag)
  attentionResponses.set(key, payload)
  return payload
}

export function resetSystemsLiveCache(projectId?: number) {
  if (projectId === undefined) {
    liveEtags.clear()
    liveResponses.clear()
    return
  }
  for (const key of liveEtags.keys()) if (key.startsWith(`${projectId}:`)) liveEtags.delete(key)
  for (const key of liveResponses.keys()) if (key.startsWith(`${projectId}:`)) liveResponses.delete(key)
}

export function resetSystemsViewsCache(projectId?: number) {
  if (projectId === undefined) {
    viewEtags.clear()
    viewResponses.clear()
    return
  }
  viewEtags.delete(projectId)
  viewResponses.delete(projectId)
}
