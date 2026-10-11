// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import Database from 'better-sqlite3';

/** libsql-shaped shim over better-sqlite3 so the scan logic below reads the
 *  same {rows} result shape it always has. */
function createClient({ url }: { url: string }) {
  const sqlite = new Database(url.replace(/^file:/, ''));
  return {
    async execute(sqlText: string) {
      return { rows: sqlite.prepare(sqlText).all() as Record<string, unknown>[] };
    },
    async close() { sqlite.close(); },
  };
}
import { scheduleReview, type CardForReview, type ReviewRating } from '@libresrs/shared';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

type Snapshot = {
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: number | null;
  nextReview: number;
};

type ParsedLog = {
  id: number;
  cardStateId: number;
  rating: ReviewRating;
  reviewedAtMs: number;
  newState: number;
  snapshot: Snapshot;
};

function normalizeDatabaseUrl(raw?: string): string {
  const value = raw || './data/flashcards.db';
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  return hasScheme ? value : `file:${value}`;
}

function toLocalFilePath(url: string): string | null {
  if (!url.startsWith('file:')) {
    return null;
  }

  const rawPath = url.replace(/^file:/, '');
  if (!rawPath || rawPath === ':memory:' || rawPath === '::memory:') {
    return null;
  }

  if (rawPath.startsWith('/')) {
    return rawPath;
  }

  return resolve(process.cwd(), rawPath);
}

function toNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${label}: ${String(value)}`);
  }
  return parsed;
}

function toReviewRating(value: unknown): ReviewRating {
  const rating = toNumber(value, 'rating');
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
    throw new Error(`Invalid FSRS rating: ${rating}`);
  }
  return rating as ReviewRating;
}

function parseSnapshot(raw: unknown, logId: number): Snapshot {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Missing previous_state_snapshot for review log ${logId}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON snapshot for review log ${logId}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Snapshot is not an object for review log ${logId}`);
  }

  const snapshot = parsed as Record<string, unknown>;
  const lastReviewRaw = snapshot.lastReview;

  return {
    stability: toNumber(snapshot.stability, `snapshot.stability (log ${logId})`),
    difficulty: toNumber(snapshot.difficulty, `snapshot.difficulty (log ${logId})`),
    elapsedDays: toNumber(snapshot.elapsedDays, `snapshot.elapsedDays (log ${logId})`),
    scheduledDays: toNumber(snapshot.scheduledDays, `snapshot.scheduledDays (log ${logId})`),
    reps: toNumber(snapshot.reps, `snapshot.reps (log ${logId})`),
    lapses: toNumber(snapshot.lapses, `snapshot.lapses (log ${logId})`),
    state: toNumber(snapshot.state, `snapshot.state (log ${logId})`),
    lastReview: lastReviewRaw === null ? null : toNumber(lastReviewRaw, `snapshot.lastReview (log ${logId})`),
    nextReview: toNumber(snapshot.nextReview, `snapshot.nextReview (log ${logId})`),
  };
}

const scanEnabled = process.env.FSRS_SCAN_EXISTING_DB === '1';
if (!scanEnabled) {
  describe('FSRS existing database timing scan', () => {
    it('is opt-in and requires FSRS_SCAN_EXISTING_DB=1', () => {
      expect(scanEnabled).toBe(false);
    });
  });
} else {
  describe('FSRS existing database timing scan', () => {
    it('replays stored reviews and verifies FSRS timing transitions', async () => {
    const databaseUrl = normalizeDatabaseUrl(process.env.FSRS_SCAN_DATABASE_URL || process.env.DATABASE_URL);
    const filePath = toLocalFilePath(databaseUrl);

    if (filePath) {
      if (!existsSync(filePath)) {
        throw new Error(`Database file does not exist: ${filePath}`);
      }
      if (statSync(filePath).size === 0) {
        throw new Error(`Database file is empty: ${filePath}`);
      }
    }

    const client = createClient({ url: databaseUrl });

    try {
      const tableCheck = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('review_logs', 'card_states')"
      );
      const foundTables = new Set(tableCheck.rows.map((row) => String(row.name)));
      if (!foundTables.has('review_logs') || !foundTables.has('card_states')) {
        throw new Error('Database is missing required tables: review_logs and/or card_states');
      }

      const logsResult = await client.execute(`
        SELECT
          id,
          card_state_id,
          rating,
          reviewed_at,
          new_state,
          previous_state_snapshot
        FROM review_logs
        WHERE card_state_id IS NOT NULL
          AND previous_state_snapshot IS NOT NULL
        ORDER BY card_state_id ASC, reviewed_at ASC, id ASC
      `);

      const stateResult = await client.execute(`
        SELECT id, next_review
        FROM card_states
      `);

      const parsedLogs: ParsedLog[] = logsResult.rows.map((row) => {
        const id = toNumber(row.id, 'review_logs.id');
        return {
          id,
          cardStateId: toNumber(row.card_state_id, `review_logs.card_state_id (log ${id})`),
          rating: toReviewRating(row.rating),
          reviewedAtMs: toNumber(row.reviewed_at, `review_logs.reviewed_at (log ${id})`),
          newState: toNumber(row.new_state, `review_logs.new_state (log ${id})`),
          snapshot: parseSnapshot(row.previous_state_snapshot, id),
        };
      });

      expect(parsedLogs.length).toBeGreaterThan(0);

      const nextReviewByStateId = new Map<number, number>();
      for (const row of stateResult.rows) {
        const id = toNumber(row.id, 'card_states.id');
        const nextReview = toNumber(row.next_review, `card_states.next_review (state ${id})`);
        nextReviewByStateId.set(id, nextReview);
      }

      const logsByStateId = new Map<number, ParsedLog[]>();
      for (const log of parsedLogs) {
        const list = logsByStateId.get(log.cardStateId) ?? [];
        list.push(log);
        logsByStateId.set(log.cardStateId, list);
      }

      const mismatches: string[] = [];
      let transitionsChecked = 0;

      for (const [cardStateId, logs] of logsByStateId.entries()) {
        for (let index = 0; index < logs.length; index += 1) {
          const current = logs[index];

          const snapshot = current.snapshot;
          const cardForReview: CardForReview = {
            stability: snapshot.stability,
            difficulty: snapshot.difficulty,
            elapsedDays: snapshot.elapsedDays,
            scheduledDays: snapshot.scheduledDays,
            reps: snapshot.reps,
            lapses: snapshot.lapses,
            state: snapshot.state,
            lastReview: snapshot.lastReview === null ? null : new Date(snapshot.lastReview),
          };

          const expected = scheduleReview(
            cardForReview,
            current.rating,
            new Date(current.reviewedAtMs)
          );

          if (Number(expected.state) !== current.newState) {
            mismatches.push(
              `review_log ${current.id} (state ${cardStateId}) new_state mismatch: expected ${Number(expected.state)}, actual ${current.newState}`
            );
          }

          const nextLog = logs[index + 1];
          const actualNextReview = nextLog
            ? nextLog.snapshot.nextReview
            : nextReviewByStateId.get(cardStateId);

          if (actualNextReview === undefined) {
            mismatches.push(
              `review_log ${current.id} (state ${cardStateId}) has no following snapshot and card_state is missing`
            );
            continue;
          }

          const expectedNextReview = expected.nextReview.getTime();
          transitionsChecked += 1;

          if (actualNextReview !== expectedNextReview) {
            mismatches.push(
              `review_log ${current.id} (state ${cardStateId}) next_review mismatch: expected ${expectedNextReview}, actual ${actualNextReview}`
            );
          }
        }
      }

      console.info(
        `[fsrs_db_scan] scanned_logs=${parsedLogs.length} card_states=${logsByStateId.size} transitions_checked=${transitionsChecked} mismatches=${mismatches.length}`
      );

      expect(transitionsChecked).toBeGreaterThan(0);
      expect(mismatches).toEqual([]);
    } finally {
      await client.close();
    }
    });
  });
}
