# Deprecated columns and values

Columns that stay in the database but that no code uses any more. They are kept, not dropped,
so a rollback finds the database as it left it and an old backup still loads. Drop them in a
later migration, once no rollback past the version below is wanted.

## The cognate system (deprecated in v1.20.0)

v1.20.0 removed the cognate system: the cognate score computed on every CSV/Anki import and by
"Regenerate All", the "Cognate: N%" badge on the back of a card, the "Show cognate score"
switches, the false-friend warning, the "Auto for non-cognates" mnemonic mode (a teacher's card
view asked for a suggestion when the card's cognate score was under 0.72), and the review trigger
that kept per-student flags in `card_ai_state`. The teacher now asks for a mnemonic suggestion on
any card. Nothing reads or writes the columns below (drizzle still sends a column's default on an
insert, which is all they receive).

| Table | Column or value | What it was |
| --- | --- | --- |
| `cards` | `cognate_score` | The card's cognate score, 0 to 1 (0009) |
| `card_ai_state` | the whole table | Per student and card: `cognate_score`, `false_friend_dismissed` (0004), and `mnemonic_enabled`, `last_regression_at`, `last_generated_at`, which the review trigger and the mnemonic service wrote and nothing read (0002) |
| `user_settings` | `show_cognate_score`, `show_cognate_score_locked` | The badge switch and its teacher lock (0017) |
| `group_settings` | `show_cognate_score`, `show_cognate_score_locked` | The same, for a group (0017) |
| `deck_user_settings` | `show_cognate_score` | A deck's override of the switch (0017) |
| `app_settings` | `ai_cognate_enabled`, `ai_cognate_model` | The Admin > AI "Cognate Scoring" switch and model (0006, 0010) |
| `user_settings`, `group_settings`, `deck_user_settings` | `mnemonic_mode = 'auto-non-cognate'` | The old default mode (0013, 0016) |

`'auto-non-cognate'` is the one that still matters at run time. Old rows hold it, and it is still
the SQL default of `user_settings.mnemonic_mode` and `group_settings.mnemonic_mode`. The code
never writes it: the schema's default is `'manual'` and drizzle sends that on every insert, and the
routers take it from an old client but save `'manual'`. Every read maps it to `'manual'`
(`readMnemonicMode` in `src/services/mnemonicMode.ts`), so it behaves exactly like `'manual'`.

`ai_anthropic_cognate_model` never shipped: it was in a development draft of 0044_anthropic_key and
was taken out before v1.20.0 went out, so no released database has it and there is nothing to drop.
(A test database that ran that draft has it, and needs the repair in 0044_anthropic_key.sql anyway.)

### Dropping them

SQLite cannot change a column in place, but since 3.35 it can drop one
(`ALTER TABLE … DROP COLUMN`). Use that, never a table rebuild (`CREATE TABLE __new_x`,
`INSERT … SELECT`, `DROP TABLE x`, `RENAME`), for any table other tables point at.

- **The table-rebuild caveat.** better-sqlite3 turns foreign keys on, and drizzle's migrator runs
  every migration inside one transaction, where `PRAGMA foreign_keys = OFF` does nothing. A
  `DROP TABLE` with foreign keys on deletes every row first and fires `ON DELETE CASCADE`: rebuilding
  `cards` would delete every student's card states, review history, assets and mnemonics. A
  generated migration (drizzle-kit writes rebuilds for SQLite) must be read before it ships. Write
  this one by hand.
- `DROP COLUMN` refuses a column that is a key, unique, indexed, or named by a view, trigger or
  CHECK. None of these are (check `sqlite_master` again first).
- Changing a column's SQL default does need a rebuild. `user_settings` and `group_settings` are
  safe to rebuild, since no table points at them, but it is optional: the code always writes the
  mode itself.

The migration:

```sql
-- The legacy mode becomes what every read already makes it.
UPDATE `user_settings` SET `mnemonic_mode` = 'manual' WHERE `mnemonic_mode` = 'auto-non-cognate';--> statement-breakpoint
UPDATE `group_settings` SET `mnemonic_mode` = 'manual' WHERE `mnemonic_mode` = 'auto-non-cognate';--> statement-breakpoint
UPDATE `deck_user_settings` SET `mnemonic_mode` = 'manual' WHERE `mnemonic_mode` = 'auto-non-cognate';--> statement-breakpoint
-- In place: no table is dropped, so nothing cascades.
ALTER TABLE `cards` DROP COLUMN `cognate_score`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `show_cognate_score`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `show_cognate_score_locked`;--> statement-breakpoint
ALTER TABLE `group_settings` DROP COLUMN `show_cognate_score`;--> statement-breakpoint
ALTER TABLE `group_settings` DROP COLUMN `show_cognate_score_locked`;--> statement-breakpoint
ALTER TABLE `deck_user_settings` DROP COLUMN `show_cognate_score`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `ai_cognate_enabled`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `ai_cognate_model`;--> statement-breakpoint
-- Nothing points at card_ai_state, so dropping it cascades nowhere.
DROP TABLE `card_ai_state`;
```

In the same change:

- `src/db/schema.ts`: remove the columns, the `cardAiState` table and `LEGACY_MNEMONIC_MODE`, and
  narrow `mnemonic_mode` to `MNEMONIC_MODES`.
- `src/testUtils/fsrsTestDb.ts`: remove the same columns and table (and its `DROP TABLE IF EXISTS`).
- `src/routers/ai.ts`, `getAdminConfig`: remove `cognate`, `cognateModel` and
  `availableModels.cognate`. They are inert values (never read from these columns) that only an
  Admin page loaded before v1.20.0 reads, so that a page left open across the deploy does not
  crash; by then no such page is open.
- `readMnemonicMode` (`src/services/mnemonicMode.ts`) may keep mapping an unknown value to
  `'manual'`; it costs nothing.
- `src/db/init.test.ts` already runs the SQL above on a migrated database with a card state and a
  review on a scored card, inside one transaction with foreign keys on, and checks that every row
  survives ("drops them with the SQL DEPRECATED.md gives"). Point that test at the new migration
  instead, and keep it.
