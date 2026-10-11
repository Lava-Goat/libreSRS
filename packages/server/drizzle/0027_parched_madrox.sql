ALTER TABLE `app_settings` ADD `ai_tts_provider` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `elevenlabs_api_key` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `ai_tts_voice_map` text DEFAULT '{}' NOT NULL;