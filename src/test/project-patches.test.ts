import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/lib/project'
import { applyProjectPatch } from '../engine/project-patches'

describe('project engine patches', () => {
  it('changes only project metadata and revision references', () => {
    const project = createEmptyProject()
    const result = applyProjectPatch(
      project,
      { kind: 'set-project-name', payload: { name: 'Rack Lab' } },
      2,
    )

    expect(result).not.toBe(project)
    expect(result.metadata).not.toBe(project.metadata)
    expect(result.metadata.name).toBe('Rack Lab')
    expect(result.revision).toBe(2)
    expect(result.items).toBe(project.items)
    expect(result.placements).toBe(project.placements)
    expect(result.assignments).toBe(project.assignments)
    expect(result.connections).toBe(project.connections)
  })
})
