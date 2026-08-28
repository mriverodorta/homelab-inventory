ALTER TABLE sharing_settings ADD COLUMN last_connected_at_ms INTEGER;
ALTER TABLE sharing_settings ADD COLUMN last_disconnected_at_ms INTEGER;
ALTER TABLE sharing_settings ADD COLUMN last_renewed_at_ms INTEGER;
ALTER TABLE sharing_settings ADD COLUMN event_last_error_code TEXT;
ALTER TABLE sharing_settings ADD COLUMN reconnect_attempt INTEGER NOT NULL DEFAULT 0 CHECK (reconnect_attempt >= 0);
ALTER TABLE sharing_settings ADD COLUMN next_reconnect_at_ms INTEGER;

