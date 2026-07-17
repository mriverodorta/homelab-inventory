import { describe, expect, test } from 'vitest'
import { createBranchReleasePlan, createStableReleasePlan, parseReleaseVersion } from './release-plan.mjs'

describe('parseReleaseVersion', () => {
  test('returns immutable and minor Docker tags', () => {
    expect(parseReleaseVersion('0.1.20')).toEqual({
      version: '0.1.20',
      gitTag: 'v0.1.20',
      exactTag: '0.1.20',
      minorTag: '0.1',
    })
  })

  test.each(['v0.1.20', '0.1', '0.1.20-beta.1', '01.1.20', '0.1.20 '])(
    'rejects unsupported version %s',
    (version) => expect(() => parseReleaseVersion(version)).toThrow('Expected a strict X.Y.Z version'),
  )
})

describe('createStableReleasePlan', () => {
  test('plans a new stable release when the Git tag is absent', () => {
    expect(createStableReleasePlan({
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: '',
    })).toEqual({
      state: 'create',
      channel: 'stable',
      verificationTag: 'stable',
      version: '0.1.20',
      gitTag: 'v0.1.20',
      exactTag: '0.1.20',
      minorTag: '0.1',
    })
  })

  test('recognizes a release that already belongs to this commit', () => {
    expect(createStableReleasePlan({
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: 'abc123',
    })).toMatchObject({
      state: 'existing',
    })
  })

  test('rejects a version tag owned by another commit', () => {
    expect(() => createStableReleasePlan({
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: 'def456',
    })).toThrow('v0.1.20 already points to def456')
  })
})

describe('createBranchReleasePlan', () => {
  test('main plans the latest channel', () => {
    expect(createBranchReleasePlan({
      branch: 'main',
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: '',
    })).toMatchObject({
      state: 'channel',
      channel: 'latest',
      verificationTag: 'latest',
    })
  })

  test('rejects publication from another branch', () => {
    expect(() => createBranchReleasePlan({
      branch: 'feature/test',
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: '',
    })).toThrow('Publication is limited to main and stable')
  })
})
