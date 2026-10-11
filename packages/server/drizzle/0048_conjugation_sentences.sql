-- v1.25.0: sentences with a blank. A "give the form" prompt can be shown as a sentence ("Mis primos ___ (vivir) en
-- Lima.") instead of a person label, on every rung. It is the same item, graded by cell as before: no new items, no
-- key changes, no progress reset. A cell with no sentence keeps the short label.
--  * deck_conjugation.sentences: 'off' (the default: every deck, and the public build, keeps the label until the
--    teacher turns sentences on), 'builtIn' (the engine's hand-written frames), 'approved' (rows below the teacher
--    approved) or 'both'. sentences_since: when the deck's sentences last went on (the results page marks it, since a
--    change of format shows up as a short dip in delayed accuracy). sentence_holdback: the holdback measurement, off by
--    default: per student, half the verbs (a fixed hash of student and verb) show sentences and half the label, and
--    the item's first answer 7 or more days after its first showing in the deck (the probe) is shown either way,
--    50/50. A form with no sentence is left out (no arm).
--  * conjugation_answers.sentence_ref: the sentence the prompt showed (its stable ref), null for a label;
--    holdback_arm: 'sentence' or 'label', the verb's half under the holdback (null without it, and for a form with no
--    sentence); holdback_probe: the answer was the probe (shown 50/50 within its half; its retry, retry = 1, keeps
--    the flag, so the probe itself is holdback_probe = 1 AND retry = 0).
--  * conjugation_sentences: a deck's own rows. A hidden built-in sentence is a row (source 'builtIn', status
--    'hidden', its ref); a sentence written by the teacher or, later, by AI is a row with its text, its cell, its
--    English and a status ('pending', 'approved', 'rejected'). Students only ever see approved rows, and every row is
--    checked again (validate) whenever it is used, so a settings change parks a row instead of showing it.
--  * conjugation_sentence_reports: a student's "Something's wrong with this sentence", once per student and
--    sentence; resolved_at once the teacher has dealt with it. Nothing changes for students until the teacher acts.
-- Rolling back to v1.24.x ignores all of it: those servers name none of the new columns when they insert, and the
-- labels come back.
ALTER TABLE `deck_conjugation` ADD `sentences` text DEFAULT 'off' NOT NULL;
--> statement-breakpoint
ALTER TABLE `deck_conjugation` ADD `sentence_holdback` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `deck_conjugation` ADD `sentences_since` integer;
--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `sentence_ref` text;
--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `holdback_arm` text;
--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `holdback_probe` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `conjugation_sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`ref` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`entry` text,
	`tense` text,
	`person` text,
	`number` text,
	`text` text,
	`english` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conjugation_sentences_deck_ref` ON `conjugation_sentences` (`deck_id`,`ref`);
--> statement-breakpoint
CREATE TABLE `conjugation_sentence_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`sentence_ref` text NOT NULL,
	`item_key` text NOT NULL,
	`sentence` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conjugation_sentence_reports_once` ON `conjugation_sentence_reports` (`deck_id`,`sentence_ref`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_conjugation_sentence_reports_user` ON `conjugation_sentence_reports` (`user_id`);
