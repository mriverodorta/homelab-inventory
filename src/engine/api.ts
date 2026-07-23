import {
  decodeEngineResponse,
  decodeEngineSnapshot,
  type EngineResponse,
  type EngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineApi } from './types'

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

export function createDomainEngineApi(fetchImpl: typeof fetch = fetch): DomainEngineApi {
  return {
    async fetchSnapshot(): Promise<{ snapshot: EngineSnapshot; bytes: Uint8Array }> {
      const response = await fetchImpl('/api/engine/snapshot', { cache: 'no-store' })
      if (!response.ok) throw await responseError(response)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { snapshot: decodeEngineSnapshot(bytes), bytes }
    },

    async postCommand(commandBytes): Promise<{ response: EngineResponse; bytes: Uint8Array }> {
      const body = Uint8Array.from(commandBytes).buffer
      const response = await fetchImpl('/api/engine/commands', {
        method: 'POST',
        headers: { 'Content-Type': ENGINE_MEDIA_TYPE },
        body,
      })
      if (!response.ok) throw await responseError(response)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { response: decodeEngineResponse(bytes), bytes }
    },
  }
}
