import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'
import { isRelationalId } from './db/relational-ids.mjs'
import { SnapshotService } from './registry/snapshot-service.mjs'
import { contributionStatus } from './registry/contribution-service.mjs'

function publicRegistryState(store) {
  const registry = store.getRegistryState()
  const meta = store.databases?.meta?.data ?? {}
  const lastMigration = meta.lastMigration && typeof meta.lastMigration === 'object'
    ? {
        from: meta.lastMigration.from,
        to: meta.lastMigration.to,
        completedAt: meta.lastMigration.completedAt,
        backupId: meta.lastMigration.backupId ?? null,
        summary: meta.lastMigration.summary ?? null,
      }
    : null
  return {
    settings: registry.settings,
    sources: registry.sources,
    links: registry.links,
    privateTemplates: registry.privateTemplates,
    snapshot: registry.snapshot,
    contributions: contributionStatus(store),
    database: {
      schemaVersion: Number.isSafeInteger(meta.schemaVersion) ? meta.schemaVersion : null,
      lastMigration,
    },
  }
}

function parseId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && isRelationalId(Number(value))
    ? Number(value)
    : null
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
  response.status(400).json({
    message: error instanceof Error ? error.message : fallback,
    code: 'invalid-registry-request',
  })
}

function run(withStore, request, response, handler) {
  void withStore(request, response, async (store) => {
    try {
      await handler(store)
    } catch (error) {
      respondError(response, error, 'Registry request is invalid.')
    }
  }, { message: 'Unable to access registry data.' })
}

export function registerRegistryRoutes(app, {
  withStore,
  trustedKeys,
  fetchImpl,
  officialOrigin,
  identityService,
  deliveryService,
} = {}) {
  const snapshotService = (store) => new SnapshotService(store, {
    ...(trustedKeys === undefined ? {} : { trustedKeys }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(officialOrigin === undefined ? {} : { officialOrigin }),
  })

  app.get('/api/registry', (request, response) => {
    run(withStore, request, response, async (store) => response.json(publicRegistryState(store)))
  })

  app.patch('/api/registry/settings', (request, response) => {
    run(withStore, request, response, async (store) => {
      const settings = request.body?.settings ?? request.body
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
        await identityService.credentials(store)
      }
      store.updateRegistrySettings(settings, request.body?.expectedUpdatedAt)
      if (store.getRegistryState().settings.automaticContributions) {
        void deliveryService.trigger(store)
      }
      response.json(publicRegistryState(store))
    })
  })

  app.post('/api/registry/private-templates', (request, response) => {
    run(withStore, request, response, async (store) => {
      await store.createPrivateTemplate(request.body)
      response.status(201).json(publicRegistryState(store))
    })
  })

  app.post('/api/registry/private-templates/:id/duplicate', (request, response) => {
    run(withStore, request, response, async (store) => {
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Private template ID is invalid.', {
        code: 'invalid-private-template-id', status: 400,
      })
      await store.duplicatePrivateTemplate(id)
      response.status(201).json(publicRegistryState(store))
    })
  })

  app.delete('/api/registry/private-templates/:id', (request, response) => {
    run(withStore, request, response, async (store) => {
      const id = parseId(request.params.id)
      if (id === null) throw new InventoryLifecycleError('Private template ID is invalid.', {
        code: 'invalid-private-template-id', status: 400,
      })
      store.deletePrivateTemplate(id)
      response.json(publicRegistryState(store))
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
        registry: publicRegistryState(store),
      })
    })
  })

  app.get('/api/registry/catalog/search', (request, response) => {
    run(withStore, request, response, async (store) => {
      const results = await snapshotService(store).search({
        query: request.query.q,
        type: request.query.type,
        manufacturer: request.query.manufacturer,
        limit: request.query.limit,
        offset: request.query.offset,
      })
      response.json(results)
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
      const registry = await snapshotService(store).activate(snapshotArtifact, { mode: 'offline', digestArtifact })
      response.status(201).json({ registry: publicRegistryState({ getRegistryState: () => registry }) })
    })
  })

  app.post('/api/registry/catalog/refresh', (request, response) => {
    run(withStore, request, response, async (store) => {
      const registry = await snapshotService(store).refreshConnected()
      response.json({ registry: publicRegistryState({ getRegistryState: () => registry }) })
    })
  })

  app.post('/api/registry/catalog/templates/:templateKey/create', (request, response) => {
    run(withStore, request, response, async (store) => {
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
      response.status(201).json(store.createCatalogInventoryItems(template, request.body?.quantity ?? 1))
    })
  })

  app.get('/api/registry/updates', (request, response) => {
    run(withStore, request, response, async (store) => response.json({ updates: store.getCatalogUpdates() }))
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
      response.json(store.applyCatalogUpdate(id, template))
    })
  })

  app.get('/api/registry/contributions/status', (request, response) => {
    run(withStore, request, response, async (store) => response.json(contributionStatus(store)))
  })

  app.post('/api/registry/contributions/deliver', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!deliveryService) throw new InventoryLifecycleError('Contribution delivery is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      response.json(await deliveryService.trigger(store))
    })
  })

  app.post('/api/registry/contributions/revoke', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!identityService) throw new InventoryLifecycleError('Registry enrollment is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      await identityService.revoke(store)
      response.json(contributionStatus(store))
    })
  })

  app.post('/api/registry/contributions/rotate-key', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (!identityService) throw new InventoryLifecycleError('Registry enrollment is unavailable.', {
        code: 'contributions-unavailable', status: 503,
      })
      await identityService.rotate(store)
      response.json(contributionStatus(store))
    })
  })
}
