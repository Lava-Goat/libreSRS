-- v1.18.0 "Study all". One new column, one new table and its
-- index; no data changes.
--  * conjugation_rounds.scope: 'deck' (a deck's quiz, as before) or 'all' ("Study all": forms of
--    every quiz the student may play; deck_id is then the newest of those decks, the round's lead,
--    kept for the cascade; deleting the lead deck first hands the round to its next deck, so the
--    older decks' answers stay: admin.deleteDeck). Existing rounds read 'deck'.
--  * flashcard_all_done: the school days on which a student had nothing due in any assigned deck
--    after rating at least one card that day (first moment only), for the teacher's
--    Flashcards-by-day grid.
-- Rolling back to v1.17.0 ignores all of it: the old server reads the old columns (unchanged).
ALTER TABLE `conjugation_rounds` ADD `scope` text DEFAULT 'deck' NOT NULL;--> statement-breakpoint
CREATE TABLE `flashcard_all_done` (
	`user_id` integer NOT NULL,
	`day` text NOT NULL,
	`completed_at` integer NOT NULL,
	`deck_ids` text NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flashcard_all_done_day` ON `flashcard_all_done` (`day`);
