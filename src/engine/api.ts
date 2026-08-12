import {
  decodeEngineResponse,
  decodeEngineSnapshot,
  type EngineResponse,
  type EngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineApi } from './types'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { parseWorkspaceRoute } from '@/lib/workspace-route'

export const ENGINE_MEDIA_TYPE = 'application/vnd.homelab-engine+msgpack'

export class DomainEngineApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, { status, code }: { status: number; code?: string }) {
    super(message)
    this.name = 'DomainEngineApiError'
    this.status = status
    this.code = code
  }
}

async function responseError(response: Response) {
  let body: { message?: string; code?: string } = {}
  try {
    body = await response.json() as typeof body
  } catch {
    // The status text remains the safe fallback for non-JSON proxy errors.
  }
  return new DomainEngineApiError(
    body.message ?? response.statusText ?? 'Engine request failed.',
    { status: response.status, code: body.code },
  )
}

export function scopedEngineUrl(path: string) {
  if (typeof window === 'undefined') return path
  const route = parseWorkspaceRoute(window.location.pathname)
  if (!route) return path
  const query = new URLSearchParams({
    projectId: String(route.projectId),
    workspaceId: String(route.workspaceId),
  })
  return `${path}?${query.toString()}`
}

export function createDomainEngineApi(fetchImpl: typeof fetch = fetch): DomainEngineApi {
  return {
    async fetchSnapshot(): Promise<{ snapshot: EngineSnapshot; bytes: Uint8Array }> {
      const response = await fetchWithTimeout(
        scopedEngineUrl('/api/engine/snapshot'),
        { cache: 'no-store' },
        { fetchImpl },
      )
      if (!response.ok) throw await responseError(response)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { snapshot: decodeEngineSnapshot(bytes), bytes }
    },

    async postCommand(commandBytes): Promise<{ response: EngineResponse; bytes: Uint8Array }> {
      const body = Uint8Array.from(commandBytes).buffer
      const response = await fetchWithTimeout(
        scopedEngineUrl('/api/engine/commands'),
        {
          method: 'POST',
          headers: { 'Content-Type': ENGINE_MEDIA_TYPE },
          body,
        },
        { fetchImpl },
      )
      if (!response.ok) throw await responseError(response)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { response: decodeEngineResponse(bytes), bytes }
    },
  }
}
