import { UPDATE_CACHE_MS } from './update-checker.mjs'

function isSuccessful(result) {
  return result?.state === 'available' || result?.state === 'current'
}

export function startUpdateCheckSchedule({
  checker,
  store = null,
  intervalMs = UPDATE_CACHE_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (!checker.enabled) {
    return {
      initialCheck: Promise.resolve(null),
      stop() {},
    }
  }

  let stopped = false
  const refresh = async ({ force = false, persistedResult = null } = {}) => {
    if (stopped) return null
    try {
      const result = await checker.check({ force, persistedResult })
      if (store && isSuccessful(result) && result !== persistedResult) await store.saveUpdateCheck(result)
      return result
    } catch {
      return null
    }
  }

  const persistedResult = store?.getUpdateMetadata?.().lastUpdateCheck ?? null
  const initialCheck = refresh({ persistedResult })
  const timer = setIntervalFn(() => { void refresh({ force: true }) }, intervalMs)
  timer?.unref?.()

  return {
    initialCheck,
    stop() {
      stopped = true
      clearIntervalFn(timer)
    },
  }
}
