ALTER TABLE `cards` ADD `mnemonic` text;--> statement-breakpoint
-- Publish what teachers already approved: before v1.8.0 an admin's accepted
-- mnemonic was saved for the admin alone and no student ever saw it.
UPDATE `cards` SET `mnemonic` = (
	SELECT m.`text` FROM `ai_mnemonics` m
	INNER JOIN `users` u ON u.`id` = m.`user_id`
	WHERE m.`card_id` = `cards`.`id` AND m.`accepted` = 1 AND u.`role` = 'admin'
	ORDER BY m.`accepted_at` DESC, m.`id` DESC
	LIMIT 1
);
