import { describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, RequestTimeoutError } from '@/lib/fetch-with-timeout'

describe('fetchWithTimeout', () => {
  it('aborts a stalled request at the configured deadline', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    )) as unknown as typeof fetch

    const request = fetchWithTimeout('/api/project', {}, { fetchImpl, timeoutMs: 250 })
    const rejection = expect(request).rejects.toBeInstanceOf(RequestTimeoutError)

    await vi.advanceTimersByTimeAsync(250)
    await rejection
    expect(fetchImpl).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('preserves caller-driven aborts instead of reporting a timeout', async () => {
    const caller = new AbortController()
    const abortError = new DOMException('Caller stopped the request.', 'AbortError')
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError))
      })
    )) as unknown as typeof fetch

    const request = fetchWithTimeout('/api/project', { signal: caller.signal }, { fetchImpl })
    caller.abort()

    await expect(request).rejects.toBe(abortError)
  })

  it('clears its timer after a successful response', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const response = new Response('{}', { status: 200 })

    await expect(fetchWithTimeout('/api/project', {}, {
      fetchImpl: vi.fn().mockResolvedValue(response),
    })).resolves.toBe(response)

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
    vi.useRealTimers()
  })
})
