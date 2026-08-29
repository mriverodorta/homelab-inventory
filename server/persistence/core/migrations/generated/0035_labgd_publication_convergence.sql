ALTER TABLE share_publication_operations
  ADD COLUMN expected_remote_revision INTEGER
  CHECK (expected_remote_revision IS NULL OR expected_remote_revision >= 0);

ALTER TABLE share_publication_operations
  ADD COLUMN remote_operation_state TEXT
  CHECK (remote_operation_state IS NULL OR remote_operation_state IN ('staged','ready','active','failed'));

ALTER TABLE share_publication_operations
  ADD COLUMN remote_failure_code TEXT;

ALTER TABLE share_publication_operations
  ADD COLUMN remote_missing_hashes_json TEXT
  CHECK (remote_missing_hashes_json IS NULL OR (
    json_valid(remote_missing_hashes_json)
    AND json_type(remote_missing_hashes_json) = 'array'
  ));

ALTER TABLE share_publication_operations
  ADD COLUMN activation_revision_id INTEGER
  CHECK (activation_revision_id IS NULL OR activation_revision_id > 0);

UPDATE share_publication_operations
SET expected_remote_revision = COALESCE(
  (SELECT shares.remote_revision FROM shares WHERE shares.id = share_publication_operations.share_id),
  0
)
WHERE kind = 'publish'
  AND state IN ('queued','running','retrying','failed');
