import { describe, expect, it } from 'vitest'
import { classifyPublicationFailure, publicationRetryDelay } from './publication-retry-policy.mjs'

describe('LabGD publication retry policy', () => {
  it('keeps only Registry definition unavailability durably retryable', () => {
    const classification = classifyPublicationFailure({ code: 'registry-definition-unavailable' }, 40)
    expect(classification).toEqual({ disposition: 'durable-registry', maxAttempts: null, delayCapMs: 6 * 60 * 60_000 })
    expect(publicationRetryDelay(classification, 40, null)).toBe(6 * 60 * 60_000)
  })

  it.each([
    [{ name: 'AbortError' }, 'transient'],
    [new TypeError('fetch failed'), 'transient'],
    [{ code: 'labgd-unavailable' }, 'transient'],
    [{ code: 'authentication-failed' }, 'transient'],
    [{ status: 408 }, 'transient'],
    [{ status: 425 }, 'transient'],
    [{ status: 429 }, 'transient'],
    [{ status: 503 }, 'transient'],
  ])('bounds recoverable failure %o', (error, disposition) => {
    expect(classifyPublicationFailure(error, 5)).toMatchObject({ disposition, maxAttempts: 6, delayCapMs: 15 * 60_000 })
    expect(classifyPublicationFailure(error, 6)).toMatchObject({ disposition: 'terminal' })
  })

  it.each([
    { code: 'idempotency-conflict', status: 409 },
    { code: 'publication-ownership-denied', status: 404 },
    { code: 'sharing-publication-integrity-failed' },
    { code: 'sharing-operation-unsupported' },
    { code: 'invalid-request', status: 400 },
    { code: 'unknown-error' },
  ])('fails terminal contract error %o closed', (error) => {
    expect(classifyPublicationFailure(error, 1)).toEqual({ disposition: 'terminal', maxAttempts: 0, delayCapMs: 0 })
  })

  it('honors bounded Retry-After without exceeding the class cap', () => {
    const classification = classifyPublicationFailure({ status: 429 }, 1)
    expect(publicationRetryDelay(classification, 1, 90_000)).toBe(90_000)
    expect(publicationRetryDelay(classification, 1, 24 * 60 * 60_000)).toBe(15 * 60_000)
  })
})
