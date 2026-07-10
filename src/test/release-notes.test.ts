import { describe, expect, it } from 'vitest'
import {
  RELEASE_NOTES,
  compareVersions,
  getReleaseNotesBetween,
  hasReleaseNoteForVersion,
} from '../release-notes'

describe('release notes helpers', () => {
  it('sorts semantic versions from oldest to newest', () => {
    expect(['0.1.10', '0.1.2', '1.0.0'].sort(compareVersions)).toEqual([
      '0.1.2',
      '0.1.10',
      '1.0.0',
    ])
  })

  it('returns entries newer than the last seen version up to the current version', () => {
    const entries = getReleaseNotesBetween(
      [
        {
          version: '0.1.9',
          date: '2026-07-08',
          channel: 'stable',
          title: 'Earlier release',
          highlights: ['Earlier item'],
          fixes: [],
        },
        {
          version: '0.1.10',
          date: '2026-07-09',
          channel: 'stable',
          title: 'Current release',
          highlights: ['Current item'],
          fixes: [],
        },
      ],
      '0.1.8',
      '0.1.10',
    )

    expect(entries.map((entry) => entry.version)).toEqual(['0.1.9', '0.1.10'])
  })

  it('excludes entries newer than the current app version', () => {
    const entries = getReleaseNotesBetween(
      [
        {
          version: '0.1.10',
          date: '2026-07-09',
          channel: 'stable',
          title: 'Current release',
          highlights: ['Current item'],
          fixes: [],
        },
        {
          version: '0.1.11',
          date: '2026-07-10',
          channel: 'latest',
          title: 'Future release',
          highlights: ['Future item'],
          fixes: [],
        },
      ],
      '0.1.9',
      '0.1.10',
    )

    expect(entries.map((entry) => entry.version)).toEqual(['0.1.10'])
  })

  it('has a structured entry for the package version under development', () => {
    expect(hasReleaseNoteForVersion(RELEASE_NOTES, '0.1.12')).toBe(true)
  })
})
