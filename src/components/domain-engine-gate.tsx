import { useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useDomainEngine } from '@/hooks/use-domain-engine'

export function DomainEngineGate({ children }: { children: ReactNode }) {
  const { enabled, state, retry } = useDomainEngine()
  const hasBeenReadyRef = useRef(false)
  if (state.phase === 'ready') hasBeenReadyRef.current = true
  if (!enabled || state.phase === 'ready') return children

  const failed = state.phase === 'failed'
  const unsupported = state.phase === 'unsupported'
  const title = state.phase === 'rebuilding' || state.phase === 'conflict'
    ? 'Rebuilding workspace engine'
    : failed
      ? 'Workspace engine failed'
      : unsupported
        ? 'Browser not supported'
        : 'Loading workspace engine'

  const status = (
    <section
        className="w-full max-w-md border border-[#cfc5b7] bg-[#f8f5ef] p-6 shadow-sm"
        role={failed || unsupported ? 'alert' : 'status'}
      >
        <div className="mb-3 h-1 w-12 bg-[#c98b2e]" />
        <h1 className="text-lg font-black text-[#20242c]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#6d6358]">
          {unsupported
            ? 'This workspace requires WebAssembly and Web Worker support.'
            : state.error ?? 'Preparing the local domain engine and synchronizing the current project revision.'}
        </p>
        {failed ? (
          <Button className="mt-5" onClick={() => void retry()}>Retry</Button>
        ) : null}
      </section>
  )

  if (hasBeenReadyRef.current) {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-[2000] grid place-items-center bg-[#20242c]/20 px-6 backdrop-blur-[1px]">
          {status}
        </div>
      </>
    )
  }

  return (
    <main className="grid h-dvh place-items-center bg-[#e8e2d8] px-6">
      {status}
    </main>
  )
}
