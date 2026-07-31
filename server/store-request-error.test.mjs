import { describe, expect, it } from 'vitest'
import { storeRequestError } from './store-request-error.mjs'

describe('storeRequestError', () => {
  it('does not expose unexpected internal errors', () => {
    expect(storeRequestError(new Error('EACCES: /data/private/store.json'), {
      message: 'Unable to save project.',
    })).toEqual({ status: 500, message: 'Unable to save project.', expose: false })
  })

  it('keeps deliberate client errors actionable', () => {
    const error = new Error('Too many new demo sessions. Please try again later.')
    error.status = 429
    expect(storeRequestError(error)).toEqual({ status: 429, message: error.message, expose: true })
  })

  it('does not expose an unexpected error just because a route has a client fallback status', () => {
    expect(storeRequestError(new Error('database path leaked'), {
      status: 400,
      message: 'Unable to save project.',
    })).toEqual({ status: 400, message: 'Unable to save project.', expose: false })
  })
})
