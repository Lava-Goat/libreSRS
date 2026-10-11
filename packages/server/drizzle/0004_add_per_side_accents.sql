ALTER TABLE `decks` ADD `source_accent` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `target_accent` text;--> statement-breakpoint
UPDATE `decks` SET `target_accent` = `speech_accent` WHERE `speech_accent` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `card_ai_state` ADD `false_friend_dismissed` integer NOT NULL DEFAULT 0;
