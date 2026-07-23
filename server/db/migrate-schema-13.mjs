export function migrateSchema12To13(project) {
  const migrated = structuredClone(project)
  if (migrated.revision === undefined) {
    migrated.revision = 1
  } else if (!Number.isSafeInteger(migrated.revision) || migrated.revision < 1) {
    throw new Error('Schema 12 project revision must be a positive safe integer when present.')
  }
  return migrated
}
