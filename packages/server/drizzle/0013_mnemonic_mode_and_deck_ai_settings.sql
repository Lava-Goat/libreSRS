ALTER TABLE `user_settings` ADD `mnemonic_mode` text NOT NULL DEFAULT 'auto-non-cognate';
--> statement-breakpoint
ALTER TABLE `deck_user_settings` ADD `ai_enabled` integer;
--> statement-breakpoint
ALTER TABLE `deck_user_settings` ADD `auto_play_audio` integer;
--> statement-breakpoint
ALTER TABLE `deck_user_settings` ADD `auto_play_audio_front` integer;
--> statement-breakpoint
ALTER TABLE `deck_user_settings` ADD `mnemonic_mode` text;
