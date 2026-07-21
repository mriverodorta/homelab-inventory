import { describe, expect, it } from 'vitest'
import {
  clearIgnoredAuditWarnings,
  enableCompatibilityForAllHosts,
  setAuditWarningIgnored,
  setHostCompatibilityEnabled,
} from '@/lib/compatibility-policy'
import type { ProjectState } from '@/types/inventory'

function project(): ProjectState {
  return {
    id: 'default',
    metadata: {
      name: 'Compatibility policy',
      version: 1,
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    items: {},
    placements: [],
    assignments: [],
    connections: [],
    compatibilityPolicy: {
      disabledHosts: [],
      ignoredWarningIds: [],
    },
  }
}

describe('compatibility policy mutations', () => {
  it('disables and re-enables host compatibility without mutating prior states', () => {
    const input = project()
    const disabled = setHostCompatibilityEnabled(input, 'server:1', false)
    const enabled = setHostCompatibilityEnabled(disabled, 'server:1', true)

    expect(disabled).not.toBe(input)
    expect(disabled.compatibilityPolicy).not.toBe(input.compatibilityPolicy)
    expect(disabled.compatibilityPolicy?.disabledHosts).toEqual([
      { hostType: 'server', hostId: 1 },
    ])
    expect(input.compatibilityPolicy?.disabledHosts).toEqual([])
    expect(enabled.compatibilityPolicy?.disabledHosts).toEqual([])
    expect(disabled.compatibilityPolicy?.disabledHosts).toEqual([
      { hostType: 'server', hostId: 1 },
    ])
  })

  it('ignores and unignores warnings without changing disabled hosts or prior states', () => {
    const disabled = setHostCompatibilityEnabled(project(), 'server:1', false)
    const warningId = 'compatibility:["server:1"]'
    const ignored = setAuditWarningIgnored(disabled, warningId, true)
    const unignored = setAuditWarningIgnored(ignored, warningId, false)

    expect(ignored.compatibilityPolicy?.disabledHosts).toEqual([
      { hostType: 'server', hostId: 1 },
    ])
    expect(ignored.compatibilityPolicy?.ignoredWarningIds).toEqual([warningId])
    expect(disabled.compatibilityPolicy?.ignoredWarningIds).toEqual([])
    expect(unignored.compatibilityPolicy).toEqual({
      disabledHosts: [{ hostType: 'server', hostId: 1 }],
      ignoredWarningIds: [],
    })
    expect(ignored.compatibilityPolicy?.ignoredWarningIds).toEqual([warningId])
  })

  it('normalizes legacy projects and does not duplicate policy entries', () => {
    const input = { ...project(), compatibilityPolicy: undefined }
    const disabled = setHostCompatibilityEnabled(input, 'server:1', false)
    const disabledAgain = setHostCompatibilityEnabled(disabled, 'server:1', false)
    const ignored = setAuditWarningIgnored(disabledAgain, 'warning:1', true)
    const ignoredAgain = setAuditWarningIgnored(ignored, 'warning:1', true)

    expect(disabledAgain.compatibilityPolicy?.disabledHosts).toEqual([
      { hostType: 'server', hostId: 1 },
    ])
    expect(ignoredAgain.compatibilityPolicy?.ignoredWarningIds).toEqual(['warning:1'])
    expect(input.compatibilityPolicy).toBeUndefined()
  })

  it('clears ignored warnings while preserving disabled hosts and prior states', () => {
    const input = project()
    input.compatibilityPolicy = {
      disabledHosts: [{ hostType: 'server', hostId: 1 }],
      ignoredWarningIds: ['warning:1'],
    }

    const cleared = clearIgnoredAuditWarnings(input)

    expect(cleared).not.toBe(input)
    expect(cleared.compatibilityPolicy).not.toBe(input.compatibilityPolicy)
    expect(cleared.compatibilityPolicy).toEqual({
      disabledHosts: [{ hostType: 'server', hostId: 1 }],
      ignoredWarningIds: [],
    })
    expect(input.compatibilityPolicy?.ignoredWarningIds).toEqual(['warning:1'])
  })

  it('enables compatibility for every host while preserving ignored warnings', () => {
    const input = project()
    input.compatibilityPolicy = {
      disabledHosts: [{ hostType: 'server', hostId: 1 }],
      ignoredWarningIds: ['warning:1'],
    }

    const enabled = enableCompatibilityForAllHosts(input)

    expect(enabled).not.toBe(input)
    expect(enabled.compatibilityPolicy).not.toBe(input.compatibilityPolicy)
    expect(enabled.compatibilityPolicy).toEqual({
      disabledHosts: [],
      ignoredWarningIds: ['warning:1'],
    })
    expect(input.compatibilityPolicy?.disabledHosts).toEqual([
      { hostType: 'server', hostId: 1 },
    ])
  })

  it('normalizes legacy projects for bulk policy actions', () => {
    const input = { ...project(), compatibilityPolicy: undefined }

    expect(clearIgnoredAuditWarnings(input).compatibilityPolicy).toEqual({
      disabledHosts: [],
      ignoredWarningIds: [],
    })
    expect(enableCompatibilityForAllHosts(input).compatibilityPolicy).toEqual({
      disabledHosts: [],
      ignoredWarningIds: [],
    })
    expect(input.compatibilityPolicy).toBeUndefined()
  })
})
