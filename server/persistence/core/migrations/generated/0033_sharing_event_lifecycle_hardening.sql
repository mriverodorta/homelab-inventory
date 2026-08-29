CREATE TABLE sharing_event_lifecycle (
  id INTEGER PRIMARY KEY NOT NULL,
  pending_claim_id TEXT,
  pending_claim_expires_at_ms INTEGER,
  account_last_reconciled_at_ms INTEGER,
  stream_open_count INTEGER NOT NULL DEFAULT 0,
  reconnect_count INTEGER NOT NULL DEFAULT 0,
  credential_refresh_count INTEGER NOT NULL DEFAULT 0,
  dormant_transition_count INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT sharing_event_lifecycle_singleton_check CHECK (id = 1),
  CONSTRAINT sharing_event_lifecycle_claim_check CHECK (
    (pending_claim_id IS NULL AND pending_claim_expires_at_ms IS NULL)
    OR (
      pending_claim_id IS NOT NULL
      AND length(pending_claim_id) BETWEEN 1 AND 128
      AND pending_claim_expires_at_ms > 0
    )
  ),
  CONSTRAINT sharing_event_lifecycle_reconciled_check CHECK (
    account_last_reconciled_at_ms IS NULL OR account_last_reconciled_at_ms > 0
  ),
  CONSTRAINT sharing_event_lifecycle_counter_check CHECK (
    stream_open_count >= 0
    AND reconnect_count >= 0
    AND credential_refresh_count >= 0
    AND dormant_transition_count >= 0
  )
) STRICT;

INSERT INTO sharing_event_lifecycle (
  id,
  created_at_ms,
  updated_at_ms
) VALUES (
  1,
  CAST(unixepoch('subsec') * 1000 AS integer),
  CAST(unixepoch('subsec') * 1000 AS integer)
);
