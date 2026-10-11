CREATE TABLE `labs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`audio_url` text NOT NULL,
	`mime_type` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`required_through_ms` integer NOT NULL,
	`for_everyone` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_labs_active` ON `labs` (`active`);--> statement-breakpoint
CREATE TABLE `lab_groups` (
	`lab_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`lab_id`, `group_id`),
	FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lab_groups_group` ON `lab_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `lab_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lab_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`audio_url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`required_through_ms` integer NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`voiced_ms` integer DEFAULT 0 NOT NULL,
	`listened_covered_ms` integer DEFAULT 0 NOT NULL,
	`listen_wall_ms` integer DEFAULT 0 NOT NULL,
	`skip_count` integer DEFAULT 0 NOT NULL,
	`segments` text,
	`started_at` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lab_submissions_lab_user` ON `lab_submissions` (`lab_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_lab_submissions_user` ON `lab_submissions` (`user_id`,`submitted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lab_submissions_session` ON `lab_submissions` (`lab_id`,`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `lab_listen_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lab_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`session_started_at` integer NOT NULL,
	`kind` text NOT NULL,
	`position_ms` integer NOT NULL,
	`client_ms` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lab_listen_events_session` ON `lab_listen_events` (`lab_id`,`user_id`,`session_started_at`,`at`);
