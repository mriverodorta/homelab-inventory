import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import type { SystemsInitialResponse, SystemsLiveResponse } from '@/types/systems'

const liveEtags = new Map<number, string>()
const liveResponses = new Map<number, SystemsLiveResponse>()

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`)
  }
  return await response.json() as T
}

export async function loadSystems(projectId: number): Promise<SystemsInitialResponse> {
  return responseJson(await fetchWithTimeout(`/api/projects/${projectId}/systems`))
}

export async function loadSystemsLive(projectId: number): Promise<SystemsLiveResponse> {
  const etag = liveEtags.get(projectId)
  const response = await fetchWithTimeout(`/api/projects/${projectId}/systems/live`, {
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  if (response.status === 304) {
    const cached = liveResponses.get(projectId)
    if (cached) return cached
    throw new Error('Systems live cache was unavailable after a not-modified response.')
  }
  const payload = await responseJson<SystemsLiveResponse>(response)
  const responseEtag = response.headers.get('etag')
  if (responseEtag) liveEtags.set(projectId, responseEtag)
  liveResponses.set(projectId, payload)
  return payload
}

export function resetSystemsLiveCache(projectId?: number) {
  if (projectId === undefined) {
    liveEtags.clear()
    liveResponses.clear()
    return
  }
  liveEtags.delete(projectId)
  liveResponses.delete(projectId)
}
