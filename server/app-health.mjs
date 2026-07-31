export function applicationHealth({ mode, schemaVersion = null, persistence = null }) {
  const persistenceHealthy = persistence === null || persistence.ok === true

  return {
    status: persistenceHealthy ? 200 : 503,
    payload: {
      ok: persistenceHealthy,
      mode,
      schemaVersion,
      persistence,
    },
  }
}
