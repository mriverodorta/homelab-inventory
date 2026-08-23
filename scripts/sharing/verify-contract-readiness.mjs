#!/usr/bin/env bun

import { pathToFileURL } from 'node:url'

import { sharingClientCapabilities } from '../../server/sharing/capabilities.mjs'
import { normalizeLabGdCapabilities } from '../../server/sharing/remote-capabilities.mjs'

const REQUEST_TIMEOUT_MS = 15_000

export async function verifySharingReadiness({
  appOrigin,
  labGdOrigin,
  sessionCookie = '',
  fetchImpl = fetch,
  requirePublicationReady = false,
} = {}) {
  const normalizedAppOrigin = parseOrigin(appOrigin, 'Homelab Inventory')
  const normalizedLabGdOrigin = parseOrigin(labGdOrigin, 'lab.gd')
  const appHeaders = sessionCookie ? { cookie: sessionCookie } : {}

  const [appHealth, labGdReadiness, labGdDocument, settings, exposedCapabilities] = await Promise.all([
    getJson(fetchImpl, normalizedAppOrigin, '/api/health'),
    getJson(fetchImpl, normalizedLabGdOrigin, '/readyz'),
    getJson(fetchImpl, normalizedLabGdOrigin, '/v1/capabilities'),
    getJson(fetchImpl, normalizedAppOrigin, '/api/sharing/settings', appHeaders),
    getJson(fetchImpl, normalizedAppOrigin, '/api/sharing/capabilities', appHeaders),
  ])

  assert(appHealth.ok === true, 'Homelab Inventory is not healthy.')
  assert(appHealth.mode === 'production', `Homelab Inventory mode is ${String(appHealth.mode)}, not production.`)
  assert(labGdReadiness.status === 'ready', 'lab.gd is not ready.')
  assert(labGdReadiness.contractMode === 'packages-enabled', 'lab.gd is not using published contract packages.')
  assert(typeof labGdReadiness.publicationReady === 'boolean', 'lab.gd publication readiness is invalid.')
  if (requirePublicationReady) assert(labGdReadiness.publicationReady === true, 'lab.gd publication is not ready.')

  const remote = normalizeLabGdCapabilities(labGdDocument)
  const expectedCapabilities = sharingClientCapabilities({ enabled: true, publication: true, remote })
  assert(settings.available === true, 'Sharing is unavailable in Homelab Inventory.')
  assert(settings.automaticEnrollment === true, 'Automatic sharing enrollment is disabled.')
  assert(settings.demo === false && settings.staging === false, 'Sharing verification cannot run against demo or staging mode.')
  assert(settings.settings?.connectionEnabled === true, 'Sharing is opted out in Homelab Inventory.')
  assert(settings.settings?.enrollmentState === 'connected', `Sharing enrollment is ${String(settings.settings?.enrollmentState)}, not connected.`)
  assertEqualCapabilities(settings.capabilities, expectedCapabilities, 'settings')
  assertEqualCapabilities(exposedCapabilities, expectedCapabilities, 'capability endpoint')

  return {
    ok: true,
    app: {
      mode: appHealth.mode,
      schemaVersion: appHealth.schemaVersion,
      enrollmentState: settings.settings.enrollmentState,
    },
    labGd: {
      contractMode: labGdReadiness.contractMode,
      publicationReady: labGdReadiness.publicationReady,
      protocolVersion: labGdDocument.protocolVersion,
    },
    capabilities: exposedCapabilities,
  }
}

function assertEqualCapabilities(actual, expected, source) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  assert(actualJson === expectedJson, `Homelab Inventory ${source} does not match negotiated lab.gd capabilities.`)
}

async function getJson(fetchImpl, origin, pathname, headers = {}) {
  const response = await fetchImpl(new URL(pathname, origin), {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await boundedJson(response)
  if (!response.ok) throw new Error(`${new URL(pathname, origin).origin}${pathname} returned HTTP ${response.status}.`)
  return body
}

async function boundedJson(response, maximumBytes = 256 * 1024) {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw new Error('Readiness response exceeded the allowed size.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maximumBytes) throw new Error('Readiness response exceeded the allowed size.')
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('Readiness response was not valid JSON.')
  }
}

function parseOrigin(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} origin is required.`)
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} origin must be a plain HTTP or HTTPS origin.`)
  }
  return url.origin
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseArguments(args) {
  const options = {
    appOrigin: process.env.HLI_ORIGIN ?? 'http://127.0.0.1:8798',
    labGdOrigin: process.env.LABGD_ORIGIN ?? 'https://lab.gd',
    sessionCookie: process.env.HLI_SESSION_COOKIE ?? '',
    requirePublicationReady: parseBoolean(process.env.LABGD_REQUIRE_PUBLICATION_READY, false),
  }
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (!['--app-origin', '--labgd-origin'].includes(name)) throw new Error(`Unknown argument: ${name}`)
    const value = args[index + 1]
    if (!value) throw new Error(`Missing value for ${name}.`)
    if (name === '--app-origin') options.appOrigin = value
    else options.labGdOrigin = value
    index += 1
  }
  return options
}

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('LABGD_REQUIRE_PUBLICATION_READY must be true or false when set.')
}

async function main() {
  const result = await verifySharingReadiness(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
