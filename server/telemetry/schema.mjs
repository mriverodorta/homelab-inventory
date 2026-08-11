export const TELEMETRY_SCHEMA_VERSION = 2

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
  Object.freeze({
    version: 2,
    sql: `
      ALTER TABLE telemetry_samples
        ADD COLUMN agent_id INTEGER CHECK (agent_id IS NULL OR agent_id > 0);
      ALTER TABLE telemetry_samples
        ADD COLUMN host_item_id INTEGER CHECK (host_item_id IS NULL OR host_item_id > 0);
      CREATE INDEX telemetry_samples_canonical_host_time_index
        ON telemetry_samples(host_item_id, received_at_ms DESC);

      ALTER TABLE latest_host_state
        ADD COLUMN agent_id INTEGER CHECK (agent_id IS NULL OR agent_id > 0);
      ALTER TABLE latest_host_state
        ADD COLUMN host_item_id INTEGER CHECK (host_item_id IS NULL OR host_item_id > 0);
      CREATE UNIQUE INDEX latest_host_state_canonical_host_unique
        ON latest_host_state(host_item_id) WHERE host_item_id IS NOT NULL;

      ALTER TABLE latest_component_state
        ADD COLUMN host_item_id INTEGER CHECK (host_item_id IS NULL OR host_item_id > 0);
      CREATE INDEX latest_component_state_canonical_host_index
        ON latest_component_state(host_item_id, family, observed_at_ms DESC);

      ALTER TABLE component_events
        ADD COLUMN host_item_id INTEGER CHECK (host_item_id IS NULL OR host_item_id > 0);
      CREATE INDEX component_events_canonical_host_time_index
        ON component_events(host_item_id, family, observed_at_ms DESC);

      CREATE TABLE host_metric_samples (
        sample_id INTEGER PRIMARY KEY REFERENCES telemetry_samples(id) ON DELETE CASCADE,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        uptime_seconds INTEGER CHECK (uptime_seconds IS NULL OR uptime_seconds >= 0),
        cpu_percent REAL CHECK (cpu_percent IS NULL OR (cpu_percent >= 0 AND cpu_percent <= 100)),
        memory_used_bytes INTEGER CHECK (memory_used_bytes IS NULL OR memory_used_bytes >= 0),
        memory_total_bytes INTEGER CHECK (memory_total_bytes IS NULL OR memory_total_bytes >= 0),
        load_1 REAL,
        load_5 REAL,
        load_15 REAL
      ) STRICT;
      CREATE INDEX host_metric_samples_host_index
        ON host_metric_samples(host_item_id, sample_id DESC);

      CREATE TABLE network_interface_samples (
        id INTEGER PRIMARY KEY,
        sample_id INTEGER NOT NULL REFERENCES telemetry_samples(id) ON DELETE CASCADE,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        interface_key TEXT NOT NULL,
        metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
        UNIQUE (sample_id, interface_key)
      ) STRICT;
      CREATE INDEX network_interface_samples_host_index
        ON network_interface_samples(host_item_id, sample_id DESC);

      CREATE TABLE storage_device_samples (
        id INTEGER PRIMARY KEY,
        sample_id INTEGER NOT NULL REFERENCES telemetry_samples(id) ON DELETE CASCADE,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        device_key TEXT NOT NULL,
        metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
        UNIQUE (sample_id, device_key)
      ) STRICT;
      CREATE INDEX storage_device_samples_host_index
        ON storage_device_samples(host_item_id, sample_id DESC);

      CREATE TABLE filesystem_samples (
        id INTEGER PRIMARY KEY,
        sample_id INTEGER NOT NULL REFERENCES telemetry_samples(id) ON DELETE CASCADE,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        mount_key TEXT NOT NULL,
        device_key TEXT,
        filesystem_type TEXT,
        total_bytes INTEGER CHECK (total_bytes IS NULL OR total_bytes >= 0),
        used_bytes INTEGER CHECK (used_bytes IS NULL OR used_bytes >= 0),
        available_bytes INTEGER CHECK (available_bytes IS NULL OR available_bytes >= 0),
        details_json TEXT NOT NULL CHECK (json_valid(details_json)),
        UNIQUE (sample_id, mount_key)
      ) STRICT;
      CREATE INDEX filesystem_samples_host_index
        ON filesystem_samples(host_item_id, sample_id DESC);

      CREATE TABLE latest_virtualization_state (
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        entity_key TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
        state_json TEXT NOT NULL CHECK (json_valid(state_json)),
        PRIMARY KEY (host_item_id, entity_key)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE virtualization_events (
        id INTEGER PRIMARY KEY,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        entity_key TEXT NOT NULL,
        event_kind TEXT NOT NULL CHECK (event_kind IN ('observed', 'changed', 'removed', 'checkpoint')),
        observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
        state_hash TEXT,
        state_json TEXT CHECK (state_json IS NULL OR json_valid(state_json))
      ) STRICT;
      CREATE INDEX virtualization_events_host_index
        ON virtualization_events(host_item_id, observed_at_ms DESC);

      CREATE TABLE manual_inventory_reports (
        id INTEGER PRIMARY KEY,
        agent_id INTEGER NOT NULL CHECK (agent_id > 0),
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        collected_at_ms INTEGER NOT NULL CHECK (collected_at_ms >= 0),
        received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        complete INTEGER NOT NULL DEFAULT 1 CHECK (complete IN (0, 1)),
        UNIQUE (agent_id, sequence)
      ) STRICT;
      CREATE INDEX manual_inventory_reports_host_index
        ON manual_inventory_reports(host_item_id, received_at_ms DESC);

      CREATE TABLE manual_inventory_components (
        id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES manual_inventory_reports(id) ON DELETE CASCADE,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        kind TEXT NOT NULL,
        locator TEXT NOT NULL,
        values_json TEXT NOT NULL CHECK (json_valid(values_json)),
        UNIQUE (report_id, kind, locator)
      ) STRICT;
      CREATE INDEX manual_inventory_components_host_index
        ON manual_inventory_components(host_item_id, kind);

      CREATE TABLE agent_field_suggestions (
        id INTEGER PRIMARY KEY,
        host_item_id INTEGER NOT NULL CHECK (host_item_id > 0),
        report_id INTEGER NOT NULL REFERENCES manual_inventory_reports(id) ON DELETE CASCADE,
        component_id INTEGER REFERENCES manual_inventory_components(id) ON DELETE CASCADE,
        target_item_id INTEGER CHECK (target_item_id IS NULL OR target_item_id > 0),
        field_path TEXT NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        state TEXT NOT NULL DEFAULT 'available' CHECK (state IN ('available', 'applied', 'dismissed', 'superseded')),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
      ) STRICT;
      CREATE INDEX agent_field_suggestions_host_state_index
        ON agent_field_suggestions(host_item_id, state, field_path);

      CREATE TRIGGER retain_five_complete_manual_inventory_reports
      AFTER INSERT ON manual_inventory_reports
      WHEN NEW.complete = 1
      BEGIN
        DELETE FROM manual_inventory_reports
        WHERE id IN (
          SELECT id
          FROM manual_inventory_reports
          WHERE host_item_id = NEW.host_item_id AND complete = 1
          ORDER BY received_at_ms DESC, id DESC
          LIMIT -1 OFFSET 5
        );
      END;
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
