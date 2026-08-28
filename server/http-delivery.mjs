import compression from 'compression'
import path from 'node:path'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

function headerValue(response, name) {
  return String(response.getHeader(name) ?? '').toLowerCase()
}

export function shouldCompressResponse(request, response) {
  if (request.headers.range || response.getHeader('Content-Range')) return false
  if (headerValue(response, 'Content-Disposition').startsWith('attachment')) return false
  if (headerValue(response, 'Content-Type').startsWith('text/event-stream')) return false

  return compression.filter(request, response)
}

export function createResponseCompression() {
  return compression({
    threshold: 1024,
    filter: shouldCompressResponse,
  })
}

export function registerProductionAssets(app, express, distDir) {
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    fallthrough: false,
    immutable: true,
    maxAge: ONE_YEAR_MS,
  }))
  app.use(express.static(distDir, {
    index: false,
    maxAge: 0,
    setHeaders(response) {
      response.setHeader('Cache-Control', 'no-cache')
    },
  }))
  app.use((_request, response) => {
    response.set('Cache-Control', 'no-cache').sendFile(path.join(distDir, 'index.html'))
  })
}
