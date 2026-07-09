import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  expireDemoSession,
  extendDemoSession,
  formatRemainingSeconds,
  loadDemoSession,
} from '@/lib/demo-api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('demo API helpers', () => {
  it('loads demo session status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'demo',
        expiresAt: '2026-07-09T12:00:00.000Z',
        remainingSeconds: 1800,
      }),
    } as Response)

    await expect(loadDemoSession()).resolves.toEqual({
      mode: 'demo',
      expiresAt: '2026-07-09T12:00:00.000Z',
      remainingSeconds: 1800,
    })
  })

  it('extends and expires demo sessions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: 'demo',
          expiresAt: '2026-07-09T12:30:00.000Z',
          remainingSeconds: 1800,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response)

    await expect(extendDemoSession()).resolves.toMatchObject({ mode: 'demo' })
    await expect(expireDemoSession()).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/demo/session/extend',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/demo/session/expire',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('formats remaining seconds as minutes and seconds', () => {
    expect(formatRemainingSeconds(0)).toBe('0:00')
    expect(formatRemainingSeconds(65)).toBe('1:05')
    expect(formatRemainingSeconds(1800.9)).toBe('30:00')
    expect(formatRemainingSeconds(-5)).toBe('0:00')
  })
})
