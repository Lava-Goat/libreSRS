CREATE TABLE `vocab_audio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`accent` text DEFAULT '' NOT NULL,
	`url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_vocab_audio_word_accent` ON `vocab_audio` (`word`,`accent`);--> statement-breakpoint
CREATE INDEX `idx_vocab_audio_status` ON `vocab_audio` (`status`);