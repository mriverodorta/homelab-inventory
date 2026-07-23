import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasActivityIndicator } from '@/components/canvas-activity-indicator'

describe('CanvasActivityIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('delays transient progress so short work does not flash', () => {
    const { rerender } = render(
      <CanvasActivityIndicator activity={{ kind: 'progress', label: 'Routing cables' }} />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(console.info).toHaveBeenCalledWith('[Canvas activity]', 'Routing cables')
    act(() => vi.advanceTimersByTime(149))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('status')).toHaveTextContent('Routing cables')

    rerender(<CanvasActivityIndicator activity={null} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows persistent failures immediately', () => {
    render(
      <CanvasActivityIndicator activity={{ kind: 'error', label: 'Cable routing failed' }} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Cable routing failed')
    expect(console.error).toHaveBeenCalledWith('[Canvas activity]', 'Cable routing failed')
  })

  it('deduplicates consecutive messages and resets after activity clears', () => {
    const { rerender } = render(
      <CanvasActivityIndicator activity={{ kind: 'progress', label: 'Routing cables' }} />,
    )

    rerender(<CanvasActivityIndicator activity={{ kind: 'progress', label: 'Routing cables' }} />)
    expect(console.info).toHaveBeenCalledTimes(1)

    rerender(<CanvasActivityIndicator activity={null} />)
    rerender(<CanvasActivityIndicator activity={{ kind: 'progress', label: 'Routing cables' }} />)
    expect(console.info).toHaveBeenCalledTimes(2)
  })
})
