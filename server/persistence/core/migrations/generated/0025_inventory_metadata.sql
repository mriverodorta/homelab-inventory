CREATE TABLE `custom_field_definitions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `description` text,
  `field_type` text NOT NULL,
  `unit` text,
  `number_minimum` real,
  `number_maximum` real,
  `number_precision` integer,
  `display_order` integer NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `archived_at_ms` integer,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `custom_field_definitions_name_check` CHECK(length(trim(`name`)) BETWEEN 1 AND 80),
  CONSTRAINT `custom_field_definitions_normalized_name_check` CHECK(`normalized_name` = lower(trim(`normalized_name`)) AND length(`normalized_name`) BETWEEN 1 AND 80),
  CONSTRAINT `custom_field_definitions_description_check` CHECK(`description` IS NULL OR length(`description`) <= 500),
  CONSTRAINT `custom_field_definitions_type_check` CHECK(`field_type` IN ('shortText','longText','number','boolean','date','dateTime','singleSelect','multiSelect','url')),
  CONSTRAINT `custom_field_definitions_unit_check` CHECK(`unit` IS NULL OR length(trim(`unit`)) BETWEEN 1 AND 24),
  CONSTRAINT `custom_field_definitions_number_configuration_check` CHECK(
    (
      `field_type` = 'number'
      AND (`number_minimum` IS NULL OR typeof(`number_minimum`) IN ('integer','real'))
      AND (`number_maximum` IS NULL OR typeof(`number_maximum`) IN ('integer','real'))
      AND (`number_minimum` IS NULL OR `number_maximum` IS NULL OR `number_minimum` <= `number_maximum`)
      AND (`number_precision` IS NULL OR `number_precision` BETWEEN 0 AND 12)
    ) OR (
      `field_type` <> 'number'
      AND `number_minimum` IS NULL
      AND `number_maximum` IS NULL
      AND `number_precision` IS NULL
      AND `unit` IS NULL
    )
  ),
  CONSTRAINT `custom_field_definitions_order_check` CHECK(`display_order` >= 0),
  CONSTRAINT `custom_field_definitions_revision_check` CHECK(`revision` > 0)
) STRICT;
CREATE UNIQUE INDEX `custom_field_definitions_normalized_name_unique` ON `custom_field_definitions` (`normalized_name`);
CREATE INDEX `custom_field_definitions_archived_index` ON `custom_field_definitions` (`archived_at_ms`, `display_order`, `id`);

CREATE TABLE `custom_field_applicability` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `definition_id` integer NOT NULL REFERENCES `custom_field_definitions`(`id`) ON DELETE CASCADE,
  `item_type_id` integer NOT NULL REFERENCES `inventory_item_types`(`id`) ON DELETE RESTRICT,
  `created_at_ms` integer NOT NULL
) STRICT;
CREATE UNIQUE INDEX `custom_field_applicability_definition_type_unique` ON `custom_field_applicability` (`definition_id`, `item_type_id`);
CREATE INDEX `custom_field_applicability_type_index` ON `custom_field_applicability` (`item_type_id`, `definition_id`);

CREATE TABLE `custom_field_options` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `definition_id` integer NOT NULL REFERENCES `custom_field_definitions`(`id`) ON DELETE CASCADE,
  `label` text NOT NULL,
  `normalized_label` text NOT NULL,
  `color_token` text NOT NULL,
  `display_order` integer NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `archived_at_ms` integer,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `custom_field_options_label_check` CHECK(length(trim(`label`)) BETWEEN 1 AND 80),
  CONSTRAINT `custom_field_options_normalized_label_check` CHECK(`normalized_label` = lower(trim(`normalized_label`)) AND length(`normalized_label`) BETWEEN 1 AND 80),
  CONSTRAINT `custom_field_options_color_check` CHECK(`color_token` IN ('gray','red','orange','amber','yellow','green','teal','blue','indigo','purple','pink')),
  CONSTRAINT `custom_field_options_order_check` CHECK(`display_order` >= 0),
  CONSTRAINT `custom_field_options_revision_check` CHECK(`revision` > 0)
) STRICT;
CREATE UNIQUE INDEX `custom_field_options_definition_label_unique` ON `custom_field_options` (`definition_id`, `normalized_label`);
CREATE INDEX `custom_field_options_definition_archived_index` ON `custom_field_options` (`definition_id`, `archived_at_ms`, `display_order`, `id`);

CREATE TABLE `inventory_custom_field_values` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `definition_id` integer NOT NULL REFERENCES `custom_field_definitions`(`id`) ON DELETE CASCADE,
  `item_id` integer NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE CASCADE,
  `text_value` text,
  `number_value` real,
  `boolean_value` integer,
  `date_value` text,
  `date_time_value` text,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `inventory_custom_field_values_boolean_check` CHECK(`boolean_value` IS NULL OR `boolean_value` IN (0, 1)),
  CONSTRAINT `inventory_custom_field_values_revision_check` CHECK(`revision` > 0)
) STRICT;
CREATE UNIQUE INDEX `inventory_custom_field_values_definition_item_unique` ON `inventory_custom_field_values` (`definition_id`, `item_id`);
CREATE INDEX `inventory_custom_field_values_item_index` ON `inventory_custom_field_values` (`item_id`, `definition_id`);
CREATE INDEX `inventory_custom_field_values_text_index` ON `inventory_custom_field_values` (`definition_id`, `text_value`);
CREATE INDEX `inventory_custom_field_values_number_index` ON `inventory_custom_field_values` (`definition_id`, `number_value`);
CREATE INDEX `inventory_custom_field_values_date_index` ON `inventory_custom_field_values` (`definition_id`, `date_value`);
CREATE INDEX `inventory_custom_field_values_date_time_index` ON `inventory_custom_field_values` (`definition_id`, `date_time_value`);

CREATE TABLE `inventory_custom_field_option_values` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `value_id` integer NOT NULL REFERENCES `inventory_custom_field_values`(`id`) ON DELETE CASCADE,
  `option_id` integer NOT NULL REFERENCES `custom_field_options`(`id`) ON DELETE CASCADE,
  `created_at_ms` integer NOT NULL
) STRICT;
CREATE UNIQUE INDEX `inventory_custom_field_option_values_value_option_unique` ON `inventory_custom_field_option_values` (`value_id`, `option_id`);
CREATE INDEX `inventory_custom_field_option_values_option_index` ON `inventory_custom_field_option_values` (`option_id`, `value_id`);

CREATE TABLE `inventory_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `color_token` text NOT NULL,
  `display_order` integer NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `archived_at_ms` integer,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `inventory_tags_name_check` CHECK(length(trim(`name`)) BETWEEN 1 AND 80),
  CONSTRAINT `inventory_tags_normalized_name_check` CHECK(`normalized_name` = lower(trim(`normalized_name`)) AND length(`normalized_name`) BETWEEN 1 AND 80),
  CONSTRAINT `inventory_tags_color_check` CHECK(`color_token` IN ('gray','red','orange','amber','yellow','green','teal','blue','indigo','purple','pink')),
  CONSTRAINT `inventory_tags_order_check` CHECK(`display_order` >= 0),
  CONSTRAINT `inventory_tags_revision_check` CHECK(`revision` > 0)
) STRICT;
CREATE UNIQUE INDEX `inventory_tags_normalized_name_unique` ON `inventory_tags` (`normalized_name`);
CREATE INDEX `inventory_tags_archived_index` ON `inventory_tags` (`archived_at_ms`, `display_order`, `id`);

CREATE TABLE `inventory_item_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `item_id` integer NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE CASCADE,
  `tag_id` integer NOT NULL REFERENCES `inventory_tags`(`id`) ON DELETE CASCADE,
  `created_at_ms` integer NOT NULL
) STRICT;
CREATE UNIQUE INDEX `inventory_item_tags_item_tag_unique` ON `inventory_item_tags` (`item_id`, `tag_id`);
CREATE INDEX `inventory_item_tags_tag_index` ON `inventory_item_tags` (`tag_id`, `item_id`);

CREATE TRIGGER `custom_field_applicability_active_definition_insert_guard`
BEFORE INSERT ON `custom_field_applicability`
WHEN NOT EXISTS (
  SELECT 1 FROM `custom_field_definitions`
  WHERE `id` = NEW.`definition_id` AND `archived_at_ms` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'custom field definition is archived');
END;

CREATE TRIGGER `custom_field_options_definition_insert_guard`
BEFORE INSERT ON `custom_field_options`
WHEN NOT EXISTS (
  SELECT 1 FROM `custom_field_definitions`
  WHERE `id` = NEW.`definition_id`
    AND `archived_at_ms` IS NULL
    AND `field_type` IN ('singleSelect', 'multiSelect')
)
BEGIN
  SELECT RAISE(ABORT, 'custom field options require an active select definition');
END;

CREATE TRIGGER `custom_field_options_definition_update_guard`
BEFORE UPDATE OF `definition_id`, `archived_at_ms` ON `custom_field_options`
WHEN NEW.`archived_at_ms` IS NULL AND NOT EXISTS (
  SELECT 1 FROM `custom_field_definitions`
  WHERE `id` = NEW.`definition_id`
    AND `archived_at_ms` IS NULL
    AND `field_type` IN ('singleSelect', 'multiSelect')
)
BEGIN
  SELECT RAISE(ABORT, 'custom field options require an active select definition');
END;

CREATE TRIGGER `inventory_custom_field_values_insert_guard`
BEFORE INSERT ON `inventory_custom_field_values`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `custom_field_definitions` definition
    JOIN `inventory_items` item ON item.`id` = NEW.`item_id`
    JOIN `custom_field_applicability` applicability
      ON applicability.`definition_id` = definition.`id`
      AND applicability.`item_type_id` = item.`type_id`
    WHERE definition.`id` = NEW.`definition_id`
      AND definition.`archived_at_ms` IS NULL
  ) THEN RAISE(ABORT, 'custom field is not active or applicable to the item') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `custom_field_definitions` definition
    WHERE definition.`id` = NEW.`definition_id`
      AND (
        (definition.`field_type` IN ('shortText','longText','url')
          AND NEW.`text_value` IS NOT NULL
          AND NEW.`number_value` IS NULL
          AND NEW.`boolean_value` IS NULL
          AND NEW.`date_value` IS NULL
          AND NEW.`date_time_value` IS NULL)
        OR (definition.`field_type` = 'number'
          AND NEW.`text_value` IS NULL
          AND NEW.`number_value` IS NOT NULL
          AND NEW.`boolean_value` IS NULL
          AND NEW.`date_value` IS NULL
          AND NEW.`date_time_value` IS NULL
          AND (definition.`number_minimum` IS NULL OR NEW.`number_value` >= definition.`number_minimum`)
          AND (definition.`number_maximum` IS NULL OR NEW.`number_value` <= definition.`number_maximum`)
          AND (definition.`number_precision` IS NULL OR abs(NEW.`number_value` - round(NEW.`number_value`, definition.`number_precision`)) < 0.000000001))
        OR (definition.`field_type` = 'boolean'
          AND NEW.`text_value` IS NULL
          AND NEW.`number_value` IS NULL
          AND NEW.`boolean_value` IS NOT NULL
          AND NEW.`date_value` IS NULL
          AND NEW.`date_time_value` IS NULL)
        OR (definition.`field_type` = 'date'
          AND NEW.`text_value` IS NULL
          AND NEW.`number_value` IS NULL
          AND NEW.`boolean_value` IS NULL
          AND NEW.`date_value` IS NOT NULL
          AND NEW.`date_time_value` IS NULL)
        OR (definition.`field_type` = 'dateTime'
          AND NEW.`text_value` IS NULL
          AND NEW.`number_value` IS NULL
          AND NEW.`boolean_value` IS NULL
          AND NEW.`date_value` IS NULL
          AND NEW.`date_time_value` IS NOT NULL)
        OR (definition.`field_type` IN ('singleSelect','multiSelect')
          AND NEW.`text_value` IS NULL
          AND NEW.`number_value` IS NULL
          AND NEW.`boolean_value` IS NULL
          AND NEW.`date_value` IS NULL
          AND NEW.`date_time_value` IS NULL)
      )
  ) THEN RAISE(ABORT, 'custom field value does not match definition type') END;
END;

CREATE TRIGGER `inventory_custom_field_values_update_guard`
BEFORE UPDATE ON `inventory_custom_field_values`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `custom_field_definitions` definition
    JOIN `inventory_items` item ON item.`id` = NEW.`item_id`
    JOIN `custom_field_applicability` applicability
      ON applicability.`definition_id` = definition.`id`
      AND applicability.`item_type_id` = item.`type_id`
    WHERE definition.`id` = NEW.`definition_id`
      AND definition.`archived_at_ms` IS NULL
  ) THEN RAISE(ABORT, 'custom field is not active or applicable to the item') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `custom_field_definitions` definition
    WHERE definition.`id` = NEW.`definition_id`
      AND (
        (definition.`field_type` IN ('shortText','longText','url')
          AND NEW.`text_value` IS NOT NULL AND NEW.`number_value` IS NULL AND NEW.`boolean_value` IS NULL AND NEW.`date_value` IS NULL AND NEW.`date_time_value` IS NULL)
        OR (definition.`field_type` = 'number'
          AND NEW.`text_value` IS NULL AND NEW.`number_value` IS NOT NULL AND NEW.`boolean_value` IS NULL AND NEW.`date_value` IS NULL AND NEW.`date_time_value` IS NULL
          AND (definition.`number_minimum` IS NULL OR NEW.`number_value` >= definition.`number_minimum`)
          AND (definition.`number_maximum` IS NULL OR NEW.`number_value` <= definition.`number_maximum`)
          AND (definition.`number_precision` IS NULL OR abs(NEW.`number_value` - round(NEW.`number_value`, definition.`number_precision`)) < 0.000000001))
        OR (definition.`field_type` = 'boolean'
          AND NEW.`text_value` IS NULL AND NEW.`number_value` IS NULL AND NEW.`boolean_value` IS NOT NULL AND NEW.`date_value` IS NULL AND NEW.`date_time_value` IS NULL)
        OR (definition.`field_type` = 'date'
          AND NEW.`text_value` IS NULL AND NEW.`number_value` IS NULL AND NEW.`boolean_value` IS NULL AND NEW.`date_value` IS NOT NULL AND NEW.`date_time_value` IS NULL)
        OR (definition.`field_type` = 'dateTime'
          AND NEW.`text_value` IS NULL AND NEW.`number_value` IS NULL AND NEW.`boolean_value` IS NULL AND NEW.`date_value` IS NULL AND NEW.`date_time_value` IS NOT NULL)
        OR (definition.`field_type` IN ('singleSelect','multiSelect')
          AND NEW.`text_value` IS NULL AND NEW.`number_value` IS NULL AND NEW.`boolean_value` IS NULL AND NEW.`date_value` IS NULL AND NEW.`date_time_value` IS NULL)
      )
  ) THEN RAISE(ABORT, 'custom field value does not match definition type') END;
END;

CREATE TRIGGER `inventory_custom_field_option_values_insert_guard`
BEFORE INSERT ON `inventory_custom_field_option_values`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `inventory_custom_field_values` value
    JOIN `custom_field_definitions` definition ON definition.`id` = value.`definition_id`
    JOIN `custom_field_options` option
      ON option.`id` = NEW.`option_id`
      AND option.`definition_id` = value.`definition_id`
    WHERE value.`id` = NEW.`value_id`
      AND definition.`archived_at_ms` IS NULL
      AND definition.`field_type` IN ('singleSelect','multiSelect')
      AND option.`archived_at_ms` IS NULL
  ) THEN RAISE(ABORT, 'custom field option does not belong to the active value definition') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `inventory_custom_field_values` value
    JOIN `custom_field_definitions` definition ON definition.`id` = value.`definition_id`
    JOIN `inventory_custom_field_option_values` selected ON selected.`value_id` = value.`id`
    WHERE value.`id` = NEW.`value_id`
      AND definition.`field_type` = 'singleSelect'
  ) THEN RAISE(ABORT, 'single-select custom fields accept one option') END;
END;

CREATE TRIGGER `inventory_custom_field_option_values_update_guard`
BEFORE UPDATE ON `inventory_custom_field_option_values`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `inventory_custom_field_values` value
    JOIN `custom_field_definitions` definition ON definition.`id` = value.`definition_id`
    JOIN `custom_field_options` option
      ON option.`id` = NEW.`option_id`
      AND option.`definition_id` = value.`definition_id`
    WHERE value.`id` = NEW.`value_id`
      AND definition.`archived_at_ms` IS NULL
      AND definition.`field_type` IN ('singleSelect','multiSelect')
      AND option.`archived_at_ms` IS NULL
  ) THEN RAISE(ABORT, 'custom field option does not belong to the active value definition') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `inventory_custom_field_values` value
    JOIN `custom_field_definitions` definition ON definition.`id` = value.`definition_id`
    JOIN `inventory_custom_field_option_values` selected
      ON selected.`value_id` = value.`id` AND selected.`id` <> OLD.`id`
    WHERE value.`id` = NEW.`value_id`
      AND definition.`field_type` = 'singleSelect'
  ) THEN RAISE(ABORT, 'single-select custom fields accept one option') END;
END;

CREATE TRIGGER `inventory_item_tags_insert_guard`
BEFORE INSERT ON `inventory_item_tags`
WHEN NOT EXISTS (
  SELECT 1 FROM `inventory_tags`
  WHERE `id` = NEW.`tag_id` AND `archived_at_ms` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'inventory tag is archived');
END;

CREATE TRIGGER `inventory_item_tags_update_guard`
BEFORE UPDATE OF `tag_id` ON `inventory_item_tags`
WHEN NOT EXISTS (
  SELECT 1 FROM `inventory_tags`
  WHERE `id` = NEW.`tag_id` AND `archived_at_ms` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'inventory tag is archived');
END;
