ALTER TABLE `user_settings` ADD `show_cognate_score` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `show_cognate_score_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_settings` ADD `show_cognate_score` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_settings` ADD `show_cognate_score_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `deck_user_settings` ADD `show_cognate_score` integer;
