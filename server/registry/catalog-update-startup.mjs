export async function runCatalogUpdatesAfterStartup({ runtime, store, coordinator }) {
  await runtime.resumeRecovery(store)
  if (!runtime.state(store).available) return { skipped: true }
  return coordinator?.run() ?? { skipped: true }
}
