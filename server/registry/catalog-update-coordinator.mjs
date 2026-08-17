export class CatalogUpdateCoordinator {
  constructor({ store, snapshotService, logger = console, forceAutomatic = false, now = Date.now, onChanged = null }) {
    this.store = store
    this.snapshotService = snapshotService
    this.logger = logger
    this.forceAutomatic = forceAutomatic
    this.now = now
    this.onChanged = onChanged
    this.inFlight = null
  }

  run({ force = false } = {}) {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.runOnce({ force })
      .catch((error) => {
        const registry = this.store.getRegistryState()
        try {
          if (registry.snapshot) this.store.recordCatalogUpdateFailure?.({
            sourceId: registry.snapshot.sourceId,
            catalogRevision: registry.snapshot.revision,
            automatic: this.forceAutomatic || registry.settings.automaticSafeUpdates !== false,
            error,
          })
        } catch (persistenceError) {
          this.logger.error('[registry-updates] Failed to persist catalog update failure.', persistenceError instanceof Error ? persistenceError.message : persistenceError)
        }
        this.logger.error('[registry-updates] Catalog update evaluation failed.', error instanceof Error ? error.message : error)
        throw error
      })
      .finally(() => { this.inFlight = null })
    return this.inFlight
  }

  async runOnce({ force = false } = {}) {
    const registry = this.store.getRegistryState()
    const snapshot = registry.snapshot
    const source = registry.sources.find((candidate) => candidate.id === snapshot?.sourceId)
    if (!snapshot || source?.kind !== 'official-connected') return { applied: 0, review: 0, blocked: 0, skipped: 0, groups: [] }
    const previousRun = this.store.getRegistryUpdateStatus?.()
    if (!force && previousRun?.state === 'failed' && previousRun.catalogRevision === snapshot.revision) {
      if (previousRun.attemptCount >= 3 || (previousRun.retryAfter && Date.parse(previousRun.retryAfter) > this.now())) {
        return { applied: 0, review: 0, blocked: 0, skipped: 0, groups: this.store.getRegistryUpdateGroups(), run: previousRun }
      }
    }
    const updates = this.store.getCatalogUpdates().filter((update) => update.linkId)
    if (updates.length === 0) return { applied: 0, review: 0, blocked: 0, skipped: 0, groups: this.store.getRegistryUpdateGroups() }
    if (!force && previousRun?.state === 'completed' && previousRun.catalogRevision === snapshot.revision) {
      const groups = this.store.getRegistryUpdateGroups()
      const evaluated = new Set(groups.flatMap((group) => (
        group.items.map((item) => `${item.linkId}:${group.toRevision}`)
      )))
      if (updates.every((update) => evaluated.has(`${update.linkId}:${update.availableRevision}`))) {
        return {
          applied: 0,
          review: previousRun.reviewCount,
          blocked: previousRun.blockedCount,
          skipped: previousRun.skippedCount,
          groups,
          run: previousRun,
        }
      }
    }
    const templateKeys = [...new Set(updates.map((update) => update.templateKey))]
    const templates = typeof this.snapshotService.templates === 'function'
      ? await this.snapshotService.templates(templateKeys)
      : (await Promise.all(templateKeys.map((key) => this.snapshotService.template(key)))).filter(Boolean)
    const templateByKey = new Map(templates.map((template) => [template.templateKey, template]))
    const eligibleUpdates = updates.filter((update) => templateByKey.get(update.templateKey)?.revision === update.availableRevision)
    const batch = this.store.evaluateCatalogUpdates(eligibleUpdates, templates)
    const result = this.store.commitCatalogUpdateRun({
      sourceId: snapshot.sourceId,
      catalogRevision: snapshot.revision,
      evaluations: batch.evaluations,
      templates,
      automatic: this.forceAutomatic || registry.settings.automaticSafeUpdates !== false,
      expectedProjectRevision: batch.projectRevision,
      expectedProjectRevisions: batch.projectRevisions,
    })
    this.onChanged?.(result)
    return result
  }
}
