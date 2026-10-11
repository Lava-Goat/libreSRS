// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, getTableName, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { resolve, dirname, join } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';
import { CardDirection } from '@libresrs/shared';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { columnsOf, coreMigrationsFolder, expectTableMatchesSchema, indexesOf, migrationsThrough } from '../testUtils/migrationChecks.js';
import { effectiveCredit, rowStatus, studentLabStatus } from '../services/labCredit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = coreMigrationsFolder;

type Sqlite = InstanceType<typeof Database>;

/** Every object of the database but the migration ledgers (and their keys), as SQLite stores it. */
const schemaDump = (client: Sqlite) =>
  client.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY type, name").all();

/**
 * Foreign-key columns of a table that no index starts with. SQLite has no
 * automatic index on a child column, so deleting a parent row (a deck, a
 * round) would scan the whole child table for its ON DELETE CASCADE.
 */
function unindexedForeignKeys(client: Sqlite, table: string): string[] {
  const leading = new Set<string>();
  for (const { name } of client.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]) {
    const [first] = client.prepare(`PRAGMA index_info("${name}")`).all() as { name: string }[];
    if (first) leading.add(first.name);
  }
  // An INTEGER PRIMARY KEY is the rowid itself, indexed without an index.
  const pk = (client.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; pk: number }[])
    .filter((c) => c.pk > 0);
  if (pk.length === 1 && pk[0].type.toUpperCase() === 'INTEGER') leading.add(pk[0].name);
  const fks = client.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string }[];
  return [...new Set(fks.map((f) => f.from))].filter((column) => !leading.has(column));
}

/**
 * What migration 0039 gives a lab submission turned in before it: credit, a
 * microphone, and no pause data; 0040: not held, no mic stats; and 0043: not
 * an exam.
 */
const LEGACY_PAUSE_COLUMNS = {
  mic: 'on', pausesCounted: null, pausesAnswered: null, pauseResults: null, rejectedAnswers: 0, lateAnswers: 0,
  minAnsweredPct: null, voicePerPauseMs: null, outsideVoicedMs: null, outsidePlayedMs: null, flags: null,
  credit: true, creditOverride: null, creditOverrideAt: null, creditOverrideBy: null, checkRequestedAt: null,
  heldFor: null, micStats: null, examSet: null,
} as const;

/** What migration 0040 gives a speaking take recorded before it: no hash, no page claims, no flags. */
const LEGACY_SPEAKING_CHECK_COLUMNS = {
  contentSha256: null, clientDurationMs: null, clientVoicedMs: null, flags: null, micSettings: null,
} as const;

describe('Database Initialization', () => {
  it('should apply migrations that match the schema', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });

    const migrationsFolder = resolve(__dirname, '../../drizzle');
    migrate(db, { migrationsFolder });

    await db.insert(schema.users).values({
      googleId: 'test',
      email: 'test@example.com',
      name: 'Test User',
    });

    const deck = await db.insert(schema.decks).values({
      name: 'Test Deck',
      createdBy: 1,
      reversible: true,
    }).returning();

    const deckId = deck[0].id;

    await db.insert(schema.cards).values({
      deckId: deckId,
      front: 'Front',
      back: 'Back',
    });

    await db.insert(schema.userSettings).values({
      userId: 1,
      isOverride: true,
      allowHigher: false,
      allowLower: false,
    });

    await db.insert(schema.cardStates).values({
      cardId: 1,
      userId: 1,
      direction: CardDirection.Reverse,
    });

    await db.insert(schema.virtualDecks).values({
      name: 'Virtual',
      userId: 1,
      sourceDeckId: 1,
      cardSelection: '1-10',
    });

    expect(true).toBe(true);
    client.close();
  });

  it('creates the lab tables with every column the schema writes, and cascades from a lab', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: resolve(__dirname, '../../drizzle') });

    await db.insert(schema.users).values({ googleId: 'g', email: 'a@example.com', name: 'A' });
    await db.insert(schema.groups).values({ name: 'P1' });
    const [lab] = await db.insert(schema.labs).values({
      title: 'ES1 Lab semana01', description: null, audioUrl: '/api/assets/x.mp3', mimeType: 'audio/mpeg',
      durationMs: 700_000, requiredThroughMs: 660_000, createdBy: 1,
    }).returning();
    expect(lab.active).toBe(false);
    expect(lab.forEveryone).toBe(false);
    await db.insert(schema.labGroups).values({ labId: lab.id, groupId: 1 });
    await db.insert(schema.labSubmissions).values({
      labId: lab.id, userId: 1, requiredThroughMs: 660_000, voicedMs: 1, listenedCoveredMs: 1, listenWallMs: 1, skipCount: 0,
      startedAt: new Date(), submittedAt: new Date(),
    });
    await db.insert(schema.labListenEvents).values({
      labId: lab.id, userId: 1, sessionStartedAt: 1, kind: 'open', positionMs: 0, clientMs: 0, at: 1,
    });
    // One submission per session.
    const startedAt = (await db.query.labSubmissions.findFirst())!.startedAt;
    await expect(db.insert(schema.labSubmissions).values({
      labId: lab.id, userId: 1, requiredThroughMs: 1, startedAt,
    })).rejects.toThrow();

    await db.delete(schema.labs);
    for (const table of ['lab_groups', 'lab_submissions', 'lab_listen_events']) {
      expect((client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    client.close();
  });

  it('publishes mnemonics teachers approved before v1.8.0, and never a student’s', () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    const migrationsFolder = resolve(__dirname, '../../drizzle');
    migrate(db, { migrationsFolder });

    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 'a', 't@example.com', 'Teacher', 'admin', 0), (2, 's', 's@example.com', 'Student', 'user', 0);
      INSERT INTO decks (id, name, created_by, created_at) VALUES (1, 'U1', 1, 0);
      INSERT INTO cards (id, deck_id, front, back, created_at) VALUES
        (1, 1, 'perro', 'dog', 0), (2, 1, 'gato', 'cat', 0), (3, 1, 'son', 'are', 0);
      INSERT INTO ai_mnemonics (card_id, user_id, provider, text, source_prompt, accepted, accepted_at, created_at) VALUES
        (1, 1, 'x', 'older teacher pick', 'p', 1, 100, 100),
        (1, 1, 'x', 'newer teacher pick', 'p', 1, 200, 200),
        (1, 1, 'x', 'teacher suggestion never approved', 'p', 0, NULL, 300),
        (2, 2, 'x', 'a student pick', 'p', 1, 100, 100),
        (3, 1, 'x', 'unapproved', 'p', 0, NULL, 100);
    `);
    const sql = readFileSync(resolve(migrationsFolder, '0031_card_mnemonics.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE'));
    client.exec(update);

    const rows = client.prepare('SELECT id, mnemonic FROM cards ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, mnemonic: 'newer teacher pick' },
      { id: 2, mnemonic: null },
      { id: 3, mnemonic: null },
    ]);
    client.close();
  });

  it('keeps no recording on a lab submission: the audio columns are gone (0032)', () => {
    const client = new Database(':memory:');
    migrate(drizzle(client, { schema }), { migrationsFolder });

    const columns = columnsOf(client, 'lab_submissions');
    for (const gone of ['audio_url', 'mime_type', 'size_bytes', 'duration_ms', 'segments']) expect(columns).not.toContain(gone);
    for (const table of [schema.labs, schema.labGroups, schema.labSubmissions, schema.labListenEvents]) {
      expectTableMatchesSchema(client, table);
    }
    client.close();
  });

  it('creates the speaking tables as the schema declares them, and cascades from a task (0032)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder });
    for (const table of [schema.speakingTasks, schema.speakingTaskGroups, schema.speakingSubmissions]) {
      expectTableMatchesSchema(client, table);
    }

    await db.insert(schema.users).values([
      { googleId: 't', email: 't@example.com', name: 'Teacher', role: 'admin' },
      { googleId: 's', email: 's@example.com', name: 'Student' },
    ]);
    await db.insert(schema.groups).values({ name: 'P1' });
    const [task] = await db.insert(schema.speakingTasks).values({ title: 'Cuento semana 2', createdBy: 1 }).returning();
    expect(task).toMatchObject({ showReference: true, forEveryone: false, active: false, referenceText: null, targetSeconds: null });
    await db.insert(schema.speakingTaskGroups).values({ taskId: task.id, groupId: 1 });
    await expect(db.insert(schema.speakingTaskGroups).values({ taskId: task.id, groupId: 1 })).rejects.toThrow();

    const [sub] = await db.insert(schema.speakingSubmissions).values({
      taskId: task.id, userId: 2, clientKey: 'abcdefgh', audioUrl: '/api/recordings/x.webm', mimeType: 'audio/webm',
      durationMs: 30_000, voicedMs: 20_000, referenceText: 'Había una vez', submittedAt: new Date(),
      gradeScore: 87.5, gradeDetails: '{}', gradeFeedback: 'Bien', gradedBy: 'teacher', gradedAt: new Date(),
    }).returning();
    expect(sub.gradeScore).toBe(87.5);
    // One recording per key per student; another student may use the same key.
    await expect(db.insert(schema.speakingSubmissions).values({
      taskId: task.id, userId: 2, clientKey: 'abcdefgh', audioUrl: '/api/recordings/y.webm', mimeType: 'audio/webm',
    })).rejects.toThrow(/UNIQUE/);
    await db.insert(schema.speakingSubmissions).values({
      taskId: task.id, userId: 1, clientKey: 'abcdefgh', audioUrl: '/api/recordings/z.webm', mimeType: 'audio/webm',
    });

    await db.delete(schema.speakingTasks);
    for (const table of ['speaking_task_groups', 'speaking_submissions']) {
      expect((client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    client.close();
  });

  it('creates the sign-up tables as the schema declares them, and cascades from a sheet (0033)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder });
    for (const table of [schema.signupSheets, schema.signupSheetGroups, schema.signupDates, schema.signupClaims]) {
      expectTableMatchesSchema(client, table);
    }

    await db.insert(schema.users).values([
      { googleId: 't', email: 't@example.com', name: 'Teacher', role: 'admin' },
      { googleId: 's', email: 's@example.com', name: 'Student' },
    ]);
    await db.insert(schema.groups).values({ name: 'Stats' });
    const [sheet] = await db.insert(schema.signupSheets).values({ title: 'Show and tell', createdBy: 1 }).returning();
    expect(sheet).toMatchObject({
      slotsPerDate: 2, picksPerStudent: 1, showNames: true, open: true, timeZone: 'America/Los_Angeles', forEveryone: false, active: false,
    });
    await db.insert(schema.signupSheetGroups).values({ sheetId: sheet.id, groupId: 1 });
    const [day] = await db.insert(schema.signupDates).values({ sheetId: sheet.id, date: '2026-09-28', label: 'Day 31' }).returning();
    // One row per day per sheet, and one pick per student per day.
    await expect(db.insert(schema.signupDates).values({ sheetId: sheet.id, date: '2026-09-28' })).rejects.toThrow(/UNIQUE/);
    await db.insert(schema.signupClaims).values({ sheetId: sheet.id, dateId: day.id, userId: 2, assignedBy: 1 });
    await expect(db.insert(schema.signupClaims).values({ sheetId: sheet.id, dateId: day.id, userId: 2 })).rejects.toThrow(/UNIQUE/);

    await db.delete(schema.signupSheets);
    for (const table of ['signup_sheet_groups', 'signup_dates', 'signup_claims']) {
      expect((client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    client.close();
  });

  it('creates the conjugation tables as the schema declares them, with the quiz defaults, and cascades from a deck (0034)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder });
    for (const table of [schema.deckConjugation, schema.conjugationProgress, schema.conjugationRounds, schema.conjugationAnswers]) {
      expectTableMatchesSchema(client, table);
    }

    await db.insert(schema.users).values([
      { googleId: 't', email: 't@example.com', name: 'Teacher', role: 'admin' },
      { googleId: 's', email: 's@example.com', name: 'Student' },
    ]);
    const [deck] = await db.insert(schema.decks).values({ name: 'Unit 1', createdBy: 1 }).returning();
    const [settings] = await db.insert(schema.deckConjugation).values({ deckId: deck.id }).returning();
    expect(settings).toMatchObject({
      enabled: false, tenses: '["present"]', includeVosotros: false, vos: 'none', directions: 'both',
      answerMode: 'progressive', accentMode: 'progressive', roundLength: 20, excludedEntries: '[]', extraEntries: '[]',
    });
    await db.insert(schema.conjugationProgress).values({ userId: 2, deckId: deck.id, itemKey: 'tener|present|yo|-|to' });
    // One row per student per item.
    await expect(db.insert(schema.conjugationProgress).values({ userId: 2, deckId: deck.id, itemKey: 'tener|present|yo|-|to' }))
      .rejects.toThrow(/UNIQUE|PRIMARY/);
    const [round] = await db.insert(schema.conjugationRounds).values({
      userId: 2, deckId: deck.id, queue: '[]', prompts: 0, settingsSnapshot: '{}',
    }).returning();
    expect(round).toMatchObject({ finishedAt: null, abandoned: false, position: 0, firstTryCorrect: 0, answers: 0, lastAnswer: null });
    await db.insert(schema.conjugationAnswers).values({
      roundId: round.id, userId: 2, deckId: deck.id, itemKey: 'tener|present|yo|-|to', levelKind: 'choice', given: 'tengo', result: 'correct',
    });

    await db.delete(schema.decks);
    for (const table of ['deck_conjugation', 'conjugation_progress', 'conjugation_rounds', 'conjugation_answers']) {
      expect((client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    client.close();
  });

  it('indexes every foreign key of the conjugation tables, so deleting a deck, a round or a student does not scan them (0034)', async () => {
    const conjugationTables = [schema.deckConjugation, schema.conjugationProgress, schema.conjugationRounds, schema.conjugationAnswers];
    const client = new Database(':memory:');
    migrate(drizzle(client, { schema }), { migrationsFolder });
    for (const table of conjugationTables) expect(unindexedForeignKeys(client, getTableConfig(table).name)).toEqual([]);
    client.close();

    // The tests' hand-written DDL declares the same tables and indexes.
    const test = createTestDb();
    await setupFsrsSchema(test.client);
    for (const table of conjugationTables) {
      expectTableMatchesSchema(test.sqlite, table);
      expect(unindexedForeignKeys(test.sqlite, getTableConfig(table).name)).toEqual([]);
    }
    await test.client.close();
  });

  it('keys the audio bank by voice and kind, keeping the older clips as voiceless words (0035)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0034_conjugation') });
    // What v1.10 left behind: OpenAI clips with no voice.
    client.exec(`INSERT INTO vocab_audio (word, accent, url, status, created_at) VALUES
      ('ciudad', '', '/api/assets/a.opus', 'ready', 0), ('ciudad', 'Mexican', '/api/assets/b.opus', 'ready', 0);`);
    migrate(db, { migrationsFolder });
    expectTableMatchesSchema(client, schema.vocabAudio);
    expectTableMatchesSchema(client, schema.appSettings);

    const legacy = await db.select().from(schema.vocabAudio);
    expect(legacy.map((r) => [r.word, r.accent, r.kind, r.voiceId, r.url])).toEqual([
      ['ciudad', '', 'word', null, '/api/assets/a.opus'], ['ciudad', 'Mexican', 'word', null, '/api/assets/b.opus'],
    ]);
    // Another voice, or a sentence with the same text, is a separate clip…
    await db.insert(schema.vocabAudio).values({ word: 'ciudad', accent: '', voiceId: 'voiceTeacherA' });
    await db.insert(schema.vocabAudio).values({ word: 'ciudad', accent: '', kind: 'sentence', voiceId: 'voiceTeacherA' });
    // …but the same clip twice is not, voiceless ones included (NULLs are distinct in a plain index).
    await expect(db.insert(schema.vocabAudio).values({ word: 'ciudad', accent: '', voiceId: 'voiceTeacherA' }))
      .rejects.toThrow(/UNIQUE/);
    await expect(db.insert(schema.vocabAudio).values({ word: 'ciudad', accent: '' })).rejects.toThrow(/UNIQUE/);

    await db.insert(schema.appSettings).values({ id: 1 });
    expect((await db.select().from(schema.appSettings))[0].vocabTtsVoiceId).toBeNull();
    client.close();
  });

  it('upgrades a v1.8.0 database that already has lab submissions, keeping them', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0031_card_mnemonics') });
    expect(columnsOf(client, 'lab_submissions')).toContain('audio_url');
    expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'speaking_tasks'`).get()).toBeUndefined();

    // What v1.8.0 wrote: a lab, a recorded submission and its listening log.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 't@example.com', 'Teacher', 'admin', 0), (2, 's', 's@example.com', 'Student', 'user', 0);
      INSERT INTO groups (id, name, created_at) VALUES (1, 'P1', 0);
      INSERT INTO labs (id, title, audio_url, mime_type, duration_ms, required_through_ms, for_everyone, active, created_by, created_at)
        VALUES (1, 'ES1 Lab semana01', '/api/assets/x.mp3', 'audio/mpeg', 700000, 660000, 0, 1, 1, 0);
      INSERT INTO lab_groups (lab_id, group_id) VALUES (1, 1);
      INSERT INTO lab_submissions (id, lab_id, user_id, audio_url, mime_type, size_bytes, required_through_ms, duration_ms,
          voiced_ms, listened_covered_ms, listen_wall_ms, skip_count, segments, started_at, submitted_at)
        VALUES (1, 1, 2, '/api/labs/recordings/a.webm', 'audio/webm', 12345, 660000, 700000,
          95000, 665000, 661000, 1, '[[0,0]]', 1790000000123, 1790000720);
      INSERT INTO lab_listen_events (lab_id, user_id, session_started_at, kind, position_ms, client_ms, at)
        VALUES (1, 2, 1790000000123, 'end', 665000, 695000, 1790000720000);
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    expectTableMatchesSchema(client, schema.labSubmissions);
    expect(await db.query.labSubmissions.findMany()).toEqual([{
      id: 1, labId: 1, userId: 2, requiredThroughMs: 660_000, voicedMs: 95_000, listenedCoveredMs: 665_000,
      skipCount: 1, listenWallMs: 661_000, startedAt: new Date(1790000000123), submittedAt: new Date(1790000720 * 1000),
      // 0039: turned in before the pause rule, so it keeps its credit and has no pause data.
      ...LEGACY_PAUSE_COLUMNS,
    }]);
    expect(await db.query.labListenEvents.findMany()).toHaveLength(1);
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

    // Still one submission per session, and a lab still takes its submissions with it.
    await expect(db.insert(schema.labSubmissions).values({
      labId: 1, userId: 2, requiredThroughMs: 1, startedAt: new Date(1790000000123),
    })).rejects.toThrow(/UNIQUE/);
    await db.insert(schema.speakingTasks).values({ title: 'Cuento', createdBy: 1 });
    await db.delete(schema.labs);
    expect(await db.query.labSubmissions.findMany()).toEqual([]);
    client.close();
  });

  it('keeps every migration after the one before it, so none is skipped (0043 after 0042)', () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      expect(entry.tag.startsWith(String(i).padStart(4, '0') + '_')).toBe(true);
      // drizzle applies only migrations newer than the last one it recorded.
      if (i > 0) expect(entry.when).toBeGreaterThan(journal.entries[i - 1].when);
      expect(readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8').length).toBeGreaterThan(0);
    });
    // 0037 keeps only its core table; 0038 and 0041 are placeholders (SELECT 1): their steps live in an
    // extension's own folder now, and every `when` is kept, so no database runs anything twice.
    expect(journal.entries.find((e) => e.tag === '0037_student_numbers')).toMatchObject({ idx: 37, when: 1790141519399 });
    expect(journal.entries.find((e) => e.tag === '0038_reserved')).toMatchObject({ idx: 38, when: 1790141579399 });
    expect(journal.entries.find((e) => e.tag === '0039_lab_pauses')).toMatchObject({ idx: 39 });
    expect(journal.entries.find((e) => e.tag === '0040_sim115_checks')).toMatchObject({ idx: 40 });
    expect(journal.entries.find((e) => e.tag === '0041_reserved')).toMatchObject({ idx: 41, when: 1790141759399 });
    expect(journal.entries.find((e) => e.tag === '0042_study_all')).toMatchObject({ idx: 42, when: 1790141819399 });
    expect(journal.entries.find((e) => e.tag === '0043_exam_labs')).toMatchObject({ idx: 43 });
    expect(journal.entries.find((e) => e.tag === '0044_anthropic_key')).toMatchObject({ idx: 44 });
    expect(journal.entries.find((e) => e.tag === '0045_tests_tab')).toMatchObject({ idx: 45 });
    expect(journal.entries.find((e) => e.tag === '0046_pin_login')).toMatchObject({ idx: 46 });
    expect(journal.entries.find((e) => e.tag === '0047_subject_shown')).toMatchObject({ idx: 47, when: 1790142119399 });
    expect(journal.entries.find((e) => e.tag === '0048_conjugation_sentences')).toMatchObject({ idx: 48, when: 1790142179399 });
    expect(journal.entries.find((e) => e.tag === '0049_transcription_switch')).toMatchObject({ idx: 49, when: 1790142239399 });
  });

  it('creates exactly the tables schema.ts declares, and nothing an extension owns (core migrations alone)', () => {
    const client = new Database(':memory:');
    migrate(drizzle(client, { schema }), { migrationsFolder });
    const declared = (Object.values(schema) as unknown[]).filter((value): value is SQLiteTable => is(value, SQLiteTable)).map((t) => getTableName(t));
    const made = (client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all() as { name: string }[])
      .map((r) => r.name);
    expect(made.sort()).toEqual([...declared, '__drizzle_migrations'].sort());
    expect(made.filter((name) => name.startsWith('__ext_'))).toEqual([]);
    client.close();
  });

  it('runs the reserved migrations (0038, 0041) as no-ops that are still recorded', () => {
    const dumpThrough = (tag: string) => {
      const client = new Database(':memory:');
      migrate(drizzle(client, { schema }), { migrationsFolder: migrationsThrough(tag) });
      const dump = { objects: schemaDump(client), ledger: (client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n };
      client.close();
      return dump;
    };
    for (const [before, reserved] of [['0037_student_numbers', '0038_reserved'], ['0040_sim115_checks', '0041_reserved']]) {
      const a = dumpThrough(before);
      const b = dumpThrough(reserved);
      expect(b.objects, reserved).toEqual(a.objects);
      expect(b.ledger, reserved).toBe(a.ledger + 1);
      // Only a statement better-sqlite3 accepts (a comment alone is "no statements" and fails).
      expect(readFileSync(join(migrationsFolder, `${reserved}.sql`), 'utf8')).toMatch(/^(--[^\n]*\n)*SELECT 1;\n$/);
    }
  });

  it('creates student_number_overrides as the schema and the tests\' DDL declare it, one row per student and number (0037)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0036_conjugation_review') });
    expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'student_number_overrides'`).get()).toBeUndefined();
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0), (2, 's', '123456@students.school.test', 'Ana', 'user', 0),
        (3, 's3', 'family@example.com', 'Bo', 'user', 0);
    `);

    migrate(db, { migrationsFolder });

    expectTableMatchesSchema(client, schema.studentNumberOverrides);
    expect(client.prepare('SELECT count(*) AS n FROM student_number_overrides').get()).toEqual({ n: 0 });
    await db.insert(schema.studentNumberOverrides).values({ userId: 3, studentNumber: '654321', updatedAt: new Date(1790500000000) });
    // One number per student, and no number twice.
    await expect(db.insert(schema.studentNumberOverrides).values({ userId: 3, studentNumber: '111111', updatedAt: new Date(0) }))
      .rejects.toThrow(/UNIQUE|PRIMARY/);
    await expect(db.insert(schema.studentNumberOverrides).values({ userId: 2, studentNumber: '654321', updatedAt: new Date(0) }))
      .rejects.toThrow(/UNIQUE/);
    expect(await db.select().from(schema.studentNumberOverrides).all())
      .toEqual([{ userId: 3, studentNumber: '654321', updatedAt: new Date(1790500000000) }]);
    // Gone with the student.
    await db.delete(schema.users).where(eq(schema.users.id, 3));
    expect(client.prepare('SELECT count(*) AS n FROM student_number_overrides').get()).toEqual({ n: 0 });
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    client.close();

    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    expectTableMatchesSchema(test.sqlite, schema.studentNumberOverrides);
    await test.client.close();
  });

  it('upgrades a v1.14 database with lab work (0039): turned-in labs keep credit, sessions keep no rules, the rule starts at 0%', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0038_reserved') });
    expect(columnsOf(client, 'lab_submissions')).not.toContain('credit');
    expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'lab_settings'`).get()).toBeUndefined();

    // What v1.14 wrote: a lab, two turned-in sessions (one with little speech) and a listening log.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 't@example.com', 'Teacher', 'admin', 0), (2, 's', 's@example.com', 'Student', 'user', 0);
      INSERT INTO labs (id, title, audio_url, mime_type, duration_ms, required_through_ms, for_everyone, active, created_by, created_at)
        VALUES (1, 'ES1 Lab semana06', '/api/assets/x.mp3', 'audio/mpeg', 939548, 905000, 1, 1, 1, 0);
      INSERT INTO lab_submissions (id, lab_id, user_id, required_through_ms, voiced_ms, listened_covered_ms, listen_wall_ms, skip_count, started_at, submitted_at)
        VALUES (1, 1, 2, 905000, 120000, 905100, 906000, 0, 1790500000123, 1790501000),
               (2, 1, 2, 905000, 1200, 905100, 906000, 0, 1790600000456, 1790601000);
      INSERT INTO lab_listen_events (lab_id, user_id, session_started_at, kind, position_ms, client_ms, at) VALUES
        (1, 2, 1790500000123, 'open', 0, 0, 1790500000200),
        (1, 2, 1790500000123, 'tick', 5000, 5100, 1790500005400),
        (1, 2, 1790500000123, 'end', 905100, 906500, 1790500907000);
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    for (const table of [schema.labs, schema.labGroups, schema.labSubmissions, schema.labListenEvents, schema.labSettings]) {
      expectTableMatchesSchema(client, table);
    }
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

    // The lab is unscanned: it keeps the old rule until the teacher finds its pauses.
    expect(await db.query.labs.findFirst()).toMatchObject({ pauses: null, pauseScan: null, pauseCountUntilMs: null });
    // Both submissions keep their credit (the little-speech one too), with a microphone and no pause data.
    const submissions = await db.query.labSubmissions.findMany({ orderBy: (s, { asc }) => [asc(s.id)] });
    expect(submissions).toEqual([
      expect.objectContaining({ id: 1, voicedMs: 120_000, ...LEGACY_PAUSE_COLUMNS }),
      expect.objectContaining({ id: 2, voicedMs: 1200, ...LEGACY_PAUSE_COLUMNS }),
    ]);
    expect(client.prepare('SELECT DISTINCT credit, mic FROM lab_submissions').all()).toEqual([{ credit: 1, mic: 'on' }]);
    // Sessions opened before v1.15.0 have no rules on their open row, and no report carried results.
    expect(client.prepare('SELECT kind, answers, rules FROM lab_listen_events ORDER BY id').all()).toEqual([
      { kind: 'open', answers: null, rules: null }, { kind: 'tick', answers: null, rules: null }, { kind: 'end', answers: null, rules: null },
    ]);
    // Watch first: seeded at 0%, so every lab counts until the teacher sets a share
    // (and 0040 adds the 6 dB room margin, with voice outside the pauses only a flag).
    expect(client.prepare('SELECT * FROM lab_settings').all()).toEqual([
      { id: 1, min_answered_pct: 0, voice_per_pause_ms: 250, updated_at: 1790141639399, gate_margin_db: 6, hold_outside_voice: 0 },
    ]);
    expect(await db.query.labSettings.findFirst()).toEqual({
      id: 1, minAnsweredPct: 0, voicePerPauseMs: 250, updatedAt: new Date(1790141639399), gateMarginDb: 6, holdOutsideVoice: false,
    });

    // A lab turned in by v1.14 after this migration ran (the server rolled back to the v1.14 image):
    // v1.14 writes neither credit nor flags, so the row gets credit 0, the column's default. When v1.15
    // is deployed again this migration does not run again; the row is known by its missing flags
    // (v1.15 always stores them) and counts, as every lab turned in under v1.14 did.
    client.prepare(`INSERT INTO lab_submissions (lab_id, user_id, required_through_ms, voiced_ms, listened_covered_ms, listen_wall_ms, skip_count, started_at, submitted_at)
      VALUES (1, 2, 905000, 0, 905100, 906000, 0, 1790700000789, 1790701000)`).run();
    expect(client.prepare('SELECT credit, flags, mic, rejected_answers, late_answers FROM lab_submissions WHERE id = 3').get())
      .toEqual({ credit: 0, flags: null, mic: 'on', rejected_answers: 0, late_answers: 0 });
    const rolledBack = (await db.query.labSubmissions.findFirst({ where: (s, { eq }) => eq(s.id, 3) }))!;
    expect(effectiveCredit(rolledBack)).toBe(true);
    expect(rowStatus(rolledBack)).toEqual({ status: 'done', reason: null });
    // The teacher can still take it away.
    expect(rowStatus({ ...rolledBack, creditOverride: false })).toEqual({ status: 'redo', reason: 'teacher' });
    // A v1.15 row that did not count stores its flags, so it stays a redo.
    expect(studentLabStatus([{ ...rolledBack, id: 4, flags: '[]', submittedAt: new Date(1790800000000) }]))
      .toEqual({ status: 'redo', reason: null });
    const [written] = await db.insert(schema.labSubmissions).values({
      labId: 1, userId: 2, requiredThroughMs: 905_000, startedAt: new Date(1790800000999),
    }).returning();
    expect(written).toMatchObject({ credit: false, mic: 'on', creditOverride: null, pausesCounted: null, flags: null });
    // Still one submission per session.
    await expect(db.insert(schema.labSubmissions).values({
      labId: 1, userId: 2, requiredThroughMs: 1, startedAt: new Date(1790500000123),
    })).rejects.toThrow(/UNIQUE/);

    // A student's entries in every lab, by time, come from the new index (the "Two at once" check).
    const plan = client.prepare('EXPLAIN QUERY PLAN SELECT lab_id, session_started_at FROM lab_listen_events WHERE user_id = ? AND at BETWEEN ? AND ?')
      .all(2, 0, 1) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_lab_listen_events_user_at');
    client.close();
  });

  it('stores what a v1.15.0 lab session writes, and reads it back as written (0039)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder });
    await db.insert(schema.users).values([
      { googleId: 't', email: 't@example.com', name: 'Teacher', role: 'admin' },
      { googleId: 's', email: 's@example.com', name: 'Student' },
    ]);
    const pauses = '[[10000,13600],[20000,23600]]';
    const scan = '{"minPauseMs":3300,"thresholdDb":-46.2,"noiseDb":-200,"shortestKeptMs":3600,"longestLeftOutMs":2940,"closeCalls":0,"scannedAt":1790900000000}';
    const [lab] = await db.insert(schema.labs).values({
      title: 'ES1 Lab semana06', audioUrl: '/api/assets/x.mp3', mimeType: 'audio/mpeg', durationMs: 60_000,
      requiredThroughMs: 50_000, createdBy: 1, pauses, pauseScan: scan, pauseCountUntilMs: 30_000,
    }).returning();
    expect(lab).toMatchObject({ pauses, pauseScan: scan, pauseCountUntilMs: 30_000 });

    const rules = '{"v":1,"pauses":[[10000,13600]],"pct":75,"floor":250,"requiredThroughMs":50000}';
    await db.insert(schema.labListenEvents).values([
      { labId: lab.id, userId: 2, sessionStartedAt: 1, kind: 'open', positionMs: 0, clientMs: 0, at: 1, rules },
      { labId: lab.id, userId: 2, sessionStartedAt: 1, kind: 'tick', positionMs: 15_000, clientMs: 15_000, at: 15_001, answers: '[[10000,1200]]' },
    ]);
    expect((await db.query.labListenEvents.findMany()).map((e) => [e.kind, e.answers, e.rules]))
      .toEqual([['open', null, rules], ['tick', '[[10000,1200]]', null]]);

    const overrideAt = new Date('2026-10-05T16:00:00Z');
    const [row] = await db.insert(schema.labSubmissions).values({
      labId: lab.id, userId: 2, requiredThroughMs: 50_000, startedAt: new Date(1), mic: 'off',
      pausesCounted: 1, pausesAnswered: 0, pauseResults: '[[10000,-1]]', rejectedAnswers: 3, lateAnswers: 1,
      minAnsweredPct: 75, voicePerPauseMs: 250, outsideVoicedMs: 500, outsidePlayedMs: 30_000, flags: '["late","no-mic"]',
      credit: false, creditOverride: false, creditOverrideAt: overrideAt, creditOverrideBy: 1, checkRequestedAt: overrideAt,
    }).returning();
    expect(row).toMatchObject({
      mic: 'off', pausesCounted: 1, pausesAnswered: 0, pauseResults: '[[10000,-1]]', rejectedAnswers: 3, lateAnswers: 1,
      minAnsweredPct: 75, voicePerPauseMs: 250, outsideVoicedMs: 500, outsidePlayedMs: 30_000, flags: '["late","no-mic"]',
      // An override of false is a decision, not "automatic".
      credit: false, creditOverride: false, creditOverrideAt: overrideAt, creditOverrideBy: 1, checkRequestedAt: overrideAt,
    });
    await db.update(schema.labSubmissions).set({ creditOverride: true }).run();
    expect((await db.query.labSubmissions.findFirst())?.creditOverride).toBe(true);

    // The teacher's settings: an upsert of row 1.
    await db.insert(schema.labSettings).values({ id: 1, minAnsweredPct: 80, voicePerPauseMs: 400 })
      .onConflictDoUpdate({ target: schema.labSettings.id, set: { minAnsweredPct: 80, voicePerPauseMs: 400 } }).run();
    expect(await db.select().from(schema.labSettings).all()).toEqual([
      expect.objectContaining({ id: 1, minAnsweredPct: 80, voicePerPauseMs: 400 }),
    ]);

    // Deleting a lab still takes its submissions and its log with it.
    await db.delete(schema.labs);
    for (const table of ['lab_submissions', 'lab_listen_events']) {
      expect((client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    client.close();
  });

  it('gives the tests\' hand-written lab and speaking tables the columns the schema declares, with no lab settings row (0039, 0040)', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client);
    for (const table of [schema.labs, schema.labSubmissions, schema.labListenEvents, schema.labSettings, schema.speakingSubmissions]) {
      const config = getTableConfig(table);
      expect(columnsOf(test.sqlite, config.name)).toEqual(config.columns.map((c) => c.name).sort());
    }
    expect(indexesOf(test.sqlite, 'lab_listen_events')).toContain('idx_lab_listen_events_user_at');
    expect(indexesOf(test.sqlite, 'speaking_submissions')).toContain('idx_speaking_submissions_sha');
    // No seed: unit tests see the code defaults.
    expect(test.sqlite.prepare('SELECT count(*) AS n FROM lab_settings').get()).toEqual({ n: 0 });
    // The same column defaults as the migration.
    await test.db.insert(schema.users).values({ googleId: 's', email: 's@example.com', name: 'Student' });
    const [lab] = await test.db.insert(schema.labs).values({
      title: 'L', audioUrl: '/api/assets/x.mp3', mimeType: 'audio/mpeg', durationMs: 1, requiredThroughMs: 1, createdBy: 1,
    }).returning();
    test.sqlite.prepare('INSERT INTO lab_submissions (lab_id, user_id, required_through_ms, started_at, submitted_at) VALUES (?, 1, 1, 1, 1)').run(lab.id);
    expect(test.sqlite.prepare('SELECT credit, mic, rejected_answers, late_answers FROM lab_submissions').get())
      .toEqual({ credit: 0, mic: 'on', rejected_answers: 0, late_answers: 0 });
    expect(test.sqlite.prepare('SELECT held_for, mic_stats FROM lab_submissions').get()).toEqual({ held_for: null, mic_stats: null });
    test.sqlite.prepare('INSERT INTO lab_settings (id, updated_at) VALUES (1, 0)').run();
    expect(await test.db.query.labSettings.findFirst()).toEqual({
      id: 1, minAnsweredPct: 75, voicePerPauseMs: 250, updatedAt: new Date(0), gateMarginDb: 6, holdOutsideVoice: false,
    });

    // A reset drops lab_settings with the rest.
    await setupFsrsSchema(test.client, { reset: true });
    expect(test.sqlite.prepare('SELECT count(*) AS n FROM lab_settings').get()).toEqual({ n: 0 });
    await test.client.close();
  });

  it('upgrades a v1.15.3 database (0040): rows keep their values, nothing is held, the saved rule and floor stay', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0039_lab_pauses') });
    for (const [table, column] of [['lab_submissions', 'held_for'], ['lab_settings', 'gate_margin_db'], ['speaking_submissions', 'content_sha256']]) {
      expect(columnsOf(client, table)).not.toContain(column);
    }

    // What v1.15.3 wrote: a saved rule (75%, 0.3 s), a scored lab row that did not count, and a graded speaking take.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 't@example.com', 'Teacher', 'admin', 0), (2, 's', 's@example.com', 'Student', 'user', 0);
      UPDATE lab_settings SET min_answered_pct = 75, voice_per_pause_ms = 300, updated_at = 1790500000000 WHERE id = 1;
      INSERT INTO labs (id, title, audio_url, mime_type, duration_ms, required_through_ms, for_everyone, active, created_by, created_at)
        VALUES (1, 'ES1 Lab semana06', '/api/assets/x.mp3', 'audio/mpeg', 60000, 50000, 1, 1, 1, 0);
      INSERT INTO lab_submissions (id, lab_id, user_id, required_through_ms, voiced_ms, listened_covered_ms, listen_wall_ms, skip_count,
          started_at, submitted_at, mic, pauses_counted, pauses_answered, pause_results, min_answered_pct, voice_per_pause_ms, flags, credit)
        VALUES (1, 1, 2, 50000, 9000, 50100, 50500, 0, 1790500000123, 1790500100, 'on', 2, 1, '[[10000,900],[20000,-1]]', 75, 300, '[]', 0);
      INSERT INTO speaking_tasks (id, title, created_by, created_at) VALUES (1, 'Cuento semana 2', 1, 0);
      INSERT INTO speaking_submissions (id, task_id, user_id, client_key, audio_url, mime_type, size_bytes, duration_ms, voiced_ms,
          submitted_at, grade_score, graded_by, graded_at)
        VALUES (1, 1, 2, 'abcdefgh', '/api/recordings/x.webm', 'audio/webm', 7900, 45000, 45000, 1790500200, 90, 'teacher', 1790500300);
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    for (const table of [schema.labSubmissions, schema.labSettings, schema.speakingSubmissions]) expectTableMatchesSchema(client, table);
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

    // The teacher's rule and floor stay as saved; the room margin is the 6 dB knee, and nothing extra is held.
    expect(await db.query.labSettings.findFirst()).toEqual({
      id: 1, minAnsweredPct: 75, voicePerPauseMs: 300, updatedAt: new Date(1790500000000), gateMarginDb: 6, holdOutsideVoice: false,
    });
    // The lab row is unchanged: still a redo, not held, no mic stats.
    expect(await db.query.labSubmissions.findFirst()).toMatchObject({
      id: 1, credit: false, flags: '[]', pausesAnswered: 1, pauseResults: '[[10000,900],[20000,-1]]', heldFor: null, micStats: null,
    });
    // The speaking take keeps its length, voice and grade; nothing is backfilled.
    expect(await db.query.speakingSubmissions.findFirst()).toMatchObject({
      id: 1, durationMs: 45_000, voicedMs: 45_000, sizeBytes: 7900, gradeScore: 90, gradedBy: 'teacher', ...LEGACY_SPEAKING_CHECK_COLUMNS,
    });

    // Earlier takes with the same audio are found through the new index.
    const plan = client.prepare('EXPLAIN QUERY PLAN SELECT id, user_id FROM speaking_submissions WHERE content_sha256 = ?')
      .all('0'.repeat(64)) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_speaking_submissions_sha');

    // A v1.15.3 server (after a rollback) still writes rows: it names none of the new columns.
    client.prepare(`INSERT INTO lab_submissions (lab_id, user_id, required_through_ms, started_at, submitted_at, flags, credit)
      VALUES (1, 2, 50000, 1790600000456, 1790600100, '[]', 1)`).run();
    client.prepare(`INSERT INTO speaking_submissions (task_id, user_id, client_key, audio_url, mime_type, submitted_at)
      VALUES (1, 2, 'ijklmnop', '/api/recordings/y.webm', 'audio/webm', 1790600200)`).run();
    client.prepare('INSERT INTO lab_settings (id, min_answered_pct, voice_per_pause_ms, updated_at) VALUES (1, 80, 250, 0) ON CONFLICT (id) DO UPDATE SET min_answered_pct = 80').run();
    expect(client.prepare('SELECT held_for, mic_stats FROM lab_submissions WHERE started_at = 1790600000456').get())
      .toEqual({ held_for: null, mic_stats: null });
    expect(client.prepare('SELECT min_answered_pct, gate_margin_db, hold_outside_voice FROM lab_settings').get())
      .toEqual({ min_answered_pct: 80, gate_margin_db: 6, hold_outside_voice: 0 });
    client.close();
  });

  it('stores what v1.16.0 writes on a lab row, the settings and a speaking take, and reads it back as written (0040)', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder });
    await db.insert(schema.users).values([
      { googleId: 't', email: 't@example.com', name: 'Teacher', role: 'admin' },
      { googleId: 's', email: 's@example.com', name: 'Student' },
      { googleId: 'u', email: 'u@example.com', name: 'Another student' },
    ]);
    const [lab] = await db.insert(schema.labs).values({
      title: 'ES1 Lab semana06', audioUrl: '/api/assets/x.mp3', mimeType: 'audio/mpeg', durationMs: 60_000, requiredThroughMs: 50_000, createdBy: 1,
    }).returning();

    // A lab that passed the rule but waits for the teacher, with the page's mic stats.
    const micStats = JSON.stringify({
      meter: 2, ambientDbP50: -52.3, gateDbP50: -46.3, voiceOverGateDbP50: 14.2, levelOnlyAnswered: 2, loudNotVoiceInPausesMs: 1250,
      unfocusedPlayedMs: 0, micCheck: 'voice', processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48_000 },
    });
    const [row] = await db.insert(schema.labSubmissions).values({
      labId: lab.id, userId: 2, requiredThroughMs: 50_000, startedAt: new Date(1), pausesCounted: 2, pausesAnswered: 2,
      flags: '["odd-answers","overlap"]', credit: false, heldFor: '["odd-answers","overlap"]', micStats,
    }).returning();
    expect(row).toMatchObject({ credit: false, creditOverride: null, heldFor: '["odd-answers","overlap"]', micStats });
    // The teacher's decision leaves the hold's reasons on the row.
    await db.update(schema.labSubmissions).set({ creditOverride: true }).run();
    expect(await db.query.labSubmissions.findFirst()).toMatchObject({ creditOverride: true, heldFor: '["odd-answers","overlap"]' });

    // The teacher's settings: an upsert of row 1 (seeded by 0039) with the new floor, margin and hold.
    const saved = { minAnsweredPct: 75, voicePerPauseMs: 200, gateMarginDb: 8, holdOutsideVoice: true };
    await db.insert(schema.labSettings).values({ id: 1, ...saved })
      .onConflictDoUpdate({ target: schema.labSettings.id, set: saved }).run();
    expect(client.prepare('SELECT voice_per_pause_ms, gate_margin_db, hold_outside_voice FROM lab_settings').get())
      .toEqual({ voice_per_pause_ms: 200, gate_margin_db: 8, hold_outside_voice: 1 });
    expect(await db.query.labSettings.findFirst()).toMatchObject({ voicePerPauseMs: 200, gateMarginDb: 8, holdOutsideVoice: true });

    // Speaking: the server's length, the page's claims, the payload hash and the flags. The hash is not unique:
    // a re-posted copy is stored, and flagged, never refused.
    const [task] = await db.insert(schema.speakingTasks).values({ title: 'Cuento semana 2', createdBy: 1 }).returning();
    const sha = 'ab'.repeat(32);
    const [take] = await db.insert(schema.speakingSubmissions).values({
      taskId: task.id, userId: 2, clientKey: 'abcdefgh', audioUrl: '/api/recordings/x.webm', mimeType: 'audio/webm',
      durationMs: 3000, voicedMs: 3000, contentSha256: sha, clientDurationMs: 45_000, clientVoicedMs: 45_000,
      flags: '["length-mismatch"]', micSettings: '{"echoCancellation":false,"noiseSuppression":false,"autoGainControl":false}',
    }).returning();
    expect(take).toMatchObject({
      durationMs: 3000, voicedMs: 3000, contentSha256: sha, clientDurationMs: 45_000, clientVoicedMs: 45_000,
      flags: '["length-mismatch"]', micSettings: '{"echoCancellation":false,"noiseSuppression":false,"autoGainControl":false}',
    });
    await db.insert(schema.speakingSubmissions).values({
      taskId: task.id, userId: 3, clientKey: 'abcdefgh', audioUrl: '/api/recordings/y.webm', mimeType: 'audio/webm',
      contentSha256: sha, flags: '["copied"]',
    });
    const same = await db.select().from(schema.speakingSubmissions).where(eq(schema.speakingSubmissions.contentSha256, sha)).all();
    expect(same.map((s) => [s.userId, s.flags])).toEqual([[2, '["length-mismatch"]'], [3, '["copied"]']]);
    // A take written without the new values (an unreadable file) keeps them NULL.
    const [plain] = await db.insert(schema.speakingSubmissions).values({
      taskId: task.id, userId: 2, clientKey: 'ijklmnop', audioUrl: '/api/recordings/z.webm', mimeType: 'audio/webm',
    }).returning();
    expect(plain).toMatchObject(LEGACY_SPEAKING_CHECK_COLUMNS);
    client.close();
  });

  it('upgrades a v1.17.0 database (0042): rounds keep their state and read as a deck\'s; all-done days are one per student and day', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0041_reserved') });
    expect(columnsOf(client, 'conjugation_rounds')).not.toContain('scope');
    expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'flashcard_all_done'`).get()).toBeUndefined();

    // What v1.17.0 wrote: a round played to its end.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0), (2, 's', '123456@students.school.test', 'Ana', 'user', 0), (3, 's3', '654321@students.school.test', 'Bo', 'user', 0);
      INSERT INTO decks (id, name, created_by, created_at) VALUES (13, 'Unit 1', 1, 0), (14, 'Unit 2', 1, 0);
      INSERT INTO conjugation_rounds (id, user_id, deck_id, started_at, finished_at, queue, prompts, settings_snapshot)
        VALUES (1, 2, 13, 1790500000000, 1790500100000, '[]', 20, '{}');
    `);

    migrate(db, { migrationsFolder });

    for (const table of [schema.conjugationRounds, schema.flashcardAllDone]) expectTableMatchesSchema(client, table);
    expect(unindexedForeignKeys(client, 'flashcard_all_done')).toEqual([]);
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(await db.query.conjugationRounds.findFirst()).toMatchObject({ id: 1, deckId: 13, scope: 'deck', finishedAt: new Date(1790500100000) });

    // A Study all round: scope 'all', its lead deck kept.
    const [all] = await db.insert(schema.conjugationRounds).values({
      userId: 2, deckId: 14, scope: 'all', queue: '[]', prompts: 20, settingsSnapshot: '{}',
    }).returning();
    expect(all).toMatchObject({ scope: 'all', deckId: 14 });

    // All flashcards done: one row per student and school day; gone with the student.
    await db.insert(schema.flashcardAllDone).values({ userId: 2, day: '2026-10-08', completedAt: new Date(1790600000000), deckIds: '[14,13]' });
    await expect(db.insert(schema.flashcardAllDone).values({ userId: 2, day: '2026-10-08', completedAt: new Date(1790600001000), deckIds: '[]' }))
      .rejects.toThrow(/UNIQUE|PRIMARY/);
    await db.insert(schema.flashcardAllDone).values({ userId: 3, day: '2026-10-08', completedAt: new Date(1790600002000), deckIds: '[14,13]' });
    expect(await db.query.flashcardAllDone.findFirst({ where: eq(schema.flashcardAllDone.userId, 2) }))
      .toEqual({ userId: 2, day: '2026-10-08', completedAt: new Date(1790600000000), deckIds: '[14,13]' });
    await db.delete(schema.users).where(eq(schema.users.id, 3));
    expect(client.prepare('SELECT user_id FROM flashcard_all_done').all()).toEqual([{ user_id: 2 }]);

    // A v1.17.0 server (after a rollback) still writes: it names none of the new columns.
    client.prepare(`INSERT INTO conjugation_rounds (user_id, deck_id, started_at, queue, prompts, settings_snapshot) VALUES (2, 13, 0, '[]', 20, '{}')`).run();
    expect(client.prepare('SELECT scope FROM conjugation_rounds ORDER BY id DESC LIMIT 1').get()).toEqual({ scope: 'deck' });
    client.close();
  });

  it('gives the tests\' hand-written tables what 0042 adds: the round scope, flashcard_all_done', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    for (const table of [schema.conjugationRounds, schema.flashcardAllDone]) {
      expectTableMatchesSchema(test.sqlite, table);
    }
    expect(unindexedForeignKeys(test.sqlite, 'flashcard_all_done')).toEqual([]);
    await test.client.close();
  });

  it('upgrades a v1.19.0 settings row (0044): mnemonics stay on OpenAI, no Anthropic key, the OpenAI models and key untouched', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0043_exam_labs') });
    expect(columnsOf(client, 'app_settings')).not.toContain('anthropic_api_key');

    // An upgraded v1.19.0 settings row: an OpenAI model for both features and an encrypted OpenAI key.
    const openaiKey = 'enc:v1:aXYtaXYtaXYtaXY:dGFnLXRhZy10YWctdGFn:cGF5bG9hZA';
    client.prepare(`INSERT INTO app_settings (id, ai_enabled, openai_api_key, ai_cognate_model, ai_mnemonic_model, ai_tts_provider, created_at, updated_at)
      VALUES (1, 1, ?, 'gpt-5.6-luna', 'gpt-5.6-luna', 'elevenlabs', 1790500000, 1790500000)`).run(openaiKey);

    migrate(db, { migrationsFolder });

    expectTableMatchesSchema(client, schema.appSettings);
    // Three columns, not four: the Claude cognate model was taken out before v1.20.0 shipped.
    expect(columnsOf(client, 'app_settings').filter((c) => /anthropic|text_provider/.test(c)))
      .toEqual(['ai_anthropic_mnemonic_model', 'ai_text_provider', 'anthropic_api_key']);
    expect(await db.query.appSettings.findFirst()).toMatchObject({
      aiEnabled: true,
      openaiApiKey: openaiKey,
      // Deprecated, and kept as it was.
      aiCognateModel: 'gpt-5.6-luna',
      aiMnemonicModel: 'gpt-5.6-luna',
      aiTtsProvider: 'elevenlabs',
      anthropicApiKey: null,
      aiTextProvider: 'openai',
      aiAnthropicMnemonicModel: 'claude-opus-5-5',
      updatedAt: new Date(1790500000 * 1000), // app_settings stores seconds
    });

    // A v1.19.0 server (after a rollback) still writes: it names none of the new columns.
    client.prepare(`UPDATE app_settings SET ai_mnemonic_model = 'gpt-5.5', updated_at = 0 WHERE id = 1`).run();
    expect(client.prepare('SELECT ai_text_provider, ai_anthropic_mnemonic_model FROM app_settings').get())
      .toEqual({ ai_text_provider: 'openai', ai_anthropic_mnemonic_model: 'claude-opus-5-5' });
    client.close();
  });

  it('gives the tests\' hand-written app_settings table the columns the schema declares, with the 0044 defaults', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    expectTableMatchesSchema(test.sqlite, schema.appSettings);
    test.sqlite.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
    expect(await test.db.query.appSettings.findFirst()).toMatchObject({
      anthropicApiKey: null,
      aiTextProvider: 'openai',
      aiAnthropicMnemonicModel: 'claude-opus-5-5',
    });
    await test.client.close();
  });

  it('upgrades v1.19.0 mnemonic suggestions (0044): every row kept as it was, none rejected, all read as keywords', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0043_exam_labs') });
    expect(columnsOf(client, 'ai_mnemonics')).not.toContain('rejected_at');
    expect(columnsOf(client, 'ai_mnemonics')).not.toContain('style');

    // What v1.19.0 left: an approved suggestion on the card and one still waiting.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES (1, 't', 't@example.com', 'Teacher', 'admin', 0);
      INSERT INTO decks (id, name, created_by, created_at) VALUES (1, 'U1', 1, 0);
      INSERT INTO cards (id, deck_id, front, back, mnemonic, created_at) VALUES (1, 1, 'tengo', 'I have', 'TEN GOats', 0);
      INSERT INTO ai_mnemonics (id, card_id, user_id, provider, text, source_prompt, accepted, accepted_at, created_at) VALUES
        (1, 1, 1, 'openai', 'TEN GOats', 'tengo → I have', 1, 1790500000000, 1790500000000),
        (2, 1, 1, 'openai', 'waiting', 'tengo → I have', 0, NULL, 1790500001000);
    `);

    migrate(db, { migrationsFolder });

    expectTableMatchesSchema(client, schema.aiMnemonics);
    expect(client.prepare('SELECT id, text, accepted, rejected_at, style FROM ai_mnemonics ORDER BY id').all()).toEqual([
      { id: 1, text: 'TEN GOats', accepted: 1, rejected_at: null, style: null },
      { id: 2, text: 'waiting', accepted: 0, rejected_at: null, style: null },
    ]);
    expect(client.prepare('SELECT mnemonic FROM cards').get()).toEqual({ mnemonic: 'TEN GOats' });

    // A v1.19.0 server (after a rollback) still inserts: it names neither new column.
    client.prepare(`INSERT INTO ai_mnemonics (card_id, user_id, provider, text, source_prompt, accepted, created_at)
      VALUES (1, 1, 'openai', 'after rollback', 'p', 0, 0)`).run();
    expect(client.prepare(`SELECT rejected_at, style FROM ai_mnemonics WHERE text = 'after rollback'`).get())
      .toEqual({ rejected_at: null, style: null });

    // And v1.20.0 writes both.
    const [row] = await db.insert(schema.aiMnemonics).values({
      cardId: 1, userId: 1, provider: 'anthropic', text: 'Quiero, PERO no puedo', sourcePrompt: 'p', style: 'sentence', rejectedAt: new Date(1790500002000),
    }).returning();
    expect(row).toMatchObject({ style: 'sentence', rejectedAt: new Date(1790500002000), accepted: false });
    client.close();
  });

  it('gives the tests\' hand-written ai_mnemonics table the columns and index the schema declares (0044)', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    expectTableMatchesSchema(test.sqlite, schema.aiMnemonics);
    await test.client.close();
  });

  describe('the cognate system: deprecated in v1.20.0, not dropped (drizzle/DEPRECATED.md)', () => {
    const DEPRECATED = {
      cards: ['cognate_score'],
      user_settings: ['show_cognate_score', 'show_cognate_score_locked'],
      group_settings: ['show_cognate_score', 'show_cognate_score_locked'],
      deck_user_settings: ['show_cognate_score'],
      app_settings: ['ai_cognate_enabled', 'ai_cognate_model'],
      card_ai_state: ['cognate_score', 'false_friend_dismissed', 'last_generated_at', 'last_regression_at', 'mnemonic_enabled'],
    };

    /** Every migration, with a card scored, studied and dismissed as a false friend before v1.20.0. */
    function migratedWithCognateData(): Sqlite {
      const client = new Database(':memory:');
      migrate(drizzle(client, { schema }), { migrationsFolder });
      client.exec(`
        INSERT INTO users (id, google_id, email, name, role, created_at) VALUES (1, 'a', 'a@example.com', 'Ana', 'user', 0);
        INSERT INTO decks (id, name, created_by, created_at) VALUES (1, 'U1', 1, 0);
        INSERT INTO cards (id, deck_id, front, back, cognate_score, created_at) VALUES (1, 1, 'nación', 'nation', 0.93, 0);
        INSERT INTO card_states (id, card_id, user_id, next_review) VALUES (1, 1, 1, 0);
        INSERT INTO review_logs (card_id, user_id, rating, reviewed_at, time_spent_ms, previous_state, new_state) VALUES (1, 1, 3, 0, 1000, 0, 1);
        INSERT INTO user_settings (user_id, created_at, updated_at) VALUES (1, 0, 0);
        INSERT INTO deck_user_settings (user_id, deck_id, mnemonic_mode, created_at, updated_at) VALUES (1, 1, 'auto-non-cognate', 0, 0);
        INSERT INTO card_ai_state (card_id, user_id, cognate_score, false_friend_dismissed) VALUES (1, 1, 0.93, 1);
      `);
      return client;
    }

    it('keeps every column, the table and its data, as the schema still declares them', () => {
      const client = migratedWithCognateData();
      for (const [table, columns] of Object.entries(DEPRECATED)) {
        expect(columnsOf(client, table), table).toEqual(expect.arrayContaining(columns));
      }
      expectTableMatchesSchema(client, schema.cardAiState);
      expect(client.prepare('SELECT cognate_score FROM cards').get()).toEqual({ cognate_score: 0.93 });
      // The SQL default is still the legacy mode; the code maps it (services/mnemonicMode.ts).
      expect(client.prepare('SELECT mnemonic_mode FROM user_settings').get()).toEqual({ mnemonic_mode: 'auto-non-cognate' });
      client.close();
    });

    it('drops them with the SQL DEPRECATED.md gives, keeping every card state and review', () => {
      const doc = readFileSync(join(migrationsFolder, 'DEPRECATED.md'), 'utf8');
      const block = /```sql\n([\s\S]*?)```/.exec(doc)?.[1];
      expect(block).toBeTruthy();
      const client = migratedWithCognateData();

      // As drizzle's migrator would run it: one transaction, foreign keys on.
      expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
      client.transaction(() => {
        for (const statement of block!.split('--> statement-breakpoint')) client.exec(statement);
      })();

      for (const [table, columns] of Object.entries(DEPRECATED)) {
        if (table === 'card_ai_state') continue;
        expect(columnsOf(client, table).filter((c) => columns.includes(c)), table).toEqual([]);
      }
      expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'card_ai_state'`).get()).toBeUndefined();
      expect(client.prepare('SELECT count(*) AS n FROM card_states').get()).toEqual({ n: 1 });
      expect(client.prepare('SELECT count(*) AS n FROM review_logs').get()).toEqual({ n: 1 });
      expect(client.prepare('SELECT mnemonic_mode FROM user_settings UNION ALL SELECT mnemonic_mode FROM deck_user_settings').all())
        .toEqual([{ mnemonic_mode: 'manual' }, { mnemonic_mode: 'manual' }]);
      expect(client.pragma('foreign_key_check')).toEqual([]);
      client.close();
    });
  });
  it('upgrades a v1.18 database to exam labs (0043): every lab stays practice, the one start is unique per set and student', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0042_study_all') });
    expect(columnsOf(client, 'labs')).not.toContain('exam_set');
    expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'lab_exam_starts'`).get()).toBeUndefined();

    // What v1.18.0 wrote: a lab, a turned-in session and its listening log.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 't@example.com', 'Teacher', 'admin', 0), (2, 's', 's@example.com', 'Student', 'user', 0),
        (3, 's3', 'b@example.com', 'Bo', 'user', 0);
      INSERT INTO labs (id, title, audio_url, mime_type, duration_ms, required_through_ms, for_everyone, active, created_by, created_at)
        VALUES (1, 'Examen U2 · Escucha · Forma A', '/api/assets/x.mp3', 'audio/mpeg', 100000, 95000, 1, 1, 1, 0);
      INSERT INTO lab_submissions (id, lab_id, user_id, required_through_ms, voiced_ms, listened_covered_ms, listen_wall_ms, skip_count,
          started_at, submitted_at, mic, min_answered_pct, voice_per_pause_ms, flags, credit)
        VALUES (1, 1, 2, 95000, 9000, 95100, 96000, 0, 1790500000123, 1790500100, 'on', 0, 250, '[]', 1);
      INSERT INTO lab_listen_events (lab_id, user_id, session_started_at, kind, position_ms, client_ms, at, rules) VALUES
        (1, 2, 1790500000123, 'open', 0, 0, 1790500000200, '{"v":1,"pauses":null,"pct":0,"floor":250,"requiredThroughMs":95000}'),
        (1, 2, 1790500000123, 'play', 0, 5000, 1790500005400, NULL),
        (1, 2, 1790500000123, 'end', 95100, 101000, 1790500101000, NULL);
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    for (const table of [schema.labs, schema.labSubmissions, schema.labListenEvents, schema.labExamStarts]) {
      expectTableMatchesSchema(client, table);
    }
    expect(unindexedForeignKeys(client, 'lab_exam_starts')).toEqual([]);
    // Exam is off for every existing lab and submission, and nobody has a start.
    expect(await db.query.labs.findFirst()).toMatchObject({ id: 1, examSet: null, active: true });
    expect(await db.query.labSubmissions.findFirst()).toMatchObject({ id: 1, examSet: null, credit: true, mic: 'on' });
    expect(client.prepare('SELECT count(*) AS n FROM lab_exam_starts').get()).toEqual({ n: 0 });
    expect(client.prepare('SELECT count(*) AS n FROM lab_listen_events').get()).toEqual({ n: 3 });

    // The lab becomes a form of set U2, and a student's start is counted.
    await db.update(schema.labs).set({ examSet: 'U2' }).run();
    const start = {
      examSet: 'U2', userId: 2, labId: 1, labTitle: 'Examen U2 · Escucha · Forma A',
      sessionStartedAt: 1790500000123, startedAt: 1790500000123, source: 'past' as const,
    };
    const [first] = await db.insert(schema.labExamStarts).values(start).returning();
    expect(first).toEqual({ id: first.id, ...start, resetAt: null, resetBy: null });
    // A second live start for the same set and student is refused by the index…
    await expect(db.insert(schema.labExamStarts).values({ ...start, sessionStartedAt: 1790600000000, startedAt: 1790600000000, source: 'start' }))
      .rejects.toThrow(/UNIQUE/);
    // …another set, or another student, is not.
    await db.insert(schema.labExamStarts).values({ ...start, examSet: 'U3' });
    await db.insert(schema.labExamStarts).values({ ...start, userId: 3 });
    // A start defaults to 'start'; once the first is reset, the next one is accepted, and the old row stays.
    await db.update(schema.labExamStarts).set({ resetAt: 1790700000000, resetBy: 1 }).where(eq(schema.labExamStarts.id, first.id)).run();
    const [again] = await db.insert(schema.labExamStarts).values({
      examSet: 'U2', userId: 2, labId: 1, labTitle: 'Examen U2 · Escucha · Forma A', sessionStartedAt: 1790800000000, startedAt: 1790800000500,
    }).returning();
    expect(again).toMatchObject({ source: 'start', resetAt: null, resetBy: null });
    expect(client.prepare('SELECT count(*) AS n FROM lab_exam_starts WHERE exam_set = ? AND user_id = 2').get('U2')).toEqual({ n: 2 });
    // The student's start in the set is found through the new indexes.
    const plan = client.prepare('EXPLAIN QUERY PLAN SELECT id FROM lab_exam_starts WHERE exam_set = ? AND user_id = ? AND reset_at IS NULL')
      .all('U2', 2) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/uq_lab_exam_starts_live|idx_lab_exam_starts_user/);

    // Deleting the lab keeps every start (the form's title stays) and takes its submissions and log, as before.
    await db.delete(schema.labs).where(eq(schema.labs.id, 1));
    expect(client.prepare('SELECT DISTINCT lab_id, lab_title FROM lab_exam_starts').all())
      .toEqual([{ lab_id: null, lab_title: 'Examen U2 · Escucha · Forma A' }]);
    expect(client.prepare('SELECT count(*) AS n FROM lab_exam_starts').get()).toEqual({ n: 4 });
    expect(client.prepare('SELECT count(*) AS n FROM lab_submissions').get()).toEqual({ n: 0 });
    // Deleting a student takes their starts.
    await db.delete(schema.users).where(eq(schema.users.id, 3));
    expect(client.prepare('SELECT DISTINCT user_id FROM lab_exam_starts').all()).toEqual([{ user_id: 2 }]);
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

    // A v1.18.0 server (after a rollback) still writes: it names none of the new columns.
    client.exec(`
      INSERT INTO labs (id, title, audio_url, mime_type, duration_ms, required_through_ms, for_everyone, active, created_by, created_at)
        VALUES (2, 'ES1 Lab semana07', '/api/assets/y.mp3', 'audio/mpeg', 60000, 50000, 1, 1, 1, 0);
      INSERT INTO lab_submissions (lab_id, user_id, required_through_ms, started_at, submitted_at, flags, credit)
        VALUES (2, 2, 50000, 1790900000456, 1790900100, '[]', 1);
    `);
    expect(client.prepare('SELECT l.exam_set AS lab, s.exam_set AS submission FROM labs l JOIN lab_submissions s ON s.lab_id = l.id').get())
      .toEqual({ lab: null, submission: null });
    client.close();
  });

  it('gives the tests\' hand-written tables what 0043 adds: the exam set columns and lab_exam_starts', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    for (const table of [schema.labs, schema.labSubmissions, schema.labExamStarts]) {
      const config = getTableConfig(table);
      expect(columnsOf(test.sqlite, config.name)).toEqual(config.columns.map((c) => c.name).sort());
    }
    expectTableMatchesSchema(test.sqlite, schema.labExamStarts);
    expect(indexesOf(test.sqlite, 'labs')).toContain('idx_labs_exam_set');
    expect(unindexedForeignKeys(test.sqlite, 'lab_exam_starts')).toEqual([]);
    await test.db.insert(schema.users).values({ googleId: 's', email: 's@example.com', name: 'Student' });
    const row = { examSet: 'U3', userId: 1, labId: null, labTitle: 'Forma A', sessionStartedAt: 1, startedAt: 2 };
    await test.db.insert(schema.labExamStarts).values(row);
    await expect(test.db.insert(schema.labExamStarts).values(row)).rejects.toThrow(/UNIQUE/);
    // A reset drops lab_exam_starts with the rest.
    await setupFsrsSchema(test.client, { reset: true });
    expect(test.sqlite.prepare('SELECT count(*) AS n FROM lab_exam_starts').get()).toEqual({ n: 0 });
    await test.client.close();
  });

  it('upgrades a v1.20 database to speaking tests (0045): every task stays practice, its recordings intact', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0044_anthropic_key') });
    expect(columnsOf(client, 'speaking_tasks')).not.toContain('exam_set');

    // An upgraded database: an ordinary active task named as a test, and a graded take on it.
    const sha = 'a'.repeat(64);
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 't@example.com', 'Teacher', 'admin', 0), (2, 's', 's@example.com', 'Student', 'user', 0);
      INSERT INTO speaking_tasks (id, title, instructions, show_reference, target_seconds, for_everyone, active, created_by, created_at)
        VALUES (3, 'Examen U2 · Expresión oral', 'Habla de tu familia.', 0, 60, 1, 1, 1, 1790500000);
      INSERT INTO speaking_submissions (id, task_id, user_id, client_key, audio_url, mime_type, size_bytes, duration_ms, voiced_ms,
          submitted_at, grade_score, graded_by, graded_at, content_sha256, flags)
        VALUES (1, 3, 2, 'abcdefgh', '/api/recordings/x.webm', 'audio/webm', 7900, 45000, 40000, 1790500200, 90, 'teacher', 1790500300,
          '${sha}', '[]');
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    for (const table of [schema.speakingTasks, schema.speakingTaskGroups, schema.speakingSubmissions]) {
      expectTableMatchesSchema(client, table);
    }
    // Practice until the teacher names a set: the task reads as before, with no exam set.
    expect(await db.query.speakingTasks.findFirst()).toEqual({
      id: 3, title: 'Examen U2 · Expresión oral', instructions: 'Habla de tu familia.', referenceText: null, showReference: false,
      modelAudioUrl: null, targetSeconds: 60, forEveryone: true, active: true, createdBy: 1, createdAt: new Date(1790500000 * 1000),
      examSet: null,
    });
    // The take is untouched.
    expect(await db.query.speakingSubmissions.findFirst()).toMatchObject({
      id: 1, taskId: 3, userId: 2, durationMs: 45_000, voicedMs: 40_000, sizeBytes: 7900, gradeScore: 90, gradedBy: 'teacher',
      contentSha256: sha, flags: '[]',
    });

    // A v1.20.1 server (after a rollback) still writes: it names no exam_set.
    client.prepare(`INSERT INTO speaking_tasks (id, title, created_by, created_at) VALUES (4, 'Cuento semana 9', 1, 1790600000)`).run();
    // The teacher makes task 3 a speaking test of set U2.
    await db.update(schema.speakingTasks).set({ examSet: 'U2' }).where(eq(schema.speakingTasks.id, 3)).run();
    expect(client.prepare('SELECT id, exam_set FROM speaking_tasks ORDER BY id').all())
      .toEqual([{ id: 3, exam_set: 'U2' }, { id: 4, exam_set: null }]);
    expect(client.prepare('SELECT count(*) AS n FROM speaking_submissions WHERE task_id = 3').get()).toEqual({ n: 1 });
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    client.close();
  });

  it('gives the tests\' hand-written speaking_tasks table the exam set column (0045)', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    const config = getTableConfig(schema.speakingTasks);
    expect(columnsOf(test.sqlite, config.name)).toEqual(config.columns.map((c) => c.name).sort());
    await test.db.insert(schema.users).values({ googleId: 't', email: 't@example.com', name: 'Teacher', role: 'admin' });
    const [task] = await test.db.insert(schema.speakingTasks).values({ title: 'Cuento', createdBy: 1 }).returning();
    expect(task.examSet).toBeNull();
    await test.client.close();
  });

  it('upgrades a v1.21 database to PIN sign-in (0046): settings read auto, PINs go with their student', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0045_tests_tab') });
    expect(columnsOf(client, 'app_settings')).not.toContain('pin_login_mode');
    expect(client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_pins'").get()).toBeUndefined();

    // An upgraded database has: the settings row, the teacher and students.
    client.exec(`
      INSERT INTO app_settings (id, ai_enabled, ai_text_provider, created_at, updated_at) VALUES (1, 1, 'openai', 1790500000, 1790500000);
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0),
        (2, 's2', '123456@students.school.test', 'Ana', 'user', 0),
        (3, 's3', '654321@students.school.test', 'Beto', 'user', 0);
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    expectTableMatchesSchema(client, schema.userPins);
    expectTableMatchesSchema(client, schema.appSettings);
    expect(unindexedForeignKeys(client, 'user_pins')).toEqual([]);
    // The saved settings are as they were, and PIN sign-in starts in auto.
    expect(await db.query.appSettings.findFirst()).toMatchObject({ aiEnabled: true, pinLoginMode: 'auto', updatedAt: new Date(1790500000 * 1000) });
    // A v1.21.1 server (after a rollback) still writes: it names no pin_login_mode.
    client.prepare(`INSERT INTO app_settings (id, ai_enabled, ai_text_provider, created_at, updated_at) VALUES (2, 0, 'openai', 0, 0)`).run();
    expect(client.prepare('SELECT id, pin_login_mode FROM app_settings ORDER BY id').all())
      .toEqual([{ id: 1, pin_login_mode: 'auto' }, { id: 2, pin_login_mode: 'auto' }]);

    // A PIN row as v1.22.0 writes it, read back as written; it goes when its student does.
    const made = new Date(1790600000123);
    await db.insert(schema.userPins).values({ userId: 2, pinHash: 'a'.repeat(64), pinSalt: 'b'.repeat(32), createdAt: made, updatedAt: made }).run();
    await db.insert(schema.userPins).values({ userId: 3, pinHash: 'c'.repeat(64), pinSalt: 'd'.repeat(32), createdAt: made, updatedAt: made }).run();
    expect(await db.query.userPins.findFirst({ where: eq(schema.userPins.userId, 2) })).toEqual({
      userId: 2, pinHash: 'a'.repeat(64), pinSalt: 'b'.repeat(32), createdAt: made, updatedAt: made,
      failedCount: 0, lockedUntil: null, lockLevel: 0, lastUsedAt: null,
    });
    expect(client.prepare('SELECT created_at FROM user_pins WHERE user_id = 2').get()).toEqual({ created_at: 1790600000123 });
    await db.delete(schema.users).where(eq(schema.users.id, 2)).run();
    expect(client.prepare('SELECT user_id FROM user_pins').all()).toEqual([{ user_id: 3 }]);
    expect(() => client.prepare(`INSERT INTO user_pins (user_id, pin_hash, pin_salt, created_at, updated_at) VALUES (99, 'x', 'y', 0, 0)`).run())
      .toThrow(/FOREIGN KEY/);
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    client.close();
  });

  it('adds the transcription switch (0049): on only where an install already has a "repeat the sentence" test', () => {
    const upgrade = (withEiTest: boolean) => {
      const client = new Database(':memory:');
      const db = drizzle(client, { schema });
      // Production's state before v1.25.0 (at 0047): 0048 and 0049 run together.
      migrate(db, { migrationsFolder: migrationsThrough('0047_subject_shown') });
      expect(columnsOf(client, 'app_settings')).not.toContain('ai_transcription_enabled');
      client.exec(`
        INSERT INTO app_settings (id, ai_enabled, ai_text_provider, created_at, updated_at) VALUES (1, 1, 'openai', 1790500000, 1790500000);
        INSERT INTO users (id, google_id, email, name, role, created_at) VALUES (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0);
        INSERT INTO vocab_tests (name, mode, settings_json, is_open, created_by, created_at)
          VALUES ('Tamaño', 'size', '{}', 1, 1, 0)${withEiTest ? ", ('Imitación', 'ei', '{}', 0, 1, 0)" : ''};
      `);
      migrate(db, { migrationsFolder });
      expectTableMatchesSchema(client, schema.appSettings);
      const row = client.prepare('SELECT ai_transcription_enabled AS on_, ai_enabled, updated_at FROM app_settings WHERE id = 1').get();
      client.close();
      return row;
    };
    // The settings are otherwise untouched (updated_at too).
    expect(upgrade(true)).toEqual({ on_: 1, ai_enabled: 1, updated_at: 1790500000 });
    expect(upgrade(false)).toEqual({ on_: 0, ai_enabled: 1, updated_at: 1790500000 });

    // A fresh install: no row at migration time; the row made later starts off.
    const fresh = new Database(':memory:');
    migrate(drizzle(fresh, { schema }), { migrationsFolder });
    fresh.prepare("INSERT INTO app_settings (id, ai_text_provider, created_at, updated_at) VALUES (1, 'openai', 0, 0)").run();
    expect(fresh.prepare('SELECT ai_transcription_enabled AS on_ FROM app_settings').get()).toEqual({ on_: 0 });
    fresh.close();
  });

  it('gives the tests\' hand-written DB user_pins and app_settings.pin_login_mode as the schema declares them (0046)', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    expectTableMatchesSchema(test.sqlite, schema.userPins);
    expectTableMatchesSchema(test.sqlite, schema.appSettings);
    test.sqlite.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
    expect(await test.db.query.appSettings.findFirst()).toMatchObject({ pinLoginMode: 'auto' });
    await test.db.insert(schema.users).values({ id: 2, googleId: 's', email: '123456@students.school.test', name: 'Ana' });
    await test.db.insert(schema.userPins).values({ userId: 2, pinHash: 'a'.repeat(64), pinSalt: 'b'.repeat(32) });
    expect(await test.db.query.userPins.findFirst()).toMatchObject({ userId: 2, failedCount: 0, lockLevel: 0, lockedUntil: null, lastUsedAt: null });
    await test.db.delete(schema.users).where(eq(schema.users.id, 2));
    expect(test.sqlite.prepare('SELECT count(*) AS n FROM user_pins').get()).toEqual({ n: 0 });
    // A reset drops user_pins with the rest.
    await test.db.insert(schema.users).values({ id: 3, googleId: 't', email: '654321@students.school.test', name: 'Beto' });
    await test.db.insert(schema.userPins).values({ userId: 3, pinHash: 'a'.repeat(64), pinSalt: 'b'.repeat(32) });
    await setupFsrsSchema(test.client, { reset: true });
    expect(test.sqlite.prepare('SELECT count(*) AS n FROM user_pins').get()).toEqual({ n: 0 });
    await test.client.close();
  });
  it('upgrades a v1.23 database to the short person cue (0047): old answers have no subject, new ones keep it', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0046_pin_login') });
    expect(columnsOf(client, 'conjugation_answers')).not.toContain('subject_shown');

    // An upgraded database has: a student's round with an answer as v1.23.0 wrote it.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0),
        (2, 's2', '123456@students.school.test', 'Ana', 'user', 0);
      INSERT INTO decks (id, name, created_by, created_at) VALUES (1, 'U3L2', 1, 0);
      INSERT INTO conjugation_rounds (id, user_id, deck_id, started_at, queue, prompts, settings_snapshot) VALUES (1, 2, 1, 0, '[]', 20, '{}');
      INSERT INTO conjugation_answers (round_id, user_id, deck_id, item_key, level_kind, given, result, at)
        VALUES (1, 2, 1, 'tener|present|ellos|-|to', 'choice', 'tienen', 'correct', 1790500000000);
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    expectTableMatchesSchema(client, schema.conjugationAnswers);
    // The answer from before reads as it was, with no subject.
    expect(await db.query.conjugationAnswers.findFirst()).toMatchObject({ itemKey: 'tener|present|ellos|-|to', given: 'tienen', subjectShown: null });
    // A v1.24.0 answer keeps the subject its prompt showed.
    await db.insert(schema.conjugationAnswers).values({
      roundId: 1, userId: 2, deckId: 1, itemKey: 'tener|present|ellos|-|to', levelKind: 'typed-lenient', given: 'tienen', result: 'correct',
      subjectShown: 'ustedes',
    }).run();
    // A v1.23.0 server (after a rollback) still writes: it names no subject_shown.
    client.prepare(`INSERT INTO conjugation_answers (round_id, user_id, deck_id, item_key, level_kind, given, result, at)
      VALUES (1, 2, 1, 'tener|present|el|-|to', 'choice', 'tiene', 'correct', 1790500000001)`).run();
    expect(client.prepare('SELECT item_key, subject_shown FROM conjugation_answers ORDER BY id').all()).toEqual([
      { item_key: 'tener|present|ellos|-|to', subject_shown: null },
      { item_key: 'tener|present|ellos|-|to', subject_shown: 'ustedes' },
      { item_key: 'tener|present|el|-|to', subject_shown: null },
    ]);
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    client.close();
  });

  it('upgrades a v1.24 database to sentences with a blank (0048): decks stay on the label, old answers show no sentence', async () => {
    const client = new Database(':memory:');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsThrough('0047_subject_shown') });
    expect(columnsOf(client, 'deck_conjugation')).not.toContain('sentences');
    expect(client.prepare(`SELECT name FROM sqlite_master WHERE name = 'conjugation_sentences'`).get()).toBeUndefined();

    // An upgraded database has: a deck with its quiz on, a student's round and an answer as v1.24.0 wrote them.
    client.exec(`
      INSERT INTO users (id, google_id, email, name, role, created_at) VALUES
        (1, 't', 'teacher@school.test', 'Teacher', 'admin', 0),
        (2, 's2', '123456@students.school.test', 'Ana', 'user', 0),
        (3, 't3', 'aide@school.test', 'Aide', 'admin', 0);
      INSERT INTO decks (id, name, created_by, created_at) VALUES (1, 'U3L2', 1, 0);
      INSERT INTO deck_conjugation (deck_id, enabled, updated_at) VALUES (1, 1, 0);
      INSERT INTO conjugation_rounds (id, user_id, deck_id, started_at, queue, prompts, settings_snapshot) VALUES (1, 2, 1, 0, '[]', 20, '{}');
      INSERT INTO conjugation_answers (round_id, user_id, deck_id, item_key, level_kind, given, result, at, subject_shown)
        VALUES (1, 2, 1, 'vivir|present|ellos|-|to', 'choice', 'viven', 'correct', 1790500000000, 'ustedes');
    `);

    migrate(db, { migrationsFolder });

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect((client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(journal.entries.length);
    for (const table of [schema.deckConjugation, schema.conjugationAnswers, schema.conjugationSentences, schema.conjugationSentenceReports]) {
      expectTableMatchesSchema(client, table);
    }
    // The deck keeps the label until the teacher turns sentences on; no holdback, no date.
    expect(await db.query.deckConjugation.findFirst()).toMatchObject({ enabled: true, sentences: 'off', sentenceHoldback: false, sentencesSince: null });
    expect(await db.query.conjugationAnswers.findFirst()).toMatchObject({ subjectShown: 'ustedes', sentenceRef: null, holdbackArm: null, holdbackProbe: false });
    // A v1.24.0 server (after a rollback) still writes: it names none of the new columns.
    client.prepare(`INSERT INTO conjugation_answers (round_id, user_id, deck_id, item_key, level_kind, given, result, at)
      VALUES (1, 2, 1, 'vivir|present|el|-|to', 'choice', 'vive', 'correct', 1790500000001)`).run();
    client.prepare(`INSERT INTO deck_conjugation (deck_id, enabled, updated_at) VALUES (1, 0, 1) ON CONFLICT (deck_id) DO UPDATE SET enabled = 0`).run();
    expect(client.prepare('SELECT sentences, sentence_holdback FROM deck_conjugation').get()).toEqual({ sentences: 'off', sentence_holdback: 0 });

    // A hidden built-in once per deck; a report once per student and sentence; both go with their deck, a report with its student.
    const now = new Date(1790500000000);
    await db.insert(schema.conjugationSentences).values({ deckId: 1, ref: 'tpl:vivir.city/np:mis-primos/city=lima/present', source: 'builtIn', status: 'hidden', createdBy: 3, createdAt: now, updatedAt: now });
    await expect(db.insert(schema.conjugationSentences).values({ deckId: 1, ref: 'tpl:vivir.city/np:mis-primos/city=lima/present', source: 'builtIn', status: 'hidden', createdAt: now, updatedAt: now }))
      .rejects.toThrow(/UNIQUE/);
    await db.insert(schema.conjugationSentenceReports).values({ deckId: 1, userId: 2, sentenceRef: 'tpl:x', itemKey: 'vivir|present|ellos|-|to', sentence: 'Mis primos ___ (vivir) en Lima.', createdAt: now });
    await expect(db.insert(schema.conjugationSentenceReports).values({ deckId: 1, userId: 2, sentenceRef: 'tpl:x', itemKey: 'vivir|present|ellos|-|to', sentence: 'x', createdAt: now }))
      .rejects.toThrow(/UNIQUE/);
    // The teacher who hid it may go: the row stays, without its author.
    await db.delete(schema.users).where(eq(schema.users.id, 3));
    expect(await db.query.conjugationSentences.findFirst()).toMatchObject({ createdBy: null, status: 'hidden' });
    await db.delete(schema.users).where(eq(schema.users.id, 2));
    expect(client.prepare('SELECT count(*) AS n FROM conjugation_sentence_reports').get()).toEqual({ n: 0 });
    await db.delete(schema.decks).where(eq(schema.decks.id, 1));
    expect(client.prepare('SELECT count(*) AS n FROM conjugation_sentences').get()).toEqual({ n: 0 });
    expect(client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    client.close();
  });

  it('gives the tests\' hand-written DDL the sentence columns and tables as the schema declares them (0048)', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    for (const table of [schema.deckConjugation, schema.conjugationAnswers, schema.conjugationSentences, schema.conjugationSentenceReports]) {
      expectTableMatchesSchema(test.sqlite, table);
    }
    await test.client.close();
  });

  it('gives the tests\' hand-written conjugation_answers the subject_shown column as the schema declares it (0047)', async () => {
    const test = createTestDb();
    await setupFsrsSchema(test.client, { reset: true });
    expectTableMatchesSchema(test.sqlite, schema.conjugationAnswers);
    await test.client.close();
  });
});
