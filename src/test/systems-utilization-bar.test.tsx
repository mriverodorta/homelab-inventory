import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SystemsUtilizationBar } from '@/components/workbook/systems/systems-utilization-bar'

describe('SystemsUtilizationBar', () => {
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
})
