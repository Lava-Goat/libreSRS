# Database Migration Workflow

This directory is the canonical migration source for the server.

## Rules

- Use Drizzle SQL migrations in `packages/server/drizzle/`.
- Do not add ad-hoc migration scripts or run schema changes from code: every change is a SQL file here.
- Keep `meta/_journal.json` in sync with migration files.
- Migrations are hand-written; extension migrations live in `extensions/<id>/` with their own ledger
  (`src/db/runMigrations.ts`).
- `0038_reserved` and `0041_reserved` are intentionally empty (`SELECT 1;`): they keep the numbers
  contiguous. Never reuse or remove them.

## Runtime behavior

- Server startup runs Drizzle migrations automatically.
- A temporary compatibility backfill exists for one legacy migration metadata gap.
  - Disable with `ENABLE_LEGACY_MIGRATION_BACKFILL=false` once all deployments are clean.

## Writing a migration

Migrations are written by hand. The snapshots in `meta/` stop at 0027, so `npm run db:generate`
would compare `src/db/schema.ts` with an old snapshot and write a migration that re-creates
everything since. Do not commit its output.

1. Change `src/db/schema.ts`, and the hand-written DDL in `src/testUtils/fsrsTestDb.ts`.
2. Add `NNNN_short_name.sql` here, with `--> statement-breakpoint` between statements.
3. Add its entry to `meta/_journal.json`: the next `idx`, `"version": "6"`, the `tag` (the file
   name without `.sql`), `"breakpoints": true`, and a `when` larger than the previous entry's
   (recent entries step by 60000). The migrator skips a file whose `when` is not later than the
   last one it applied.
4. Never rebuild a table that other tables point at (see `DEPRECATED.md`, "Dropping them"). Use
   `ALTER TABLE`.
5. Test it from the repo root:

```bash
npm test -w @libresrs/server
```

`src/db/init.test.ts` migrates a fresh database and checks it against the schema.
