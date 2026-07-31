import { AlertTriangle } from 'lucide-react'

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#e8e2d8] text-[#20242c]">
      <div className="rounded-lg border border-[#d6ccbd] bg-[#fffdf8] px-5 py-4 shadow-sm">
        Loading inventory...
      </div>
    </div>
  )
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#e8e2d8] p-6 text-[#20242c]">
      <div className="max-w-md rounded-lg border border-[#dfb3a5] bg-[#fffdf8] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a84834]" />
          <div>
            <h1 className="font-bold">Inventory could not load</h1>
            <p className="mt-2 text-sm text-[#75695d]">{message}</p>
            <button
              type="button"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[#20242c] px-4 text-sm font-bold text-white transition-colors hover:bg-[#343941] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20242c]/35"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
