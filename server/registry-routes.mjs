import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'
import { isRelationalId } from './db/relational-ids.mjs'
import { SnapshotService } from './registry/snapshot-service.mjs'
import { contributionStatus } from './registry/contribution-service.mjs'
import { InstallationRecoveryError } from './registry/installation-identity.mjs'
import { CatalogAvailabilityError } from './registry/catalog-availability.mjs'
import {
  APPLICATION_CATALOG_CONTRACT_VERSION,
  APPLICATION_OEM_CONTRACT_VERSION,
} from './app-health.mjs'

const DEFAULT_REGISTRY_POLICY = Object.freeze({
  modeLocked: false,
  forcedMode: null,
  contributionsAllowed: true,
  networkRefreshAllowed: true,
})

function normalizedRegistryPolicy(policy) {
  if (!policy) return DEFAULT_REGISTRY_POLICY
  return {
    modeLocked: typeof policy.forcedMode === 'string',
    forcedMode: policy.forcedMode ?? null,
    contributionsAllowed: policy.contributionsAllowed !== false,
    networkRefreshAllowed: policy.networkRefreshAllowed !== false,
    ...(policy.automaticSafeUpdatesForced === true ? { automaticSafeUpdatesForced: true } : {}),
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
      ...(policy.automaticSafeUpdatesForced ? { automaticSafeUpdates: true } : {}),
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

function registryUpdateSummary(store) {
  if (typeof store.getRegistryUpdateSummary === 'function') return store.getRegistryUpdateSummary()
  const groups = typeof store.getRegistryUpdateGroups === 'function' ? store.getRegistryUpdateGroups() : []
  return {
    run: typeof store.getRegistryUpdateStatus === 'function' ? store.getRegistryUpdateStatus() : null,
    counts: {
      review: groups.filter((group) => group.status === 'review' && group.classification !== 'blocked').length,
      blocked: groups.filter((group) => group.status === 'blocked' || (group.status === 'review' && group.classification === 'blocked')).length,
      applied: groups.filter((group) => group.status === 'applied').length,
      declined: groups.filter((group) => group.status === 'declined').length,
    },
  }
}

function compactRegistryUpdateGroup(group) {
  return {
    id: group.id,
    status: group.status,
    templateKey: group.templateKey,
    fromRevision: group.fromRevision,
    toRevision: group.toRevision,
    classification: group.classification,
    reasons: group.reasons,
    concurrencyToken: group.concurrencyToken,
    reconsiderable: group.reconsiderable === true,
    evaluatedAt: group.evaluatedAt,
    items: group.items.map((item) => ({
      linkId: item.linkId,
      itemType: item.itemType,
      itemId: item.itemId,
      itemName: item.itemName,
      projects: item.projects,
      classification: item.classification,
      fromRevision: item.fromRevision,
    })),
    projects: group.projects,
  }
}

function registryUpdateListQuery(query) {
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new InventoryLifecycleError('Registry update page size is invalid.', {
      code: 'invalid-registry-update-page', status: 400,
    })
  }
  let offset = 0
  if (query.cursor !== undefined) {
    try {
      const decoded = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString('utf8'))
      if (!Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new Error('invalid')
      offset = decoded.offset
    } catch {
      throw new InventoryLifecycleError('Registry update cursor is invalid.', {
        code: 'invalid-registry-update-cursor', status: 400,
      })
    }
  }
  const status = typeof query.status === 'string' ? query.status : 'review'
  if (!['review', 'blocked', 'applied', 'declined'].includes(status)) {
    throw new InventoryLifecycleError('Registry update status is invalid.', {
      code: 'invalid-registry-update-filter', status: 400,
    })
  }
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120).toLowerCase() : ''
  const category = typeof query.category === 'string' ? query.category : null
  const reason = typeof query.reason === 'string' ? query.reason : null
  const projectId = query.projectId === undefined ? null : parseId(String(query.projectId))
  if (query.projectId !== undefined && projectId === null) {
    throw new InventoryLifecycleError('Registry update project filter is invalid.', {
      code: 'invalid-registry-update-filter', status: 400,
    })
  }
  return { limit, offset, status, q, category, reason, projectId }
}

function listRegistryUpdateGroups(store, query) {
  const filters = registryUpdateListQuery(query)
  const filtered = store.getRegistryUpdateGroups().filter((group) => (
    group.status === filters.status
    && (!filters.q || `${group.templateKey} ${group.items.map((item) => item.itemName).join(' ')}`.toLowerCase().includes(filters.q))
    && (!filters.category || group.items.some((item) => item.itemType === filters.category))
    && (!filters.reason || group.reasons.includes(filters.reason))
    && (!filters.projectId || group.projects.some((project) => project.id === filters.projectId))
  ))
  const page = filtered.slice(filters.offset, filters.offset + filters.limit)
  const nextOffset = filters.offset + page.length
  return {
    groups: page.map(compactRegistryUpdateGroup),
    nextCursor: nextOffset < filtered.length
      ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url')
      : null,
    total: filtered.length,
    run: typeof store.getRegistryUpdateStatus === 'function' ? store.getRegistryUpdateStatus() : null,
  }
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
  if (error instanceof CatalogAvailabilityError) {
    response.status(error.status).json({ message: error.message, code: error.code })
    return
  }
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
  catalogUpdateCoordinator,
  catalogStatusService,
  onUpdatesChanged,
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
      if (policy.automaticSafeUpdatesForced && settings?.automaticSafeUpdates === false) throw demoPolicyError()
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
        ...(policy.automaticSafeUpdatesForced ? { automaticSafeUpdates: true } : {}),
      }, request.body?.expectedUpdatedAt)
      catalogRefreshCoordinator?.reconcileSchedule()
      if (settings?.automaticSafeUpdates === true) void catalogUpdateCoordinator?.run().catch(() => {})
      if (store.getRegistryState().settings.automaticContributions) {
        void deliveryService.trigger(store)
        void catalogStatusService?.trigger('enrollment-ready')
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
      if (!policy.networkRefreshAllowed) throw demoPolicyError()
      try {
        if (catalogRefreshCoordinator) {
          await catalogRefreshCoordinator.refresh('manual')
        } else {
          await snapshotService(store).refreshConnected()
        }
        await catalogUpdateCoordinator?.run()
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
    run(withStore, request, response, async (store) => {
      if (request.query.view === 'summary') {
        response.json(registryUpdateSummary(store))
        return
      }
      if (request.query.view === 'groups') {
        response.json({
          groups: typeof store.getRegistryUpdateGroups === 'function' ? store.getRegistryUpdateGroups() : [],
          run: typeof store.getRegistryUpdateStatus === 'function' ? store.getRegistryUpdateStatus() : null,
        })
        return
      }
      response.json({
        updates: store.getCatalogUpdates(),
        groups: typeof store.getRegistryUpdateGroups === 'function' ? store.getRegistryUpdateGroups() : [],
        run: typeof store.getRegistryUpdateStatus === 'function' ? store.getRegistryUpdateStatus() : null,
      })
    })
  })

  app.get('/api/registry/update-groups', (request, response) => {
    run(withStore, request, response, async (store) => {
      response.json(listRegistryUpdateGroups(store, request.query))
    })
  })

  app.get('/api/registry/update-groups/:groupId', (request, response) => {
    run(withStore, request, response, async (store) => {
      const token = typeof request.query.token === 'string' ? request.query.token : ''
      if (!/^[a-f0-9]{64}$/.test(token)) throw new InventoryLifecycleError('Registry update token is invalid.', {
        code: 'invalid-registry-update-token', status: 400,
      })
      const group = store.getRegistryUpdateGroup(request.params.groupId, token)
      if (group.status === 'applied' || group.status === 'declined') {
        response.json(store.getRegistryUpdateGroupDetail(group.id, token, null))
        return
      }
      const template = await snapshotService(store).template(group.templateKey)
      if (!template || template.revision !== group.toRevision || template.contentHash !== group.targetContentHash) {
        throw new InventoryLifecycleError('Updated catalog template is unavailable.', {
          code: 'catalog-template-not-found', status: 409,
        })
      }
      response.json(store.getRegistryUpdateGroupDetail(group.id, token, template))
    })
  })

  app.post('/api/registry/updates/retry', (request, response) => {
    run(withStore, request, response, async (store) => {
      await catalogUpdateCoordinator?.run({ force: true })
      response.json({
        groups: store.getRegistryUpdateGroups(),
        run: store.getRegistryUpdateStatus(),
      })
    })
  })

  app.post('/api/registry/update-groups/decision', (request, response) => {
    run(withStore, request, response, async (store) => {
      if (Array.isArray(request.body?.groups) && request.body.groups.every((group) => typeof group?.groupId === 'string')) {
        const groups = request.body.groups
        const decision = request.body?.decision
        if (
          groups.length === 0
          || groups.length > 100
          || !['applied', 'declined', 'reconsider'].includes(decision)
          || groups.some((group) => !/^[a-f0-9]{64}$/.test(group.concurrencyToken ?? ''))
        ) throw new InventoryLifecycleError('Registry update decision is invalid.', {
          code: 'invalid-registry-update-decision', status: 400,
        })
        const results = []
        for (const requested of groups) {
          if (decision === 'applied') {
            const group = store.getRegistryUpdateGroup(requested.groupId, requested.concurrencyToken)
            const template = await snapshotService(store).template(group.templateKey)
            if (!template) throw new InventoryLifecycleError('Updated catalog template is unavailable.', {
              code: 'catalog-template-not-found', status: 409,
            })
            results.push(store.applyRegistryUpdateGroupById({
              groupId: requested.groupId,
              concurrencyToken: requested.concurrencyToken,
              template,
              userId: request.authentication?.account?.id ?? null,
            }))
          } else {
            results.push(store.decideRegistryUpdateGroupById({
              groupId: requested.groupId,
              concurrencyToken: requested.concurrencyToken,
              decision: decision === 'reconsider' ? 'pending' : decision,
              userId: request.authentication?.account?.id ?? null,
            }))
          }
        }
        const last = results.at(-1)
        onUpdatesChanged?.()
        response.json({
          decisions: results.flatMap((result) => result.decisions),
          summary: last?.summary ?? registryUpdateSummary(store),
          affectedProjectIds: [...new Set(results.flatMap((result) => result.affectedProjectIds ?? []))],
          affectedProjectRevisions: Object.assign({}, ...results.map((result) => result.affectedProjectRevisions ?? {})),
          affectedLinkIds: [...new Set(results.flatMap((result) => result.affectedLinkIds ?? []))],
        })
        return
      }
      const requestedGroups = Array.isArray(request.body?.groups)
        ? request.body.groups
        : [{ templateKey: request.body?.templateKey, toRevision: request.body?.toRevision }]
      const decision = request.body?.decision
      const groups = requestedGroups.map((group) => ({ templateKey: group?.templateKey, toRevision: Number(group?.toRevision) }))
      const groupKeys = new Set(groups.map((group) => `${group.templateKey}:${group.toRevision}`))
      if (groups.length === 0 || groups.length > 100 || groupKeys.size !== groups.length || groups.some((group) => typeof group.templateKey !== 'string' || !Number.isSafeInteger(group.toRevision) || group.toRevision < 1)) {
        throw new InventoryLifecycleError('Registry update group is invalid.', {
          code: 'invalid-registry-update-group', status: 400,
        })
      }
      if (!['applied', 'declined', 'reconsider'].includes(decision)) throw new InventoryLifecycleError('Registry update decision is invalid.', {
        code: 'invalid-registry-update-decision', status: 400,
      })
      if (decision === 'applied') {
        const templates = await Promise.all(groups.map((group) => snapshotService(store).template(group.templateKey)))
        if (templates.some((template, index) => !template || template.revision !== groups[index].toRevision)) throw new InventoryLifecycleError('Updated catalog template is unavailable.', {
          code: 'catalog-template-not-found', status: 409,
        })
        const result = store.applyRegistryUpdateGroups(templates, request.authentication?.account?.id ?? null)
        onUpdatesChanged?.()
        response.json(result)
        return
      }
      const result = store.decideRegistryUpdateGroups({
        groups,
        decision: decision === 'reconsider' ? 'pending' : decision,
        userId: request.authentication?.account?.id ?? null,
      })
      onUpdatesChanged?.()
      response.json(result)
    })
  })

  app.post('/api/registry/update-groups/:groupId/resolve-and-apply', (request, response) => {
    run(withStore, request, response, async (store) => {
      const token = request.body?.concurrencyToken
      const linkId = Number(request.body?.linkId)
      if (!/^[a-f0-9]{64}$/.test(token ?? '') || !isRelationalId(linkId)) {
        throw new InventoryLifecycleError('Registry topology resolution request is invalid.', {
          code: 'invalid-registry-update-resolution', status: 400,
        })
      }
      const group = store.getRegistryUpdateGroup(request.params.groupId, token)
      const template = await snapshotService(store).template(group.templateKey)
      if (!template) throw new InventoryLifecycleError('Updated catalog template is unavailable.', {
        code: 'catalog-template-not-found', status: 409,
      })
      const result = store.resolveAndApplyRegistryUpdateGroupById({
        groupId: group.id,
        concurrencyToken: token,
        linkId,
        template,
        expectedProjectRevisions: request.body?.expectedProjectRevisions ?? null,
        userId: request.authentication?.account?.id ?? null,
      })
      onUpdatesChanged?.()
      response.json(result)
    })
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
