-- homelab:statement-breakpoints
DROP INDEX host_resource_groups_host_key_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX host_resource_groups_host_type_key_unique ON host_resource_groups (host_item_id, resource_type, semantic_key);
--> statement-breakpoint
-- Only adapter aliases change. Numeric resources, slots and their relationships stay intact.
CREATE TEMP TABLE laptop_resource_aliases_v13 AS
SELECT a.id, '@v13:' || g.resource_type || ':' || g.semantic_key AS scoped_key
FROM resource_identity_aliases a
JOIN host_resource_groups g ON g.resource_identity_id = a.resource_id
JOIN servers s ON s.id = g.host_item_id
WHERE s.hardware_class = 'laptop'
  AND g.resource_type IN ('storage', 'expansion', 'optionalModule', 'controllerSlot', 'bootDeviceSlot', 'coolingProfile');
--> statement-breakpoint
-- Reinsert the same alias rows atomically to avoid transient old/new key collisions.
DROP TRIGGER resource_identity_aliases_immutable_delete;
--> statement-breakpoint
CREATE TEMP TABLE laptop_resource_alias_rows_v13 AS
SELECT a.* FROM resource_identity_aliases a JOIN laptop_resource_aliases_v13 m ON m.id = a.id;
--> statement-breakpoint
DELETE FROM resource_identity_aliases WHERE id IN (SELECT id FROM laptop_resource_aliases_v13);
--> statement-breakpoint
INSERT INTO resource_identity_aliases (id, resource_id, legacy_item_type_key, legacy_item_id, legacy_resource_key, legacy_resource_group_id, created_at_ms)
SELECT a.id, a.resource_id, a.legacy_item_type_key, a.legacy_item_id, m.scoped_key, a.legacy_resource_group_id, a.created_at_ms
FROM laptop_resource_alias_rows_v13 a JOIN laptop_resource_aliases_v13 m ON m.id = a.id;
--> statement-breakpoint
DROP TABLE laptop_resource_alias_rows_v13;
--> statement-breakpoint
DROP TABLE laptop_resource_aliases_v13;
--> statement-breakpoint
CREATE TRIGGER resource_identity_aliases_immutable_delete
BEFORE DELETE ON resource_identity_aliases
WHEN EXISTS (
  SELECT 1 FROM host_resource_slots s JOIN component_assignment_slots a ON a.resource_slot_id = s.id
  WHERE s.resource_group_id = OLD.resource_id
) OR EXISTS (
  SELECT 1 FROM host_resource_slots s JOIN component_assignments a ON a.resource_slot_id = s.id
  WHERE s.resource_group_id = OLD.resource_id
)
BEGIN
  SELECT RAISE(ABORT, 'Assigned resource identity aliases are immutable.');
END;
--> statement-breakpoint
ALTER TABLE compatibility_constraint_groups ADD COLUMN catalog_resource_id INTEGER CHECK (catalog_resource_id IS NULL OR (catalog_resource_id > 0 AND catalog_resource_id <= 9007199254740991));
--> statement-breakpoint
CREATE UNIQUE INDEX compatibility_constraint_groups_catalog_id_unique ON compatibility_constraint_groups (host_profile_id, catalog_resource_id);
--> statement-breakpoint
ALTER TABLE item_port_details ADD COLUMN derived_from_host_power INTEGER NOT NULL DEFAULT 0 CHECK (derived_from_host_power IN (0, 1));
