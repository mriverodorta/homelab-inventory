const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export class RequestTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms.`)
    this.name = 'RequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  }: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {},
): Promise<Response> {
  const controller = new AbortController()
  const callerSignal = init.signal
  let timedOut = false

  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) {
    abortFromCaller()
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError(timeoutMs)
    }

    throw error
  } finally {
    window.clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}
