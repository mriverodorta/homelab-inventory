import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'

const RECEIPT_ID = '0035_labgd_publication_convergence'
const RECEIPT_CHECKSUM = '911b3806a6d3d12c63acf59593692cbedb8cff54b36ec445adb6bf63d1bbc159'

export function auditPublicationMigration(database) {
  const receipt = database.query(`
    SELECT started_at_ms AS startedAtMs, completed_at_ms AS completedAtMs
    FROM schema_migrations
    WHERE migration_id = ? AND checksum = ? AND verification_status = 'verified'
  `).get(RECEIPT_ID, RECEIPT_CHECKSUM)
  if (!receipt
    || !Number.isSafeInteger(receipt.startedAtMs)
    || !Number.isSafeInteger(receipt.completedAtMs)
    || receipt.startedAtMs <= 0
    || receipt.completedAtMs < receipt.startedAtMs) {
    throw new Error('The verified schema 35 migration receipt is unavailable.')
  }

  const columns = new Set(database.query('PRAGMA table_info(share_publication_operations)').all().map(({ name }) => name))
  const migrated = columns.has('predates_migration_0035') && columns.has('revision_intent_provenance')
  const predatesExpression = migrated
    ? 'predates_migration_0035'
    : `CASE WHEN created_at_ms <= ${Number(receipt.completedAtMs)} THEN 1 ELSE 0 END`
  const groups = database.query(`
    SELECT kind, state,
      CASE WHEN remote_operation_id IS NULL THEN 0 ELSE 1 END AS remoteOperationPresent,
      CASE WHEN expected_remote_revision IS NULL THEN 0 ELSE 1 END AS expectedRevisionPresent,
      ${predatesExpression} AS predatesMigration0035,
      count(*) AS count
    FROM share_publication_operations
    GROUP BY kind, state, remoteOperationPresent, expectedRevisionPresent, predatesMigration0035
    ORDER BY kind, state, remoteOperationPresent, expectedRevisionPresent, predatesMigration0035
  `).all().map((row) => ({
    kind: row.kind,
    state: row.state,
    remoteOperationPresent: row.remoteOperationPresent === 1,
    expectedRevisionPresent: row.expectedRevisionPresent === 1,
    predatesMigration0035: row.predatesMigration0035 === 1,
    count: Number(row.count),
  }))

  const reconciliationRequired = migrated
    ? database.query(`
        SELECT count(*) AS count FROM share_publication_operations
        WHERE revision_intent_provenance = 'reconciliation-required'
      `).get().count
    : database.query(`
        SELECT count(*) AS count
        FROM share_publication_operations
        WHERE kind = 'publish'
          AND state IN ('queued','running','retrying','failed')
          AND created_at_ms <= ?
          AND NOT (
            state = 'queued'
            AND attempt_count = 0
            AND remote_operation_id IS NULL
            AND remote_operation_state IS NULL
            AND remote_failure_code IS NULL
            AND remote_missing_hashes_json IS NULL
            AND activation_revision_id IS NULL
            AND last_error_code IS NULL
            AND updated_at_ms = created_at_ms
          )
      `).get(receipt.completedAtMs).count

  return { groups, reconciliationRequiredCount: Number(reconciliationRequired) }
}

function databaseArgument(argv) {
  const index = argv.indexOf('--database')
  const value = index >= 0 ? argv[index + 1] : null
  if (!value || value.startsWith('-')) throw new Error('Usage: bun run sharing:publication-preflight --database /absolute/path/to/homelab-inventory.sqlite')
  return resolve(value)
}

if (import.meta.main) {
  let database
  try {
    database = new Database(databaseArgument(process.argv.slice(2)), { readonly: true, strict: true })
    database.exec('PRAGMA query_only = ON;')
    const result = auditPublicationMigration(database)
    console.log(JSON.stringify(result, null, 2))
    if (result.reconciliationRequiredCount > 0) process.exitCode = 2
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Publication preflight failed.')
    process.exitCode = 1
  } finally {
    database?.close(false)
  }
}
