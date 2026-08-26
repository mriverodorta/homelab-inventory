import {
  decodeEngineResponse,
  decodeEngineSnapshot,
  type EngineResponse,
  type EngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineApi } from './types'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { parseWorkspaceRoute } from '@/lib/workspace-route'
import {
  assertEngineWorkspaceScope,
  type EngineWorkspaceScope,
} from '@/engine/runtime-scope'

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

export function scopedEngineUrl(path: string, providedScope?: EngineWorkspaceScope) {
  const scope = providedScope ?? (() => {
    if (typeof window === 'undefined') return null
    const route = parseWorkspaceRoute(window.location.pathname)
    return route ? { projectId: route.projectId, workspaceId: route.workspaceId } : null
  })()
  if (!scope) return path
  assertEngineWorkspaceScope(scope)
  const query = new URLSearchParams({
    projectId: String(scope.projectId),
    workspaceId: String(scope.workspaceId),
  })
  return `${path}?${query.toString()}`
}

export type DomainEngineApiOptions = {
  scope?: EngineWorkspaceScope
  fetchImpl?: typeof fetch
}

export function createDomainEngineApi({
  scope,
  fetchImpl = fetch,
}: DomainEngineApiOptions = {}): DomainEngineApi {
  if (scope) assertEngineWorkspaceScope(scope)
  return {
    async fetchSnapshot(): Promise<{ snapshot: EngineSnapshot; bytes: Uint8Array }> {
      const response = await fetchWithTimeout(
        scopedEngineUrl('/api/engine/snapshot', scope),
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
        scopedEngineUrl('/api/engine/commands', scope),
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
