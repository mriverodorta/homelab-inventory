const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8_000

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

export async function gracefullyStopServer({
  server,
  sseHub,
  stoppers = [],
  closers = [],
  flush,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  const closed = closeServer(server)
  sseHub?.closeAll()

  const failures = []
  const stopperResults = await Promise.allSettled(stoppers.map((stop) => stop?.()))
  for (const result of stopperResults) {
    if (result.status === 'rejected') failures.push(result.reason)
  }
  let timeout
  const timedOut = new Promise((resolve) => {
    timeout = setTimeoutFn(() => resolve(true), timeoutMs)
    timeout?.unref?.()
  })
  const didTimeOut = await Promise.race([closed.then(() => false), timedOut])
  clearTimeoutFn(timeout)

  if (didTimeOut) {
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await closed
  }

  try {
    await flush?.()
  } catch (error) {
    failures.push(error)
  }
  const closerResults = await Promise.allSettled(closers.map((close) => close?.()))
  for (const result of closerResults) {
    if (result.status === 'rejected') failures.push(result.reason)
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more shutdown operations failed.')
  }
}
