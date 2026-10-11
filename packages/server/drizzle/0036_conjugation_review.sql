-- Conjugation v1.13: mastery on two school days, mastered forms brought back
-- when due (across decks), named mistakes and silent response times. Columns
-- only, all nullable or defaulted, so existing rows stay valid:
--  * "name the verb" items are multiple choice only now (their typed rungs
--    trained typing infinitives, not producing forms), so a row that got past
--    the choice rung under v1.12 counts as mastered;
--  * every mastered row is due now, at the first step (1 week), so each one is
--    checked once; its last answer stands in for when it was first mastered;
--  * answers get the gap since their form was last answered (for the
--    teacher's accuracy on forms not seen for a week).
ALTER TABLE `conjugation_progress` ADD `due_at` integer;--> statement-breakpoint
ALTER TABLE `conjugation_progress` ADD `review_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conjugation_progress` ADD `first_top_day` text;--> statement-breakpoint
ALTER TABLE `conjugation_progress` ADD `first_mastered_at` integer;--> statement-breakpoint
UPDATE `conjugation_progress` SET `mastered` = 1 WHERE `item_key` LIKE '%|from' AND `level` >= 1;--> statement-breakpoint
UPDATE `conjugation_progress`
  SET `due_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000, `review_step` = 0, `first_mastered_at` = `last_at`
  WHERE `mastered` = 1;--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `response_ms` integer;--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `mistake_kind` text;--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `mistake_detail` text;--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `retry` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `review` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conjugation_answers` ADD `gap_ms` integer;--> statement-breakpoint
-- The v1.12 answers get their gaps too: the time since the same form (either
-- direction, any deck) was last answered, by the same student.
UPDATE `conjugation_answers` SET `gap_ms` = g.`gap`
  FROM (
    SELECT `id`, `at` - LAG(`at`) OVER (
      PARTITION BY `user_id`, CASE WHEN `item_key` LIKE '%|from' THEN substr(`item_key`, 1, length(`item_key`) - 5)
        ELSE substr(`item_key`, 1, length(`item_key`) - 3) END
      ORDER BY `at`, `id`
    ) AS `gap`
    FROM `conjugation_answers`
  ) AS g
  WHERE g.`id` = `conjugation_answers`.`id`;
