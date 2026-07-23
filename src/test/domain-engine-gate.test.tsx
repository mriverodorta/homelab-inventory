import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DomainEngineGate } from '@/components/domain-engine-gate'
import { DomainEngineProvider } from '@/components/domain-engine-provider'
import { DomainEngineContext } from '@/engine/react-context'
import type { DomainEngineClient } from '@/engine/client'
import type { DomainEngineState } from '@/engine/types'

const eventSourceFactory = () => ({
  addEventListener: vi.fn(),
  close: vi.fn(),
}) as unknown as EventSource

function stubClient({
  initial,
  afterStart,
}: {
  initial: DomainEngineState
  afterStart?: DomainEngineState
}) {
  let state = initial
  const listeners = new Set<(next: DomainEngineState) => void>()
  const client = {
    status: () => state,
    subscribe(listener: (next: DomainEngineState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    async start() {
      if (afterStart) {
        state = afterStart
        for (const listener of listeners) listener(state)
      }
    },
    dispose: vi.fn(),
  }
  return client as unknown as DomainEngineClient
}

describe('DomainEngineGate', () => {
  it('blocks the workbench while the worker is loading', () => {
    const client = stubClient({ initial: { phase: 'loading', revision: null } })
    render(
      <DomainEngineProvider enabled client={client} eventSourceFactory={eventSourceFactory}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace engine')
    expect(screen.queryByText('Canvas workbench')).not.toBeInTheDocument()
  })

  it('shows the workbench only after the engine becomes ready', async () => {
    const client = stubClient({
      initial: { phase: 'loading', revision: null },
      afterStart: { phase: 'ready', revision: 3 },
    })
    render(
      <DomainEngineProvider enabled client={client} eventSourceFactory={eventSourceFactory}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineProvider>,
    )

    await waitFor(() => expect(screen.getByText('Canvas workbench')).toBeInTheDocument())
  })

  it('explains unsupported browser requirements', async () => {
    const client = stubClient({
      initial: { phase: 'loading', revision: null },
      afterStart: { phase: 'unsupported', revision: null },
    })
    render(
      <DomainEngineProvider enabled client={client} eventSourceFactory={eventSourceFactory}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineProvider>,
    )

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('WebAssembly and Web Worker'))
  })

  it('keeps routine rebuilding nonblocking after the workbench becomes ready', () => {
    const client = stubClient({ initial: { phase: 'ready', revision: 3 } })
    const { rerender } = render(
      <DomainEngineContext.Provider value={{
        enabled: true,
        client,
        state: { phase: 'ready', revision: 3 },
        syncEvent: null,
        retry: async () => {},
      }}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )

    rerender(
      <DomainEngineContext.Provider value={{
        enabled: true,
        client,
        state: { phase: 'rebuilding', revision: 3, reason: 'External update' },
        syncEvent: null,
        retry: async () => {},
      }}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )

    expect(screen.getByText('Canvas workbench')).toBeInTheDocument()
    expect(screen.queryByText('Rebuilding workspace engine')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
