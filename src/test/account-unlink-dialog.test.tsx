import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccountUnlinkDialog } from '@/components/settings/sharing/account-unlink-dialog'

describe('AccountUnlinkDialog', () => {
  it('defaults to retaining remote shares and explains that sharing remains connected', () => {
    const onConfirm = vi.fn()
    render(<AccountUnlinkDialog open username="maikeldorta" pending={false} error={null} onOpenChange={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText(/connection and signing identity remain active/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Keep shares online/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink account' }))
    expect(onConfirm).toHaveBeenCalledWith('keep', null)
  })

  it('requires exact DELETE confirmation for permanent remote deletion', () => {
    const onConfirm = vi.fn()
    render(<AccountUnlinkDialog open username={null} pending={false} error={null} onOpenChange={vi.fn()} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('radio', { name: /Permanently delete all shares/ }))
    const submit = screen.getByRole('button', { name: 'Unlink account' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    fireEvent.click(submit)
    expect(onConfirm).toHaveBeenCalledWith('delete', 'DELETE')
  })
})
