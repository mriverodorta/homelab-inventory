import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomelabInventoryStore } from './db/store.mjs'
import { registerRegistryRoutes } from './registry-routes.mjs'
import { CatalogAvailabilityError } from './registry/catalog-availability.mjs'

const resources = []

async function waitForCondition(condition, message, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

async function createServer(registryRouteOptions = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-routes-'))
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  const app = express()
  app.use(express.json())
  const withStore = async (_request, _response, handler) => handler(store)
  registerRegistryRoutes(app, { withStore, ...registryRouteOptions })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  resources.push({ dataDir, store, server })
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}`, store }
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ dataDir, store, server }) => {
    await store.flush().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dataDir, { recursive: true, force: true })
  }))
})

describe('registry routes', () => {
  it('enforces connected read-only registry policy for public demos', async () => {
    const refreshConnected = vi.fn(async () => undefined)
    const { baseUrl } = await createServer({
      registryPolicy: {
        forcedMode: 'connected',
        contributionsAllowed: false,
        automaticSafeUpdatesForced: true,
      },
      snapshotServiceFactory: () => ({ refreshConnected }),
    })

    const state = await fetch(`${baseUrl}/api/registry`).then((response) => response.json())
    expect(state.settings).toMatchObject({ mode: 'connected', automaticContributions: false, automaticSafeUpdates: true })
    expect(state.policy).toEqual({
      modeLocked: true,
      forcedMode: 'connected',
      contributionsAllowed: false,
      networkRefreshAllowed: true,
      automaticSafeUpdatesForced: true,
    })

    const preference = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { defaultInventorySource: 'manual' } }),
    })
    expect(preference.status).toBe(200)
    expect((await preference.json()).settings).toMatchObject({
      mode: 'connected',
      defaultInventorySource: 'manual',
      automaticContributions: false,
      automaticSafeUpdates: true,
    })

    for (const settings of [{ mode: 'offline' }, { automaticContributions: true }, { automaticSafeUpdates: false }]) {
      const response = await fetch(`${baseUrl}/api/registry/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'demo-registry-policy' })
    }

    const refresh = await fetch(`${baseUrl}/api/registry/catalog/refresh`, { method: 'POST' })
    expect(refresh.status).toBe(200)
    expect(refreshConnected).toHaveBeenCalledOnce()

    for (const route of ['deliver', 'revoke', 'rotate-key', 'resume-recovery', 'reset-recovery']) {
      const response = await fetch(`${baseUrl}/api/registry/contributions/${route}`, { method: 'POST' })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'demo-registry-policy' })
    }
  })

  it('keeps local catalog reads but blocks registry network refresh in staging', async () => {
    const refresh = vi.fn(async () => ({ revision: 4 }))
    const { baseUrl } = await createServer({
      registryPolicy: { contributionsAllowed: false, networkRefreshAllowed: false },
      catalogRefreshCoordinator: { refresh },
    })

    const state = await fetch(`${baseUrl}/api/registry`).then((response) => response.json())
    expect(state.policy).toMatchObject({ contributionsAllowed: false, networkRefreshAllowed: false })

    const response = await fetch(`${baseUrl}/api/registry/catalog/refresh`, { method: 'POST' })
    expect(response.status).toBe(403)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('updates local registry preferences without changing the project revision', async () => {
    const { baseUrl, store } = await createServer()
    const revision = store.getEngineRevision()
    const response = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          mode: 'offline',
          defaultInventorySource: 'manual',
          showRegistryLinkIndicators: true,
        },
      }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).settings).toMatchObject({
      mode: 'offline',
      defaultInventorySource: 'manual',
      showRegistryLinkIndicators: true,
    })
    expect(store.getEngineRevision()).toBe(revision)
  })

  it('reconciles automatic scheduling after persisted settings changes', async () => {
    const catalogRefreshCoordinator = { reconcileSchedule: vi.fn() }
    const { baseUrl } = await createServer({ catalogRefreshCoordinator })
    const response = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { mode: 'connected' } }),
    })

    expect(response.status).toBe(200)
    expect(catalogRefreshCoordinator.reconcileSchedule).toHaveBeenCalledOnce()
  })

  it('evaluates catalog updates after enabling automatic updates and after manual refresh', async () => {
    const catalogRefreshCoordinator = { reconcileSchedule: vi.fn(), refresh: vi.fn(async () => ({ revision: 2 })) }
    const catalogUpdateCoordinator = { run: vi.fn(async () => ({ applied: 0, review: 0, blocked: 0, skipped: 0 })) }
    const { baseUrl } = await createServer({ catalogRefreshCoordinator, catalogUpdateCoordinator })

    const settings = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { mode: 'connected', automaticSafeUpdates: true } }),
    })
    expect(settings.status).toBe(200)
    await waitForCondition(
      () => catalogUpdateCoordinator.run.mock.calls.length === 1,
      'Automatic catalog update evaluation did not start.',
    )

    const refresh = await fetch(`${baseUrl}/api/registry/catalog/refresh`, { method: 'POST' })
    expect(refresh.status).toBe(200)
    expect(catalogRefreshCoordinator.refresh).toHaveBeenCalledWith('manual')
    expect(catalogUpdateCoordinator.run).toHaveBeenCalledTimes(2)
  })

  it('routes Send now as an explicit one-shot delivery while automatic delivery is disabled', async () => {
    const deliveryService = {
      trigger: vi.fn(async () => ({ queued: 0, delivered: 1 })),
      waitForIdle: vi.fn(async () => undefined),
    }
    const { baseUrl, store } = await createServer({ deliveryService })
    store.updateRegistrySettings({ mode: 'connected', automaticContributions: false })

    const response = await fetch(`${baseUrl}/api/registry/contributions/deliver`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(deliveryService.trigger).toHaveBeenCalledWith(store, { explicit: true })
  })

  it('resumes an approved installation recovery and restarts opted-in delivery', async () => {
    const identityService = {
      resumeRecovery: vi.fn(async (store) => store.registryTransaction((draft) => {
        draft.installationIdentity.state = 'active'
        draft.installationIdentity.recoveryKey = null
        draft.installationIdentity.lastError = null
      })),
    }
    const deliveryService = { trigger: vi.fn(async () => undefined) }
    const { baseUrl, store } = await createServer({ identityService, deliveryService })
    store.registryTransaction((draft) => {
      draft.settings.mode = 'connected'
      draft.settings.automaticContributions = true
      draft.installationIdentity = {
        installationKey: '22222222-2222-4222-8222-222222222222',
        publicKeyId: 'a'.repeat(64),
        clientInstanceId: '11111111-2222-4333-8444-555555555555',
        state: 'recovery-pending',
        recoveryKey: '33333333-4444-4555-8666-777777777777',
        lastError: 'Approval required.',
        activatedAt: null,
        tokenExpiresAt: null,
        revokedAt: null,
      }
    })

    const response = await fetch(`${baseUrl}/api/registry/contributions/resume-recovery`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ enrollment: 'active', enabled: true })
    expect(identityService.resumeRecovery).toHaveBeenCalledWith(store)
    expect(deliveryService.trigger).toHaveBeenCalledWith(store)
  })

  it('rejects explicit contribution delivery outside connected registry mode', async () => {
    const deliveryService = { trigger: vi.fn(), waitForIdle: vi.fn() }
    const { baseUrl } = await createServer({ deliveryService })

    const response = await fetch(`${baseUrl}/api/registry/contributions/deliver`, { method: 'POST' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'connected-registry-required' })
    expect(deliveryService.trigger).not.toHaveBeenCalled()
  })

  it('waits for an active delivery to settle before confirming automatic delivery is disabled', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const deliveryService = {
      trigger: vi.fn(async () => ({ queued: 0 })),
      waitForIdle: vi.fn(() => pending),
    }
    const { baseUrl, store } = await createServer({ deliveryService })
    store.updateRegistrySettings({ mode: 'connected', automaticContributions: true })

    let settled = false
    const request = fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { automaticContributions: false } }),
    }).then((response) => {
      settled = true
      return response
    })

    await waitForCondition(
      () => deliveryService.waitForIdle.mock.calls.length === 1,
      'Contribution delivery did not begin settling.',
    )
    expect(settled).toBe(false)
    release()

    const response = await request
    expect(response.status).toBe(200)
    expect((await response.json()).settings.automaticContributions).toBe(false)
  })

  it('routes manual refresh through the shared coordinator', async () => {
    const catalogRefreshCoordinator = {
      refresh: vi.fn(async () => ({ revision: 3 })),
      reconcileSchedule: vi.fn(),
    }
    const { baseUrl } = await createServer({ catalogRefreshCoordinator })
    await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { mode: 'connected' } }),
    })

    const response = await fetch(`${baseUrl}/api/registry/catalog/refresh`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(catalogRefreshCoordinator.refresh).toHaveBeenCalledOnce()
    expect(catalogRefreshCoordinator.refresh).toHaveBeenCalledWith('manual')
  })

  it('forces one registry update evaluation retry from the review surface', async () => {
    const catalogUpdateCoordinator = { run: vi.fn(async () => ({ applied: 1 })) }
    const { baseUrl, store } = await createServer({ catalogUpdateCoordinator })
    store.getRegistryUpdateGroups = vi.fn(() => [{ id: 'applied:cpu-example:2' }])
    store.getRegistryUpdateStatus = vi.fn(() => ({ state: 'completed', catalogRevision: 2 }))

    const response = await fetch(`${baseUrl}/api/registry/updates/retry`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(catalogUpdateCoordinator.run).toHaveBeenCalledWith({ force: true })
    expect(await response.json()).toMatchObject({
      groups: [{ id: 'applied:cpu-example:2' }],
      run: { state: 'completed', catalogRevision: 2 },
    })
  })

  it('reads persisted registry update status without running catalog evaluation', async () => {
    const catalogUpdateCoordinator = { run: vi.fn(async () => ({ applied: 1 })) }
    const { baseUrl, store } = await createServer({ catalogUpdateCoordinator })
    store.getRegistryUpdateGroups = vi.fn(() => [{ id: 'review:cpu-example:2' }])
    store.getRegistryUpdateStatus = vi.fn(() => ({ state: 'completed', catalogRevision: 2 }))

    const response = await fetch(`${baseUrl}/api/registry/updates`)

    expect(response.status).toBe(200)
    expect(catalogUpdateCoordinator.run).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      groups: [{ id: 'review:cpu-example:2' }],
      run: { state: 'completed', catalogRevision: 2 },
    })
  })

  it('serves compact update summary and group-only views', async () => {
    const { baseUrl, store } = await createServer()
    store.getRegistryUpdateSummary = vi.fn(() => ({
      counts: { review: 2, blocked: 1, applied: 4, declined: 3 },
      run: { state: 'completed', catalogRevision: 17 },
    }))
    store.getRegistryUpdateGroups = vi.fn(() => [{
      id: 'review:cpu-example:2', changes: [{ field: 'compatibility', next: { socket: 'LGA1200' } }],
    }])
    store.getRegistryUpdateStatus = vi.fn(() => ({ state: 'completed', catalogRevision: 17 }))

    const summaryResponse = await fetch(`${baseUrl}/api/registry/updates?view=summary`)
    const summary = await summaryResponse.json()
    expect(summary).toEqual({
      counts: { review: 2, blocked: 1, applied: 4, declined: 3 },
      run: { state: 'completed', catalogRevision: 17 },
    })
    expect(summary).not.toHaveProperty('groups')
    expect(summary).not.toHaveProperty('updates')

    const groupsResponse = await fetch(`${baseUrl}/api/registry/updates?view=groups`)
    const groups = await groupsResponse.json()
    expect(groups).toMatchObject({ groups: [{ id: 'review:cpu-example:2' }] })
    expect(groups).not.toHaveProperty('updates')
  })

  it('returns a compact decision receipt after approving an update group', async () => {
    const template = { templateKey: 'cpu-example', revision: 2 }
    const result = {
      applied: 1,
      review: 0,
      blocked: 0,
      skipped: 0,
      decisions: [{ templateKey: 'cpu-example', toRevision: 2, status: 'applied' }],
      summary: {
        counts: { review: 0, blocked: 0, applied: 1, declined: 0 },
        run: { state: 'completed', catalogRevision: 2 },
      },
      affectedProjectIds: [1],
      affectedProjectRevisions: { 1: 13 },
      affectedLinkIds: [7],
    }
    const { baseUrl, store } = await createServer({
      snapshotServiceFactory: () => ({ template: vi.fn(async () => template) }),
    })
    store.applyRegistryUpdateGroups = vi.fn(() => result)

    const response = await fetch(`${baseUrl}/api/registry/update-groups/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groups: [{ templateKey: 'cpu-example', toRevision: 2 }],
        decision: 'applied',
      }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual(result)
    expect(payload).not.toHaveProperty('groups')
    expect(payload).not.toHaveProperty('updates')
    expect(JSON.stringify(payload).length).toBeLessThan(1_000)
  })

  it('returns a gateway error for a failed official catalog refresh', async () => {
    const { baseUrl } = await createServer({
      catalogRefreshCoordinator: {
        refresh: vi.fn(async () => { throw new Error('Official catalog request timed out.') }),
        reconcileSchedule: vi.fn(),
      },
    })

    const response = await fetch(`${baseUrl}/api/registry/catalog/refresh`, { method: 'POST' })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'catalog-refresh-failed' })
  })

  it('does not expose unexpected registry implementation errors', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { baseUrl } = await createServer({
      snapshotServiceFactory: () => ({
        search: async () => { throw new Error('/private/path/catalog.sqlite is locked') },
      }),
    })

    const response = await fetch(`${baseUrl}/api/registry/catalog/search?q=cpu`)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({
      message: 'Registry request could not be completed.',
      code: 'registry-request-failed',
    })
    expect(JSON.stringify(payload)).not.toContain('/private/path')
    expect(errorLog).toHaveBeenCalled()
    errorLog.mockRestore()
  })

  it('returns a stable 503 while the catalog is being verified', async () => {
    const { baseUrl } = await createServer({
      snapshotServiceFactory: () => ({
        search: () => {
          throw new CatalogAvailabilityError('Catalog is being verified. Try again shortly.', {
            code: 'catalog-initializing',
          })
        },
      }),
    })

    const response = await fetch(`${baseUrl}/api/registry/catalog/search?type=cpu`)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      message: 'Catalog is being verified. Try again shortly.',
      code: 'catalog-initializing',
    })
  })

  it('serves signed facet metadata and forwards validated local facet filters', async () => {
    const search = vi.fn(async (parameters) => ({
      total: 1,
      limit: Number(parameters.limit),
      offset: Number(parameters.offset),
      hasMore: false,
      nextOffset: null,
      items: [],
    }))
    const facets = vi.fn(async () => ({
      available: true,
      schemaVersion: 1,
      catalogRevision: 8,
      categories: [{ type: 'cpu', label: 'Processors', count: 1, facets: [] }],
    }))
    const { baseUrl } = await createServer({
      snapshotServiceFactory: () => ({ search, facets }),
    })

    const facetResponse = await fetch(`${baseUrl}/api/registry/catalog/facets`)
    expect(facetResponse.status).toBe(200)
    expect(await facetResponse.json()).toMatchObject({ available: true, catalogRevision: 8 })

    const parameters = new URLSearchParams({ q: '10500T', type: 'cpu', limit: '40', offset: '80' })
    parameters.append('term', 'manufacturer:Intel')
    parameters.append('term', 'specs.socket:LGA1200')
    parameters.append('term', 'specs.socket:LGA1700')
    parameters.append('min', 'specs.cores:4')
    parameters.append('max', 'specs.cores:16')
    const response = await fetch(`${baseUrl}/api/registry/catalog/search?${parameters}`)

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledWith({
      query: '10500T',
      type: 'cpu',
      manufacturer: undefined,
      terms: {
        manufacturer: ['Intel'],
        'specs.socket': ['LGA1200', 'LGA1700'],
      },
      ranges: { 'specs.cores': { minimum: 4, maximum: 16 } },
      limit: '40',
      offset: '80',
    })
  })

  it('reuses one catalog snapshot service for requests sharing a data store', async () => {
    const search = vi.fn(async () => ({ total: 0, limit: 40, offset: 0, hasMore: false, nextOffset: null, items: [] }))
    const facets = vi.fn(async () => ({ available: true, categories: [] }))
    const snapshotServiceFactory = vi.fn(() => ({ search, facets }))
    const { baseUrl } = await createServer({ snapshotServiceFactory })

    await Promise.all([
      fetch(`${baseUrl}/api/registry/catalog/facets`),
      fetch(`${baseUrl}/api/registry/catalog/search?type=cpu&limit=40&offset=0`),
      fetch(`${baseUrl}/api/registry/catalog/search?type=desktop&limit=40&offset=0`),
    ])

    expect(snapshotServiceFactory).toHaveBeenCalledOnce()
    expect(facets).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed catalog facet constraints before searching', async () => {
    const search = vi.fn()
    const { baseUrl } = await createServer({
      snapshotServiceFactory: () => ({ search, facets: async () => ({ available: false, categories: [] }) }),
    })

    const response = await fetch(`${baseUrl}/api/registry/catalog/search?type=cpu&min=specs.cores:not-a-number`)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid-catalog-filters' })
    expect(search).not.toHaveBeenCalled()
  })

  it('creates, exports, deletes, previews, and imports sanitized private templates', async () => {
    const { baseUrl } = await createServer()
    const created = await fetch(`${baseUrl}/api/registry/private-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Reusable server',
        item: {
          type: 'server',
          name: 'Example server',
          manufacturer: 'Example',
          properties: { lanIp: '192.168.1.10' },
        },
      }),
    })
    const createdPayload = await created.json()
    expect(created.status).toBe(201)
    expect(createdPayload.privateTemplates[0]).toMatchObject({ id: 1, name: 'Reusable server' })
    expect(JSON.stringify(createdPayload)).not.toContain('192.168.1.10')

    const exported = await fetch(`${baseUrl}/api/registry/private-templates/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    }).then((response) => response.json())
    expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/)

    expect((await fetch(`${baseUrl}/api/registry/private-templates/1`, { method: 'DELETE' })).status).toBe(200)
    const preview = await fetch(`${baseUrl}/api/registry/private-templates/import/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: exported }),
    }).then((response) => response.json())
    expect(preview).toMatchObject({ valid: true, errors: [] })

    const imported = await fetch(`${baseUrl}/api/registry/private-templates/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: exported }),
    }).then((response) => response.json())
    expect(imported).toMatchObject({ imported: 1, skipped: 0 })
    expect(imported.registry.privateTemplates[0].id).toBe(1)
  })

  it('serializes concurrent private-template creation so numeric ids remain unique', async () => {
    const { baseUrl } = await createServer()
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) => fetch(`${baseUrl}/api/registry/private-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Concurrent template ${index + 1}`,
          item: {
            type: 'cpu',
            name: `Example CPU ${index + 1}`,
            manufacturer: 'Example',
            model: `CPU-${index + 1}`,
          },
        }),
      })),
    )

    expect(responses.every((response) => response.status === 201)).toBe(true)
    const registry = await fetch(`${baseUrl}/api/registry`).then((response) => response.json())
    expect(registry.privateTemplates.map((template) => template.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('rejects invalid packs and stale preference writes', async () => {
    const { baseUrl } = await createServer()
    await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { defaultInventorySource: 'manual' } }),
    })
    const conflict = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { defaultInventorySource: 'catalog' }, expectedUpdatedAt: null }),
    })
    expect(conflict.status).toBe(409)

    const invalid = await fetch(`${baseUrl}/api/registry/private-templates/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: { format: 'other', version: 1, templates: [] } }),
    })
    expect(invalid.status).toBe(400)
  })

  it.each([
    { mode: 'offline', path: '/api/registry/catalog/import', expectedStatus: 201 },
    { mode: 'connected', path: '/api/registry/catalog/refresh', expectedStatus: 200 },
  ])('preserves database metadata after $mode catalog activation', async ({ mode, path: routePath, expectedStatus }) => {
    const { baseUrl } = await createServer({
      snapshotServiceFactory: (store) => ({
        activate: async () => store.getRegistryState(),
        refreshConnected: async () => store.getRegistryState(),
      }),
    })
    await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { mode } }),
    })
    const before = await fetch(`${baseUrl}/api/registry`).then((response) => response.json())
    const response = await fetch(`${baseUrl}${routePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const payload = await response.json()

    expect(response.status).toBe(expectedStatus)
    expect(payload.registry.database).toEqual(before.database)
    expect(payload.registry.database.schemaVersion).not.toBeNull()
  })
})
