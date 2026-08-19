import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemsUtilizationBar } from '@/components/workbook/systems/systems-utilization-bar'

describe('SystemsUtilizationBar', () => {
  let currentTime = 0
  let nextFrameId = 1
  let frames = new Map<number, FrameRequestCallback>()
  let reducedMotion = false

  beforeEach(() => {
    currentTime = 0
    nextFrameId = 1
    frames = new Map()
    reducedMotion = false
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: reducedMotion,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const advanceAnimation = (timestamp: number) => {
    currentTime = timestamp
    const pending = [...frames.values()]
    frames.clear()
    act(() => pending.forEach((callback) => callback(timestamp)))
  }

  it.each([
    [2, '02%'],
    [20, '20%'],
    [100, '100%'],
  ])('reserves a compact stable label track for %s percent', (value, label) => {
    render(<SystemsUtilizationBar value={value} kind="cpu" />)

    const percentage = screen.getByText(label)
    expect(percentage).toHaveClass('w-[3.5ch]', 'text-left')
    expect(percentage.parentElement).toHaveClass('min-w-[125px]', 'grid-cols-[3.5ch_minmax(0,1fr)]')
    expect(percentage.parentElement).not.toHaveClass('gap-0.5')
  })

  it('renders only effective memory pressure and reclaimable or available space', () => {
    const { container } = render(<SystemsUtilizationBar value={28} kind="memory" />)

    expect(container.querySelector('[data-memory-segment="used"]')).toHaveClass('bg-[#3f8f6f]')
    expect(container.querySelector('[data-memory-segment="used"]')).toHaveStyle({ width: '28%' })
    expect(container.querySelector('[data-memory-segment="buffers"]')).toBeNull()
    expect(container.querySelector('[data-memory-segment="cache"]')).toBeNull()
    expect(container.querySelector('[data-memory-segment="shared"]')).toBeNull()
    expect(screen.getByRole('img')).toHaveAccessibleName('memory utilization 28 percent')
  })

  it('renders the initial value immediately and animates later increases', () => {
    const view = render(<SystemsUtilizationBar value={20} kind="cpu" />)
    const fill = view.container.querySelector('[data-utilization-fill]')

    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(fill).toHaveStyle({ width: '20%' })
    expect(frames.size).toBe(0)

    view.rerender(<SystemsUtilizationBar value={80} kind="cpu" />)

    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(fill).toHaveStyle({ width: '80%' })
    expect(frames.size).toBe(1)

    advanceAnimation(300)
    expect(screen.getByText('73%')).toBeInTheDocument()

    advanceAnimation(600)
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName('cpu utilization 80 percent')
    expect(frames.size).toBe(0)
  })

  it('animates decreases and starts replacement targets from the displayed value', () => {
    const view = render(<SystemsUtilizationBar value={80} kind="cpu" />)

    view.rerender(<SystemsUtilizationBar value={20} kind="cpu" />)
    advanceAnimation(300)
    expect(screen.getByText('28%')).toBeInTheDocument()

    view.rerender(<SystemsUtilizationBar value={60} kind="cpu" />)
    expect(screen.getByText('28%')).toBeInTheDocument()

    advanceAnimation(600)
    expect(screen.getByText('56%')).toBeInTheDocument()
    advanceAnimation(900)
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('updates immediately for reduced motion and does not schedule frames', () => {
    reducedMotion = true
    const view = render(<SystemsUtilizationBar value={20} kind="memory" />)

    view.rerender(<SystemsUtilizationBar value={80} kind="memory" />)

    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(frames.size).toBe(0)
    expect(view.container.querySelector('[data-utilization-fill]')).not.toHaveClass('transition-[width]')
  })

  it('clamps invalid values and avoids work for an unchanged target', () => {
    const high = render(<SystemsUtilizationBar value={Number.POSITIVE_INFINITY} kind="storage" />)
    expect(screen.getByText('00%')).toBeInTheDocument()
    expect(high.container.querySelector('[data-utilization-fill]')).toHaveStyle({ width: '0%' })
    high.unmount()

    const view = render(<SystemsUtilizationBar value={120} kind="storage" />)
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(view.container.querySelector('[data-utilization-fill]')).toHaveStyle({ width: '100%' })

    view.rerender(<SystemsUtilizationBar value={120} kind="storage" />)
    expect(frames.size).toBe(0)
  })

  it('changes storage severity with the displayed value', () => {
    const view = render(<SystemsUtilizationBar value={79} kind="storage" />)
    const fill = view.container.querySelector('[data-utilization-fill]')
    expect(fill).toHaveClass('bg-[#3f8f6f]')

    view.rerender(<SystemsUtilizationBar value={95} kind="storage" />)
    expect(fill).toHaveClass('bg-[#3f8f6f]')

    advanceAnimation(300)
    expect(fill).toHaveClass('bg-[#b34f43]')
  })

  it('cancels pending animation work when unmounted', () => {
    const cancel = vi.mocked(window.cancelAnimationFrame)
    const view = render(<SystemsUtilizationBar value={20} kind="cpu" />)
    view.rerender(<SystemsUtilizationBar value={80} kind="cpu" />)
    const [frameId] = frames.keys()

    view.unmount()

    expect(cancel).toHaveBeenCalledWith(frameId)
    expect(frames.size).toBe(0)
  })
})
