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

  it('returns matching entries in descending semantic-version order without mutating the source', () => {
    const sourceEntries = [
      {
        version: '0.1.10',
        date: '2026-07-09',
        channel: 'stable' as const,
        title: 'Current release',
        highlights: ['Current item'],
        fixes: [],
      },
      {
        version: '0.1.9',
        date: '2026-07-08',
        channel: 'stable' as const,
        title: 'Earlier release',
        highlights: ['Earlier item'],
        fixes: [],
      },
      {
        version: '0.1.2',
        date: '2026-07-01',
        channel: 'release' as const,
        title: 'Oldest release',
        highlights: ['Oldest item'],
        fixes: [],
      },
      {
        version: '0.1.11',
        date: '2026-07-09',
        channel: 'latest' as const,
        title: 'Future release',
        highlights: ['Future item'],
        fixes: [],
      },
    ]
    const originalEntries = structuredClone(sourceEntries)

    const entries = getReleaseNotesBetween(
      sourceEntries,
      '0.1.1',
      '0.1.10',
    )

    expect(entries.map((entry) => entry.version)).toEqual(['0.1.10', '0.1.9', '0.1.2'])
    expect(sourceEntries).toEqual(originalEntries)
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

  it('has structured compatibility notes for the package version under development', () => {
    expect(hasReleaseNoteForVersion(RELEASE_NOTES, '0.1.26')).toBe(true)
    expect(RELEASE_NOTES[0]).toEqual(
      expect.objectContaining({
        version: '0.1.26',
        title: 'Hardware compatibility rules',
      }),
    )
    expect(RELEASE_NOTES.filter((entry) => entry.channel === 'latest')).toEqual([
      expect.objectContaining({ version: '0.1.26' }),
    ])

    const compatibilityRelease = RELEASE_NOTES[0]
    const releaseText = [
      ...(compatibilityRelease?.highlights ?? []),
      ...(compatibilityRelease?.fixes ?? []),
      ...(compatibilityRelease?.notes ?? []),
    ].join(' ')

    expect(releaseText).toMatch(/known-invalid|known incompatible/i)
    expect(releaseText).toMatch(/unknown/i)
    expect(releaseText).toMatch(/deterministic.*allocat/i)
    expect(releaseText).toMatch(/compatibility.*tab/i)
    expect(releaseText).toMatch(/audit/i)
    expect(releaseText).toMatch(/schema 7/i)
    expect(releaseText).toMatch(/backup|migration/i)
  })
})
