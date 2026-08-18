import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SystemsUtilizationBar } from '@/components/workbook/systems/systems-utilization-bar'

describe('SystemsUtilizationBar', () => {
  it.each([
    [2, '02%'],
    [20, '20%'],
    [100, '100%'],
  ])('reserves a stable four-character label track for %s percent', (value, label) => {
    render(<SystemsUtilizationBar value={value} kind="cpu" />)

    const percentage = screen.getByText(label)
    expect(percentage).toHaveClass('w-[4ch]', 'text-left')
    expect(percentage.parentElement).toHaveClass('grid-cols-[4ch_minmax(4rem,1fr)]')
  })

  it('renders bounded Linux memory segments from latest-state counters', () => {
    const { container } = render(<SystemsUtilizationBar
      value={40}
      kind="memory"
      memoryBreakdown={{
        totalBytes: 1_000,
        availableBytes: 600,
        buffersBytes: 100,
        cachedBytes: 250,
        sharedBytes: 50,
      }}
    />)

    expect(container.querySelector('[data-memory-segment="used"]')).toHaveStyle({ width: '40%' })
    expect(container.querySelector('[data-memory-segment="buffers"]')).toHaveStyle({ width: '10%' })
    expect(container.querySelector('[data-memory-segment="cache"]')).toHaveStyle({ width: '25%' })
    expect(container.querySelector('[data-memory-segment="shared"]')).toHaveStyle({ width: '5%' })
    expect(screen.getByRole('img')).toHaveAccessibleName(/used 40%, buffers 10%, cache 25%, shared 5%, available 20%/i)
  })

  it('clamps overlapping memory counters to the remaining track', () => {
    const { container } = render(<SystemsUtilizationBar
      value={40}
      kind="memory"
      memoryBreakdown={{
        totalBytes: 1_000,
        availableBytes: 600,
        buffersBytes: 500,
        cachedBytes: 500,
        sharedBytes: 500,
      }}
    />)

    expect(container.querySelector('[data-memory-segment="used"]')).toHaveStyle({ width: '40%' })
    expect(container.querySelector('[data-memory-segment="buffers"]')).toHaveStyle({ width: '50%' })
    expect(container.querySelector('[data-memory-segment="cache"]')).toHaveStyle({ width: '10%' })
    expect(container.querySelector('[data-memory-segment="shared"]')).toBeNull()
  })

  it('keeps incomplete FreeBSD memory data on the green and gray fallback', () => {
    const { container } = render(<SystemsUtilizationBar value={55} kind="memory" memoryBreakdown={null} />)

    expect(container.querySelector('[data-memory-segment="used"]')).toHaveClass('bg-[#3f8f6f]')
    expect(container.querySelector('[data-memory-segment="buffers"]')).toBeNull()
    expect(container.querySelector('[data-memory-segment="cache"]')).toBeNull()
    expect(container.querySelector('[data-memory-segment="shared"]')).toBeNull()
  })
})
