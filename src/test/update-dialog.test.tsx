import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UpdateAvailableButton,
  UpdateDialog,
} from '@/components/update-dialog'
import type { UpdateStatus } from '@/lib/update-api'

const availableStatus: UpdateStatus = {
  enabled: true,
  channel: 'stable',
  runningVersion: '0.1.15',
  runningRevision: 'running-sha-1234567890',
  availableVersion: '0.1.16',
  availableRevision: 'published-sha-0987654321',
  updateAvailable: true,
  skipped: false,
  checkedAt: '2026-07-12T12:00:00.000Z',
  state: 'available',
  errorCode: null,
  entries: [
    {
      version: '0.1.16',
      date: '2026-07-12',
      channel: 'stable',
      title: 'Docker update notifications',
      highlights: ['See new Docker images without opening Docker Hub.'],
      fixes: ['Update checks remain quiet when Docker Hub is unavailable.'],
      notes: ['Watchtower users may still update automatically.'],
    },
  ],
}

function renderDialog(overrides: Partial<ComponentProps<typeof UpdateDialog>> = {}) {
  const props: ComponentProps<typeof UpdateDialog> = {
    open: true,
    status: availableStatus,
    checking: false,
    skipping: false,
    clearingSkip: false,
    onOpenChange: vi.fn(),
    onCheck: vi.fn(),
    onSkip: vi.fn(),
    onClearSkip: vi.fn(),
    ...overrides,
  }

  render(<UpdateDialog {...props} />)
  return props
}

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UpdateAvailableButton', () => {
  it('opens update details when the caller renders it', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<UpdateAvailableButton updateAvailable onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: /update available/i }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('provides an always-accessible neutral updates control', () => {
    render(<UpdateAvailableButton updateAvailable={false} onClick={() => {}} />)

    expect(screen.getByRole('button', { name: /open update status/i })).toHaveTextContent('Updates')
  })

  it('shows a disabled checking state while status is loading', () => {
    render(<UpdateAvailableButton updateAvailable={false} checking onClick={() => {}} />)

    expect(screen.getByRole('button', { name: /checking update status/i })).toBeDisabled()
  })
})

describe('UpdateDialog', () => {
  it('shows the channel, versions, revisions, and structured release notes', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: /update available/i })
    expect(within(dialog).getByText(/stable channel/i)).toBeInTheDocument()
    expect(within(dialog).getByText('Stable image')).toBeInTheDocument()
    expect(within(dialog).getByText('0.1.15')).toBeInTheDocument()
    expect(within(dialog).getAllByText('0.1.16')).toHaveLength(2)
    expect(within(dialog).getByText('running-sha-1234567890')).toBeInTheDocument()
    expect(within(dialog).getByText('published-sha-0987654321')).toBeInTheDocument()
    expect(within(dialog).getByText('Docker update notifications')).toBeInTheDocument()
    expect(within(dialog).getByText('See new Docker images without opening Docker Hub.')).toBeInTheDocument()
    expect(within(dialog).getByText('Update checks remain quiet when Docker Hub is unavailable.')).toBeInTheDocument()
    expect(within(dialog).getByText('Watchtower users may still update automatically.')).toBeInTheDocument()
    expect(within(dialog).getByText(/last checked:/i)).toBeInTheDocument()
  })

  it('copies the compose commands from an explicit action', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderDialog()

    await user.click(screen.getByRole('button', { name: /copy commands/i }))

    expect(writeText).toHaveBeenCalledWith(
      'docker compose pull\ndocker compose up -d',
    )
    expect(screen.getByRole('button', { name: /commands copied/i })).toBeInTheDocument()
  })

  it('invokes refresh, skip, and close callbacks', async () => {
    const user = userEvent.setup()
    const onCheck = vi.fn()
    const onSkip = vi.fn()
    const onOpenChange = vi.fn()
    renderDialog({ onCheck, onSkip, onOpenChange })

    await user.click(screen.getByRole('button', { name: /check now/i }))
    await user.click(screen.getByRole('button', { name: /skip this version/i }))
    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('exposes busy states and prevents repeated actions', () => {
    renderDialog({ checking: true, skipping: true, clearingSkip: true })

    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /skipping/i })).toBeDisabled()
  })

  it('shows failure context and allows a skipped version to be restored', async () => {
    const user = userEvent.setup()
    const onClearSkip = vi.fn()
    renderDialog({
      status: {
        ...availableStatus,
        skipped: true,
        state: 'unknown',
        errorCode: 'registry-timeout',
      },
      onClearSkip,
    })

    expect(screen.getByRole('dialog', { name: /update status unavailable/i })).toBeInTheDocument()
    expect(screen.getByText('Check failed')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /skip this version/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show this version/i }))
    expect(onClearSkip).toHaveBeenCalledTimes(1)
  })

  it('shows current and disabled states without invalid actions', () => {
    const { unmount } = render(
      <UpdateDialog
        open
        status={{
          ...availableStatus,
          state: 'current',
          updateAvailable: false,
          availableVersion: '0.1.15',
          availableRevision: 'running-sha-1234567890',
          entries: [],
        }}
        checking={false}
        skipping={false}
        clearingSkip={false}
        onOpenChange={() => {}}
        onCheck={() => {}}
        onSkip={() => {}}
        onClearSkip={() => {}}
      />,
    )
    expect(screen.getByRole('dialog', { name: /up to date/i })).toBeInTheDocument()
    expect(screen.getByText('Stable image')).toBeInTheDocument()
    expect(screen.getByText(/matches the current stable image/i)).toBeInTheDocument()
    expect(screen.queryByText(/release details are not available/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('update-commands')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /skip this version/i })).not.toBeInTheDocument()
    unmount()

    renderDialog({
      status: {
        ...availableStatus,
        enabled: false,
        state: 'disabled',
        updateAvailable: false,
        availableVersion: null,
        availableRevision: null,
        checkedAt: null,
        entries: [],
      },
    })
    expect(screen.getByRole('dialog', { name: /update checks disabled/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument()
  })

  it('shows an ahead state without presenting the older channel image as an update', () => {
    renderDialog({
      status: {
        ...availableStatus,
        channel: 'latest',
        runningVersion: '0.1.19',
        runningRevision: 'newer-running-revision',
        availableVersion: '0.1.18',
        availableRevision: 'older-latest-revision',
        updateAvailable: false,
        state: 'ahead',
        entries: [],
      },
    })

    const dialog = screen.getByRole('dialog', { name: /ahead of latest/i })
    expect(within(dialog).getByText('Latest image')).toBeInTheDocument()
    expect(within(dialog).getByText(/running version is newer than the current latest image/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/release details are not available/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId('update-commands')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /skip this version/i })).not.toBeInTheDocument()
  })

  it('explains a same-version rebuild and still shows update actions', () => {
    renderDialog({
      status: {
        ...availableStatus,
        channel: 'latest',
        runningVersion: '0.1.19',
        runningRevision: 'older-running-revision',
        availableVersion: '0.1.19',
        availableRevision: 'newer-published-revision',
        updateAvailable: true,
        state: 'available',
        entries: [],
      },
    })

    const dialog = screen.getByRole('dialog', { name: /update available/i })
    expect(within(dialog).getByText('Latest image')).toBeInTheDocument()
    expect(within(dialog).getByText(/rebuilt from a newer commit/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/release details are not available/i)).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('update-commands')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /skip this version/i })).toBeInTheDocument()
  })

  it('keeps diagnostic states free of update instructions', () => {
    const { unmount } = render(
      <UpdateDialog
        open
        status={{
          ...availableStatus,
          state: 'unknown',
          updateAvailable: false,
          entries: [],
          errorCode: 'registry-timeout',
        }}
        checking={false}
        skipping={false}
        clearingSkip={false}
        onOpenChange={() => {}}
        onCheck={() => {}}
        onSkip={() => {}}
        onClearSkip={() => {}}
      />,
    )

    expect(screen.queryByTestId('update-commands')).not.toBeInTheDocument()
    unmount()

    renderDialog({
      status: {
        ...availableStatus,
        enabled: false,
        state: 'disabled',
        updateAvailable: false,
        entries: [],
      },
    })
    expect(screen.queryByTestId('update-commands')).not.toBeInTheDocument()
  })

  it('uses a bounded dialog, scrollable body, wrapping content, and mobile-first controls', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: /update available/i })
    const body = within(dialog).getByTestId('update-dialog-body')
    const versions = within(dialog).getByTestId('update-version-grid')
    const footer = within(dialog).getByTestId('update-dialog-footer')
    const commands = within(dialog).getByTestId('update-commands')

    expect(dialog).toHaveClass('max-h-[calc(100dvh-1rem)]', 'overflow-hidden')
    expect(body).toHaveClass('min-h-0', 'overflow-hidden')
    expect(versions).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
    expect(footer).toHaveClass('shrink-0')
    expect(within(footer).getByRole('button', { name: /check now/i })).toHaveClass('w-full', 'sm:w-auto')
    expect(commands).toHaveClass('whitespace-pre-wrap', 'break-words')
  })
})
