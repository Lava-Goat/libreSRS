// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabReview from './LabReview';

type Status = 'done' | 'redo' | 'check';
type Reason = 'no-mic' | 'asked' | 'teacher' | 'held' | null;

interface MicStats {
  meter: 2;
  ambientDbP50: number | null;
  gateDbP50: number | null;
  voiceOverGateDbP50: number | null;
  levelOnlyAnswered: number | null;
  loudNotVoiceInPausesMs: number;
  unfocusedPlayedMs: number;
  micCheck: 'voice' | 'level' | null;
  processing: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean } | null;
}

interface Row {
  id: number;
  userId: number;
  studentName: string;
  studentEmail: string;
  isTeacher: boolean;
  attempts: number;
  requiredThroughMs: number;
  voicedMs: number;
  listenedCoveredMs: number;
  listenWallMs: number;
  skipCount: number;
  startedAt: string;
  submittedAt: string;
  elapsedMs: number;
  mic: 'on' | 'off';
  pausesCounted: number | null;
  pausesAnswered: number | null;
  pauseResults: [number, number][] | null;
  rejectedAnswers: number;
  lateAnswers: number;
  minAnsweredPct: number | null;
  voicePerPauseMs: number | null;
  outsideVoicedMs: number | null;
  outsidePlayedMs: number | null;
  credit: boolean;
  creditOverride: boolean | null;
  creditOverrideAt: string | null;
  checkRequestedAt: string | null;
  needed: number | null;
  effectiveCredit: boolean;
  status: Status;
  statusReason: Reason;
  flags: string[];
  heldFor: string[] | null;
  micStats: MicStats | null;
}

// Shared with the trpc mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  lab: {} as Record<string, unknown>,
  submissions: [] as unknown[],
  summary: { byStudent: [] as unknown[], done: 0, redo: 0, check: 0 },
  missing: [] as unknown[] | undefined,
  listenLog: [] as unknown[],
  creditCalls: [] as { submissionIds: number[]; credit: boolean | null }[],
  creditFails: null as string | null,
  invalidated: [] as string[],
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      labs: {
        submissions: { invalidate: async (input: { labId: number }) => { h.invalidated.push(`submissions:${input.labId}`); } },
        adminList: { invalidate: async () => { h.invalidated.push('adminList'); } },
      },
    }),
    labs: {
      submissions: {
        useQuery: () => ({
          data: { lab: h.lab, submissions: h.submissions, summary: h.summary },
          isLoading: false,
          error: null,
        }),
      },
      missing: { useQuery: () => ({ data: h.missing, error: null }) },
      listenLog: { useQuery: () => ({ data: h.listenLog, isLoading: false, error: null }) },
      setCredit: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: { submissionIds: number[]; credit: boolean | null }) => {
            h.creditCalls.push(input);
            if (h.creditFails) throw new Error(h.creditFails);
            return { updated: input.submissionIds.length, rows: [] };
          },
        }),
      },
    },
  },
}));

const pauses: [number, number][] = [[1000, 900], [6000, 1200], [11000, 300], [16000, 250]];

function row(overrides: Partial<Row>): Row {
  const base: Row = {
    id: 1,
    userId: 1,
    studentName: 'Student',
    studentEmail: 'student@example.com',
    isTeacher: false,
    attempts: 1,
    requiredThroughMs: 930_000,
    voicedMs: 45_000,
    listenedCoveredMs: 930_000,
    listenWallMs: 940_000,
    skipCount: 0,
    startedAt: '2026-09-28T15:00:00.000Z',
    submittedAt: '2026-09-28T15:16:00.000Z',
    elapsedMs: 16 * 60_000,
    mic: 'on',
    pausesCounted: 4,
    pausesAnswered: 4,
    pauseResults: pauses,
    rejectedAnswers: 0,
    lateAnswers: 0,
    minAnsweredPct: 75,
    voicePerPauseMs: 250,
    outsideVoicedMs: 20_000,
    outsidePlayedMs: 800_000,
    credit: true,
    creditOverride: null,
    creditOverrideAt: null,
    checkRequestedAt: null,
    needed: 3,
    effectiveCredit: true,
    status: 'done',
    statusReason: null,
    flags: [],
    heldFor: null,
    micStats: null,
  };
  return { ...base, ...overrides };
}

// As the server orders them: by student name, newest first.
const ana = row({ id: 10, userId: 1, studentName: 'Ana' });
const ben = row({
  id: 20, userId: 2, studentName: 'Ben', credit: false, effectiveCredit: false, status: 'redo',
  pausesAnswered: 1, pauseResults: [[1000, 0], [6000, -1], [11000, 100], [16000, 600]],
  rejectedAnswers: 5, flags: ['odd-answers'],
});
const carla = row({
  id: 30, userId: 3, studentName: 'Carla', mic: 'off', credit: false, effectiveCredit: false,
  status: 'check', statusReason: 'no-mic', pausesAnswered: 0, voicedMs: 0, flags: ['no-mic'],
});
const dani = row({
  id: 40, userId: 4, studentName: 'Dani', credit: false, effectiveCredit: false, status: 'check',
  statusReason: 'asked', pausesAnswered: 2, checkRequestedAt: '2026-09-28T15:20:00.000Z',
});
const eva = row({
  id: 50, userId: 5, studentName: 'Eva', credit: false, creditOverride: true, effectiveCredit: true,
  creditOverrideAt: '2026-09-28T18:00:00.000Z', pausesAnswered: 2,
});
const fer = row({
  id: 60, userId: 6, studentName: 'Fer', creditOverride: false, effectiveCredit: false, status: 'redo',
  statusReason: 'teacher', creditOverrideAt: '2026-09-28T18:05:00.000Z', flags: ['overlap', 'constant-sound', 'noisy'],
});
// Turned in before the pause rule: no pause data, credit kept.
const gil = row({
  id: 70, userId: 7, studentName: 'Gil', pausesCounted: null, pausesAnswered: null, pauseResults: null,
  minAnsweredPct: null, voicePerPauseMs: null, needed: null, voicedMs: 20_000, flags: ['little-speech', 'late'],
});
const gilEarlier = row({ ...gil, id: 69, attempts: 2, submittedAt: '2026-09-27T15:16:00.000Z', credit: false, effectiveCredit: false, status: 'redo' });
const teacher = row({ id: 90, userId: 99, studentName: 'Ms. Example', isTeacher: true });

const scannedLab = {
  id: 3,
  title: 'ES1 Lab semana06',
  durationMs: 939_548,
  requiredThroughMs: 930_000,
  minimumVoicedMs: 60_000,
  pauseCount: 4,
  pauseTotal: 4,
  pauseScan: null,
  pauseCountUntilMs: null,
  needsCheck: false,
  settings: { minAnsweredPct: 75, voicePerPauseMs: 250 },
  needed: 3,
};

function standing(r: Row) {
  return {
    userId: r.userId, name: r.studentName, status: r.status, reason: r.statusReason, countingRowId: r.id,
    answered: r.pausesAnswered, counted: r.pausesCounted,
  };
}
function setSubmissions(rows: Row[]) {
  h.submissions = rows;
  // As the server does: each student's newest attempt that counts, else their newest.
  const counting = new Map<number, Row>();
  for (const r of rows) {
    if (r.isTeacher) continue;
    const held = counting.get(r.userId);
    if (!held || (!held.effectiveCredit && r.effectiveCredit)) counting.set(r.userId, r);
  }
  const byStudent = [...counting.values()].map(standing);
  h.summary = {
    byStudent,
    done: byStudent.filter((s) => s.status === 'done').length,
    redo: byStudent.filter((s) => s.status === 'redo').length,
    check: byStudent.filter((s) => s.status === 'check').length,
  };
}

const renderReview = () => render(<LabReview labId={3} onBack={() => {}} />);
const table = () => screen.getByRole('table');
const rowOf = (name: string) => within(table()).getAllByRole('row').find((r) => r.textContent?.startsWith(name))!;
const confirmSpy = vi.spyOn(window, 'confirm');

describe('LabReview', () => {
  beforeEach(() => {
    h.lab = { ...scannedLab };
    setSubmissions([ana, ben, carla, dani, eva, fer, gil, gilEarlier, teacher]);
    h.missing = [{ id: 8, name: 'Hugo', email: 'hugo@example.com', opened: false, started: false, heardThroughMs: null, skips: 0, lastSeenAt: null }];
    h.listenLog = [];
    h.creditCalls.length = 0;
    h.creditFails = null;
    h.invalidated.length = 0;
    confirmSpy.mockReset();
  });
  afterEach(() => confirmSpy.mockReset());

  it('says how labs started from now on are judged: scored, the rule off, not scanned, or no counted pauses', () => {
    const { unmount } = renderReview();
    expect(screen.getByText('Must hear through 15:30 · labs started from now on count with 3 of 4 pauses answered')).toBeInTheDocument();
    unmount();

    h.lab = { ...scannedLab, settings: { minAnsweredPct: 0, voicePerPauseMs: 250 }, needed: 0 };
    const off = renderReview();
    expect(screen.getByText('Must hear through 15:30 · the pause rule is off, so labs started from now on all count')).toBeInTheDocument();
    off.unmount();

    h.lab = { ...scannedLab, pauseCount: null, pauseTotal: null, needed: null };
    const old = renderReview();
    expect(screen.getByText('Must hear through 15:30')).toBeInTheDocument();
    expect(screen.getByText('No pause list yet: this lab uses the old rule (speak for at least 1:00).')).toBeInTheDocument();
    old.unmount();

    h.lab = { ...scannedLab, pauseCount: 0, pauseTotal: 0, needed: 0 };
    renderReview();
    expect(screen.getByText('Must hear through 15:30 · speak for at least 1:00')).toBeInTheDocument();
  });

  it('sums up where the students stand', () => {
    renderReview();
    expect(screen.getByRole('heading', { name: 'Turned in (7)' })).toBeInTheDocument();
    // Done: Ana, Eva (given credit), Gil. Redo: Ben, Fer. Waiting: Carla, Dani.
    expect(screen.getByText('3 done · 2 need a redo · 2 waiting for you')).toBeInTheDocument();
  });

  it('shows each attempt’s pauses and result, with the teacher’s decisions', () => {
    renderReview();

    expect(within(rowOf('Ana')).getByText('4 of 4')).toBeInTheDocument();
    expect(within(rowOf('Ana')).getByText('Done')).toBeInTheDocument();

    expect(within(rowOf('Ben')).getByText('1 of 4')).toBeInTheDocument();
    expect(within(rowOf('Ben')).getByText('Needs redo')).toBeInTheDocument();

    expect(within(rowOf('Carla')).getByText('Check it')).toBeInTheDocument();
    expect(within(rowOf('Carla')).getByText('No microphone', { selector: 'div' })).toBeInTheDocument();
    expect(within(rowOf('Dani')).getByText("Says the mic didn't hear them")).toBeInTheDocument();

    expect(within(rowOf('Eva')).getByText('Done')).toBeInTheDocument();
    expect(within(rowOf('Eva')).getByText(/^You gave credit · /)).toBeInTheDocument();
    expect(within(rowOf('Fer')).getByText('Needs redo')).toBeInTheDocument();
    expect(within(rowOf('Fer')).getByText(/^You took credit away · /)).toBeInTheDocument();

    // Turned in before the pause rule: no pause count.
    expect(within(rowOf('Gil')).getAllByRole('cell')[3]).toHaveTextContent('—');
  });

  it('says "You asked for a redo" when the teacher turned down a row that had no credit', () => {
    setSubmissions([row({
      id: 31, userId: 3, studentName: 'Carla', mic: 'off', credit: false, creditOverride: false, effectiveCredit: false,
      status: 'redo', statusReason: 'teacher', creditOverrideAt: '2026-09-28T18:00:00.000Z',
    })]);
    renderReview();
    expect(within(rowOf('Carla')).getByText(/^You asked for a redo · /)).toBeInTheDocument();
    expect(within(rowOf('Carla')).getByRole('button', { name: 'Undo: Carla' })).toBeInTheDocument();
  });

  it('offers the right credit buttons on each row', async () => {
    const user = userEvent.setup();
    renderReview();
    const buttons = (name: string) => within(rowOf(name)).getAllByRole('button').map((b) => b.textContent);

    expect(buttons('Ana')).toEqual(['Take credit away', 'Log']);
    expect(buttons('Ben')).toEqual(['Give credit', 'Log']);
    expect(buttons('Carla')).toEqual(['Give credit', 'Ask for a redo', 'Log']);
    expect(buttons('Eva')).toEqual(['Undo', 'Log']);
    expect(buttons('Fer')).toEqual(['Undo', 'Log']);

    // Each button says whose it is, so a list of 30 of them can be told apart.
    await user.click(within(rowOf('Ana')).getByRole('button', { name: 'Take credit away from Ana' }));
    await user.click(within(rowOf('Ben')).getByRole('button', { name: 'Give credit to Ben' }));
    await user.click(within(rowOf('Carla')).getByRole('button', { name: 'Ask for a redo: Carla' }));
    await user.click(within(rowOf('Eva')).getByRole('button', { name: 'Undo: Eva' }));
    expect(within(rowOf('Ben')).getByRole('button', { name: 'Log: Ben' })).toBeInTheDocument();

    expect(h.creditCalls).toEqual([
      { submissionIds: [10], credit: false },
      { submissionIds: [20], credit: true },
      { submissionIds: [30], credit: false },
      { submissionIds: [50], credit: null },
    ]);
    expect(h.invalidated).toEqual(expect.arrayContaining(['submissions:3', 'adminList']));
  });

  it('takes credit away from the student, not one attempt: every attempt that counts loses it', async () => {
    const user = userEvent.setup();
    // At 0% both of Ana's attempts counted: turned in on 9/20, done again on 9/22.
    const again = row({ id: 12, userId: 1, studentName: 'Ana', attempts: 2, submittedAt: '2026-09-22T15:16:00.000Z' });
    const first = row({ id: 11, userId: 1, studentName: 'Ana', attempts: 2, submittedAt: '2026-09-20T15:16:00.000Z' });
    setSubmissions([again, first]);
    renderReview();
    expect(within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Ana'))).toHaveLength(1);

    await user.click(within(rowOf('Ana')).getByRole('button', { name: 'Take credit away from Ana' }));
    expect(h.creditCalls).toEqual([{ submissionIds: [12, 11], credit: false }]);

    // Undo takes back that one decision, on both attempts.
    h.creditCalls.length = 0;
    const at = '2026-09-28T18:00:00.000Z';
    const takenAway = { creditOverride: false, creditOverrideAt: at, effectiveCredit: false, status: 'redo' as const, statusReason: 'teacher' as const };
    setSubmissions([{ ...again, ...takenAway }, { ...first, ...takenAway }]);
    renderReview();
    await user.click(within(screen.getAllByRole('table').at(-1)!).getByRole('button', { name: 'Undo: Ana' }));
    expect(h.creditCalls).toEqual([{ submissionIds: [12, 11], credit: null }]);
  });

  it('shows the attempt that counts: a done student whose later retry failed is done, and the retry is marked', async () => {
    const user = userEvent.setup();
    const done = row({ id: 11, userId: 1, studentName: 'Ana', attempts: 2, submittedAt: '2026-09-20T15:16:00.000Z' });
    const retry = row({
      id: 12, userId: 1, studentName: 'Ana', attempts: 2, submittedAt: '2026-09-22T15:16:00.000Z',
      credit: false, effectiveCredit: false, status: 'redo', pausesAnswered: 1,
    });
    setSubmissions([retry, done]);
    renderReview();
    const shown = within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Ana'));
    expect(shown).toHaveLength(1);
    expect(within(shown[0]).getByText('Done')).toBeInTheDocument();
    expect(within(shown[0]).getByText(/2 attempts/)).toBeInTheDocument();
    expect(within(shown[0]).getByRole('button', { name: 'Take credit away from Ana' })).toBeInTheDocument();

    await user.click(screen.getByLabelText('Show all attempts'));
    const both = within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Ana'));
    expect(both).toHaveLength(2);
    // The row that counts stays first, though the failed retry is newer.
    expect(within(both[0]).getByText('Done')).toBeInTheDocument();
    // The failed retry is another attempt; its own button acts on it alone.
    expect(within(both[1]).getByText(/another attempt/)).toBeInTheDocument();
    await user.click(within(both[1]).getByRole('button', { name: 'Give credit to Ana' }));
    expect(h.creditCalls).toEqual([{ submissionIds: [12], credit: true }]);
  });

  it('gives credit to everyone waiting, after asking', async () => {
    const user = userEvent.setup();
    renderReview();

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Give credit to all 2 waiting for you' }));
    expect(confirmSpy).toHaveBeenCalledWith('Give credit to 2 student(s)?');
    expect(h.creditCalls).toEqual([]);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Give credit to all 2 waiting for you' }));
    expect(h.creditCalls).toEqual([{ submissionIds: [30, 40], credit: true }]);
  });

  it('gives credit to the automatic redos, not to a redo the teacher asked for', async () => {
    const user = userEvent.setup();
    confirmSpy.mockReturnValue(true);
    renderReview();

    await user.click(screen.getByRole('button', { name: 'Give credit to all 1 who need a redo' }));
    expect(confirmSpy).toHaveBeenCalledWith('Give credit to 1 student(s)?');
    expect(h.creditCalls).toEqual([{ submissionIds: [20], credit: true }]);
  });

  // A class of 250 renders slowly on a busy machine: its own time limit, not the 5 s default.
  it('sends a large class in batches the server takes', { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    confirmSpy.mockReturnValue(true);
    setSubmissions(Array.from({ length: 250 }, (_, i) => row({
      id: 1000 + i, userId: 1000 + i, studentName: `Student ${String(i).padStart(3, '0')}`, mic: 'off',
      credit: false, effectiveCredit: false, status: 'check', statusReason: 'no-mic',
    })));
    renderReview();

    await user.click(screen.getByRole('button', { name: 'Give credit to all 250 waiting for you' }));

    expect(h.creditCalls.map((c) => c.submissionIds.length)).toEqual([200, 50]);
    expect(h.creditCalls.flatMap((c) => c.submissionIds)).toHaveLength(250);
  });

  it('hides the bulk buttons when nobody needs them', () => {
    setSubmissions([ana, eva]);
    renderReview();
    expect(screen.queryByRole('button', { name: /Give credit to all/ })).toBeNull();
  });

  it('shows a refused credit change', async () => {
    const user = userEvent.setup();
    h.creditFails = 'Forbidden';
    renderReview();

    await user.click(within(rowOf('Ben')).getByRole('button', { name: 'Give credit to Ben' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });

  it('labels the new flags and explains them', () => {
    renderReview();

    const chip = (name: string, label: string) => within(rowOf(name)).getByText(label, { exact: false, selector: 'span[title]' });
    const odd = chip('Ben', 'Odd results');
    const oddMeaning = "5 pause result(s) don't add up: two results for one pause in one playback, or answers the page could not have sent. They did not count. Check the log.";
    expect(odd).toHaveAttribute('title', oddMeaning);
    // The meaning reaches a screen reader too, not only the mouse.
    expect(odd).toHaveTextContent(`Odd results: ${oddMeaning}`);
    expect(within(odd).getByText(`: ${oddMeaning}`)).toHaveClass('sr-only');
    expect(chip('Gil', 'Sent late')).toHaveAttribute('title', expect.stringMatching(/^Part of the listening log reached the server long after/));
    // Gil's other attempt has the same two flags: each chip says so.
    expect(within(rowOf('Gil')).getByText('Little speech · also on 1 other')).toBeInTheDocument();
    expect(chip('Gil', 'Sent late · also on 1 other')).toBeInTheDocument();
    expect(chip('Fer', 'Two at once')).toHaveAttribute('title', 'Another window of this student was playing a lab at the same time.');
    expect(chip('Fer', 'Sound in every pause')).toHaveAttribute('title', expect.stringMatching(/music, a video or a second window/));
    expect(chip('Fer', 'Voice outside the pauses')).toHaveAttribute('title', 'The mic heard a voice outside the pauses about as often as in them: a phone or video, a neighbour, or speakers instead of headphones.');
    expect(within(rowOf('Fer')).queryByText('Noisy mic')).toBeNull();
    expect(within(rowOf('Carla')).getByText('No microphone', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows a strip of the pauses and the voice each report carried in the log', async () => {
    const user = userEvent.setup();
    h.listenLog = [{
      startedAt: Date.parse('2026-09-28T15:00:00.000Z'),
      started: true,
      summary: { heardThroughMs: 930_000, skips: 0 },
      submitted: true,
      events: [
        { kind: 'open', positionMs: 0, clientMs: 0, at: Date.parse('2026-09-28T15:00:00.000Z'), answers: null },
        { kind: 'play', positionMs: 0, clientMs: 100, at: Date.parse('2026-09-28T15:00:01.000Z'), answers: null },
        { kind: 'tick', positionMs: 12_000, clientMs: 12_100, at: Date.parse('2026-09-28T15:00:13.000Z'), answers: [[1000, 0], [11_000, 100]] },
      ],
    }];
    renderReview();

    const logButton = within(rowOf('Ben')).getByRole('button', { name: 'Log: Ben' });
    expect(logButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(logButton);
    expect(logButton).toHaveAttribute('aria-expanded', 'true');

    const strip = screen.getByRole('list', { name: 'Pauses answered' });
    const squares = within(strip).getAllByRole('img');
    expect(squares.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Pause 1 at 0:01: 0.0 s of voice',
      'Pause 2 at 0:06: not reported',
      'Pause 3 at 0:11: 0.1 s of voice',
      'Pause 4 at 0:16: 0.6 s of voice',
    ]);
    // Under the 0.25 s floor is amber, at or over it green, not reported gray.
    expect(squares[0].className).toMatch(/bg-amber/);
    expect(squares[1].className).toMatch(/bg-gray/);
    expect(squares[2].className).toMatch(/bg-amber/);
    expect(squares[3].className).toMatch(/bg-green/);

    expect(screen.getByText(/At 0:12 · voice in the pause at 0:01: 0\.0 s · voice in the pause at 0:11: 0\.1 s$/)).toBeInTheDocument();
  });

  it('judges the strip by the floor the attempt was scored with', async () => {
    const user = userEvent.setup();
    setSubmissions([row({ ...ana, voicePerPauseMs: 1000 })]);
    renderReview();

    await user.click(within(rowOf('Ana')).getByRole('button', { name: 'Log: Ana' }));

    const squares = within(screen.getByRole('list', { name: 'Pauses answered' })).getAllByRole('img');
    expect(squares.map((s) => /bg-green/.test(s.className))).toEqual([false, true, false, false]);
  });

  it('lists who still has to do the lab: missing, redo and waiting', () => {
    renderReview();

    const section = screen.getByRole('heading', { name: 'Still to do (5)' }).closest('section')!;
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'HugoNever opened it',
      // The need the attempt was judged by; a redo the teacher asked for says so, not a count that met it.
      'BenNeeds redo · 1 of 4 pauses (needed 3)',
      'FerNeeds redo · you asked for it',
      'CarlaWaiting for you · no microphone',
      "DaniWaiting for you · says the mic didn't hear them",
    ]);
    expect(within(section).queryByText('Everyone is done.')).toBeNull();
  });

  it('says a redo without pause counts plainly', () => {
    setSubmissions([row({ ...gil, credit: false, effectiveCredit: false, status: 'redo', statusReason: null })]);
    h.missing = [];
    renderReview();
    const section = screen.getByRole('heading', { name: 'Still to do (1)' }).closest('section')!;
    expect(within(section).getByText('Needs redo')).toBeInTheDocument();
  });

  it('says everyone is done only when nobody is missing, redoing or waiting', () => {
    setSubmissions([ana, eva, teacher]);
    h.missing = [];
    renderReview();
    expect(screen.getByRole('heading', { name: 'Still to do (0)' })).toBeInTheDocument();
    expect(screen.getByText('Everyone is done.')).toBeInTheDocument();
  });

  it('waits for the missing list before counting', () => {
    h.missing = undefined;
    renderReview();
    expect(screen.getByRole('heading', { name: 'Still to do' })).toBeInTheDocument();
  });

  it('keeps showing earlier attempts on request', async () => {
    const user = userEvent.setup();
    renderReview();
    expect(within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Gil'))).toHaveLength(1);

    await user.click(screen.getByLabelText('Show all attempts'));

    expect(within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Gil'))).toHaveLength(2);
    expect(screen.getByText(/another attempt/, { selector: 'span' })).toBeInTheDocument();
  });

  describe('marks for flags on other attempts', () => {
    // Olga's counting row is clean; her other attempts carry flags, one of them red, and one had no microphone.
    const olga = row({ id: 80, userId: 8, studentName: 'Olga', attempts: 5, submittedAt: '2026-09-28T15:16:00.000Z' });
    const olgaOthers = [
      row({ id: 81, userId: 8, studentName: 'Olga', attempts: 5, submittedAt: '2026-09-29T15:16:00.000Z', credit: false, effectiveCredit: false, status: 'redo', flags: ['odd-answers'], rejectedAnswers: 12 }),
      row({ id: 79, userId: 8, studentName: 'Olga', attempts: 5, submittedAt: '2026-09-27T15:16:00.000Z', flags: ['constant-sound', 'noisy'] }),
      row({ id: 78, userId: 8, studentName: 'Olga', attempts: 5, submittedAt: '2026-09-26T15:16:00.000Z', flags: ['noisy'] }),
      row({ id: 77, userId: 8, studentName: 'Olga', attempts: 5, submittedAt: '2026-09-25T15:16:00.000Z', mic: 'off', flags: ['no-mic'] }),
    ];
    const marksOf = (name: string) => [...rowOf(name).querySelectorAll('[data-flag-mark]')].map((el) => el.textContent);

    it('marks the row that counts with the flags of the other attempts, without ticking the box', () => {
      // As the server orders them: newest first, so a later failed attempt comes before the one that counts.
      setSubmissions([olgaOthers[0], olga, ...olgaOthers.slice(1)]);
      renderReview();

      expect(within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Olga'))).toHaveLength(1);
      // Red first; No microphone is not a mark against the student.
      expect(marksOf('Olga')).toEqual([
        'Odd results · on 1 other attempt(s)',
        'Sound in every pause · on 1 other attempt(s)',
        'Voice outside the pauses · on 2 other attempt(s)',
      ]);
      const odd = within(rowOf('Olga')).getByText('Odd results · on 1 other attempt(s)');
      expect(odd.className).toMatch(/bg-red-100/);
      expect(within(rowOf('Olga')).getByText('Voice outside the pauses · on 2 other attempt(s)').className).toMatch(/bg-amber-100/);
      // Plain chips, not buttons: the box shows the attempts.
      expect(within(rowOf('Olga')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Take credit away', 'Log']);
    });

    it('merges a mark into the row’s own chip for the same flag', () => {
      setSubmissions([{ ...olga, flags: ['noisy'] }, ...olgaOthers.slice(1)]);
      renderReview();

      const own = within(rowOf('Olga')).getByText('Voice outside the pauses · also on 2 other', { exact: false, selector: 'span[title]' });
      expect(own).toHaveAttribute('title', expect.stringMatching(/^The mic heard a voice outside the pauses/));
      expect(marksOf('Olga')).toEqual(['Sound in every pause · on 1 other attempt(s)']);
    });

    it('lists the row that counts first, then the others newest first, and marks only the row that counts', async () => {
      const user = userEvent.setup();
      setSubmissions([olgaOthers[0], olga, ...olgaOthers.slice(1)]);
      renderReview();
      await user.click(screen.getByLabelText('Show all attempts'));

      const shown = within(table()).getAllByRole('row').filter((r) => r.textContent?.startsWith('Olga'));
      expect(shown).toHaveLength(5);
      expect(within(shown[0]).getByText(/5 attempts/)).toBeInTheDocument();
      expect(shown.slice(1).map((r) => within(r).getByText(/another attempt/))).toHaveLength(4);
      expect(within(shown[1]).getByText('Odd results', { exact: false, selector: 'span[title]' })).toBeInTheDocument();
      // The marks stay on the counting row while the box is ticked, and nowhere else.
      expect(shown[0].querySelectorAll('[data-flag-mark]')).toHaveLength(3);
      expect(shown.slice(1).every((r) => r.querySelectorAll('[data-flag-mark]').length === 0)).toBe(true);
    });

    it('marks nothing for a student with one attempt, or only no-microphone attempts', () => {
      setSubmissions([ana, olga, olgaOthers[3]]);
      renderReview();
      expect(marksOf('Ana')).toEqual([]);
      expect(marksOf('Olga')).toEqual([]);
    });
  });

  it('shows the voice in the pauses and the voice while playing', () => {
    const { unmount } = renderReview();

    expect(screen.getByRole('columnheader', { name: 'Voice heard' })).toHaveAttribute(
      'title', 'Voice in the counted pauses (the best pass of each), and all the voice the microphone heard while the lab played.');
    expect(screen.queryByRole('columnheader', { name: 'Spoke for' })).toBeNull();
    // Ana: 0.9 + 1.2 + 0.3 + 0.25 s in the pauses, 45 s in all.
    const ana = within(rowOf('Ana')).getAllByRole('cell')[4];
    expect(ana).toHaveTextContent(/^0:03 in the pauses0:45 while playing$/);
    unmount();

    // A pause not reported and a pause in conflict add nothing. A page that sent pause results
    // it never heard (0:00 while playing) shows the mismatch.
    setSubmissions([row({ ...ben, pauseResults: [[1000, 1500], [6000, -1], [11000, -2], [16000, 600]], voicedMs: 0 })]);
    renderReview();
    expect(within(rowOf('Ben')).getAllByRole('cell')[4]).toHaveTextContent(/^0:02 in the pauses0:00 while playing$/);
  });

  it('falls back to the page’s total without pause results', () => {
    renderReview();
    // Gil turned in before the pause rule.
    expect(within(rowOf('Gil')).getAllByRole('cell')[4]).toHaveTextContent(/^0:20$/);
  });

  describe('the rule each attempt was judged by', () => {
    // Today: 75%, 3 of 4, 0.25 s.
    const judged = [
      row({ id: 1, userId: 1, studentName: 'Ana' }),
      row({ id: 2, userId: 2, studentName: 'Ben', minAnsweredPct: 50, needed: 2, pausesAnswered: 2 }),
      row({ id: 3, userId: 3, studentName: 'Carla', minAnsweredPct: 0, needed: 0, pausesAnswered: 1 }),
      row({ id: 4, userId: 4, studentName: 'Dani', voicePerPauseMs: 500 }),
      row({ id: 5, userId: 5, studentName: 'Eva', minAnsweredPct: 50, needed: 2, voicePerPauseMs: 1000, pausesAnswered: 2 }),
    ];
    const pausesCell = (name: string) => within(rowOf(name)).getAllByRole('cell')[3];

    it('adds a gray line only where the row differs from today, and always states the row’s rule in the title', () => {
      setSubmissions(judged);
      renderReview();

      expect(pausesCell('Ana')).toHaveTextContent(/^4 of 4$/);
      expect(pausesCell('Ana')).toHaveAttribute('title', 'This attempt was judged by the rule when it started: 75% of the pauses (3 of 4), 0.25 s of voice in each.');
      expect(pausesCell('Ben')).toHaveTextContent(/^2 of 4needed 2$/);
      expect(pausesCell('Ben')).toHaveAttribute('title', 'This attempt was judged by the rule when it started: 50% of the pauses (2 of 4), 0.25 s of voice in each.');
      // "The rule was off" first: a 0% row needed 0, which is not the point.
      expect(pausesCell('Carla')).toHaveTextContent(/^1 of 4the rule was off$/);
      expect(pausesCell('Carla')).toHaveAttribute('title', 'This attempt started while the pause rule was off, so it counted whatever it answered.');
      expect(pausesCell('Dani')).toHaveTextContent(/^4 of 40\.5 s each$/);
      expect(pausesCell('Eva')).toHaveTextContent(/^2 of 4needed 2 · 1 s each$/);
    });

    it('with today’s rule off, a row judged at 75% says what it needed and a 0% row says nothing more', () => {
      h.lab = { ...scannedLab, settings: { minAnsweredPct: 0, voicePerPauseMs: 250 }, needed: 0 };
      setSubmissions(judged);
      renderReview();

      expect(pausesCell('Ana')).toHaveTextContent(/^4 of 4needed 3$/);
      expect(pausesCell('Carla')).toHaveTextContent(/^1 of 4$/);
    });

    it('says nothing for a row turned in before the pause rule', () => {
      renderReview();
      expect(within(rowOf('Gil')).getAllByRole('cell')[3]).toHaveTextContent(/^—$/);
      expect(within(rowOf('Gil')).getAllByRole('cell')[3]).not.toHaveAttribute('title');
    });
  });

  describe('held labs', () => {
    const held = row({
      id: 100, userId: 10, studentName: 'Hana', credit: false, effectiveCredit: false, status: 'check', statusReason: 'held',
      heldFor: ['overlap', 'odd-answers'], flags: ['odd-answers', 'overlap'], rejectedAnswers: 0,
      pauseResults: [[1000, -2], [6000, 1200], [11000, -2], [16000, 250]], pausesAnswered: 2,
    });

    it('says what held a lab, and keeps held labs out of “Give credit to all”', async () => {
      const user = userEvent.setup();
      confirmSpy.mockReturnValue(true);
      setSubmissions([ana, carla, dani, held]);
      renderReview();

      expect(within(rowOf('Hana')).getByText('Check it')).toBeInTheDocument();
      expect(within(rowOf('Hana')).getByText('Held: Odd results, Two at once')).toBeInTheDocument();
      // The two pauses in conflict are what did not add up.
      expect(within(rowOf('Hana')).getByText('Odd results', { exact: false, selector: 'span[title]' })).toHaveAttribute(
        'title', expect.stringMatching(/^2 pause result\(s\) don't add up/));
      expect(within(rowOf('Hana')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Give credit', 'Ask for a redo', 'Log']);
      expect(screen.getByText('Held labs (1) are not in “Give credit to all”: look at each one.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Give credit to all 2 waiting for you' }));
      expect(h.creditCalls).toEqual([{ submissionIds: [30, 40], credit: true }]);

      const section = screen.getByRole('heading', { name: /^Still to do/ }).closest('section')!;
      expect(within(section).getByText('Waiting for you · held: Odd results, Two at once')).toBeInTheDocument();
    });

    it('offers no bulk credit when every lab waiting is held, and still says why', () => {
      setSubmissions([ana, held]);
      renderReview();
      expect(screen.queryByRole('button', { name: /Give credit to all/ })).toBeNull();
      expect(screen.getByText('Held labs (1) are not in “Give credit to all”: look at each one.')).toBeInTheDocument();
    });

    it('shows a pause in conflict as a red square', async () => {
      const user = userEvent.setup();
      setSubmissions([held]);
      renderReview();
      await user.click(within(rowOf('Hana')).getByRole('button', { name: 'Log: Hana' }));

      const squares = within(screen.getByRole('list', { name: 'Pauses answered' })).getAllByRole('img');
      expect(squares[0]).toHaveAttribute('aria-label', 'Pause 1 at 0:01: two results for one pause in one playback; neither counted.');
      expect(squares[0].className).toMatch(/bg-red/);
      expect(squares[1].className).toMatch(/bg-green/);
    });

    it('still says a lab is held when what held it cannot be read', () => {
      setSubmissions([row({ ...held, heldFor: [] })]);
      renderReview();
      expect(within(rowOf('Hana')).getByText('Held for you')).toBeInTheDocument();
      const section = screen.getByRole('heading', { name: /^Still to do/ }).closest('section')!;
      expect(within(section).getByText('Waiting for you · held')).toBeInTheDocument();
    });

    it('explains odd results that only failed the no-microphone check', () => {
      setSubmissions([row({ ...held, mic: 'off', heldFor: ['odd-answers'], flags: ['odd-answers', 'no-mic'], pauseResults: [[1000, 900]] })]);
      renderReview();
      expect(within(rowOf('Hana')).getByText('Odd results', { exact: false, selector: 'span[title]' })).toHaveAttribute(
        'title', 'The answers add up to more voice than the page heard in all. Check the log.');
    });
  });

  it('labels short answers', () => {
    setSubmissions([row({ ...ana, flags: ['short-answers'] })]);
    renderReview();
    expect(within(rowOf('Ana')).getByText('Short answers', { exact: false, selector: 'span[title]' })).toHaveAttribute(
      'title', "This student's answers were much shorter than the class's: often one sound in each pause.");
  });

  describe('what the page’s voice meter measured', () => {
    const stats: MicStats = {
      meter: 2, ambientDbP50: -52.4, gateDbP50: -46.4, voiceOverGateDbP50: 14.2, levelOnlyAnswered: 3,
      loudNotVoiceInPausesMs: 4_200, unfocusedPlayedMs: 130_000, micCheck: 'voice',
      processing: { echoCancellation: true, noiseSuppression: false },
    };

    it('shows the old meter’s count, the room level and time in the background on the row, the rest under the log', async () => {
      const user = userEvent.setup();
      setSubmissions([row({ ...ana, micStats: stats })]);
      renderReview();

      const cells = within(rowOf('Ana')).getAllByRole('cell');
      expect(cells[2]).toHaveTextContent('In the background for 2:10');
      expect(cells[3]).toHaveTextContent('Old meter: 3 of 4 pauses');
      expect(cells[4]).toHaveTextContent('Room level −52 dB · a voice needed −46 dB');
      expect(screen.queryByText(/Non-voice sound/)).toBeNull();

      await user.click(within(rowOf('Ana')).getByRole('button', { name: 'Log: Ana' }));
      const details = screen.getByRole('list', { name: 'Microphone' });
      expect(within(details).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Non-voice sound in the pauses: 0:04',
        'Mic processing: echo cancellation on, noise suppression off, auto gain not reported',
      ]);
    });

    it('leaves out a short time in the background, levels never measured, and an old meter with no pause list', () => {
      setSubmissions([row({
        ...ana,
        micStats: { ...stats, unfocusedPlayedMs: 59_999, ambientDbP50: null, gateDbP50: null, levelOnlyAnswered: null, processing: null },
      })]);
      renderReview();
      expect(rowOf('Ana')).not.toHaveTextContent(/In the background|Room level|Old meter/);
    });

    it('shows nothing for a row without meter stats', () => {
      renderReview();
      expect(rowOf('Ana')).not.toHaveTextContent(/In the background|Room level|Old meter/);
    });
  });
});
