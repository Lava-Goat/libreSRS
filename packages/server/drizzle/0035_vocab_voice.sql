-- Vocabulómetro voice: the audio bank remembers which ElevenLabs voice spoke
-- each clip, so switching voices never serves a clip from the old one, and it
-- also holds the elicited-imitation sentence clips (kind 'sentence').
-- Existing rows keep voice_id NULL (clips made before this migration) and kind 'word'.
ALTER TABLE `app_settings` ADD `vocab_tts_voice_id` text;--> statement-breakpoint
ALTER TABLE `vocab_audio` ADD `voice_id` text;--> statement-breakpoint
ALTER TABLE `vocab_audio` ADD `kind` text DEFAULT 'word' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `uniq_vocab_audio_word_accent`;--> statement-breakpoint
-- One clip per kind, text, accent and voice. ifnull: SQLite treats NULLs as
-- distinct in a unique index, which would let OpenAI-era clips duplicate.
CREATE UNIQUE INDEX `uniq_vocab_audio_clip` ON `vocab_audio` (`kind`,`word`,`accent`,ifnull(`voice_id`, ''));
-- The Vocabulómetro voice is chosen in Admin > Vocabulómetro, or seeded on a
-- fresh install by VOCAB_TTS_VOICE_ID.
