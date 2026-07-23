import type { EngineResponse, ProjectPatch } from '../../shared/engine/protocol.mjs'
import type { ProjectState } from '@/types/inventory'

export function applyProjectPatch(
  project: ProjectState,
  patch: ProjectPatch,
  revision: number,
): ProjectState {
  if (patch.kind === 'set-project-name') {
    return {
      ...project,
      revision,
      metadata: {
        ...project.metadata,
        name: patch.payload.name,
      },
    }
  }
  return project
}

export function applyEngineResponsePatch(project: ProjectState, response: EngineResponse) {
  if (response.result.kind !== 'patch') return project
  return applyProjectPatch(
    project,
    response.result.payload.forward,
    response.result.payload.revision,
  )
}
