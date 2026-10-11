-- Conjugation quizzes: "[Deck name] conjugation", built from a deck's verbs.
-- New tables only; nothing existing changes.
CREATE TABLE `deck_conjugation` (
	`deck_id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`tenses` text DEFAULT '["present"]' NOT NULL,
	`include_vosotros` integer DEFAULT false NOT NULL,
	`vos` text DEFAULT 'none' NOT NULL,
	`directions` text DEFAULT 'both' NOT NULL,
	`answer_mode` text DEFAULT 'progressive' NOT NULL,
	`accent_mode` text DEFAULT 'progressive' NOT NULL,
	`round_length` integer DEFAULT 20 NOT NULL,
	`excluded_entries` text DEFAULT '[]' NOT NULL,
	`extra_entries` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conjugation_progress` (
	`user_id` integer NOT NULL,
	`deck_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`mastered` integer DEFAULT false NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`wrong` integer DEFAULT 0 NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `deck_id`, `item_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conjugation_progress_deck` ON `conjugation_progress` (`deck_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `conjugation_rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`deck_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`abandoned` integer DEFAULT false NOT NULL,
	`queue` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`prompts` integer NOT NULL,
	`first_try_correct` integer DEFAULT 0 NOT NULL,
	`answers` integer DEFAULT 0 NOT NULL,
	`settings_snapshot` text NOT NULL,
	`last_answer` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conjugation_rounds_deck_user` ON `conjugation_rounds` (`deck_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_conjugation_rounds_user` ON `conjugation_rounds` (`user_id`);--> statement-breakpoint
CREATE TABLE `conjugation_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`deck_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`level_kind` text NOT NULL,
	`given` text NOT NULL,
	`result` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `conjugation_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conjugation_answers_deck_item` ON `conjugation_answers` (`deck_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `idx_conjugation_answers_round` ON `conjugation_answers` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_conjugation_answers_user` ON `conjugation_answers` (`user_id`);