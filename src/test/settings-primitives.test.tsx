import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ConfirmSettingsAction,
  EnvironmentValue,
  SettingRow,
} from '@/components/settings/settings-primitives'
import { Switch } from '@/components/ui/switch'
import { TooltipProvider } from '@/components/ui/tooltip'

describe('Settings presentation primitives', () => {
  it('renders environment values as selectable read-only content with guidance', async () => {
    render(
      <TooltipProvider>
        <EnvironmentValue label="Data directory" value="/data" />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    const value = screen.getByLabelText('Data directory: read-only environment value')
    expect(value).toHaveTextContent('/data')
    fireEvent.focus(value)
    expect((await screen.findAllByText(/Read-only because this value is derived/)).length).toBeGreaterThan(0)
  })

  it('associates a labeled browser setting with a controlled toggle', () => {
    const onCheckedChange = vi.fn()
    render(
      <SettingRow label="Show inventory">
        <Switch aria-label="Show inventory" checked onCheckedChange={onCheckedChange} />
      </SettingRow>,
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Show inventory' }))
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })

  it('requires confirmation before running a settings action', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmSettingsAction
        title="Reset browser preferences?"
        description="This restores browser-only defaults."
        actionLabel="Reset preferences"
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reset preferences' }))
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset preferences' }).at(-1)!)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
