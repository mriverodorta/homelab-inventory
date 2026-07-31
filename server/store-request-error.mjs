const DEFAULT_MESSAGE = 'Unable to access data store.'

function safeMessage(error, fallback) {
  const message = error instanceof Error ? error.message.trim() : ''
  return message && message.length <= 240 ? message : fallback
}

export function storeRequestError(error, options = {}) {
  const fallback = options.message ?? DEFAULT_MESSAGE
  const busy = error instanceof Error && error.message === 'The public demo is temporarily busy.'
  const explicitStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? error.status
    : null

  if (busy) return { status: 503, message: error.message, expose: true }
  if (explicitStatus !== null) {
    return { status: explicitStatus, message: safeMessage(error, fallback), expose: true }
  }

  return {
    status: Number.isInteger(options.status) ? options.status : 500,
    message: fallback,
    expose: false,
  }
}
