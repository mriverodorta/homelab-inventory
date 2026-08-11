ALTER TABLE `registry_links` ADD `available_content_hash` text;
--> statement-breakpoint
ALTER TABLE `registry_links` ADD `product_family_json` text;
--> statement-breakpoint
ALTER TABLE `registry_links` ADD `variant_evidence_json` text;
--> statement-breakpoint
ALTER TABLE `registry_links` ADD `identity_aliases_json` text;
--> statement-breakpoint
ALTER TABLE `registry_links` ADD `detached_at_ms` integer;
