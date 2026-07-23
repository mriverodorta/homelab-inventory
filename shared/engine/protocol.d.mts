export const ENGINE_PROTOCOL_VERSION: 1

export type EngineSnapshot = {
  revision: number
  project_name: string
}

export type EngineOperation =
  | { kind: 'status' }
  | { kind: 'update-project-metadata'; payload: { name: string } }

export type EngineRequest = {
  protocol_version: 1
  request_id: number
  base_revision: number
  operation: EngineOperation
}

export type ProjectPatch = {
  kind: 'set-project-name'
  payload: { name: string }
}

export type EngineResponseBody =
  | { kind: 'status'; payload: { revision: number; project_name: string } }
  | {
      kind: 'patch'
      payload: { revision: number; forward: ProjectPatch; inverse: ProjectPatch }
    }
  | { kind: 'error'; payload: { code: string; message: string } }

export type EngineResponse = {
  protocol_version: 1
  request_id: number
  base_revision: number
  result: EngineResponseBody
}

export function encodeEngineSnapshot(snapshot: EngineSnapshot): Uint8Array
export function decodeEngineSnapshot(bytes: ArrayBuffer | Uint8Array): EngineSnapshot
export function encodeEngineRequest(request: EngineRequest): Uint8Array
export function decodeEngineRequest(bytes: ArrayBuffer | Uint8Array): EngineRequest
export function encodeEngineResponse(response: EngineResponse): Uint8Array
export function decodeEngineResponse(bytes: ArrayBuffer | Uint8Array): EngineResponse
