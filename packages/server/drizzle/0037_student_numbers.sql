-- Student IDs set by hand: a student whose sign-in email carries no ID, or the wrong one, gets
-- the number the school uses (sign-in and the admin lists read it before the email's).
-- New table only; nothing existing changes.
CREATE TABLE `student_number_overrides` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`student_number` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_student_number_overrides_number` ON `student_number_overrides` (`student_number`);
