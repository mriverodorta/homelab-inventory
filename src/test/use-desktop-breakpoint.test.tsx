import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesktopBreakpoint } from '@/hooks/use-desktop-breakpoint'

const media = {
  matches: true,
  listener: null as (() => void) | null,
  remove: vi.fn(),
}

describe('useDesktopBreakpoint', () => {
  beforeEach(() => {
    media.matches = true
    media.listener = null
    media.remove.mockReset()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() {
        return media.matches
      },
      addEventListener: (_event: string, listener: () => void) => {
        media.listener = listener
      },
      removeEventListener: media.remove,
    })))
  })

  it('tracks both sides of the desktop breakpoint and removes its listener', () => {
    const view = renderHook(() => useDesktopBreakpoint())
    expect(view.result.current).toBe(true)

    media.matches = false
    act(() => media.listener?.())
    expect(view.result.current).toBe(false)

    view.unmount()
    expect(media.remove).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
