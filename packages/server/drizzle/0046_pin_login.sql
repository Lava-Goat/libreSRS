-- v1.22.0: students can sign in with a 4-digit PIN when Google refuses their accounts (a school's Workspace
-- policy can answer every student "Access blocked - Error 400: admin_policy_enforced" while staff get through).
--  * user_pins: one PIN per account, stored only as a salted scrypt hash (hex) and its salt (hex). Plaintext PINs exist
--    only in the response of the admin procedure that made them. failed_count counts wrong PINs since the last
--    success or lock; five in a row lock PIN sign-in for that account until locked_until (15 minutes, doubling with
--    lock_level, at most 24 hours). Times are milliseconds. Deleting a user deletes the PIN.
--  * app_settings.pin_login_mode: 'auto' (the default: the login page offers PIN sign-in only while Google sign-in
--    looks blocked for students), 'on' (always) or 'off' (never; PIN sign-ins are refused). Checked by the server.
-- No index beyond the primary key: user_id is the key and the only lookup.
-- Rolling back to v1.21.x ignores both: PIN sign-in disappears, and the PINs and the mode wait in
-- the database for the next upgrade.
CREATE TABLE `user_pins` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`lock_level` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `pin_login_mode` text DEFAULT 'auto' NOT NULL;
