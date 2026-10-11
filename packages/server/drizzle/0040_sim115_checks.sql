-- v1.16.0: checks from the v1.15 "tricks" simulation. Only new columns and one index; no data
-- changes. The pause rule and its floor stay as the teacher saved them.
--  * lab_submissions: why a row waits for the teacher ("Check it") although it passed the rule
--    (held_for, a JSON list: 'odd-answers', 'overlap', 'noisy'; NULL is not held), and what the
--    page's new voice meter measured (mic_stats, JSON LabMicStats; information, never evidence).
--  * lab_settings: the voice meter's room margin in dB (6, the measured knee; the teacher may set
--    4-12 under Advanced), and whether "Voice outside the pauses" also holds a lab (off: a flag
--    only). Row 1, seeded by 0039, gets both defaults.
--  * speaking_submissions: the SHA-256 of a take's audio payload (finds re-posted copies of a take,
--    a classmate's take or the model), what the page claimed for its length and voice (the
--    duration_ms and voiced_ms columns now hold the server's reading), the flags decided at upload,
--    and the mic processing the page reported. Takes recorded before v1.16.0 keep NULL in all five.
-- Rolling back to v1.15.3 ignores all of it: a held lab reads as "Needs redo" there (credit 0), so
-- give those credit by hand, and the speaking flags are not shown.
-- Finishes held by the pace rule change no schema: v1.15.3 shows them without a reason, and the
-- teacher can still settle them by hand.
ALTER TABLE `lab_submissions` ADD `held_for` text;--> statement-breakpoint
ALTER TABLE `lab_submissions` ADD `mic_stats` text;--> statement-breakpoint
ALTER TABLE `lab_settings` ADD `gate_margin_db` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `lab_settings` ADD `hold_outside_voice` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `speaking_submissions` ADD `content_sha256` text;--> statement-breakpoint
ALTER TABLE `speaking_submissions` ADD `client_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `speaking_submissions` ADD `client_voiced_ms` integer;--> statement-breakpoint
ALTER TABLE `speaking_submissions` ADD `flags` text;--> statement-breakpoint
ALTER TABLE `speaking_submissions` ADD `mic_settings` text;--> statement-breakpoint
CREATE INDEX `idx_speaking_submissions_sha` ON `speaking_submissions` (`content_sha256`);
