import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DemoSessionDialog } from '@/components/demo-session-dialog'

describe('DemoSessionDialog', () => {
  it('shows the extension prompt and calls extend', async () => {
    const onExtend = vi.fn()
    const onExpire = vi.fn()

    render(
      <DemoSessionDialog
        state="extend"
        secondsRemaining={30}
        onExtend={onExtend}
        onExpire={onExpire}
      />,
    )

    expect(screen.getByText('Demo session expired')).toBeInTheDocument()
    expect(screen.getByText(/30 seconds/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /extend session/i }))

    expect(onExtend).toHaveBeenCalledTimes(1)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('shows the final expired state', () => {
    render(
      <DemoSessionDialog
        state="expired"
        secondsRemaining={0}
        onExtend={vi.fn()}
        onExpire={vi.fn()}
      />,
    )

    expect(screen.getByText('Demo expired')).toBeInTheDocument()
    expect(screen.getByText('Refresh to start a new demo sandbox.')).toBeInTheDocument()
  })
})
