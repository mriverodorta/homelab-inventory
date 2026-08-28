import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnimatedUtilization } from './use-animated-utilization'

function Metrics({ first, second }: { first: number; second: number }) {
  const left = useAnimatedUtilization(first)
  const right = useAnimatedUtilization(second)
  return <><output data-testid="first">{left.displayed}</output><output data-testid="second">{right.displayed}</output></>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Systems utilization animation', () => {
  it('shares one reduced-motion observer and one animation frame across bars', () => {
    const changeListeners = new Set<() => void>()
    const media = {
      matches: false,
      addEventListener: vi.fn((_name: string, listener: () => void) => changeListeners.add(listener)),
      removeEventListener: vi.fn((_name: string, listener: () => void) => changeListeners.delete(listener)),
    }
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const rendered = render(<Metrics first={10} second={20} />)

    rendered.rerender(<Metrics first={80} second={60} />)

    expect(window.matchMedia).toHaveBeenCalledOnce()
    expect(media.addEventListener).toHaveBeenCalledOnce()
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce()
    const timestamp = performance.now() + 300
    act(() => frames.shift()?.(timestamp))
    expect(Number(screen.getByTestId('first').textContent)).toBeGreaterThan(10)
    expect(Number(screen.getByTestId('second').textContent)).toBeGreaterThan(20)
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2)

    rendered.unmount()
    expect(media.removeEventListener).toHaveBeenCalledOnce()
  })
})
