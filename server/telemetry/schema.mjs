export const TELEMETRY_SCHEMA_VERSION = 1

const HOST_TYPE_CHECK = "CHECK (host_type IN ('server', 'nas', 'pcBuild'))"

export const TELEMETRY_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    sql: `
      CREATE TABLE telemetry_samples (
        id INTEGER PRIMARY KEY,
        device_id INTEGER NOT NULL CHECK (device_id > 0),
        host_type TEXT NOT NULL ${HOST_TYPE_CHECK},
        host_id INTEGER NOT NULL CHECK (host_id > 0),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),
        collected_at_ms INTEGER NOT NULL CHECK (collected_at_ms >= 0),
        agent_version TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        UNIQUE (device_id, sequence)
      ) STRICT;

      CREATE INDEX telemetry_samples_host_time_index
        ON telemetry_samples(host_type, host_id, received_at_ms DESC);

      CREATE TABLE latest_host_state (
        host_type TEXT NOT NULL ${HOST_TYPE_CHECK},
        host_id INTEGER NOT NULL CHECK (host_id > 0),
        device_id INTEGER NOT NULL CHECK (device_id > 0),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),
        collected_at_ms INTEGER NOT NULL CHECK (collected_at_ms >= 0),
        agent_version TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        PRIMARY KEY (host_type, host_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE latest_component_state (
        host_type TEXT NOT NULL ${HOST_TYPE_CHECK},
        host_id INTEGER NOT NULL CHECK (host_id > 0),
        family TEXT NOT NULL CHECK (family IN ('service', 'container', 'storage-health')),
        entity_key TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
        state_json TEXT NOT NULL CHECK (json_valid(state_json)),
        PRIMARY KEY (host_type, host_id, family, entity_key)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX latest_component_state_host_family_index
        ON latest_component_state(host_type, host_id, family, observed_at_ms DESC);

      CREATE TABLE component_events (
        id INTEGER PRIMARY KEY,
        host_type TEXT NOT NULL ${HOST_TYPE_CHECK},
        host_id INTEGER NOT NULL CHECK (host_id > 0),
        family TEXT NOT NULL CHECK (family IN ('service', 'container', 'storage-health')),
        entity_key TEXT NOT NULL,
        event_kind TEXT NOT NULL CHECK (event_kind IN ('observed', 'changed', 'removed', 'checkpoint')),
        observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
        state_hash TEXT,
        state_json TEXT CHECK (state_json IS NULL OR json_valid(state_json))
      ) STRICT;

      CREATE INDEX component_events_host_time_index
        ON component_events(host_type, host_id, family, observed_at_ms DESC);
    `,
  }),
])

export function migrateTelemetrySchema(database) {
  const current = Number(database.query('PRAGMA user_version').get().user_version)
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error('Telemetry database schema version is invalid.')
  }
  if (current > TELEMETRY_SCHEMA_VERSION) {
    throw new Error(`Telemetry database schema ${current} is newer than this app supports (${TELEMETRY_SCHEMA_VERSION}).`)
  }

  for (const migration of TELEMETRY_MIGRATIONS) {
    if (migration.version <= current) continue
    database.transaction(() => {
      database.exec(migration.sql)
      database.exec(`PRAGMA user_version = ${migration.version}`)
    })()
  }
}
