-- Labs are no longer recorded (speaking is recorded as its own task); the
-- microphone only measures speaking time. Dropping these columns keeps every
-- lab_submissions row, which is the listening evidence. Without audio_url
-- nothing points at the recordings v1.8.0 kept in data/lab-recordings, so the
-- server deletes that directory at startup (removeRetiredLabRecordings in
-- services/recordings.ts).
ALTER TABLE `lab_submissions` DROP COLUMN `audio_url`;--> statement-breakpoint
ALTER TABLE `lab_submissions` DROP COLUMN `mime_type`;--> statement-breakpoint
ALTER TABLE `lab_submissions` DROP COLUMN `size_bytes`;--> statement-breakpoint
ALTER TABLE `lab_submissions` DROP COLUMN `duration_ms`;--> statement-breakpoint
ALTER TABLE `lab_submissions` DROP COLUMN `segments`;--> statement-breakpoint
CREATE TABLE `speaking_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`instructions` text,
	`reference_text` text,
	`show_reference` integer DEFAULT true NOT NULL,
	`model_audio_url` text,
	`target_seconds` integer,
	`for_everyone` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_speaking_tasks_active` ON `speaking_tasks` (`active`);--> statement-breakpoint
CREATE TABLE `speaking_task_groups` (
	`task_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`task_id`, `group_id`),
	FOREIGN KEY (`task_id`) REFERENCES `speaking_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_speaking_task_groups_group` ON `speaking_task_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `speaking_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`client_key` text NOT NULL,
	`audio_url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`voiced_ms` integer DEFAULT 0 NOT NULL,
	`reference_text` text,
	`submitted_at` integer NOT NULL,
	`grade_score` real,
	`grade_details` text,
	`grade_feedback` text,
	`graded_by` text,
	`graded_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `speaking_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_speaking_submissions_task_user` ON `speaking_submissions` (`task_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_speaking_submissions_user` ON `speaking_submissions` (`user_id`,`submitted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_speaking_submissions_client_key` ON `speaking_submissions` (`user_id`,`client_key`);
