import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'
import { isRelationalId } from './db/relational-ids.mjs'
import { SnapshotService } from './registry/snapshot-service.mjs'
import { contributionStatus } from './registry/contribution-service.mjs'
import { InstallationRecoveryError } from './registry/installation-identity.mjs'
import {
  APPLICATION_CATALOG_CONTRACT_VERSION,
  APPLICATION_OEM_CONTRACT_VERSION,
} from './app-health.mjs'

const DEFAULT_REGISTRY_POLICY = Object.freeze({
  modeLocked: false,
  forcedMode: null,
  contributionsAllowed: true,
})

function normalizedRegistryPolicy(policy) {
  if (!policy) return DEFAULT_REGISTRY_POLICY
  return {
    modeLocked: typeof policy.forcedMode === 'string',
    forcedMode: policy.forcedMode ?? null,
    contributionsAllowed: policy.contributionsAllowed !== false,
  }
}

/** @param {import('./persistence/store-contract.ts').HomelabInventoryPersistence} store */
export function publicRegistryState(store, policy = DEFAULT_REGISTRY_POLICY) {
  const registry = store.getRegistryState()
  const database = store.getDatabaseStatus()
  const lastMigration = database.lastMigration && typeof database.lastMigration === 'object'
    ? {
        from: database.lastMigration.from,
        to: database.lastMigration.to,
        completedAt: database.lastMigration.completedAt,
        backupId: database.lastMigration.backupId ?? null,
        summary: database.lastMigration.summary ?? null,
      }
    : null
  return {
    policy,
    settings: {
      ...registry.settings,
      ...(policy.forcedMode ? { mode: policy.forcedMode } : {}),
      ...(!policy.contributionsAllowed ? { automaticContributions: false } : {}),
    },
    sources: registry.sources,
    links: registry.links,
    privateTemplates: registry.privateTemplates,
    snapshot: registry.snapshot,
    contributions: {
      ...contributionStatus(store),
      ...(!policy.contributionsAllowed ? { enabled: false } : {}),
    },
    database: {
      schemaVersion: database.schemaVersion,
      applicationOemContractVersion: APPLICATION_OEM_CONTRACT_VERSION,
      applicationCatalogContractVersion: APPLICATION_CATALOG_CONTRACT_VERSION,
      lastMigration,
    },
  }
}

function parseId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && isRelationalId(Number(value))
    ? Number(value)
    : null
}

function queryValues(value) {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map(String)
}

function parseFacetSearch(query) {
  const terms = {}
  const ranges = {}
  const entries = [
    ...queryValues(query.term).map((value) => ['term', value]),
    ...queryValues(query.min).map((value) => ['minimum', value]),
    ...queryValues(query.max).map((value) => ['maximum', value]),
  ]
  if (entries.length > 80) throw new InventoryLifecycleError('Too many catalog facet constraints were supplied.', {
    code: 'invalid-catalog-filters', status: 400,
  })
  for (const [kind, entry] of entries) {
    const separator = entry.indexOf(':')
    const key = separator > 0 ? entry.slice(0, separator) : ''
    const value = separator > 0 ? entry.slice(separator + 1) : ''
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key) || value === '' || value.length > 200) {
      throw new InventoryLifecycleError('Catalog facet filters are invalid.', {
        code: 'invalid-catalog-filters', status: 400,
      })
    }
    if (kind === 'term') {
      terms[key] = [...new Set([...(terms[key] ?? []), value])]
      continue
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) throw new InventoryLifecycleError('Catalog range filters are invalid.', {
      code: 'invalid-catalog-filters', status: 400,
    })
    ranges[key] = { ...(ranges[key] ?? {}), [kind]: numeric }
  }
  return { terms, ranges }
}

function respondError(response, error, fallback) {
  if (error instanceof InventoryLifecycleError) {
    response.status(error.status).json({
      message: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    })
    return
  }
  if (error instanceof InstallationRecoveryError) {
    response.status(409).json({
      message: error.message,
      code: error.code,
      recoveryKey: error.recoveryKey,
    })
    return
  }
  console.error('[registry] Request failed.', error instanceof Error ? error.message : error)
  response.status(500).json({
    message: fallback,
    code: 'registry-request-failed',
  })
}

function run(withStore, request, response, handler) {
  void withStore(request, response, async (store) => {
    try {
      await handler(store)
    } catch (error) {
      respondError(response, error, 'Registry request could not be completed.')
    }
  }, { message: 'Unable to access registry data.' })
}

function scopedRegistryStore(store, request) {
  const rawProjectId = request.query?.projectId
  const rawWorkspaceId = request.query?.workspaceId
  if (rawProjectId === undefined && rawWorkspaceId === undefined) return { store, scoped: false }
  const projectId = parseId(String(rawProjectId ?? ''))
  const workspaceId = parseId(String(rawWorkspaceId ?? ''))
  if (projectId === null || workspaceId === null) {
    throw new InventoryLifecycleError('Registry project and workspace scope must use positive safe integers.', {
      code: 'invalid-registry-workspace-scope', status: 400,
    })
  }
  try {
    return { store: store.forWorkspace(projectId, workspaceId), scoped: true }
  } catch (error) {
    throw new InventoryLifecycleError(
      error instanceof Error ? error.message : 'Registry workspace scope was not found.',
      { code: 'registry-workspace-scope-not-found', status: 404 },
    )
  }
}

export function registerRegistryRoutes(app, {
  withStore,
  trustedKeys,
  fetchImpl,
  officialOrigin,
  identityService,
  deliveryService,
  snapshotServiceFactory,
  catalogRefreshCoordinator,
  registryPolicy,
} = {}) {
  const policy = normalizedRegistryPolicy(registryPolicy)
  const demoPolicyError = () => new InventoryLifecycleError(
    'Registry contribution settings are read-only in public demo mode.',
    { code: 'demo-registry-policy', status: 403 },
  )
  const snapshotServices = new WeakMap()
  const snapshotService = (store) => {
    const existing = snapshotServices.get(store)
    if (existing) return existing
    const service = snapshotServiceFactory
      ? snapshotServiceFactory(store)
      : new SnapshotService(store, {
        ...(trustedKeys === undefined ? {} : { trustedKeys }),
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
        ...(officialOrigin === undefined ? {} : { officialOrigin }),
      })
    snapshotServices.set(store, service)
    return service
  }

  app.get('/api/registry', (request, response) => {
    run(withStore, request, response, async (store) => response.json(publicRegistryState(store, policy)))
  })

  app.patch('/api/registry/settings', (request, response) => {
    run(withStore, request, response, async (store) => {
      const settings = request.body?.settings ?? request.body
      if (policy.modeLocked && settings?.mode !== undefined && settings.mode !== policy.forcedMode) {
        throw demoPolicyError()
      }
      if (!policy.contributionsAllowed && settings?.automaticContributions === true) {
        throw demoPolicyError()
      }
      if (settings?.automaticContributions === true) {
        const requestedMode = settings?.mode ?? store.getRegistryState().settings.mode
        if (requestedMode !== 'connected') {
          throw new InventoryLifecycleError('Automatic contributions require connected registry mode.', {
            code: 'connected-registry-required', status: 409,
          })
        }
        if (!identityService || !deliveryService) {
          throw new InventoryLifecycleError('Automatic contributions are unavailable on this installation.', {
            code: 'contributions-unavailable', status: 503,
          })
        }
        try {
          await identityService.credentials(store)
        } catch (error) {
          if (error instanceof InstallationRecoveryError) {
            store.updateRegistrySettings({ ...settings, automaticContributions: true }, request.body?.expectedUpdatedAt)
          }
          throw error
        }
      }
      store.updateRegistrySettings({
        ...settings,
        ...(policy.forcedMode ? { mode: policy.forcedMode } : {}),
        ...(!policy.contributionsAllowed ? { automaticContributions: false } : {}),
      }, request.body?.expectedUpdatedAt)
      catalogRefreshCoordinator?.reconcileSchedule()
      if (store.getRegistryState().settings.automaticContributions) {
        void deliveryService.trigger(store)
      } else if (settings?.automaticContributions === false) {
        await deliveryService?.waitForIdle?.()
      }
      response.json(publicRegistryState(store, policy))
    })
  })

  app.post('/api/registry/private-templates', (request, response) => {
    run(withStore, request, response, async (store) => {
      await store.createPrivateTemplate(request.body)
      response.status(201).json(publicRegistryState(store, policy))
    })
  })

  app.post('/api/registry/private-templates/:id/duplicate', (request, response) => {
    run(withStore, request, response, async (store) => {
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Private template ID is invalid.', {
        code: 'invalid-private-template-id', status: 400,
      })
      await store.duplicatePrivateTemplate(id)
      response.status(201).json(publicRegistryState(store, policy))
    })
  })

  app.delete('/api/registry/private-templates/:id', (request, response) => {
    run(withStore, request, response, async (store) => {
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Private template ID is invalid.', {
        code: 'invalid-private-template-id', status: 400,
      })
      store.deletePrivateTemplate(id)
      response.json(publicRegistryState(store, policy))
    })
  })

  app.post('/api/registry/private-templates/export', (request, response) => {
    run(withStore, request, response, async (store) => {
      response.json(await store.exportPrivateTemplates(request.body?.ids))
    })
  })

  app.post('/api/registry/private-templates/import/preview', (request, response) => {
    run(withStore, request, response, async (store) => {
      response.json(await store.previewPrivateTemplateImport(request.body?.pack ?? request.body))
    })
  })

  app.post('/api/registry/private-templates/import', (request, response) => {
    run(withStore, request, response, async (store) => {
      const result = await store.importPrivateTemplates(request.body?.pack ?? request.body)
      response.status(201).json({
        ...result,
        registry: publicRegistryState(store, policy),
      })
    })
  })

  app.get('/api/registry/catalog/search', (request, response) => {
    run(withStore, request, response, async (store) => {
      const results = await snapshotService(store).search({
        query: request.query.q,
        type: request.query.type,
        manufacturer: request.query.manufacturer,
        ...parseFacetSearch(request.query),
        limit: request.query.limit,
        offset: request.query.offset,
      })
      response.json(results)
    })
  })

  app.get('/api/registry/catalog/facets', (request, response) => {
    run(withStore, request, response, async (store) => {
      response.json(await snapshotService(store).facets())
    })
  })

  app.post('/api/registry/catalog/import', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (store.getRegistryState().settings.mode !== 'offline') {
        throw new InventoryLifecycleError('Offline catalog mode must be enabled before importing a snapshot.', {
          code: 'offline-catalog-disabled', status: 409,
        })
      }
      const imported = request.body?.artifact ?? request.body
      const snapshotArtifact = imported?.snapshot ?? imported
      const digestArtifact = imported?.digests
      const facetArtifact = imported?.facets
      try {
        await snapshotService(store).activate(snapshotArtifact, { mode: 'offline', digestArtifact, facetArtifact })
      } catch {
        throw new InventoryLifecycleError('Catalog snapshot could not be verified.', {
          code: 'invalid-catalog-snapshot', status: 400,
        })
      }
      response.status(201).json({ registry: publicRegistryState(store, policy) })
    })
  })

  app.post('/api/registry/catalog/refresh', (request, response) => {
    run(withStore, request, response, async (store) => {
      try {
        if (catalogRefreshCoordinator) {
          await catalogRefreshCoordinator.refresh('manual')
        } else {
          await snapshotService(store).refreshConnected()
        }
      } catch (error) {
        throw new InventoryLifecycleError(
          error instanceof Error ? error.message : 'Official catalog refresh failed.',
          { code: 'catalog-refresh-failed', status: 502 },
        )
      }
      response.json({ registry: publicRegistryState(store, policy) })
    })
  })

  app.post('/api/registry/catalog/templates/:templateKey/create', (request, response) => {
    run(withStore, request, response, async (store) => {
      const target = scopedRegistryStore(store, request)
      const templateKey = request.params.templateKey
      if (typeof templateKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(templateKey)) {
        throw new InventoryLifecycleError('Catalog template key is invalid.', {
          code: 'invalid-catalog-template-key', status: 400,
        })
      }
      const template = await snapshotService(store).template(templateKey)
      if (!template) throw new InventoryLifecycleError('Catalog template was not found.', {
        code: 'catalog-template-not-found', status: 404,
      })
      response.status(201).json(target.store.createCatalogInventoryItems(
        template,
        request.body?.quantity ?? 1,
        { usageRole: request.body?.usageRole, scope: target.scoped ? 'project' : 'global' },
      ))
    })
  })

  app.get('/api/registry/updates', (request, response) => {
    run(withStore, request, response, async (store) => response.json({ updates: store.getCatalogUpdates() }))
  })

  app.post('/api/registry/variant-matches/:id/select', (request, response) => {
    run(withStore, request, response, async (store) => {
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Catalog variant match ID is invalid.', {
        code: 'invalid-catalog-variant-match-id', status: 400,
      })
      const match = store.getRegistryState().variantMatches.find((candidate) => candidate.id === id)
      const templateKey = request.body?.templateKey
      if (!match || typeof templateKey !== 'string') throw new InventoryLifecycleError('Catalog variant selection was not found.', {
        code: 'catalog-variant-selection-not-found', status: 404,
      })
      const template = await snapshotService(store).template(templateKey)
      if (!template) throw new InventoryLifecycleError('Selected catalog template was not found.', {
        code: 'catalog-template-not-found', status: 404,
      })
      store.selectCatalogVariant(id, template)
      response.json({ updates: store.getCatalogUpdates() })
    })
  })

  app.get('/api/registry/links/:id/update-preview', (request, response) => {
    run(withStore, request, response, async (store) => {
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Catalog link ID is invalid.', {
        code: 'invalid-catalog-link-id', status: 400,
      })
      const link = store.getRegistryState().links.find((candidate) => candidate.id === id)
      if (!link) throw new InventoryLifecycleError('Catalog link was not found.', {
        code: 'catalog-link-not-found', status: 404,
      })
      const template = await snapshotService(store).template(link.templateKey)
      if (!template) throw new InventoryLifecycleError('Updated catalog template is unavailable.', {
        code: 'catalog-template-not-found', status: 409,
      })
      response.json(store.getCatalogUpdatePreview(id, template))
    })
  })

  app.post('/api/registry/links/:id/apply-update', (request, response) => {
    run(withStore, request, response, async (store) => {
      const target = scopedRegistryStore(store, request)
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Catalog link ID is invalid.', {
        code: 'invalid-catalog-link-id', status: 400,
      })
      const link = store.getRegistryState().links.find((candidate) => candidate.id === id)
      if (!link) throw new InventoryLifecycleError('Catalog link was not found.', {
        code: 'catalog-link-not-found', status: 404,
      })
      const template = await snapshotService(store).template(link.templateKey)
      if (!template) throw new InventoryLifecycleError('Updated catalog template is unavailable.', {
        code: 'catalog-template-not-found', status: 409,
      })
      response.json(target.store.applyCatalogUpdate(id, template))
    })
  })

  app.get('/api/registry/contributions/status', (request, response) => {
    run(withStore, request, response, async (store) => response.json(contributionStatus(store)))
  })

  app.post('/api/registry/contributions/deliver', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!policy.contributionsAllowed) throw demoPolicyError()
      if (!deliveryService) throw new InventoryLifecycleError('Contribution delivery is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      if (store.getRegistryState().settings.mode !== 'connected') {
        throw new InventoryLifecycleError('Contribution delivery requires connected registry mode.', {
          code: 'connected-registry-required', status: 409,
        })
      }
      response.json(await deliveryService.trigger(store, { explicit: true }))
    })
  })

  app.post('/api/registry/contributions/revoke', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!policy.contributionsAllowed) throw demoPolicyError()
      if (!identityService) throw new InventoryLifecycleError('Registry enrollment is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      await identityService.revoke(store)
      response.json(contributionStatus(store))
    })
  })

  app.post('/api/registry/contributions/rotate-key', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!policy.contributionsAllowed) throw demoPolicyError()
      if (!identityService) throw new InventoryLifecycleError('Registry enrollment is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      await identityService.rotate(store)
      response.json(contributionStatus(store))
    })
  })

  app.post('/api/registry/contributions/resume-recovery', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!policy.contributionsAllowed) throw demoPolicyError()
      if (!identityService) throw new InventoryLifecycleError('Registry enrollment recovery is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      await identityService.resumeRecovery(store)
      if (store.getRegistryState().settings.automaticContributions) void deliveryService?.trigger(store)
      response.json(contributionStatus(store))
    })
  })

  app.post('/api/registry/contributions/reset-recovery', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!policy.contributionsAllowed) throw demoPolicyError()
      if (!identityService) throw new InventoryLifecycleError('Registry enrollment recovery is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      await identityService.resetRecovery(store)
      response.json(contributionStatus(store))
    })
  })
}
