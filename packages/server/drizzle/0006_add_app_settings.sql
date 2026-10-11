CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`google_client_id` text,
	`google_client_secret` text,
	`ai_enabled` integer DEFAULT 0 NOT NULL,
	`ai_provider` text DEFAULT 'openai' NOT NULL,
	`openai_api_key` text,
	`ai_pronunciation_enabled` integer DEFAULT 1 NOT NULL,
	`ai_image_enabled` integer DEFAULT 1 NOT NULL,
	`ai_mnemonic_enabled` integer DEFAULT 1 NOT NULL,
	`ai_cognate_enabled` integer DEFAULT 1 NOT NULL,
	`ai_mnemonic_model` text DEFAULT 'gpt-5.2' NOT NULL,
	`ai_image_model` text DEFAULT 'gpt-image-1.5' NOT NULL,
	`ai_image_quality` text DEFAULT 'low' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
