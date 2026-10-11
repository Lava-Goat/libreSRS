ALTER TABLE `decks` ADD `source_language` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `target_language` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ai_enabled` integer NOT NULL DEFAULT 1;--> statement-breakpoint
CREATE TABLE `ai_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
	`asset_type` text NOT NULL,
	`provider` text NOT NULL,
	`prompt` text NOT NULL,
	`url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `ai_mnemonics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
	`user_id` integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	`provider` text NOT NULL,
	`text` text NOT NULL,
	`source_prompt` text NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `card_ai_state` (
	`card_id` integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
	`user_id` integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	`cognate_score` real,
	`mnemonic_enabled` integer DEFAULT 0 NOT NULL,
	`last_regression_at` integer,
	`last_generated_at` integer,
	PRIMARY KEY(`card_id`, `user_id`)
);--> statement-breakpoint
CREATE INDEX `idx_ai_assets_card` ON `ai_assets` (`card_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_assets_card_type` ON `ai_assets` (`card_id`,`asset_type`);--> statement-breakpoint
CREATE INDEX `idx_ai_mnemonics_card_user` ON `ai_mnemonics` (`card_id`,`user_id`);
