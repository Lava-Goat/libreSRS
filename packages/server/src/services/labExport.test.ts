// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

const PERIOD_1 = 1;
const PERIOD_2 = 2;
const HEADER = 'student_name,student_email,lab,status,submitted_at,attempts,heard_through_s,required_through_s,skips,started_at,elapsed_s,voice_s,min_voice_s,pauses_answered,pauses_counted,needed,mic,credit_by,flags,held_for,level_only_answered';
/** 21 pauses every 30 s from 0:20, plus one ending after must-hear-through (it never counts). */
const PAUSES = [...Array.from({ length: 21 }, (_, i) => [20_000 + i * 30_000, 24_000 + i * 30_000]), [656_000, 660_000]];

async function load() {
  return import('./labExport.js');
}

let labCounter = 0;
async function lab(fields: Partial<typeof schema.labs.$inferInsert> = {}) {
  labCounter += 1;
  const [row] = await testDb.insert(schema.labs).values({
    title: `ES1 Lab semana0${labCounter}`,
    audioUrl: `/api/assets/00000000-0000-4000-8000-${String(labCounter).padStart(12, '0')}.mp3`,
    mimeType: 'audio/mpeg',
    durationMs: 700_000,
    requiredThroughMs: 660_000,
    forEveryone: true,
    active: true,
    createdBy: 1,
    ...fields,
  }).returning();
  return row;
}

async function submission(labId: number, userId: number, fields: Partial<typeof schema.labSubmissions.$inferInsert> = {}) {
  const submittedAt = fields.submittedAt ?? new Date('2026-09-25T15:12:00Z');
  const [row] = await testDb.insert(schema.labSubmissions).values({
    labId,
    userId,
    requiredThroughMs: 660_000,
    voicedMs: 95_000,
    listenedCoveredMs: 660_000,
    listenWallMs: 661_000,
    startedAt: new Date(submittedAt.getTime() - 12 * 60_000),
    submittedAt,
    credit: true,
    // As v1.15 writes it (a row without flags is older code's, and counts).
    flags: '[]',
    ...fields,
  }).returning();
  return row;
}

const rowsOf = (csv: string) => csv.split('\n').slice(1);
const cells = (row: string) => row.split(',');

describe('labs CSV', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({ db: testDb, schema }));
    await setupFsrsSchema(client, { reset: true });
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'g-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, googleId: 'g-ana', email: 'ana@example.com', name: 'Ana', role: 'user' },
      { id: 3, googleId: 'g-beto', email: 'beto@example.com', name: 'Beto', role: 'user' },
      { id: 4, googleId: 'g-carla', email: 'carla@example.com', name: 'Carla', role: 'user' },
      { id: 5, googleId: 'g-dani', email: 'dani@example.com', name: 'Dani', role: 'user' },
    ]);
    await testDb.insert(schema.groups).values([{ id: PERIOD_1, name: 'P1' }, { id: PERIOD_2, name: 'P2' }]);
    await testDb.insert(schema.userGroups).values([
      { userId: 1, groupId: PERIOD_1 },
      { userId: 2, groupId: PERIOD_1 },
      { userId: 3, groupId: PERIOD_1 },
      { userId: 4, groupId: PERIOD_1 },
      { userId: 5, groupId: PERIOD_1 },
    ]);
  });

  it('gives each student’s status from their counting row, with the pause columns', async () => {
    const { groupLabsCsv } = await load();
    const l = await lab({ pauses: JSON.stringify(PAUSES) });
    // Ana: a redo, then a scored attempt that counted; the credited one describes her.
    await submission(l.id, 2, {
      submittedAt: new Date('2026-09-24T15:12:00Z'), credit: false, pausesCounted: 21, pausesAnswered: 3, minAnsweredPct: 75, voicePerPauseMs: 250,
    });
    await submission(l.id, 2, {
      submittedAt: new Date('2026-09-25T15:12:00Z'), credit: true, pausesCounted: 21, pausesAnswered: 20, minAnsweredPct: 75, voicePerPauseMs: 250,
      voicedMs: 30_000, flags: '["noisy"]',
    });
    // Beto: scored, not enough, and the teacher gave credit.
    await submission(l.id, 3, {
      credit: false, creditOverride: true, creditOverrideAt: new Date(), creditOverrideBy: 1, pausesCounted: 21, pausesAnswered: 2, minAnsweredPct: 75,
      rejectedAnswers: 5,
    });
    // Carla: no microphone, waiting for the teacher.
    await submission(l.id, 4, { credit: false, mic: 'off', pausesCounted: 21, pausesAnswered: 0, minAnsweredPct: 75, voicedMs: 0 });

    const { csv, rowCount } = groupLabsCsv(PERIOD_1);
    const [header] = csv.split('\n');
    expect(header).toBe(HEADER);
    expect(rowCount).toBe(4);
    expect(rowsOf(csv)).toEqual([
      `"Ana","ana@example.com","${l.title}",done,"2026-09-25T15:12:00.000Z",2,660,660,0,"2026-09-25T15:00:00.000Z",720,30,30,20,21,16,on,auto,"noisy","",`,
      `"Beto","beto@example.com","${l.title}",done,"2026-09-25T15:12:00.000Z",1,660,660,0,"2026-09-25T15:00:00.000Z",720,95,30,2,21,16,on,teacher,"odd-answers","",`,
      `"Carla","carla@example.com","${l.title}",check,"2026-09-25T15:12:00.000Z",1,660,660,0,"2026-09-25T15:00:00.000Z",720,0,30,0,21,16,off,,"no-mic","",`,
      // Missing: measured against the lab as it is now (21 pauses count; the default 75% needs 16).
      `"Dani","dani@example.com","${l.title}",missing,,0,,660,,,,,30,,21,16,,,,,`,
    ]);
    for (const row of rowsOf(csv)) expect(cells(row)).toHaveLength(cells(HEADER).length);
  });

  it('shows a held lab as check, with why it waits, and what the page’s old meter would have counted', async () => {
    const { groupLabsCsv } = await load();
    const l = await lab({ pauses: JSON.stringify(PAUSES) });
    const micStats = JSON.stringify({
      meter: 2, ambientDbP50: -52.5, gateDbP50: -46.5, voiceOverGateDbP50: 9.1, levelOnlyAnswered: 19,
      loudNotVoiceInPausesMs: 1200, unfocusedPlayedMs: 0, micCheck: 'voice', processing: null,
    });
    // Ana: met the rule, held for results the page could not have sent and a second lab at once.
    await submission(l.id, 2, {
      credit: false, pausesCounted: 21, pausesAnswered: 21, minAnsweredPct: 75, flags: '["odd-answers","overlap"]',
      heldFor: '["odd-answers","overlap"]', micStats,
    });
    // Beto: held, and the teacher gave credit.
    await submission(l.id, 3, {
      credit: false, creditOverride: true, pausesCounted: 21, pausesAnswered: 20, minAnsweredPct: 75, flags: '["overlap"]', heldFor: '["overlap"]',
    });
    const rows = rowsOf(groupLabsCsv(PERIOD_1).csv).map(cells);
    expect(rows.slice(0, 2).map((r) => [r[0], r[3], r[17], r[18], r[19], r[20]])).toEqual([
      ['"Ana"', 'check', '', '"odd-answers overlap"', '"odd-answers overlap"', '19'],
      ['"Beto"', 'done', 'teacher', '"overlap"', '"overlap"', ''],
    ]);
    for (const row of rows) expect(row).toHaveLength(cells(HEADER).length);
  });

  it('shows a redo, a redo the teacher asked for, and a row from before the pause rule', async () => {
    const { groupLabsCsv } = await load();
    const l = await lab();
    await submission(l.id, 2, { credit: false, pausesCounted: 21, pausesAnswered: 3, minAnsweredPct: 75 });
    await submission(l.id, 3, { credit: true, creditOverride: false, pausesCounted: 21, pausesAnswered: 20, minAnsweredPct: 75 });
    // Turned in before v1.15.0: credit kept, no pause data, "little speech" as before.
    await submission(l.id, 4, { credit: true, voicedMs: 2_000 });

    const rows = rowsOf(groupLabsCsv(PERIOD_1).csv).map(cells);
    expect(rows.map((r) => [r[0], r[3], r[13], r[14], r[15], r[16], r[17], r[18]])).toEqual([
      ['"Ana"', 'redo', '3', '21', '16', 'on', '', '""'],
      ['"Beto"', 'redo', '20', '21', '16', 'on', '', '""'],
      ['"Carla"', 'done', '', '', '', 'on', 'auto', '"little-speech"'],
      // Unscanned lab: no pause columns for a missing student either.
      ['"Dani"', 'missing', '', '', '', '', '', ''],
    ]);
  });

  it('uses the current share for a missing student, and each row’s own snapshot otherwise', async () => {
    const { groupLabsCsv } = await load();
    await testDb.insert(schema.labSettings).values({ id: 1, minAnsweredPct: 0, voicePerPauseMs: 250, updatedAt: new Date() });
    const l = await lab({ pauses: JSON.stringify(PAUSES), pauseCountUntilMs: 200_000 });
    await submission(l.id, 2, { credit: true, pausesCounted: 21, pausesAnswered: 0, minAnsweredPct: 0 });
    const rows = rowsOf(groupLabsCsv(PERIOD_1).csv).map(cells);
    expect(rows[0].slice(13, 16)).toEqual(['0', '21', '0']);
    // Pauses starting at or after 3:20 don't count now: the six from 0:20 to 2:50 do; at 0% none are needed.
    expect(rows[1].slice(13, 16)).toEqual(['', '6', '0']);
  });

  it('has a row per student per released lab of the group, never the teacher', async () => {
    const { groupLabsCsv } = await load();
    await lab({ title: 'ES1 Lab semana10' });
    await lab({ title: 'ES1 Lab semana2' });
    await lab({ title: 'Hidden and never turned in', active: false });
    const p2 = await lab({ title: 'P2 only', forEveryone: false });
    await testDb.insert(schema.labGroups).values({ labId: p2.id, groupId: PERIOD_2 });
    const hidden = await lab({ title: 'Hidden but turned in', active: false, forEveryone: false });
    await testDb.insert(schema.labGroups).values({ labId: hidden.id, groupId: PERIOD_1 });
    await submission(hidden.id, 3);
    await submission(hidden.id, 1);

    const rows = rowsOf(groupLabsCsv(PERIOD_1).csv).map(cells);
    expect([...new Set(rows.map((r) => r[2]))]).toEqual(['"ES1 Lab semana2"', '"ES1 Lab semana10"', '"Hidden but turned in"']);
    expect(rows.filter((r) => r[2] === '"ES1 Lab semana2"').map((r) => r[0])).toEqual(['"Ana"', '"Beto"', '"Carla"', '"Dani"']);
    expect(groupLabsCsv(PERIOD_2).rowCount).toBe(0);
  });

  it('flags a test (an exam lab, v1.19.0) without No microphone, and practice rows as before', async () => {
    const { groupLabsCsv, labsCsv } = await load();
    const practice = await lab();
    const exam = await lab({ examSet: 'U3' });
    // Practice without a microphone keeps its flag and waits for the teacher.
    await submission(practice.id, 2, { credit: false, mic: 'off', voicedMs: 0, minAnsweredPct: 75 });
    // A test is turned in without a microphone by design: credited, no flag.
    await submission(exam.id, 2, { mic: 'off', voicedMs: 0, minAnsweredPct: 0, examSet: 'U3', flags: '["late"]' });
    await submission(exam.id, 3, { mic: 'off', voicedMs: 0, minAnsweredPct: 0, examSet: 'U3' });

    const rows = rowsOf(groupLabsCsv(PERIOD_1).csv);
    const of = (name: string, title: string) => rows.find((r) => r.startsWith(`"${name}"`) && r.includes(`"${title}"`))!;
    expect(cells(of('Ana', practice.title)).slice(3, 4)).toEqual(['check']);
    expect(of('Ana', practice.title)).toContain(',off,,"no-mic",');
    expect(of('Ana', exam.title)).toContain(',done,');
    expect(of('Ana', exam.title)).toContain(',off,auto,"late",');
    expect(of('Beto', exam.title)).toContain(',off,auto,"",');

    // A caller that names no exam set (older fixtures) reads as practice.
    const withoutSet = { ...await submission(exam.id, 4, { mic: 'off', voicedMs: 0, examSet: 'U3' }), examSet: undefined };
    const { csv } = labsCsv({
      labs: [exam], members: [{ id: 4, name: 'Carla', email: 'carla@example.com' }], submissions: [withoutSet],
      settings: { minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: false },
    });
    expect(rowsOf(csv)[0]).toContain('"no-mic"');
  });

  it('keeps a spreadsheet from running a name or title as a formula', async () => {
    const { csvCell, groupLabsCsv, neutralizeFormula } = await load();
    for (const [raw, safe] of [
      ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
      ['+1', `"'+1"`],
      ['-2+3', `"'-2+3"`],
      ['@SUM(A1)', `"'@SUM(A1)"`],
      ['\tTab', `"'\tTab"`],
      ['\rCR', `"'\rCR"`],
      ['Ana María', '"Ana María"'],
      ['a=b', '"a=b"'],
    ]) {
      expect(csvCell(raw)).toBe(safe);
    }
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(neutralizeFormula('=1')).toBe("'=1");

    await testDb.update(schema.users).set({ name: '=cmd|"/c calc"!A0' }).where((await import('drizzle-orm')).eq(schema.users.id, 2));
    await lab({ title: '@lab' });
    const [first] = rowsOf(groupLabsCsv(PERIOD_1).csv);
    expect(first.startsWith(`"'=cmd|""/c calc""!A0","ana@example.com","'@lab",missing`)).toBe(true);
  });
});
