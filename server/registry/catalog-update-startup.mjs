export const CATALOG_UPDATE_RECONCILIATION_VERSION = 1

export async function runCatalogUpdatesAfterStartup({ runtime, store, coordinator }) {
  await runtime.resumeRecovery(store)
  if (!runtime.state(store).available) return { skipped: true }
  if (!coordinator) return { skipped: true }

  const persistedVersion = store.getCatalogUpdateReconciliationVersion?.()
    ?? CATALOG_UPDATE_RECONCILIATION_VERSION
  const force = persistedVersion < CATALOG_UPDATE_RECONCILIATION_VERSION
  const result = force
    ? await coordinator.run({ force: true })
    : await coordinator.run()
  if (force) {
    store.markCatalogUpdateReconciliationComplete?.(CATALOG_UPDATE_RECONCILIATION_VERSION)
  }
  return result
}
