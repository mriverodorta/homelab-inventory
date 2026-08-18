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
})
