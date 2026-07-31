import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createLazySurface } from '@/components/lazy-surface'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('createLazySurface', () => {
  it('renders a stable local fallback before the module resolves', async () => {
    const module = deferred<{ default: React.ComponentType<{ label: string }> }>()
    const LazyExample = createLazySurface(() => module.promise, {
      displayName: 'Example',
      loadingLabel: 'Loading example',
      loadingClassName: 'min-h-64',
    })

    render(<LazyExample label="Ready" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading example')
    expect(screen.getByRole('status')).toHaveClass('min-h-64')

    await act(async () => {
      module.resolve({ default: ({ label }) => <div>{label}</div> })
      await module.promise
    })
    expect(await screen.findByText('Ready')).toBeInTheDocument()
  })

  it('contains a failed import and retries with a fresh loader call', async () => {
    const first = deferred<{ default: React.ComponentType }>()
    const second = deferred<{ default: React.ComponentType }>()
    const loader = vi
      .fn<() => Promise<{ default: React.ComponentType }>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const LazyExample = createLazySurface(loader, {
      displayName: 'Example',
      loadingLabel: 'Loading example',
    })

    render(
      <div>
        <span>Canvas stays mounted</span>
        <LazyExample />
      </div>,
    )
    await act(async () => first.reject(new Error('chunk failed')))

    expect(await screen.findByRole('alert')).toHaveTextContent('Example could not be loaded')
    expect(screen.getByText('Canvas stays mounted')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await act(async () => {
      second.resolve({ default: () => <div>Recovered</div> })
      await second.promise
    })
    expect(await screen.findByText('Recovered')).toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('offers a surface-specific close action after failure', async () => {
    const close = vi.fn()
    const LazyExample = createLazySurface<{ onClose: () => void }>(
      () => Promise.reject(new Error('chunk failed')),
      {
        displayName: 'Example',
        loadingLabel: 'Loading example',
        getClose: (props) => props.onClose,
      },
    )

    render(<LazyExample onClose={close} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('prefetches at most once after success and suppresses speculative failures', async () => {
    const successfulLoader = vi.fn(async () => ({ default: () => null }))
    const LazySuccess = createLazySurface(successfulLoader, {
      displayName: 'Success',
      loadingLabel: 'Loading success',
    })

    await LazySuccess.prefetch()
    await LazySuccess.prefetch()
    expect(successfulLoader).toHaveBeenCalledOnce()

    const failedLoader = vi.fn(async () => {
      throw new Error('prefetch failed')
    })
    const LazyFailure = createLazySurface(failedLoader, {
      displayName: 'Failure',
      loadingLabel: 'Loading failure',
    })

    await expect(LazyFailure.prefetch()).resolves.toBeUndefined()
    await waitFor(() => expect(failedLoader).toHaveBeenCalledOnce())
  })

  it('does not reset state owned by its parent while loading', async () => {
    const module = deferred<{ default: React.ComponentType }>()
    const LazyExample = createLazySurface(() => module.promise, {
      displayName: 'Example',
      loadingLabel: 'Loading example',
    })

    function Parent() {
      const [count, setCount] = useState(0)
      return (
        <div>
          <button type="button" onClick={() => setCount((current) => current + 1)}>
            Count {count}
          </button>
          <LazyExample />
        </div>
      )
    }

    render(<Parent />)
    await userEvent.click(screen.getByRole('button', { name: 'Count 0' }))
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeInTheDocument()
  })

  it('does not request a hidden optional surface', async () => {
    const loader = vi.fn(async () => ({ default: () => <div>Loaded</div> }))
    const LazyExample = createLazySurface<{ open: boolean }>(loader, {
      displayName: 'Example',
      loadingLabel: 'Loading example',
      shouldRender: (props) => props.open,
    })
    const { rerender } = render(<LazyExample open={false} />)

    expect(loader).not.toHaveBeenCalled()
    rerender(<LazyExample open />)
    expect(await screen.findByText('Loaded')).toBeInTheDocument()
    expect(loader).toHaveBeenCalledOnce()
  })
})
