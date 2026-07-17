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
  test('publishes release tags when the Git tag is absent', () => {
    expect(createStableReleasePlan({
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: '',
      imageName: 'mriverodorta/homelab-inventory',
    })).toEqual({
      state: 'create',
      channel: 'stable',
      verificationTag: 'stable',
      version: '0.1.20',
      gitTag: 'v0.1.20',
      exactTag: '0.1.20',
      minorTag: '0.1',
      dockerTags: [
        'mriverodorta/homelab-inventory:stable',
        'mriverodorta/homelab-inventory:0.1.20',
        'mriverodorta/homelab-inventory:0.1',
      ],
    })
  })

  test('publishes only stable when the release already belongs to this commit', () => {
    expect(createStableReleasePlan({
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: 'abc123',
      imageName: 'mriverodorta/homelab-inventory',
    })).toMatchObject({
      state: 'existing',
      dockerTags: ['mriverodorta/homelab-inventory:stable'],
    })
  })

  test('rejects a version tag owned by another commit', () => {
    expect(() => createStableReleasePlan({
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: 'def456',
      imageName: 'mriverodorta/homelab-inventory',
    })).toThrow('v0.1.20 already points to def456')
  })
})

describe('createBranchReleasePlan', () => {
  test('main publishes only the latest channel tag', () => {
    expect(createBranchReleasePlan({
      branch: 'main',
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: '',
      imageName: 'mriverodorta/homelab-inventory',
    })).toMatchObject({
      state: 'channel',
      channel: 'latest',
      verificationTag: 'latest',
      dockerTags: ['mriverodorta/homelab-inventory:latest'],
    })
  })

  test('rejects publication from another branch', () => {
    expect(() => createBranchReleasePlan({
      branch: 'feature/test',
      version: '0.1.20',
      revision: 'abc123',
      existingTagRevision: '',
      imageName: 'mriverodorta/homelab-inventory',
    })).toThrow('Publication is limited to main and stable')
  })
})
