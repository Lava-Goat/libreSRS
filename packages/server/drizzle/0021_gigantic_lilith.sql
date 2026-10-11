CREATE TABLE `vocab_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`mode` text NOT NULL,
	`seed` integer NOT NULL,
	`blk` text,
	`form` text,
	`occasion` text,
	`summary_json` text NOT NULL,
	`responses_json` text,
	`started_at` integer,
	`completed_at` integer NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`test_id`) REFERENCES `vocab_tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vocab_results_test_user` ON `vocab_results` (`test_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_vocab_results_user_completed` ON `vocab_results` (`user_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `vocab_test_groups` (
	`test_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`test_id`, `group_id`),
	FOREIGN KEY (`test_id`) REFERENCES `vocab_tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vocab_test_groups_group` ON `vocab_test_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `vocab_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`occasion` text,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`is_open` integer DEFAULT false NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
