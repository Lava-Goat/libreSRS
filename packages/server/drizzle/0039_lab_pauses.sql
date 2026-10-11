-- v1.15.0: a lab counts the answer pauses a student speaks in. Still nothing is recorded: the
-- page reports, per pause, how long its microphone heard a voice, riding on the listening log.
-- The server checks each report against its log and the rules the session began with (stored on
-- the session's 'open' row). Existing submissions keep their credit.
--  * labs: the pauses the teacher's browser found at upload (NULL: never scanned, so the lab keeps
--    the old rule; '[]': scanned, none found), the scan's numbers, and "don't count pauses after".
--  * lab_listen_events: the pause results a report carried, and the rules on 'open' rows (NULL on
--    every row written before v1.15.0). The (user_id, at) index finds a student's other sessions.
--  * lab_submissions: the result and what it was judged by. Every row turned in before v1.15.0
--    keeps its credit (set to 1 below). v1.15.0 always writes credit and flags (at least '[]'); a
--    row with flags NULL was written by older code, and services/labCredit.ts counts it as credited.
--  * lab_settings: the teacher's threshold, one row. Seeded at 0% (watch first): every lab counts
--    until the teacher sets a share in Admin -> Labs. With no row the code defaults apply (75%, 0.25 s).
-- Rolling back to v1.14 ignores all of it, and students who got no credit show as turned in again.
-- Labs turned in under v1.14 during a rollback get credit 0 (the default) and flags NULL; when
-- v1.15 is deployed again this file does not run again, and those rows still count (flags NULL).
ALTER TABLE `labs` ADD `pauses` text;--> statement-breakpoint
ALTER TABLE `labs` ADD `pause_scan` text;--> statement-breakpoint
ALTER TABLE `labs` ADD `pause_count_until_ms` integer;--> statement-breakpoint
ALTER TABLE `lab_listen_events` ADD `answers` text;--> statement-breakpoint
ALTER TABLE `lab_listen_events` ADD `rules` text;--> statement-breakpoint
CREATE INDEX `idx_lab_listen_events_user_at` ON `lab_listen_events` (`user_id`,`at`);--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `mic` text DEFAULT 'on' NOT NULL;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `pauses_counted` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `pauses_answered` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `pause_results` text;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `rejected_answers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `late_answers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `min_answered_pct` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `voice_per_pause_ms` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `outside_voiced_ms` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `outside_played_ms` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `flags` text;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `credit` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `lab_submissions` SET `credit` = true;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `credit_override` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `credit_override_at` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `credit_override_by` integer;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `check_requested_at` integer;--> statement-breakpoint
CREATE TABLE `lab_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`min_answered_pct` integer DEFAULT 75 NOT NULL,
	`voice_per_pause_ms` integer DEFAULT 250 NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `lab_settings` (`id`, `min_answered_pct`, `voice_per_pause_ms`, `updated_at`) VALUES (1, 0, 250, 1790141639399);
