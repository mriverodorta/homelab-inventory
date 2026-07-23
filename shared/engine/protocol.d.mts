export const ENGINE_PROTOCOL_VERSION: 1

export type EngineSnapshot = {
  revision: number
  project_name: string
}

export type GeometryRect = {
  x: number
  y: number
  width: number
  height: number
}

export type GeometryNode = {
  item_id: string
  bounds: GeometryRect
}

export type GeometryHandle = {
  key: string
  item_id: string
  point: { x: number; y: number }
  side: 'left' | 'right' | 'top' | 'bottom'
}

export type EngineOperation =
  | { kind: 'status' }
  | { kind: 'update-project-metadata'; payload: { name: string } }
  | {
      kind: 'replace-geometry'
      payload: { nodes: GeometryNode[]; handles: GeometryHandle[] }
    }
  | {
      kind: 'update-geometry'
      payload: {
        upsert_nodes: GeometryNode[]
        remove_node_ids: string[]
        upsert_handles: GeometryHandle[]
        remove_handle_keys: string[]
      }
    }
  | {
      kind: 'check-placement'
      payload: { item_id: string; bounds: GeometryRect; exclude_item_ids: string[] }
    }
  | { kind: 'check-group-move'; payload: { moves: GeometryNode[] } }
  | {
      kind: 'find-nearest-placement'
      payload: {
        item_id: string
        preferred: GeometryRect
        clearance: number
        step: number
        max_rings: number
      }
    }

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
  | {
      kind: 'status'
      payload: { revision: number; geometry_revision: number; project_name: string }
    }
  | {
      kind: 'patch'
      payload: { revision: number; forward: ProjectPatch; inverse: ProjectPatch }
    }
  | { kind: 'geometry-updated'; payload: { geometry_revision: number } }
  | {
      kind: 'placement-check'
      payload: { valid: boolean; colliding_item_ids: string[] }
    }
  | { kind: 'nearest-placement'; payload: { bounds: GeometryRect | null } }
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
