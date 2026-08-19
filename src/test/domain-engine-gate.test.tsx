import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DomainEngineGate } from '@/components/domain-engine-gate'
import { DomainEngineProvider } from '@/components/domain-engine-provider'
import { DomainEngineContext } from '@/engine/react-context'
import type { DomainEngineClient } from '@/engine/client'
import type { DomainEngineState } from '@/engine/types'
import { useDomainEngine } from '@/hooks/use-domain-engine'

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
    start: vi.fn(async () => {
      if (afterStart) {
        state = afterStart
        for (const listener of listeners) listener(state)
      }
    }),
    rebuild: vi.fn(async () => {}),
    applyCommittedResponse: vi.fn(),
    dispose: vi.fn(),
  }
  return client as unknown as DomainEngineClient
}

describe('DomainEngineGate', () => {
  it('preserves mounted application state while a new session loads', () => {
    const client = stubClient({ initial: { phase: 'loading', revision: null } })
    function StatefulWorkspace() {
      const [count, setCount] = useState(0)
      return <button onClick={() => setCount((value) => value + 1)}>Selection {count}</button>
    }
    const contextValue = (enabled: boolean, session: number, state: DomainEngineState) => ({
      enabled,
      session,
      client,
      state,
      syncEvent: null,
      setEnabled: () => {},
      retry: async () => {},
    })
    const { rerender } = render(
      <DomainEngineContext.Provider value={contextValue(false, 0, { phase: 'idle', revision: null })}>
        <DomainEngineGate><StatefulWorkspace /></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Selection 0' }))
    rerender(
      <DomainEngineContext.Provider value={contextValue(true, 1, { phase: 'loading', revision: null })}>
        <DomainEngineGate><StatefulWorkspace /></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )

    expect(screen.getByRole('button', { name: 'Selection 1' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace engine')

    rerender(
      <DomainEngineContext.Provider value={contextValue(true, 1, { phase: 'ready', revision: 3 })}>
        <DomainEngineGate><StatefulWorkspace /></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(
      <DomainEngineContext.Provider value={contextValue(true, 2, { phase: 'loading', revision: null })}>
        <DomainEngineGate><StatefulWorkspace /></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Selection 1' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace engine')
  })

  it('creates a distinct idle-to-ready lifecycle for every Canvas activation', async () => {
    vi.useFakeTimers()
    try {
      const firstClient = stubClient({ initial: { phase: 'loading', revision: null } })
      const secondClient = stubClient({ initial: { phase: 'loading', revision: null } })
      const clients = [firstClient, secondClient]
      const clientFactory = vi.fn(() => clients.shift()!)

      function Harness() {
        const engine = useDomainEngine()
        return (
          <>
            <button onClick={() => engine.setEnabled(true)}>Open Canvas</button>
            <button onClick={() => engine.setEnabled(false)}>Open Systems</button>
            <output data-testid="engine-state">
              {JSON.stringify({
                enabled: engine.enabled,
                session: engine.session,
                phase: engine.state.phase,
              })}
            </output>
          </>
        )
      }

      render(
        <DomainEngineProvider
          enabled={false}
          clientFactory={clientFactory}
          eventSourceFactory={eventSourceFactory}
        >
          <Harness />
        </DomainEngineProvider>,
      )

      expect(screen.getByTestId('engine-state')).toHaveTextContent(
        JSON.stringify({ enabled: false, session: 0, phase: 'idle' }),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Open Canvas' }))
      expect(screen.getByTestId('engine-state')).toHaveTextContent(
        JSON.stringify({ enabled: true, session: 1, phase: 'loading' }),
      )
      expect(firstClient.start).toHaveBeenCalledOnce()

      fireEvent.click(screen.getByRole('button', { name: 'Open Systems' }))
      expect(screen.getByTestId('engine-state')).toHaveTextContent(
        JSON.stringify({ enabled: false, session: 1, phase: 'idle' }),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Open Canvas' }))
      expect(screen.getByTestId('engine-state')).toHaveTextContent(
        JSON.stringify({ enabled: true, session: 2, phase: 'loading' }),
      )
      expect(secondClient.start).toHaveBeenCalledOnce()

      await act(async () => vi.runAllTimersAsync())
      expect(firstClient.dispose).toHaveBeenCalledOnce()
      expect(secondClient.dispose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts on demand for Canvas and remains inactive for Systems', async () => {
    const client = stubClient({
      initial: { phase: 'loading', revision: null },
      afterStart: { phase: 'ready', revision: 3 },
    })
    function Harness() {
      const engine = useDomainEngine()
      return (
        <>
          <button onClick={() => engine.setEnabled(true)}>Open Canvas</button>
          <DomainEngineGate><div>Workspace content</div></DomainEngineGate>
        </>
      )
    }

    render(
      <DomainEngineProvider enabled={false} client={client} eventSourceFactory={eventSourceFactory}>
        <Harness />
      </DomainEngineProvider>,
    )

    expect(screen.getByText('Workspace content')).toBeInTheDocument()
    expect(client.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas' }))
    await waitFor(() => expect(client.start).toHaveBeenCalledOnce())
    expect(screen.getByText('Workspace content')).toBeInTheDocument()
  })

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
        session: 1,
        client,
        state: { phase: 'ready', revision: 3 },
        syncEvent: null,
        setEnabled: () => {},
        retry: async () => {},
      }}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )

    rerender(
      <DomainEngineContext.Provider value={{
        enabled: true,
        session: 1,
        client,
        state: { phase: 'rebuilding', revision: 3, reason: 'External update' },
        syncEvent: null,
        setEnabled: () => {},
        retry: async () => {},
      }}>
        <DomainEngineGate><div>Canvas workbench</div></DomainEngineGate>
      </DomainEngineContext.Provider>,
    )

    expect(screen.getByText('Canvas workbench')).toBeInTheDocument()
    expect(screen.queryByText('Rebuilding workspace engine')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('ignores a delayed invalidation for the revision already loaded locally', async () => {
    const listeners = new Map<string, EventListener>()
    const localEventSourceFactory = vi.fn(() => ({
      addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
      close: vi.fn(),
    }) as unknown as EventSource)
    const client = stubClient({ initial: { phase: 'ready', revision: 3 } })

    render(
      <DomainEngineProvider enabled client={client} eventSourceFactory={localEventSourceFactory}>
        <div>Canvas workbench</div>
      </DomainEngineProvider>,
    )

    await waitFor(() => expect(listeners.has('project-invalidated')).toBe(true))
    listeners.get('project-invalidated')?.(new MessageEvent('project-invalidated', {
      data: JSON.stringify({ baseRevision: 2, revision: 3 }),
    }))

    expect(client.rebuild).not.toHaveBeenCalled()
  })
})
