ALTER TABLE `systems_saved_view_columns` RENAME TO `systems_saved_view_columns_legacy`;

CREATE TABLE `systems_saved_view_columns` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `saved_view_id` integer NOT NULL REFERENCES `systems_saved_views`(`id`) ON DELETE CASCADE,
  `column_key` text NOT NULL,
  `definition_id` integer REFERENCES `custom_field_definitions`(`id`) ON DELETE CASCADE,
  `visible` integer NOT NULL,
  `display_order` integer NOT NULL,
  CONSTRAINT `systems_saved_view_columns_key_check` CHECK (
    (`definition_id` IS NULL AND `column_key` IN (
      'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
      'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp', 'tags'
    )) OR
    (`definition_id` IS NOT NULL AND `column_key` = 'custom-field:' || `definition_id`)
  ),
  CONSTRAINT `systems_saved_view_columns_visible_check` CHECK (`visible` IN (0, 1)),
  CONSTRAINT `systems_saved_view_columns_order_check` CHECK (`display_order` >= 0)
) STRICT;

INSERT INTO `systems_saved_view_columns` (
  `id`, `saved_view_id`, `column_key`, `definition_id`, `visible`, `display_order`
)
SELECT `id`, `saved_view_id`, `column_key`, NULL, `visible`, `display_order`
FROM `systems_saved_view_columns_legacy`;

DROP TABLE `systems_saved_view_columns_legacy`;

CREATE UNIQUE INDEX `systems_saved_view_columns_key_unique`
  ON `systems_saved_view_columns` (`saved_view_id`, `column_key`);
CREATE UNIQUE INDEX `systems_saved_view_columns_order_unique`
  ON `systems_saved_view_columns` (`saved_view_id`, `display_order`);
CREATE INDEX `systems_saved_view_columns_definition_index`
  ON `systems_saved_view_columns` (`definition_id`, `saved_view_id`);

CREATE TABLE `systems_saved_view_metadata_filters` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `saved_view_id` integer NOT NULL REFERENCES `systems_saved_views`(`id`) ON DELETE CASCADE,
  `definition_id` integer REFERENCES `custom_field_definitions`(`id`) ON DELETE CASCADE,
  `operator` text NOT NULL,
  `text_value` text,
  `number_minimum` real,
  `number_maximum` real,
  `date_after` text,
  `date_before` text,
  CONSTRAINT `systems_saved_view_metadata_filters_operator_check` CHECK (`operator` IN (
    'contains', 'set', 'unset', 'range', 'date-range', 'yes', 'no', 'options',
    'tags-any', 'has-tags', 'no-tags'
  )),
  CONSTRAINT `systems_saved_view_metadata_filters_target_check` CHECK (
    (`operator` IN ('tags-any','has-tags','no-tags') AND `definition_id` IS NULL) OR
    (`operator` NOT IN ('tags-any','has-tags','no-tags') AND `definition_id` IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX `systems_saved_view_metadata_filters_definition_unique`
  ON `systems_saved_view_metadata_filters` (`saved_view_id`, `definition_id`)
  WHERE `definition_id` IS NOT NULL;
CREATE UNIQUE INDEX `systems_saved_view_metadata_filters_tag_mode_unique`
  ON `systems_saved_view_metadata_filters` (`saved_view_id`)
  WHERE `definition_id` IS NULL;
CREATE INDEX `systems_saved_view_metadata_filters_view_index`
  ON `systems_saved_view_metadata_filters` (`saved_view_id`, `id`);
CREATE INDEX `systems_saved_view_metadata_filters_definition_index`
  ON `systems_saved_view_metadata_filters` (`definition_id`, `saved_view_id`);

CREATE TABLE `systems_saved_view_metadata_filter_options` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `filter_id` integer NOT NULL REFERENCES `systems_saved_view_metadata_filters`(`id`) ON DELETE CASCADE,
  `option_id` integer NOT NULL REFERENCES `custom_field_options`(`id`) ON DELETE CASCADE
) STRICT;
CREATE UNIQUE INDEX `systems_saved_view_metadata_filter_options_unique`
  ON `systems_saved_view_metadata_filter_options` (`filter_id`, `option_id`);
CREATE INDEX `systems_saved_view_metadata_filter_options_option_index`
  ON `systems_saved_view_metadata_filter_options` (`option_id`, `filter_id`);

CREATE TABLE `systems_saved_view_metadata_filter_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `filter_id` integer NOT NULL REFERENCES `systems_saved_view_metadata_filters`(`id`) ON DELETE CASCADE,
  `tag_id` integer NOT NULL REFERENCES `inventory_tags`(`id`) ON DELETE CASCADE
) STRICT;
CREATE UNIQUE INDEX `systems_saved_view_metadata_filter_tags_unique`
  ON `systems_saved_view_metadata_filter_tags` (`filter_id`, `tag_id`);
CREATE INDEX `systems_saved_view_metadata_filter_tags_tag_index`
  ON `systems_saved_view_metadata_filter_tags` (`tag_id`, `filter_id`);
