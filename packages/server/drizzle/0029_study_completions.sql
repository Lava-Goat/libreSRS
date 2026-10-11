CREATE TABLE `study_completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`deck_id` integer,
	`virtual_deck_id` integer,
	`reason` text NOT NULL,
	`new_cards_done` integer DEFAULT 0 NOT NULL,
	`reviews_done` integer DEFAULT 0 NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`virtual_deck_id`) REFERENCES `virtual_decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_study_completions_user` ON `study_completions` (`user_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `idx_study_completions_deck` ON `study_completions` (`deck_id`,`completed_at`);
