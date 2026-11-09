-- homelab:transactional-table-rebuild
CREATE TABLE __laptop_servers (
  id INTEGER PRIMARY KEY NOT NULL,
  hardware_class TEXT DEFAULT 'server' NOT NULL,
  usage_role TEXT DEFAULT 'server' NOT NULL,
  chassis_type_id INTEGER,
  form_factor_text TEXT,
  network_slot TEXT,
  wireless TEXT,
  FOREIGN KEY (id) REFERENCES inventory_items(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (chassis_type_id) REFERENCES chassis_types(id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT servers_hardware_class_check CHECK (hardware_class IN ('desktop', 'workstation', 'server', 'laptop')),
  CONSTRAINT servers_usage_role_check CHECK (usage_role IN ('server', 'desktop', 'workstation', 'other'))
) STRICT;

INSERT INTO __laptop_servers (id, hardware_class, usage_role, chassis_type_id, form_factor_text, network_slot, wireless)
SELECT id, hardware_class, usage_role, chassis_type_id, form_factor_text, network_slot, wireless FROM servers;
DROP TABLE servers;
ALTER TABLE __laptop_servers RENAME TO servers;
CREATE INDEX servers_chassis_type_index ON servers(chassis_type_id);
