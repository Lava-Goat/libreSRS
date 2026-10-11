-- v1.24.0: the short person cue. A "give the form" prompt names one real subject at a time (ustedes, then ellas,
-- then ellos), taking turns, instead of the whole group "ellos / ellas / ustedes"; a "name the verb" option names
-- one too. The item, its progress row and its grading are unchanged (one item per cell, graded by cell).
--  * conjugation_answers.subject_shown: the subject the prompt showed for the item's own person ("ustedes",
--    "a ellas", "usted"); null for answers before v1.24.0, for impersonal verbs (hay, llueve), and for prompts
--    built before the deploy (rounds in progress keep their long labels). It feeds the teacher's split of Most
--    missed by subject, and the next round's choice of the subject seen least recently for each cell.
-- No index: it is read with the row (the per-user index already narrows the round-start lookup).
-- Rolling back to v1.23.x ignores the column: those servers name no subject_shown when they insert.
ALTER TABLE `conjugation_answers` ADD `subject_shown` text;
