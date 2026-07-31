export function apiErrorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error)
    return
  }

  if (error?.type === 'entity.too.large' || error?.status === 413) {
    response.status(413).json({
      message: 'Request body exceeds the maximum allowed size.',
      code: 'request-body-too-large',
    })
    return
  }

  if (error instanceof SyntaxError && error?.status === 400 && Object.hasOwn(error, 'body')) {
    response.status(400).json({
      message: 'Request body contains invalid JSON.',
      code: 'invalid-json',
    })
    return
  }

  console.error(`[api] ${request.method} ${request.originalUrl} failed.`, error instanceof Error ? error.message : error)
  response.status(500).json({
    message: 'The request could not be completed.',
    code: 'request-failed',
  })
}
