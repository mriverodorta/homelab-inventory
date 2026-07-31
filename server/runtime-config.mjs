const TRUE_VALUES = new Set(['true', '1'])
const FALSE_VALUES = new Set(['false', '0'])

function configuredValue(environment, name) {
  const value = environment[name]
  if (value === undefined) return null
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must not be empty.`)
  }
  return value.trim()
}

export function readIntegerSetting(
  environment,
  name,
  fallback,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  const value = configuredValue(environment, name)
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

export function readBooleanSetting(environment, name, fallback) {
  const value = configuredValue(environment, name)
  if (value === null) return fallback
  const normalized = value.toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  throw new Error(`${name} must be true or false.`)
}

export function readRuntimeConfig(environment = process.env) {
  const appMode = configuredValue(environment, 'APP_MODE') ?? 'production'
  if (!['production', 'demo'].includes(appMode)) {
    throw new Error('APP_MODE must be production or demo.')
  }

  return {
    appMode,
    port: readIntegerSetting(environment, 'PORT', 5173, { minimum: 1, maximum: 65_535 }),
    demoSessionMinutes: readIntegerSetting(environment, 'DEMO_SESSION_MINUTES', 30, {
      minimum: 1,
      maximum: 10_080,
    }),
    demoMaxSessions: readIntegerSetting(environment, 'DEMO_MAX_SESSIONS', 100, {
      minimum: 1,
      maximum: 100_000,
    }),
    saveDebounceMs: readIntegerSetting(environment, 'SAVE_DEBOUNCE_MS', 500, {
      minimum: 0,
      maximum: 60_000,
    }),
    seedEmptyData: readBooleanSetting(environment, 'SEED_EMPTY_DATA', environment.NODE_ENV !== 'production'),
    updateCheckEnabled: readBooleanSetting(environment, 'UPDATE_CHECK_ENABLED', true),
  }
}
