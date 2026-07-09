import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhatsNewDialog } from '@/components/whats-new-dialog'
import type { ReleaseNoteEntry } from '@/release-notes'

const entries: ReleaseNoteEntry[] = [
  {
    version: '0.1.10',
    date: '2026-07-09',
    channel: 'stable',
    title: "What's New release notes",
    highlights: ['Added a VS Code-style update dialog.'],
    fixes: ['Fixed release publishing without structured notes.'],
    notes: ['Only Got it marks notes as seen.'],
  },
]

afterEach(() => {
  cleanup()
})

describe('WhatsNewDialog', () => {
  it('renders grouped release-note sections', () => {
    render(
      <WhatsNewDialog
        open
        currentVersion="0.1.10"
        entries={entries}
        acknowledging={false}
        onAcknowledge={() => {}}
        onOpenChange={() => {}}
      />,
    )

    expect(screen.getByRole('dialog', { name: /what's new in homelab inventory/i })).toBeInTheDocument()
    expect(screen.getByText('0.1.10')).toBeInTheDocument()
    expect(screen.getByText('2026-07-09')).toBeInTheDocument()
    expect(screen.getByText('stable')).toBeInTheDocument()
    expect(screen.getByText('Highlights')).toBeInTheDocument()
    expect(screen.getByText('Added a VS Code-style update dialog.')).toBeInTheDocument()
    expect(screen.getByText('Fixes')).toBeInTheDocument()
    expect(screen.getByText('Fixed release publishing without structured notes.')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Only Got it marks notes as seen.')).toBeInTheDocument()
  })

  it('calls acknowledge only from Got it', async () => {
    const user = userEvent.setup()
    const onAcknowledge = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <WhatsNewDialog
        open
        currentVersion="0.1.10"
        entries={entries}
        acknowledging={false}
        onAcknowledge={onAcknowledge}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /got it/i }))

    expect(onAcknowledge).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('dismisses without acknowledging from the close button', async () => {
    const user = userEvent.setup()
    const onAcknowledge = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <WhatsNewDialog
        open
        currentVersion="0.1.10"
        entries={entries}
        acknowledging={false}
        onAcknowledge={onAcknowledge}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onAcknowledge).not.toHaveBeenCalled()
  })
})
