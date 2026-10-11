-- v1.19.0 exam labs: test audio as its own thing, and a teacher's Reset of the one play in the admin
-- page.
--  * labs.exam_set: NULL is a practice lab (every existing lab); a name ("U3") makes it a test form of that
--    exam set. Students get ONE start per set, across its forms.
--  * lab_submissions.exam_set: the set an exam session was turned in under (NULL: practice), so the
--    teacher's flags leave out "No microphone" and "Little speech" for tests.
--  * lab_exam_starts: one row each time a student was counted as starting a form of a set. The live row
--    (reset_at NULL) is unique per set and student: that is the one start. "Reset" stamps reset_at/reset_by,
--    which gives exactly one more start and keeps the row (and every listening row) as history. source
--    'past': counted from a play made before the lab joined the set. lab_id goes NULL when the lab is
--    deleted (lab_title keeps which form it was), and the start still counts.
-- Rolling back to v1.18.0 ignores all of it, and would play exam labs as practice labs (Back 10 s, Do it
-- again): hide (switch off) every exam lab before rolling back.
ALTER TABLE `labs` ADD `exam_set` text;--> statement-breakpoint
CREATE INDEX `idx_labs_exam_set` ON `labs` (`exam_set`);--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `exam_set` text;--> statement-breakpoint
CREATE TABLE `lab_exam_starts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_set` text NOT NULL,
	`user_id` integer NOT NULL,
	`lab_id` integer,
	`lab_title` text NOT NULL,
	`session_started_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`source` text DEFAULT 'start' NOT NULL,
	`reset_at` integer,
	`reset_by` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_lab_exam_starts_live` ON `lab_exam_starts` (`exam_set`,`user_id`) WHERE `reset_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_lab_exam_starts_user` ON `lab_exam_starts` (`user_id`,`exam_set`);--> statement-breakpoint
CREATE INDEX `idx_lab_exam_starts_lab` ON `lab_exam_starts` (`lab_id`,`user_id`,`session_started_at`);
