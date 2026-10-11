-- The "repeat the sentence" (elicited imitation) test sends each student recording to the AI provider
-- (OpenAI, whisper-1) to be transcribed: the one flow of student-made content to a third party. It gets
-- its own switch, apart from the master AI switch:
--  * app_settings.ai_transcription_enabled: 0 = the transcription is refused (and so is creating an
--    "ei" test), 1 = allowed while AI is on. A NEW database gets 0: off by default.
--  * An install that already uses the mode keeps it: the UPDATE turns the switch on in the existing
--    settings row only where a vocabulary test in mode 'ei' exists, so a class that takes those tests
--    today sees no change. An install with no settings row yet (a fresh one) has nothing to update.
-- Rolling back to a release without the column ignores it: transcription follows the AI switch again.
ALTER TABLE `app_settings` ADD `ai_transcription_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `app_settings` SET `ai_transcription_enabled` = 1 WHERE EXISTS (SELECT 1 FROM `vocab_tests` WHERE `mode` = 'ei');
