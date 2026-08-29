CREATE TEMP TABLE _labgd_publication_convergence_receipt_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO _labgd_publication_convergence_receipt_guard (valid)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM schema_migrations
  WHERE migration_id = '0035_labgd_publication_convergence'
    AND checksum = '911b3806a6d3d12c63acf59593692cbedb8cff54b36ec445adb6bf63d1bbc159'
    AND verification_status = 'verified'
    AND started_at_ms > 0
    AND completed_at_ms >= started_at_ms
) THEN 1 ELSE 0 END;

ALTER TABLE share_publication_operations
  ADD COLUMN predates_migration_0035 INTEGER NOT NULL DEFAULT 0
  CHECK (predates_migration_0035 IN (0, 1));

ALTER TABLE share_publication_operations
  ADD COLUMN revision_intent_provenance TEXT NOT NULL DEFAULT 'exact'
  CHECK (revision_intent_provenance IN ('exact','safe-backfill','reconciliation-required'));

UPDATE share_publication_operations
SET predates_migration_0035 = 1
WHERE created_at_ms <= (
  SELECT completed_at_ms
  FROM schema_migrations
  WHERE migration_id = '0035_labgd_publication_convergence'
);

UPDATE share_publication_operations
SET revision_intent_provenance = 'safe-backfill'
WHERE predates_migration_0035 = 1
  AND kind = 'publish'
  AND state = 'queued'
  AND attempt_count = 0
  AND remote_operation_id IS NULL
  AND remote_operation_state IS NULL
  AND remote_failure_code IS NULL
  AND remote_missing_hashes_json IS NULL
  AND activation_revision_id IS NULL
  AND last_error_code IS NULL
  AND updated_at_ms = created_at_ms;

UPDATE share_publication_operations
SET revision_intent_provenance = 'reconciliation-required',
    expected_remote_revision = NULL
WHERE predates_migration_0035 = 1
  AND kind = 'publish'
  AND state IN ('queued','running','retrying','failed')
  AND revision_intent_provenance <> 'safe-backfill';

CREATE INDEX share_publication_operations_runnable_index
  ON share_publication_operations (
    revision_intent_provenance,
    state,
    available_at_ms,
    id
  );

DROP TABLE _labgd_publication_convergence_receipt_guard;
