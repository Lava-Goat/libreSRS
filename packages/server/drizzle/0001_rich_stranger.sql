ALTER TABLE `review_logs` ADD `card_state_id` integer REFERENCES card_states(id);--> statement-breakpoint
ALTER TABLE `review_logs` ADD `previous_state_snapshot` text;--> statement-breakpoint
CREATE INDEX `idx_review_logs_card_state` ON `review_logs` (`card_state_id`,`reviewed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_card_states_user_card_direction` ON `card_states` (`user_id`,`card_id`,`direction`);
