import { describe, expect, test } from 'bun:test'
import {
  PROJECT_ICON_KEYS,
  WORKSPACE_COLOR_KEYS,
  WORKSPACE_ICON_KEYS,
  assertProjectIconKey,
  assertWorkspaceAppearance,
} from './project-contract.ts'

describe('project workbook contracts', () => {
  test('exposes only curated project and workspace presentation values', () => {
    expect(PROJECT_ICON_KEYS).toContain('folder')
    expect(WORKSPACE_ICON_KEYS).toContain('network')
    expect(WORKSPACE_COLOR_KEYS).toContain('blue')
    expect(() => assertProjectIconKey('untrusted-icon-name')).toThrow(/project icon/iu)
    expect(() => assertWorkspaceAppearance({ iconKey: 'network', colorKey: 'blue' })).not.toThrow()
    expect(() => assertWorkspaceAppearance({ iconKey: 'untrusted', colorKey: 'blue' })).toThrow(/workspace icon/iu)
    expect(() => assertWorkspaceAppearance({ iconKey: 'network', colorKey: 'transparent' })).toThrow(/workspace color/iu)
  })
})
