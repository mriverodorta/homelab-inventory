import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NasPowerConfigurationDialog } from '@/components/nas-power-configuration-dialog'

describe('NasPowerConfigurationDialog', () => {
  it('lists removed cables and the adapter returned to inventory', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <NasPowerConfigurationDialog
        open
        nasName="Storage NAS"
        impact={{
          from: 'external-adapter',
          to: 'internal-psu',
          connections: [{ id: 7, label: 'Rack power' }],
          releasedAdapter: { type: 'powerAdapter', id: 2, name: 'OEM 90W' },
        }}
        busy={false}
        error={null}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText('Remove Rack power')).toBeInTheDocument()
    expect(screen.getByText('Return OEM 90W to inventory')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm change' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
