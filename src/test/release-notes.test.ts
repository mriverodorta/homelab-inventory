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

  it('has structured settings simplification notes for the package version under development', () => {
    expect(hasReleaseNoteForVersion(RELEASE_NOTES, '0.1.29')).toBe(true)
    expect(RELEASE_NOTES[0]).toEqual(
      expect.objectContaining({
        version: '0.1.29',
        title: 'Focused application settings',
      }),
    )
    expect(RELEASE_NOTES.filter((entry) => entry.channel === 'latest')).toEqual([
      expect.objectContaining({ version: '0.1.29' }),
    ])

    const settingsRelease = RELEASE_NOTES[0]
    const releaseText = [
      ...(settingsRelease?.highlights ?? []),
      ...(settingsRelease?.fixes ?? []),
      ...(settingsRelease?.notes ?? []),
    ].join(' ')

    expect(releaseText).toMatch(/General, Project, Updates, and About/i)
    expect(releaseText).toMatch(/product overview.*inventory.*canvas.*compatibility.*cabling/i)
    expect(releaseText).toMatch(/mounted data persistence/i)
    expect(releaseText).toMatch(/Removed the redundant System category/i)
    expect(releaseText).toMatch(/Removed repetitive Environment, Project, and This Browser pills/i)
  })

  it('retains structured compatibility-policy and audit-ignore notes for version 0.1.27', () => {
    expect(hasReleaseNoteForVersion(RELEASE_NOTES, '0.1.27')).toBe(true)
    expect(RELEASE_NOTES.find((entry) => entry.version === '0.1.27')).toEqual(
      expect.objectContaining({
        version: '0.1.27',
        title: 'Compatibility policies and audit acknowledgements',
        channel: 'release',
      }),
    )
    expect(RELEASE_NOTES.find((entry) => entry.version === '0.1.26')).toEqual(
      expect.objectContaining({ channel: 'release' }),
    )

    const compatibilityRelease = RELEASE_NOTES.find((entry) => entry.version === '0.1.27')
    const releaseText = [
      ...(compatibilityRelease?.highlights ?? []),
      ...(compatibilityRelease?.fixes ?? []),
      ...(compatibilityRelease?.notes ?? []),
    ].join(' ')

    expect(releaseText).toMatch(/dedicated compatibility editing tabs/i)
    expect(releaseText).toMatch(/servers and NAS devices can opt out/i)
    expect(releaseText).toMatch(/ignored view.*ignored.*active audit/i)
    expect(releaseText).toMatch(/physical slot, cardinality, and resource limits.*matching is disabled/i)
    expect(releaseText).toMatch(/failed.*policy.*audit-ignore saves.*roll back/i)
    expect(releaseText).toMatch(/deterministic warning IDs.*avoid collisions.*different hosts/i)
    expect(releaseText).toMatch(/schema 8 migration.*backup/i)
    expect(releaseText).toMatch(/ignored warning IDs.*project-scoped.*dormant/i)
    expect(releaseText).toMatch(/opt-out suppresses only compatibility warnings/i)
  })
})
