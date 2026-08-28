import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createResponseCompression, registerProductionAssets } from './http-delivery.mjs'

const servers = new Set()
const temporaryDirectories = new Set()

async function listen(app) {
  const server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer))
  })
  servers.add(server)
  return server.address().port
}

function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const current = http.get({ host: '127.0.0.1', port, path: requestPath, headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode,
      }))
    })
    current.on('error', reject)
  })
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))))
  servers.clear()
  await Promise.all([...temporaryDirectories].map((directory) => fs.rm(directory, { force: true, recursive: true })))
  temporaryDirectories.clear()
})

describe('production HTTP delivery', () => {
  it.each([
    ['br', brotliDecompressSync],
    ['gzip', gunzipSync],
  ])('compresses large JSON responses with %s', async (encoding, decompress) => {
    const app = express()
    app.use(createResponseCompression())
    app.get('/payload', (_request, response) => response.json({ value: 'inventory '.repeat(2_000) }))
    const port = await listen(app)

    const response = await request(port, '/payload', { 'Accept-Encoding': encoding })

    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBe(encoding)
    expect(response.headers.vary).toContain('Accept-Encoding')
    expect(JSON.parse(decompress(response.body).toString())).toHaveProperty('value')
  })

  it('does not compress SSE, attachments, range responses, or small payloads', async () => {
    const app = express()
    app.use(createResponseCompression())
    app.get('/events', (_request, response) => response.type('text/event-stream').send(`data: ${'x'.repeat(2_000)}\n\n`))
    app.get('/download', (_request, response) => response.attachment('inventory.txt').send('x'.repeat(2_000)))
    app.get('/range', (_request, response) => response.type('text/plain').send('x'.repeat(2_000)))
    app.get('/small', (_request, response) => response.json({ ok: true }))
    const port = await listen(app)
    const headers = { 'Accept-Encoding': 'br' }

    const [events, download, range, small] = await Promise.all([
      request(port, '/events', headers),
      request(port, '/download', headers),
      request(port, '/range', { ...headers, Range: 'bytes=0-100' }),
      request(port, '/small', headers),
    ])

    expect(events.headers['content-encoding']).toBeUndefined()
    expect(download.headers['content-encoding']).toBeUndefined()
    expect(range.headers['content-encoding']).toBeUndefined()
    expect(small.headers['content-encoding']).toBeUndefined()
  })

  it('caches hashed assets immutably while HTML always revalidates', async () => {
    const distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-http-delivery-'))
    temporaryDirectories.add(distDir)
    await fs.mkdir(path.join(distDir, 'assets'))
    await fs.writeFile(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log("asset")')
    await fs.writeFile(path.join(distDir, 'index.html'), '<main>Homelab Inventory</main>')
    const app = express()
    registerProductionAssets(app, express, distDir)
    const port = await listen(app)

    const asset = await request(port, '/assets/app-abc123.js')
    const shell = await request(port, '/systems')
    const unchanged = await request(port, '/assets/app-abc123.js', { 'If-None-Match': asset.headers.etag })

    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(shell.headers['cache-control']).toBe('no-cache')
    expect(shell.body.toString()).toContain('Homelab Inventory')
    expect(unchanged.status).toBe(304)
  })
})
