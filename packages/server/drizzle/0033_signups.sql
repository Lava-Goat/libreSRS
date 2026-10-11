-- Sign-up sheets: class days students pick from (who presents on which day).
-- New tables only; nothing existing changes.
CREATE TABLE `signup_sheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`slots_per_date` integer DEFAULT 2 NOT NULL,
	`picks_per_student` integer DEFAULT 1 NOT NULL,
	`show_names` integer DEFAULT true NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`time_zone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`for_everyone` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_signup_sheets_active` ON `signup_sheets` (`active`);--> statement-breakpoint
CREATE TABLE `signup_sheet_groups` (
	`sheet_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`sheet_id`, `group_id`),
	FOREIGN KEY (`sheet_id`) REFERENCES `signup_sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signup_sheet_groups_group` ON `signup_sheet_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `signup_dates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sheet_id` integer NOT NULL,
	`date` text NOT NULL,
	`label` text,
	`capacity` integer,
	FOREIGN KEY (`sheet_id`) REFERENCES `signup_sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_signup_dates_sheet_date` ON `signup_dates` (`sheet_id`,`date`);--> statement-breakpoint
CREATE TABLE `signup_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sheet_id` integer NOT NULL,
	`date_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`assigned_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `signup_sheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`date_id`) REFERENCES `signup_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_signup_claims_date_user` ON `signup_claims` (`date_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_signup_claims_sheet_user` ON `signup_claims` (`sheet_id`,`user_id`);
