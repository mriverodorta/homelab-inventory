export type TestNetworkAttempt = Readonly<{
  allowed: boolean
  origin: string | null
}>

export function createTestFetchGuard(
  fetchImpl: typeof globalThis.fetch,
  options?: Readonly<{
    onAttempt?: (attempt: TestNetworkAttempt) => void
  }>,
): typeof globalThis.fetch
