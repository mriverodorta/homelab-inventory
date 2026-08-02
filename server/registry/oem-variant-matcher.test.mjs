import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchOemVariant } from './oem-variant-matcher.mjs'

async function fixture() {
  return JSON.parse(await fs.readFile(
    path.resolve('test/fixtures/catalog-import/oem/server-specs-inventory-contract.json'),
    'utf8',
  ))
}

describe('OEM variant matcher', () => {
  it('uses authoritative evidence and refuses ambiguous family-only matches', async () => {
    const contract = await fixture()

    for (const testCase of contract.linkingCases) {
      const candidates = testCase.catalogCandidates.map((candidate) => ({
        ...candidate,
        state: 'published',
        revision: candidate.revision ?? 1,
      }))
      const result = matchOemVariant(testCase.localProjection, candidates)

      if (testCase.expected.outcome === 'auto-link') {
        expect(result.outcome, testCase.caseId).toBe('match')
        expect(result.match.templateKey, testCase.caseId).toBe(testCase.expected.templateKey)
      } else {
        expect(result.outcome, testCase.caseId).toBe('ambiguous')
        expect(result.candidates, testCase.caseId).toHaveLength(2)
      }
    }
  })

  it('only falls back to family identity when exactly one published variant exists', async () => {
    const contract = await fixture()
    const testCase = contract.linkingCases.find((entry) => entry.caseId === 'ambiguous-local-family-detached')
    const onlyCandidate = { ...testCase.catalogCandidates[0], state: 'published', revision: 1 }

    const result = matchOemVariant(testCase.localProjection, [onlyCandidate])

    expect(result).toMatchObject({
      outcome: 'match',
      reason: 'single-family-variant',
      match: { templateKey: onlyCandidate.templateKey },
    })
  })

  it('treats an exact OEM variant identifier as authoritative without requiring complete topology', async () => {
    const contract = await fixture()
    const testCase = contract.linkingCases.find((entry) => entry.caseId === 'ambiguous-local-family-detached')
    const expected = testCase.catalogCandidates[1]
    const result = matchOemVariant({
      ...testCase.localProjection,
      variantEvidence: {
        source: 'motherboard',
        completeness: 'partial',
        label: expected.variantEvidence.label,
        variantKey: expected.variantEvidence.variantKey,
      },
    }, testCase.catalogCandidates.map((candidate) => ({
      ...candidate,
      state: 'published',
      revision: 1,
    })))

    expect(result).toMatchObject({
      outcome: 'match',
      reason: 'variant',
      match: { templateKey: expected.templateKey },
    })
  })

  it('ignores non-published and older duplicate template revisions', async () => {
    const contract = await fixture()
    const testCase = contract.linkingCases.find((entry) => entry.caseId === 'exact-board-auto-link')
    const matching = testCase.catalogCandidates.find(
      (candidate) => candidate.templateKey === testCase.expected.templateKey,
    )
    const result = matchOemVariant(testCase.localProjection, [
      { ...matching, state: 'published', revision: 1 },
      { ...matching, state: 'published', revision: 2 },
      { ...matching, state: 'quarantined', revision: 3 },
    ])

    expect(result).toMatchObject({ outcome: 'match', match: { revision: 2 } })
  })
})
