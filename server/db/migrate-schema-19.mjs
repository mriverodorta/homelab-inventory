const LEGACY_FINGERPRINT_VERSION = 2

function withLegacyFingerprint(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  return {
    ...record,
    fingerprintVersion: Number.isSafeInteger(record.fingerprintVersion)
      ? record.fingerprintVersion
      : LEGACY_FINGERPRINT_VERSION,
  }
}

export function migrateSchema18To19(registry) {
  const migrated = structuredClone(registry ?? {})
  const collections = ['contributionOutbox', 'contributionLedger', 'contributionGroups', 'projectionCache']
  let initializedRecords = 0

  for (const collection of collections) {
    const records = Array.isArray(migrated[collection]) ? migrated[collection] : []
    migrated[collection] = records.map((record) => {
      if (Number.isSafeInteger(record?.fingerprintVersion)) return record
      initializedRecords += 1
      return withLegacyFingerprint(record)
    })
  }

  const links = Array.isArray(migrated.links) ? migrated.links : []
  migrated.links = links.map((link) => {
    if (Number.isSafeInteger(link?.importedFingerprintVersion)) return link
    initializedRecords += 1
    return { ...link, importedFingerprintVersion: LEGACY_FINGERPRINT_VERSION }
  })

  return {
    registry: migrated,
    summary: {
      initializedRecords,
      links: links.length,
      fingerprintVersion: LEGACY_FINGERPRINT_VERSION,
    },
  }
}
