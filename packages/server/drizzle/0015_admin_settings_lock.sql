ALTER TABLE `user_settings` ADD `ai_enabled_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_play_audio_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_play_audio_front_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `mnemonic_mode_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `locale_locked` integer DEFAULT 0 NOT NULL;
