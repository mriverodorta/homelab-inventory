-- homelab:transactional-table-rebuild

CREATE TEMP TABLE __workspace_primary (
  project_id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL
) STRICT;

INSERT INTO __workspace_primary (project_id, workspace_id)
SELECT project.id, COALESCE(
  (
    SELECT workspace.id
    FROM project_preferences AS preference
    JOIN workspaces AS workspace ON workspace.id = preference.default_workspace_id
    WHERE preference.project_id = project.id AND workspace.type = 'canvas'
  ),
  (
    SELECT workspace.id
    FROM workspaces AS workspace
    WHERE workspace.project_id = project.id AND workspace.type = 'canvas'
    ORDER BY workspace.archived_at_ms IS NOT NULL, workspace.sort_order, workspace.id
    LIMIT 1
  )
)
FROM projects AS project;

CREATE TEMP TABLE __previous_component_assignments AS SELECT * FROM component_assignments;
CREATE TEMP TABLE __previous_component_assignment_slots AS SELECT * FROM component_assignment_slots;
CREATE TEMP TABLE __previous_project_connections AS SELECT * FROM project_connections;
CREATE TEMP TABLE __previous_connection_endpoints AS SELECT * FROM connection_endpoints;
CREATE TEMP TABLE __previous_workspace_connection_visibility AS SELECT * FROM workspace_connection_visibility;
CREATE TEMP TABLE __previous_workspace_manual_bend_points AS SELECT * FROM workspace_manual_bend_points;
CREATE TEMP TABLE __previous_workspace_route_cache AS SELECT * FROM workspace_route_cache;
CREATE TEMP TABLE __previous_compatibility_audits AS SELECT * FROM compatibility_audits;
CREATE TEMP TABLE __previous_compatibility_audit_findings AS SELECT * FROM compatibility_audit_findings;
CREATE TEMP TABLE __previous_compatibility_audit_dirty_hosts AS SELECT * FROM compatibility_audit_dirty_hosts;
CREATE TEMP TABLE __previous_system_attention_summaries AS SELECT * FROM system_attention_summaries;
CREATE TEMP TABLE __previous_system_attention_dirty_hosts AS SELECT * FROM system_attention_dirty_hosts;

DROP TABLE component_assignment_slots;
DROP TABLE connection_endpoints;
DROP TABLE workspace_connection_visibility;
DROP TABLE workspace_manual_bend_points;
DROP TABLE workspace_route_cache;
DROP TABLE compatibility_audits;
DROP TABLE compatibility_audit_findings;
DROP TABLE compatibility_audit_dirty_hosts;
DROP TABLE system_attention_summaries;
DROP TABLE system_attention_dirty_hosts;
DROP TABLE component_assignments;
DROP TABLE project_connections;

CREATE TABLE component_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  host_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  component_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  resource_slot_id INTEGER,
  assigned_at_ms INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (host_item_id, resource_slot_id)
    REFERENCES host_resource_slots(host_item_id, id) ON DELETE RESTRICT,
  CONSTRAINT component_assignments_distinct_items_check CHECK (host_item_id <> component_item_id)
) STRICT;

CREATE TABLE component_assignment_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  assignment_id INTEGER NOT NULL,
  host_item_id INTEGER NOT NULL,
  resource_slot_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id, assignment_id)
    REFERENCES component_assignments(project_id, workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (host_item_id, resource_slot_id)
    REFERENCES host_resource_slots(host_item_id, id) ON DELETE RESTRICT,
  CONSTRAINT component_assignment_slots_position_check CHECK (position >= 0)
) STRICT;

CREATE TABLE project_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  connection_type TEXT NOT NULL,
  negotiated_speed_bps INTEGER,
  label TEXT,
  source_side TEXT NOT NULL,
  target_side TEXT NOT NULL,
  avoid_cable_overlap INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  CONSTRAINT project_connections_type_check
    CHECK (connection_type IN ('network', 'display', 'power', 'other')),
  CONSTRAINT project_connections_speed_check
    CHECK (negotiated_speed_bps IS NULL OR negotiated_speed_bps >= 0),
  CONSTRAINT project_connections_source_side_check
    CHECK (source_side IN ('left', 'right', 'top', 'bottom')),
  CONSTRAINT project_connections_target_side_check
    CHECK (target_side IN ('left', 'right', 'top', 'bottom')),
  CONSTRAINT project_connections_overlap_check CHECK (avoid_cable_overlap IN (0, 1))
) STRICT;

CREATE TABLE connection_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES project_connections(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  port_id INTEGER NOT NULL REFERENCES inventory_ports(id) ON DELETE RESTRICT,
  endpoint_face_id INTEGER,
  FOREIGN KEY (port_id, endpoint_face_id)
    REFERENCES port_endpoint_faces(port_id, id) ON DELETE RESTRICT,
  CONSTRAINT connection_endpoints_role_check CHECK (role IN ('source', 'target'))
) STRICT;

CREATE TABLE workspace_connection_visibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  connection_id INTEGER NOT NULL,
  visible INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, workspace_id, connection_id)
    REFERENCES project_connections(project_id, workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT workspace_connection_visibility_visible_check CHECK (visible IN (0, 1))
) STRICT;

CREATE TABLE workspace_manual_bend_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  connection_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, workspace_id, connection_id)
    REFERENCES project_connections(project_id, workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT workspace_manual_bend_points_position_check CHECK (position >= 0)
) STRICT;

CREATE TABLE workspace_route_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  connection_id INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  layout_fingerprint TEXT NOT NULL,
  route_fingerprint TEXT NOT NULL,
  route_payload_json TEXT NOT NULL,
  calculated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, workspace_id, connection_id)
    REFERENCES project_connections(project_id, workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT workspace_route_cache_payload_check CHECK (json_valid(route_payload_json))
) STRICT;

CREATE TABLE compatibility_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  input_revision INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  CONSTRAINT compatibility_audits_state_check CHECK (state IN ('running', 'completed', 'failed')),
  CONSTRAINT compatibility_audits_revision_check CHECK (input_revision > 0)
) STRICT;

CREATE TABLE compatibility_audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  host_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  component_item_id INTEGER REFERENCES inventory_items(id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES component_assignments(id) ON DELETE CASCADE,
  resource_slot_id INTEGER REFERENCES host_resource_slots(id) ON DELETE SET NULL,
  finding_key TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'actionable',
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  resolved_at_ms INTEGER,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  CONSTRAINT compatibility_audit_findings_severity_check CHECK (severity IN ('info', 'warning', 'error')),
  CONSTRAINT compatibility_audit_findings_classification_check
    CHECK (classification IN ('actionable', 'informational')),
  CONSTRAINT compatibility_audit_findings_details_json_check CHECK (json_valid(details_json))
) STRICT;

CREATE TABLE compatibility_audit_dirty_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  host_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  enqueued_at_ms INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  CONSTRAINT compatibility_audit_dirty_hosts_reason_check CHECK (length(trim(reason)) > 0)
) STRICT;

CREATE TABLE system_attention_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  host_type TEXT NOT NULL,
  host_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  registry_count INTEGER NOT NULL DEFAULT 0,
  audit_count INTEGER NOT NULL DEFAULT 0,
  notification_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  input_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  evaluated_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  CONSTRAINT system_attention_summaries_host_type_check CHECK (host_type IN ('server', 'nas', 'pcBuild')),
  CONSTRAINT system_attention_summaries_counts_check CHECK (
    registry_count >= 0 AND audit_count >= 0 AND notification_count >= 0
    AND total_count = registry_count + audit_count + notification_count
  ),
  CONSTRAINT system_attention_summaries_fingerprint_check CHECK (length(input_fingerprint) = 64),
  CONSTRAINT system_attention_summaries_state_check CHECK (state IN ('current', 'refreshing', 'failed')),
  CONSTRAINT system_attention_summaries_revision_check CHECK (revision > 0)
) STRICT;

CREATE TABLE system_attention_dirty_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  host_type TEXT NOT NULL,
  host_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  CONSTRAINT system_attention_dirty_hosts_host_type_check CHECK (host_type IN ('server', 'nas', 'pcBuild'))
) STRICT;

CREATE TEMP TABLE __assignment_workspace_map (
  previous_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  next_id INTEGER NOT NULL,
  PRIMARY KEY (previous_id, workspace_id)
) STRICT;

INSERT INTO __assignment_workspace_map (previous_id, project_id, workspace_id, next_id)
SELECT assignment.id, assignment.project_id, primary_workspace.workspace_id, assignment.id
FROM __previous_component_assignments AS assignment
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = assignment.project_id;

INSERT INTO __assignment_workspace_map (previous_id, project_id, workspace_id, next_id)
SELECT assignment.id, assignment.project_id, placement.workspace_id,
  COALESCE((SELECT MAX(id) FROM __previous_component_assignments), 0)
    + ROW_NUMBER() OVER (ORDER BY assignment.id, placement.workspace_id)
FROM __previous_component_assignments AS assignment
JOIN workspace_placements AS placement
  ON placement.project_id = assignment.project_id AND placement.item_id = assignment.host_item_id
JOIN workspaces AS workspace
  ON workspace.id = placement.workspace_id AND workspace.type = 'canvas'
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = assignment.project_id
WHERE placement.workspace_id <> primary_workspace.workspace_id;

INSERT INTO component_assignments (
  id, project_id, workspace_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms
)
SELECT map.next_id, assignment.project_id, map.workspace_id, assignment.host_item_id,
  assignment.component_item_id, assignment.resource_slot_id, assignment.assigned_at_ms
FROM __previous_component_assignments AS assignment
JOIN __assignment_workspace_map AS map ON map.previous_id = assignment.id
ORDER BY map.next_id;

INSERT INTO component_assignment_slots (
  id, project_id, workspace_id, assignment_id, host_item_id, resource_slot_id, position
)
SELECT CASE WHEN map.next_id = slot.assignment_id THEN slot.id ELSE NULL END,
  slot.project_id, map.workspace_id, map.next_id, slot.host_item_id, slot.resource_slot_id, slot.position
FROM __previous_component_assignment_slots AS slot
JOIN __assignment_workspace_map AS map ON map.previous_id = slot.assignment_id
ORDER BY map.next_id = slot.assignment_id DESC, slot.id, map.workspace_id;

CREATE TEMP TABLE __connection_workspace_candidates (
  previous_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  PRIMARY KEY (previous_id, workspace_id)
) STRICT;

INSERT INTO __connection_workspace_candidates (previous_id, project_id, workspace_id)
SELECT connection.id, connection.project_id, primary_workspace.workspace_id
FROM __previous_project_connections AS connection
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = connection.project_id;

INSERT OR IGNORE INTO __connection_workspace_candidates (previous_id, project_id, workspace_id)
SELECT connection.id, connection.project_id, workspace.id
FROM __previous_project_connections AS connection
JOIN workspaces AS workspace ON workspace.project_id = connection.project_id AND workspace.type = 'canvas'
WHERE NOT EXISTS (
  SELECT 1
  FROM __previous_connection_endpoints AS endpoint
  JOIN inventory_ports AS port ON port.id = endpoint.port_id
  WHERE endpoint.connection_id = connection.id
    AND NOT EXISTS (
      SELECT 1
      FROM workspace_placements AS placement
      WHERE placement.project_id = connection.project_id
        AND placement.workspace_id = workspace.id
        AND placement.item_id = COALESCE(
          (
            SELECT assignment.host_item_id
            FROM __previous_component_assignments AS assignment
            WHERE assignment.project_id = connection.project_id
              AND assignment.component_item_id = port.item_id
          ),
          port.item_id
        )
    )
);

INSERT OR IGNORE INTO __connection_workspace_candidates (previous_id, project_id, workspace_id)
SELECT connection_id, project_id, workspace_id FROM __previous_workspace_connection_visibility
UNION SELECT connection_id, project_id, workspace_id FROM __previous_workspace_manual_bend_points
UNION SELECT connection_id, project_id, workspace_id FROM __previous_workspace_route_cache;

CREATE TEMP TABLE __connection_workspace_map (
  previous_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  next_id INTEGER NOT NULL,
  PRIMARY KEY (previous_id, workspace_id)
) STRICT;

INSERT INTO __connection_workspace_map (previous_id, project_id, workspace_id, next_id)
SELECT candidate.previous_id, candidate.project_id, candidate.workspace_id, candidate.previous_id
FROM __connection_workspace_candidates AS candidate
JOIN __workspace_primary AS primary_workspace
  ON primary_workspace.project_id = candidate.project_id
  AND primary_workspace.workspace_id = candidate.workspace_id;

INSERT INTO __connection_workspace_map (previous_id, project_id, workspace_id, next_id)
SELECT candidate.previous_id, candidate.project_id, candidate.workspace_id,
  COALESCE((SELECT MAX(id) FROM __previous_project_connections), 0)
    + ROW_NUMBER() OVER (ORDER BY candidate.previous_id, candidate.workspace_id)
FROM __connection_workspace_candidates AS candidate
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = candidate.project_id
WHERE candidate.workspace_id <> primary_workspace.workspace_id;

INSERT INTO project_connections (
  id, project_id, workspace_id, connection_type, negotiated_speed_bps, label,
  source_side, target_side, avoid_cable_overlap, created_at_ms, updated_at_ms
)
SELECT map.next_id, connection.project_id, map.workspace_id, connection.connection_type,
  connection.negotiated_speed_bps, connection.label, connection.source_side,
  connection.target_side, connection.avoid_cable_overlap,
  connection.created_at_ms, connection.updated_at_ms
FROM __previous_project_connections AS connection
JOIN __connection_workspace_map AS map ON map.previous_id = connection.id
ORDER BY map.next_id;

INSERT INTO connection_endpoints (id, workspace_id, connection_id, role, port_id, endpoint_face_id)
SELECT CASE WHEN map.next_id = endpoint.connection_id THEN endpoint.id ELSE NULL END,
  map.workspace_id, map.next_id, endpoint.role, endpoint.port_id, endpoint.endpoint_face_id
FROM __previous_connection_endpoints AS endpoint
JOIN __connection_workspace_map AS map ON map.previous_id = endpoint.connection_id
ORDER BY map.next_id = endpoint.connection_id DESC, endpoint.id, map.workspace_id;

INSERT INTO workspace_connection_visibility (
  id, project_id, workspace_id, connection_id, visible, updated_at_ms
)
SELECT visibility.id, visibility.project_id, visibility.workspace_id, map.next_id,
  visibility.visible, visibility.updated_at_ms
FROM __previous_workspace_connection_visibility AS visibility
JOIN __connection_workspace_map AS map
  ON map.previous_id = visibility.connection_id AND map.workspace_id = visibility.workspace_id;

INSERT INTO workspace_manual_bend_points (id, project_id, workspace_id, connection_id, position, x, y)
SELECT bend.id, bend.project_id, bend.workspace_id, map.next_id, bend.position, bend.x, bend.y
FROM __previous_workspace_manual_bend_points AS bend
JOIN __connection_workspace_map AS map
  ON map.previous_id = bend.connection_id AND map.workspace_id = bend.workspace_id;

INSERT INTO workspace_route_cache (
  id, project_id, workspace_id, connection_id, engine_version, layout_fingerprint,
  route_fingerprint, route_payload_json, calculated_at_ms
)
SELECT route.id, route.project_id, route.workspace_id, map.next_id, route.engine_version,
  route.layout_fingerprint, route.route_fingerprint, route.route_payload_json, route.calculated_at_ms
FROM __previous_workspace_route_cache AS route
JOIN __connection_workspace_map AS map
  ON map.previous_id = route.connection_id AND map.workspace_id = route.workspace_id;

INSERT INTO compatibility_audits (
  id, project_id, workspace_id, state, input_revision, engine_version, started_at_ms, completed_at_ms
)
SELECT audit.id, audit.project_id, primary_workspace.workspace_id, audit.state,
  audit.input_revision, audit.engine_version, audit.started_at_ms, audit.completed_at_ms
FROM __previous_compatibility_audits AS audit
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = audit.project_id;

INSERT INTO compatibility_audit_findings (
  id, project_id, workspace_id, host_item_id, component_item_id, assignment_id,
  resource_slot_id, finding_key, rule_key, severity, classification, message,
  details_json, first_seen_at_ms, last_seen_at_ms, resolved_at_ms
)
SELECT finding.id, finding.project_id, primary_workspace.workspace_id,
  finding.host_item_id, finding.component_item_id, finding.assignment_id,
  finding.resource_slot_id, finding.finding_key, finding.rule_key,
  finding.severity, finding.classification, finding.message, finding.details_json,
  finding.first_seen_at_ms, finding.last_seen_at_ms, finding.resolved_at_ms
FROM __previous_compatibility_audit_findings AS finding
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = finding.project_id;

INSERT INTO compatibility_audit_dirty_hosts (
  id, project_id, workspace_id, host_item_id, reason, enqueued_at_ms
)
SELECT dirty.id, dirty.project_id, primary_workspace.workspace_id,
  dirty.host_item_id, dirty.reason, dirty.enqueued_at_ms
FROM __previous_compatibility_audit_dirty_hosts AS dirty
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = dirty.project_id;

INSERT INTO compatibility_audit_dirty_hosts (
  project_id, workspace_id, host_item_id, reason, enqueued_at_ms
)
SELECT DISTINCT finding.project_id, finding.workspace_id, finding.host_item_id,
  'workspace-topology-migration', CAST(unixepoch('now') AS INTEGER) * 1000
FROM compatibility_audit_findings AS finding
WHERE finding.resolved_at_ms IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM compatibility_audit_dirty_hosts AS dirty
    WHERE dirty.project_id = finding.project_id
      AND dirty.workspace_id = finding.workspace_id
      AND dirty.host_item_id = finding.host_item_id
  );

INSERT INTO compatibility_audit_dirty_hosts (
  project_id, workspace_id, host_item_id, reason, enqueued_at_ms
)
SELECT DISTINCT assignment.project_id, assignment.workspace_id, assignment.host_item_id,
  'workspace-topology-migration', CAST(unixepoch('now') AS INTEGER) * 1000
FROM component_assignments AS assignment
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = assignment.project_id
WHERE assignment.workspace_id <> primary_workspace.workspace_id;

INSERT INTO system_attention_summaries (
  id, project_id, workspace_id, host_type, host_id, registry_count, audit_count,
  notification_count, total_count, input_fingerprint, state, revision,
  evaluated_at_ms, updated_at_ms
)
SELECT summary.id, summary.project_id, primary_workspace.workspace_id, summary.host_type,
  summary.host_id, summary.registry_count, summary.audit_count, summary.notification_count,
  summary.total_count, summary.input_fingerprint, summary.state, summary.revision,
  summary.evaluated_at_ms, summary.updated_at_ms
FROM __previous_system_attention_summaries AS summary
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = summary.project_id;

INSERT INTO system_attention_dirty_hosts (
  id, project_id, workspace_id, host_type, host_id, reason, created_at_ms
)
SELECT dirty.id, dirty.project_id, primary_workspace.workspace_id, dirty.host_type,
  dirty.host_id, dirty.reason, dirty.created_at_ms
FROM __previous_system_attention_dirty_hosts AS dirty
JOIN __workspace_primary AS primary_workspace ON primary_workspace.project_id = dirty.project_id;

UPDATE inventory_items
SET scope = 'project',
  owner_project_id = (
    SELECT membership.project_id
    FROM project_inventory_memberships AS membership
    WHERE membership.item_id = inventory_items.id
  )
WHERE scope = 'global'
  AND (SELECT COUNT(*) FROM project_inventory_memberships WHERE item_id = inventory_items.id) = 1;

DROP TABLE __previous_component_assignment_slots;
DROP TABLE __previous_connection_endpoints;
DROP TABLE __previous_workspace_connection_visibility;
DROP TABLE __previous_workspace_manual_bend_points;
DROP TABLE __previous_workspace_route_cache;
DROP TABLE __previous_compatibility_audits;
DROP TABLE __previous_compatibility_audit_findings;
DROP TABLE __previous_compatibility_audit_dirty_hosts;
DROP TABLE __previous_system_attention_summaries;
DROP TABLE __previous_system_attention_dirty_hosts;
DROP TABLE __previous_component_assignments;
DROP TABLE __previous_project_connections;

CREATE UNIQUE INDEX component_assignments_project_component_unique
  ON component_assignments(project_id, workspace_id, component_item_id);
CREATE UNIQUE INDEX component_assignments_project_id_unique ON component_assignments(project_id, id);
CREATE UNIQUE INDEX component_assignments_workspace_id_unique
  ON component_assignments(project_id, workspace_id, id);
CREATE UNIQUE INDEX component_assignments_project_slot_unique
  ON component_assignments(project_id, workspace_id, resource_slot_id)
  WHERE resource_slot_id IS NOT NULL;
CREATE INDEX component_assignments_host_index
  ON component_assignments(project_id, workspace_id, host_item_id);

CREATE UNIQUE INDEX component_assignment_slots_assignment_position_unique
  ON component_assignment_slots(assignment_id, position);
CREATE UNIQUE INDEX component_assignment_slots_assignment_slot_unique
  ON component_assignment_slots(assignment_id, resource_slot_id);
CREATE UNIQUE INDEX component_assignment_slots_project_slot_unique
  ON component_assignment_slots(project_id, workspace_id, resource_slot_id);

CREATE UNIQUE INDEX project_connections_project_id_unique ON project_connections(project_id, id);
CREATE UNIQUE INDEX project_connections_workspace_id_unique
  ON project_connections(project_id, workspace_id, id);
CREATE INDEX project_connections_project_type_index
  ON project_connections(project_id, workspace_id, connection_type);

CREATE UNIQUE INDEX connection_endpoints_connection_role_unique
  ON connection_endpoints(connection_id, role);
CREATE UNIQUE INDEX connection_endpoints_port_face_unique
  ON connection_endpoints(workspace_id, port_id, coalesce(endpoint_face_id, 0));
CREATE INDEX connection_endpoints_connection_index ON connection_endpoints(connection_id);

CREATE UNIQUE INDEX workspace_connection_visibility_unique
  ON workspace_connection_visibility(workspace_id, connection_id);
CREATE UNIQUE INDEX workspace_manual_bend_points_position_unique
  ON workspace_manual_bend_points(workspace_id, connection_id, position);
CREATE UNIQUE INDEX workspace_route_cache_workspace_connection_unique
  ON workspace_route_cache(workspace_id, connection_id);
CREATE INDEX workspace_route_cache_layout_index ON workspace_route_cache(workspace_id, layout_fingerprint);

CREATE INDEX compatibility_audits_project_index
  ON compatibility_audits(project_id, workspace_id, started_at_ms);
CREATE UNIQUE INDEX compatibility_audit_findings_project_key_unique
  ON compatibility_audit_findings(project_id, workspace_id, finding_key);
CREATE INDEX compatibility_audit_findings_host_index
  ON compatibility_audit_findings(project_id, workspace_id, host_item_id, resolved_at_ms);
CREATE INDEX compatibility_audit_findings_assignment_index
  ON compatibility_audit_findings(assignment_id, resolved_at_ms);
CREATE UNIQUE INDEX compatibility_audit_dirty_hosts_unique
  ON compatibility_audit_dirty_hosts(project_id, workspace_id, host_item_id);
CREATE INDEX compatibility_audit_dirty_hosts_queue_index
  ON compatibility_audit_dirty_hosts(enqueued_at_ms, id);

CREATE UNIQUE INDEX system_attention_summaries_host_unique
  ON system_attention_summaries(project_id, workspace_id, host_type, host_id);
CREATE INDEX system_attention_summaries_project_index
  ON system_attention_summaries(project_id, workspace_id, total_count, state);
CREATE UNIQUE INDEX system_attention_dirty_hosts_host_unique
  ON system_attention_dirty_hosts(project_id, workspace_id, host_type, host_id);
CREATE INDEX system_attention_dirty_hosts_created_index ON system_attention_dirty_hosts(created_at_ms, id);

ALTER TABLE systems_saved_views
  ADD COLUMN canvas_workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX systems_saved_views_canvas_workspace_index
  ON systems_saved_views(project_id, canvas_workspace_id);

CREATE TRIGGER connection_endpoints_kind_guard
BEFORE INSERT ON connection_endpoints
WHEN (SELECT kind_id FROM item_port_details WHERE port_id = NEW.port_id) IS NULL
  OR NOT (
    (SELECT connection_type FROM project_connections WHERE id = NEW.connection_id) = 'other'
    OR (
      (SELECT connection_type FROM project_connections WHERE id = NEW.connection_id) = 'network'
      AND (SELECT kind_id FROM item_port_details WHERE port_id = NEW.port_id) IN (1, 6)
    )
    OR (
      (SELECT connection_type FROM project_connections WHERE id = NEW.connection_id) = 'display'
      AND (SELECT kind_id FROM item_port_details WHERE port_id = NEW.port_id) = 4
    )
    OR (
      (SELECT connection_type FROM project_connections WHERE id = NEW.connection_id) = 'power'
      AND (SELECT kind_id FROM item_port_details WHERE port_id = NEW.port_id) IN (2, 3)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Connection type is incompatible with the selected port.');
END;

CREATE TRIGGER connection_endpoints_workspace_guard
BEFORE INSERT ON connection_endpoints
WHEN (SELECT workspace_id FROM project_connections WHERE id = NEW.connection_id) <> NEW.workspace_id
BEGIN
  SELECT RAISE(ABORT, 'Connection endpoint must belong to the connection workspace.');
END;

CREATE TRIGGER connection_endpoints_power_direction_guard
BEFORE INSERT ON connection_endpoints
WHEN (SELECT connection_type FROM project_connections WHERE id = NEW.connection_id) = 'power'
  AND EXISTS (SELECT 1 FROM connection_endpoints WHERE connection_id = NEW.connection_id)
  AND (
    SELECT kind_id FROM item_port_details WHERE port_id = (
      SELECT port_id FROM connection_endpoints WHERE connection_id = NEW.connection_id LIMIT 1
    )
  ) = (SELECT kind_id FROM item_port_details WHERE port_id = NEW.port_id)
BEGIN
  SELECT RAISE(ABORT, 'Power connections require one input and one output port.');
END;

DROP TABLE __connection_workspace_map;
DROP TABLE __connection_workspace_candidates;
DROP TABLE __assignment_workspace_map;
DROP TABLE __workspace_primary;
