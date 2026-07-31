import {
  Component,
  Suspense,
  lazy,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type {
  LazyModule,
  LazySurfaceOptions,
} from '@/components/lazy-surface-contract'
import { cn } from '@/lib/utils'

const RETRY_BUTTON_CLASS = 'inline-flex h-9 items-center justify-center rounded-md border border-[#20242c] bg-[#20242c] px-4 text-sm font-bold text-white transition-colors hover:bg-[#343941] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20242c]/35'
const CLOSE_BUTTON_CLASS = 'inline-flex h-9 items-center justify-center rounded-md border border-[#cfc4b5] bg-white px-4 text-sm font-bold text-[#3f3329] transition-colors hover:bg-[#f7f1e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20242c]/25'

type ErrorBoundaryProps = {
  children: ReactNode
  displayName: string
  errorTitle: string
  onRetry: () => void
  onClose?: () => void
}

type ErrorBoundaryState = {
  error: Error | null
}

class LazySurfaceErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Lazy surface] ${this.props.displayName} failed to load.`, error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        role="alert"
        className="grid min-h-48 place-items-center rounded-md border border-[#dfb3a5] bg-[#fff7f2] p-6 text-center"
      >
        <div className="grid max-w-sm justify-items-center gap-3">
          <AlertTriangle className="size-6 text-[#8b3a2a]" aria-hidden="true" />
          <div>
            <p className="font-black text-[#3f241d]">{this.props.errorTitle}</p>
            <p className="mt-1 text-sm text-[#795f55]">
              This part of the interface could not be loaded. The workspace remains available.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {this.props.onClose ? (
              <button type="button" className={CLOSE_BUTTON_CLASS} onClick={this.props.onClose}>
                Close
              </button>
            ) : null}
            <button type="button" className={RETRY_BUTTON_CLASS} onClick={this.props.onRetry}>
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }
}

function LazySurfaceLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'grid min-h-48 place-items-center rounded-md border border-[#e5dccf] bg-[#fffdf8] p-6 text-[#75695d]',
        className,
      )}
    >
      <span className="inline-flex items-center gap-2 text-sm font-semibold">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </span>
    </div>
  )
}

export function LazySurfaceView<Props extends object>({
  loader,
  options,
  surfaceProps,
}: {
  loader: () => LazyModule<Props>
  options: LazySurfaceOptions<Props>
  surfaceProps: Props
}) {
  const [attempt, setAttempt] = useState(0)
  const LazyComponent = useMemo(() => {
    void attempt
    return lazy(loader)
  }, [attempt, loader])
  const close = options.getClose?.(surfaceProps)
  const shouldRender = options.shouldRender?.(surfaceProps) ?? true

  if (!shouldRender) return null

  return (
    <LazySurfaceErrorBoundary
      key={attempt}
      displayName={options.displayName}
      errorTitle={options.errorTitle ?? `${options.displayName} could not be loaded`}
      onRetry={() => setAttempt((current) => current + 1)}
      onClose={close}
    >
      <Suspense
        fallback={(
          <LazySurfaceLoading
            label={options.loadingLabel}
            className={options.loadingClassName}
          />
        )}
      >
        <LazyComponent {...surfaceProps} />
      </Suspense>
    </LazySurfaceErrorBoundary>
  )
}
