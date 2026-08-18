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
    expect(percentage.parentElement).toHaveClass('grid-cols-[4ch_minmax(0,1fr)]', 'gap-0.5')
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
