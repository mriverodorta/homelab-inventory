ALTER TABLE sharing_installation_projection
ADD COLUMN account_binding_revision integer NOT NULL DEFAULT 0
CHECK(account_binding_revision >= 0);

UPDATE sharing_installation_projection
SET account_binding_revision = 1
WHERE account_claimed = 1 AND account_binding_revision = 0;

CREATE TABLE sharing_account_operations (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  client_attempt_id text NOT NULL,
  remote_idempotency_key text NOT NULL,
  share_disposition text NOT NULL,
  expected_account_binding_revision integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  result_json text,
  last_error_code text,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at_ms integer NOT NULL,
  updated_at_ms integer NOT NULL,
  CONSTRAINT sharing_account_operations_client_attempt_unique UNIQUE(client_attempt_id),
  CONSTRAINT sharing_account_operations_remote_key_unique UNIQUE(remote_idempotency_key),
  CONSTRAINT sharing_account_operations_disposition_check CHECK(share_disposition IN ('keep','unpublish','delete')),
  CONSTRAINT sharing_account_operations_revision_check CHECK(expected_account_binding_revision >= 0),
  CONSTRAINT sharing_account_operations_state_check CHECK(state IN ('pending','retrying','succeeded','failed')),
  CONSTRAINT sharing_account_operations_result_check CHECK(result_json IS NULL OR json_valid(result_json))
) STRICT;

CREATE INDEX sharing_account_operations_state_index
ON sharing_account_operations(state, updated_at_ms, id);
