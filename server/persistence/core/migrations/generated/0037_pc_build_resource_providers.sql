-- homelab:transactional-table-rebuild
-- Preserve existing assignments and sequence high-water mark; resources may be
-- provided by a motherboard assigned to the same PC in the same canvas.
CREATE TEMP TABLE __pc_assignment_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'component_assignments';
CREATE TABLE __pc_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL,
  host_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  component_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  resource_slot_id INTEGER REFERENCES host_resource_slots(id) ON DELETE RESTRICT,
  assigned_at_ms INTEGER NOT NULL,
  resource_provider_assignment_id INTEGER,
  FOREIGN KEY (project_id, workspace_id) REFERENCES workspaces(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, workspace_id, resource_provider_assignment_id)
    REFERENCES component_assignments(project_id, workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT component_assignments_distinct_items_check CHECK (host_item_id <> component_item_id),
  CONSTRAINT component_assignments_distinct_provider_check CHECK (resource_provider_assignment_id IS NULL OR resource_provider_assignment_id <> id)
) STRICT;
INSERT INTO __pc_assignments SELECT *, NULL FROM component_assignments;
DROP TABLE component_assignments;
ALTER TABLE __pc_assignments RENAME TO component_assignments;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM __pc_assignment_sequence), 0)) WHERE name = 'component_assignments';
DROP TABLE __pc_assignment_sequence;
CREATE UNIQUE INDEX component_assignments_project_component_unique ON component_assignments(project_id, workspace_id, component_item_id);
CREATE UNIQUE INDEX component_assignments_project_id_unique ON component_assignments(project_id, id);
CREATE UNIQUE INDEX component_assignments_workspace_id_unique ON component_assignments(project_id, workspace_id, id);
CREATE UNIQUE INDEX component_assignments_project_slot_unique ON component_assignments(project_id, workspace_id, resource_slot_id) WHERE resource_slot_id IS NOT NULL;
CREATE INDEX component_assignments_host_index ON component_assignments(project_id, workspace_id, host_item_id);
CREATE INDEX component_assignments_provider_index ON component_assignments(resource_provider_assignment_id);

CREATE VIEW assignment_resource_ownership AS
SELECT a.id AS assignment_id, a.project_id, a.workspace_id, a.host_item_id,
       COALESCE(provider.component_item_id, a.host_item_id) AS resource_owner_item_id
FROM component_assignments a
LEFT JOIN component_assignments provider ON provider.id = a.resource_provider_assignment_id
WHERE a.resource_provider_assignment_id IS NULL OR (
  provider.project_id = a.project_id AND provider.workspace_id = a.workspace_id
  AND provider.host_item_id = a.host_item_id
  AND EXISTS (SELECT 1 FROM pc_builds WHERE id = a.host_item_id)
  AND EXISTS (SELECT 1 FROM motherboards WHERE id = provider.component_item_id)
);

CREATE TRIGGER component_assignments_resource_owner_insert AFTER INSERT ON component_assignments
WHEN NEW.resource_slot_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assignment_resource_ownership owner JOIN host_resource_slots slot ON slot.host_item_id = owner.resource_owner_item_id
    WHERE owner.assignment_id = NEW.id AND slot.id = NEW.resource_slot_id
  ) THEN RAISE(ABORT, 'Assignment resource owner does not match its host or assigned motherboard.') END;
END;
CREATE TRIGGER component_assignments_resource_owner_update AFTER UPDATE ON component_assignments
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM component_assignments a WHERE (a.id = NEW.id OR a.resource_provider_assignment_id = NEW.id)
    AND a.resource_slot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM assignment_resource_ownership owner JOIN host_resource_slots slot ON slot.host_item_id = owner.resource_owner_item_id
      WHERE owner.assignment_id = a.id AND slot.id = a.resource_slot_id
    )
  ) THEN RAISE(ABORT, 'Assignment resource owner does not match its host or assigned motherboard.') END;
END;
CREATE TRIGGER component_assignment_slots_owner_insert BEFORE INSERT ON component_assignment_slots
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assignment_resource_ownership owner
    WHERE owner.assignment_id = NEW.assignment_id AND owner.project_id = NEW.project_id
      AND owner.workspace_id = NEW.workspace_id AND owner.resource_owner_item_id = NEW.host_item_id
  ) THEN RAISE(ABORT, 'Assignment slot resource owner is invalid.') END;
END;
CREATE TRIGGER component_assignment_slots_owner_update BEFORE UPDATE ON component_assignment_slots
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assignment_resource_ownership owner
    WHERE owner.assignment_id = NEW.assignment_id AND owner.project_id = NEW.project_id
      AND owner.workspace_id = NEW.workspace_id AND owner.resource_owner_item_id = NEW.host_item_id
  ) THEN RAISE(ABORT, 'Assignment slot resource owner is invalid.') END;
END;

-- Add only missing logical resources. Existing IDs, topology and slots are untouched.
CREATE TEMP TABLE __pc_resource_candidates AS
SELECT id AS item_id, 'motherboard' AS resource_type, 'motherboard' AS semantic_key, 1 AS slot_count FROM pc_builds
UNION ALL SELECT id, 'case', 'case', 1 FROM pc_builds
UNION ALL SELECT id, 'power', 'power', 1 FROM pc_builds
UNION ALL SELECT g.host_item_id, 'cooling', 'cpu-cooling', g.slot_count
  FROM host_resource_groups g JOIN motherboards board ON board.id = g.host_item_id WHERE g.resource_type = 'cpu';
CREATE TEMP TABLE __pc_new_resources AS
SELECT COALESCE((SELECT MAX(id) FROM inventory_resources), 0) + ROW_NUMBER() OVER (ORDER BY c.item_id, c.semantic_key) AS id, c.*
FROM __pc_resource_candidates c WHERE NOT EXISTS (
  SELECT 1 FROM host_resource_groups g WHERE g.host_item_id = c.item_id AND g.semantic_key = c.semantic_key
);
INSERT INTO inventory_resources (id, item_id, created_at_ms)
SELECT r.id, r.item_id, i.created_at_ms FROM __pc_new_resources r JOIN inventory_items i ON i.id = r.item_id;
INSERT INTO resource_identity_aliases (resource_id, legacy_item_type_key, legacy_item_id, legacy_resource_key, legacy_resource_group_id, created_at_ms)
SELECT r.id, a.legacy_type_key, a.legacy_id, r.semantic_key, NULL, i.created_at_ms
FROM __pc_new_resources r JOIN inventory_identity_aliases a ON a.item_id = r.item_id JOIN inventory_items i ON i.id = r.item_id;
INSERT INTO host_resource_groups (id, resource_identity_id, host_item_id, resource_type, semantic_key, label, slot_count, created_at_ms)
SELECT r.id, r.id, r.item_id, r.resource_type, r.semantic_key, r.semantic_key, r.slot_count, i.created_at_ms
FROM __pc_new_resources r JOIN inventory_items i ON i.id = r.item_id;
WITH RECURSIVE positions(resource_id, item_id, semantic_key, position, slot_count) AS (
  SELECT id, item_id, semantic_key, 1, slot_count FROM __pc_new_resources
  UNION ALL SELECT resource_id, item_id, semantic_key, position + 1, slot_count FROM positions WHERE position < slot_count
)
INSERT INTO host_resource_slots (resource_group_id, host_item_id, position, label, single_capacity, created_at_ms)
SELECT p.resource_id, p.item_id, p.position, p.semantic_key || ' ' || p.position, 1, i.created_at_ms
FROM positions p JOIN inventory_items i ON i.id = p.item_id;
DROP TABLE __pc_new_resources;
-- Keep this assertion last: Bun's multi-statement exec must surface the error
-- instead of masking it with a subsequent successful statement. TEMP tables
-- disappear when the migration connection closes and contain no user payloads.
CREATE TEMP TABLE __pc_resource_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO __pc_resource_guard SELECT CASE WHEN EXISTS (
  SELECT 1 FROM __pc_resource_candidates c LEFT JOIN host_resource_groups g
    ON g.host_item_id = c.item_id AND g.semantic_key = c.semantic_key
  WHERE g.id IS NULL OR g.resource_type <> c.resource_type OR g.slot_count <> c.slot_count
    OR (SELECT count(*) FROM host_resource_slots s WHERE s.resource_group_id = g.id) <> c.slot_count
) THEN 0 ELSE 1 END;
