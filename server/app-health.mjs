export const APPLICATION_OEM_CONTRACT_VERSION = 6
export const APPLICATION_CATALOG_CONTRACT_VERSION = 8

export function applicationHealth({ mode, schemaVersion = null, persistence = null }) {
  const persistenceHealthy = persistence === null || persistence.ok === true

  return {
    status: persistenceHealthy ? 200 : 503,
    payload: {
      ok: persistenceHealthy,
      mode,
      schemaVersion,
      applicationOemContractVersion: APPLICATION_OEM_CONTRACT_VERSION,
      applicationCatalogContractVersion: APPLICATION_CATALOG_CONTRACT_VERSION,
      persistence,
    },
  }
}
