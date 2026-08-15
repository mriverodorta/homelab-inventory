import { describe, expect, it } from 'vitest'
import {
  currentRegistryUpdateEvaluations,
  registryUpdateCounts,
  registryUpdateGroups,
} from './catalog-update-projection.mjs'

const link = {
  id: 1,
  itemId: 22,
  itemType: 'cpu',
  templateKey: 'cpu-intel-i7-10700t',
  importedRevision: 1,
  importedContentHash: 'a'.repeat(64),
  availableRevision: 3,
  availableContentHash: 'c'.repeat(64),
  state: 'update-available',
}

function evaluation(overrides = {}) {
  return {
    id: 1,
    linkId: 1,
    fromRevision: 1,
    toRevision: 3,
    targetContentHash: 'c'.repeat(64),
    classification: 'review-required',
    decision: 'pending',
    reasons: ['identity-change'],
    changes: [],
    evaluatedAtMs: 100,
    ...overrides,
  }
}

describe('current Registry update projection', () => {
  it('selects one latest matching evaluation per link and leaves history intact', () => {
    const rows = [
      evaluation({ id: 1, toRevision: 2, targetContentHash: 'b'.repeat(64), evaluatedAtMs: 50 }),
      evaluation({ id: 2, evaluatedAtMs: 100 }),
      evaluation({ id: 3, evaluatedAtMs: 100, classification: 'safe', reasons: [] }),
    ]

    expect(currentRegistryUpdateEvaluations(rows, [link])).toEqual([rows[2]])
    expect(rows).toHaveLength(3)
  })

  it('keeps applied and pending members of one target in separate states', () => {
    const second = { ...link, id: 2, itemId: 23, importedRevision: 3, importedContentHash: 'c'.repeat(64), state: 'linked', availableRevision: undefined, availableContentHash: undefined }
    const groups = registryUpdateGroups({
      links: [link, second],
      evaluations: [
        evaluation({ id: 1, linkId: 1 }),
        evaluation({ id: 2, linkId: 2, decision: 'applied', evaluatedAtMs: 90 }),
      ],
      catalogRevision: 18,
      projectRevisions: { 1: 60 },
    })

    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'review', members: [expect.objectContaining({ linkId: 1 })] }),
      expect.objectContaining({ status: 'applied', members: [expect.objectContaining({ linkId: 2 })] }),
    ]))
    expect(registryUpdateCounts(groups)).toEqual({ review: 1, blocked: 0, applied: 1, declined: 0 })
  })

  it('allows reconsideration only while the declined target is still current', () => {
    const declined = evaluation({ decision: 'declined' })
    const current = registryUpdateGroups({ links: [link], evaluations: [declined] })[0]
    const superseded = registryUpdateGroups({
      links: [{ ...link, availableRevision: 4, availableContentHash: 'd'.repeat(64) }],
      evaluations: [declined],
    })[0]

    expect(current).toMatchObject({ status: 'declined', reconsiderable: true })
    expect(superseded).toMatchObject({ status: 'declined', reconsiderable: false })
  })

  it('aggregates mixed per-link classifications without duplicating a member', () => {
    const second = { ...link, id: 2, itemId: 23 }
    const groups = registryUpdateGroups({
      links: [link, second],
      evaluations: [
        evaluation({ id: 1, linkId: 1, classification: 'review-required' }),
        evaluation({ id: 2, linkId: 2, classification: 'blocked', reasons: ['connected-port-change'] }),
        evaluation({ id: 3, linkId: 2, classification: 'blocked', reasons: ['connected-port-change'], evaluatedAtMs: 50 }),
      ],
      catalogRevision: 18,
      projectRevisions: { 1: 60 },
    })

    expect(groups.filter((group) => ['review', 'blocked'].includes(group.status))).toEqual([
      expect.objectContaining({ status: 'blocked', members: [expect.objectContaining({ linkId: 2 })] }),
      expect.objectContaining({ status: 'review', members: [expect.objectContaining({ linkId: 1 })] }),
    ])
    expect(groups.every((group) => group.concurrencyToken.match(/^[a-f0-9]{64}$/))).toBe(true)
  })

  it('changes the concurrency token when project or link state changes', () => {
    const first = registryUpdateGroups({ links: [link], evaluations: [evaluation()], catalogRevision: 18, projectRevisions: { 1: 60 } })[0]
    const projectChanged = registryUpdateGroups({ links: [link], evaluations: [evaluation()], catalogRevision: 18, projectRevisions: { 1: 61 } })[0]
    const linkChanged = registryUpdateGroups({ links: [{ ...link, importedRevision: 2 }], evaluations: [evaluation()], catalogRevision: 18, projectRevisions: { 1: 60 } })[0]

    expect(projectChanged.concurrencyToken).not.toBe(first.concurrencyToken)
    expect(linkChanged.concurrencyToken).not.toBe(first.concurrencyToken)
  })

  it('ignores revisions from projects unrelated to the group membership', () => {
    const projectIdsByLinkId = new Map([[1, [1]]])
    const first = registryUpdateGroups({ links: [link], evaluations: [evaluation()], projectIdsByLinkId, projectRevisions: { 1: 60, 2: 20 } })[0]
    const unrelated = registryUpdateGroups({ links: [link], evaluations: [evaluation()], projectIdsByLinkId, projectRevisions: { 1: 60, 2: 21 } })[0]

    expect(unrelated.concurrencyToken).toBe(first.concurrencyToken)
  })
})
