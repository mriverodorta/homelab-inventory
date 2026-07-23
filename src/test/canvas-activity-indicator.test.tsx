import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasActivityIndicator } from '@/components/canvas-activity-indicator'

describe('CanvasActivityIndicator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delays transient progress so short work does not flash', () => {
    const { rerender } = render(
      <CanvasActivityIndicator activity={{ kind: 'progress', label: 'Routing cables' }} />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
  })
})
