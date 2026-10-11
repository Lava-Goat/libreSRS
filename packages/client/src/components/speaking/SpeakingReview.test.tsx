// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpeakingReview from './SpeakingReview';

type Row = {
  id: number;
  userId: number;
  studentName: string;
  studentEmail: string;
  audioUrl: string;
  durationMs: number;
  voicedMs: number;
  referenceText: string | null;
  submittedAt: string;
  gradeScore: number | null;
  gradeDetails: string | null;
  gradeFeedback: string | null;
  gradedBy: string | null;
  gradedAt: string | null;
  isTeacher: boolean;
  attempts: number;
  flags?: string[];
  clientDurationMs?: number | null;
  clientVoicedMs?: number | null;
  micSettings?: Record<string, unknown> | null;
  sameFileAs?: { submissionId: number; taskId: number; taskTitle: string; studentName: string; submittedAt: string } | null;
  copiedFrom?: { submissionId: number; taskId: number; taskTitle: string; studentName: string; submittedAt: string } | null;
};

// Shared with the trpc mock below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  submissions: [] as unknown[],
  missing: [] as { id: number; name: string; email: string }[],
  /** The task's reference text as it reads now. */
  currentText: 'Había una vez…',
  gradeCalls: [] as unknown[],
  invalidated: [] as string[],
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      speaking: {
        submissions: { invalidate: async (input: { taskId: number }) => { h.invalidated.push(`submissions:${input.taskId}`); } },
        adminList: { invalidate: async () => { h.invalidated.push('adminList'); } },
      },
    }),
    speaking: {
      submissions: {
        useQuery: () => ({
          data: {
            task: { id: 7, title: 'El cuento de la semana', targetSeconds: 90, referenceText: h.currentText, modelAudioUrl: '/api/assets/model.mp3' },
            submissions: h.submissions,
          },
          isLoading: false,
          error: null,
        }),
      },
      missing: { useQuery: () => ({ data: h.missing, error: null }) },
      grade: {
        useMutation: (options?: { onSuccess?: () => Promise<unknown> }) => ({
          isPending: false,
          mutate: async (input: unknown, callbacks?: { onSuccess?: () => void }) => {
            h.gradeCalls.push(input);
            await options?.onSuccess?.();
            callbacks?.onSuccess?.();
          },
        }),
      },
    },
  },
}));

const row = (overrides: Partial<Row>): Row => ({
  id: 1,
  userId: 1,
  studentName: 'Student',
  studentEmail: 'student@example.com',
  audioUrl: '/api/recordings/rec.webm',
  durationMs: 65_000,
  voicedMs: 50_000,
  referenceText: h.currentText,
  submittedAt: '2026-09-20T15:00:00.000Z',
  gradeScore: null,
  gradeDetails: null,
  gradeFeedback: null,
  gradedBy: null,
  gradedAt: null,
  isTeacher: false,
  attempts: 1,
  ...overrides,
});

// As the server orders them: by student name, newest first.
const anaLatest = row({
  id: 12,
  userId: 1,
  studentName: 'Ana',
  submittedAt: '2026-09-21T15:00:00.000Z',
  attempts: 2,
  gradeScore: 82,
  gradedBy: 'vowel-grader',
  gradedAt: '2026-09-21T16:00:00.000Z',
  gradeFeedback: 'Watch the final e.',
  gradeDetails: '{"vowels":{"a":0.91,"e":0.74}}',
});
const anaEarlier = row({ id: 11, userId: 1, studentName: 'Ana', submittedAt: '2026-09-20T15:00:00.000Z', attempts: 2 });
const ben = row({ id: 20, userId: 2, studentName: 'Ben' });

const renderReview = () => render(<SpeakingReview taskId={7} onBack={() => {}} />);
const studentRows = () => screen.getAllByRole('row').slice(1);
const rowWith = (text: string) => studentRows().find((r) => r.textContent?.includes(text))!;

describe('SpeakingReview', () => {
  beforeEach(() => {
    h.submissions = [anaLatest, anaEarlier, ben];
    h.missing = [];
    h.gradeCalls.length = 0;
    h.invalidated.length = 0;
  });

  it('shows the latest recording per student, and earlier ones on request', async () => {
    const user = userEvent.setup();
    renderReview();

    expect(studentRows()).toHaveLength(2);
    expect(studentRows()[0]).toHaveTextContent('Ana');
    expect(studentRows()[0]).toHaveTextContent('2 attempts');
    expect(screen.getByRole('heading', { name: 'Turned in (2)' })).toBeInTheDocument();

    await user.click(screen.getByLabelText('Show earlier attempts'));

    expect(studentRows()).toHaveLength(3);
    expect(studentRows()[1]).toHaveTextContent('Ana · earlier');
  });

  it('labels the teacher’s own test run and does not count it as a student', () => {
    h.submissions = [row({ id: 30, userId: 9, studentName: 'Ms. Example', isTeacher: true }), ben];
    renderReview();

    expect(studentRows()[0]).toHaveTextContent('your test run');
    expect(screen.getByRole('heading', { name: 'Turned in (1)' })).toBeInTheDocument();
  });

  it('shows the grade with who graded it', async () => {
    const user = userEvent.setup();
    renderReview();

    const [anaRow, benRow] = studentRows();
    expect(within(anaRow).getByText('82')).toBeInTheDocument();
    expect(within(anaRow).getByText('vowel-grader')).toBeInTheDocument();
    expect(within(benRow).getByText('Not graded')).toBeInTheDocument();

    await user.click(within(anaRow).getByRole('button', { name: 'Listen' }));

    expect(screen.getByText('82 out of 100')).toBeInTheDocument();
    expect(screen.getByText(/graded by vowel-grader/)).toBeInTheDocument();
    expect(screen.getByText('Watch the final e.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText('Comment for the student (they will see it)')).toHaveValue('Watch the final e.');
    expect(screen.getByLabelText('Recording by Ana')).toHaveAttribute('src', '/api/recordings/rec.webm');
    // The teacher's score form starts from the current grade.
    expect(screen.getByLabelText('Score (0–100)')).toHaveValue('82');
  });

  it('says an agent\'s grade waits for the teacher\'s Save, and saving sends no details (the server keeps the agent\'s)', async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(within(studentRows()[0]).getByRole('button', { name: 'Listen' }));
    expect(screen.getByText("The student can't see this grade until you save it.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    expect(h.gradeCalls).toEqual([{ submissionId: 12, score: 82, feedback: 'Watch the final e.', gradedBy: 'teacher' }]);
    expect(h.gradeCalls[0]).not.toHaveProperty('details');
  });

  it('never says "by you" for a grade with no grader named, nor that the student sees it', async () => {
    const user = userEvent.setup();
    h.submissions = [row({ ...anaLatest, gradedBy: null }), ben];
    renderReview();
    expect(within(studentRows()[0]).getByText('grader unknown')).toBeInTheDocument();
    await user.click(within(studentRows()[0]).getByRole('button', { name: 'Listen' }));
    expect(screen.getByText(/grader unknown/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/by you/)).toBeNull();
    expect(screen.getByText("The student can't see this grade until you save it.")).toBeInTheDocument();
  });

  it('says nothing of the kind for the teacher\'s own grade', async () => {
    const user = userEvent.setup();
    h.submissions = [row({ ...anaLatest, gradedBy: 'teacher' }), ben];
    renderReview();
    expect(within(studentRows()[0]).getByText('by you')).toBeInTheDocument();
    await user.click(within(studentRows()[0]).getByRole('button', { name: 'Listen' }));
    expect(screen.queryByText("The student can't see this grade until you save it.")).toBeNull();
  });

  it('tells the teacher the comment is shown to the student', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(within(studentRows()[1]).getByRole('button', { name: 'Listen' }));

    const comment = screen.getByRole('textbox', { name: 'Comment for the student (they will see it)' });
    expect(comment.tagName).toBe('TEXTAREA');
    expect(screen.queryByText('Feedback (optional)')).toBeNull();
  });

  it('pretty-prints JSON grade details inside a details element', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(within(studentRows()[0]).getByRole('button', { name: 'Listen' }));

    const pretty = JSON.stringify({ vowels: { a: 0.91, e: 0.74 } }, null, 2);
    const pre = screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === pretty);
    expect(pre.closest('details')).not.toBeNull();
    expect(within(pre.closest('details')!).getByText('Grader details')).toBeInTheDocument();
  });

  it('saves the teacher’s grade and refreshes the lists', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(within(studentRows()[1]).getByRole('button', { name: 'Listen' }));
    await user.type(screen.getByLabelText('Score (0–100)'), '90');
    await user.type(screen.getByLabelText('Comment for the student (they will see it)'), '  Muy bien.  ');
    await user.click(screen.getByRole('button', { name: 'Save grade' }));

    expect(h.gradeCalls).toEqual([{ submissionId: 20, score: 90, feedback: 'Muy bien.', gradedBy: 'teacher' }]);
    expect(h.invalidated).toEqual(expect.arrayContaining(['submissions:7', 'adminList']));
    expect(await screen.findByRole('status')).toHaveTextContent('Grade saved.');
  });

  it('refuses a score outside 0–100', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(within(studentRows()[1]).getByRole('button', { name: 'Listen' }));
    await user.type(screen.getByLabelText('Score (0–100)'), '120');
    await user.click(screen.getByRole('button', { name: 'Save grade' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a score from 0 to 100.');
    expect(h.gradeCalls).toEqual([]);
  });

  it('clears a grade by sending a null score', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(within(studentRows()[0]).getByRole('button', { name: 'Listen' }));
    await user.click(screen.getByRole('button', { name: 'Clear grade' }));

    expect(h.gradeCalls).toEqual([{ submissionId: 12, score: null, gradedBy: 'teacher' }]);
    expect(h.invalidated).toEqual(expect.arrayContaining(['submissions:7', 'adminList']));
    await waitFor(() => expect(screen.getByLabelText('Score (0–100)')).toHaveValue(''));
  });

  it('offers no Clear grade button for an ungraded recording', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(within(studentRows()[1]).getByRole('button', { name: 'Listen' }));

    expect(screen.getByText('Not graded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear grade' })).toBeNull();
  });

  it('shows the text a recording was made against when the task’s has changed since', async () => {
    const user = userEvent.setup();
    const before = 'Érase una vez un niño que vivía junto al mar.';
    h.submissions = [anaLatest, { ...anaEarlier, referenceText: before }, { ...ben, referenceText: null }];
    renderReview();
    await user.click(screen.getByLabelText('Show earlier attempts'));

    // Recorded against the current text: nothing to point out.
    await user.click(within(rowWith('2 attempts')).getByRole('button', { name: 'Listen' }));
    expect(screen.getByLabelText('Recording by Ana')).toBeInTheDocument();
    expect(screen.queryByText(/has changed since this was recorded/)).toBeNull();
    expect(screen.queryByText('Text this recording was made against')).toBeNull();

    await user.click(within(rowWith('Ana · earlier')).getByRole('button', { name: 'Listen' }));
    expect(screen.getByText(/has changed since this was recorded/)).toBeInTheDocument();
    const snapshot = screen.getByText('Text this recording was made against').closest('details')!;
    expect(snapshot).not.toHaveAttribute('open');
    expect(within(snapshot).getByText(before)).toBeInTheDocument();
    expect(within(snapshot).queryByText(h.currentText)).toBeNull();

    await user.click(within(rowWith('Ben')).getByRole('button', { name: 'Listen' }));
    expect(screen.getByText(/recorded before the task had a reference text/)).toBeInTheDocument();
    expect(screen.queryByText('Text this recording was made against')).toBeNull();
  });

  describe('what the server found when each take arrived (v1.16.0)', () => {
    const match = (studentName: string, taskTitle: string) => ({
      submissionId: 3, taskId: 5, taskTitle, studentName, submittedAt: '2026-09-18T15:00:00.000Z',
    });
    const chipsOf = (text: string) => Array.from(rowWith(text).querySelectorAll('span[class*="rounded"]')).map((c) => c.firstChild?.textContent);

    it('shows red chips for audio posted before, naming the take it matches', () => {
      h.submissions = [
        row({ id: 12, userId: 1, studentName: 'Ana', flags: ['same-file', 'model'], sameFileAs: match('Ana', 'Cuento semana 2') }),
        row({ id: 20, userId: 2, studentName: 'Ben', flags: ['copied'], copiedFrom: match('Ana', 'Cuento semana 2') }),
        row({ id: 30, userId: 3, studentName: 'Cruz', flags: ['same-file', 'copied'] }),
      ];
      renderReview();

      const ana = chipsOf('Ana');
      expect(ana[0]).toMatch(/^Same file as the recording for “Cuento semana 2” \(.+\)$/);
      expect(ana[1]).toBe('This is the model recording');
      expect(within(rowWith('Ana')).getByText('This is the model recording')).toHaveClass('bg-red-100');
      const copied = within(rowWith('Ben')).getByText('Same file as Ana’s recording');
      expect(copied).toHaveClass('bg-red-100');
      expect(copied).toHaveAttribute('title', expect.stringMatching(/^Their recording for “Cuento semana 2” \(.+\)\.$/));
      // The take it matched is gone: the flag stays, unnamed.
      expect(chipsOf('Cruz')).toEqual(['Same file as an earlier recording', 'Same file as another student’s recording']);
    });

    it('shows amber chips for a page that timed it much longer than the file, and for very little speaking; grey for an unreadable file', () => {
      h.submissions = [
        row({ id: 12, userId: 1, studentName: 'Ana', durationMs: 3000, voicedMs: 3000, clientDurationMs: 45_000, flags: ['length-mismatch'] }),
        row({ id: 20, userId: 2, studentName: 'Ben', voicedMs: 0, flags: ['little-speech'] }),
        row({ id: 30, userId: 3, studentName: 'Cruz', flags: ['unmeasured'] }),
        row({ id: 40, userId: 4, studentName: 'Dani', flags: [] }),
      ];
      renderReview();

      expect(within(rowWith('Ana')).getByText('The page timed it at 0:45; the file is 0:03')).toHaveClass('bg-amber-100');
      // The length shown is the file's.
      expect(rowWith('Ana')).toHaveTextContent('0:03');
      expect(within(rowWith('Ben')).getByText('Very little speaking')).toHaveClass('bg-amber-100');
      expect(within(rowWith('Cruz')).getByText('Length not checked: the file could not be read')).toHaveClass('bg-gray-100');
      expect(chipsOf('Dani')).toEqual([]);
    });

    it('carries a red flag from an earlier attempt up to the take that counts, but not an amber one', async () => {
      const user = userEvent.setup();
      h.submissions = [
        row({ id: 12, userId: 1, studentName: 'Ana', attempts: 3, flags: [] }),
        row({ id: 11, userId: 1, studentName: 'Ana', attempts: 3, flags: ['copied', 'little-speech'], copiedFrom: match('Ben', 'Cuento semana 3') }),
        row({ id: 10, userId: 1, studentName: 'Ana', attempts: 3, flags: ['copied', 'length-mismatch'], copiedFrom: match('Ben', 'Cuento semana 3'), clientDurationMs: 90_000 }),
      ];
      renderReview();

      // Once, however many earlier takes had it.
      expect(chipsOf('3 attempts')).toEqual(['Same file as Ben’s recording · earlier attempt']);

      await user.click(screen.getByLabelText('Show earlier attempts'));
      const earlier = studentRows().filter((r) => r.textContent?.includes('Ana · earlier'));
      expect(within(earlier[0]).getByText('Very little speaking')).toBeInTheDocument();
      expect(within(earlier[0]).getByText('Same file as Ben’s recording')).toBeInTheDocument();
      expect(within(earlier[1]).getByText(/The page timed it at 1:30/)).toBeInTheDocument();
    });

    it('does not repeat a red flag the take that counts already has', () => {
      h.submissions = [
        row({ id: 12, userId: 1, studentName: 'Ana', attempts: 2, flags: ['model'] }),
        row({ id: 11, userId: 1, studentName: 'Ana', attempts: 2, flags: ['model'] }),
      ];
      renderReview();
      expect(chipsOf('2 attempts')).toEqual(['This is the model recording']);
    });

    it('shows what the student’s browser applied to the microphone, under the recording', async () => {
      const user = userEvent.setup();
      h.submissions = [
        row({ id: 12, userId: 1, studentName: 'Ana', micSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, sampleRate: 44_100 } }),
        row({ id: 20, userId: 2, studentName: 'Ben', micSettings: null }),
      ];
      renderReview();
      await user.click(within(rowWith('Ana')).getByRole('button', { name: 'Listen' }));
      expect(screen.getByText('Microphone processing: Echo cancellation: Off · Noise suppression: Off · Automatic gain: On · 44.1 kHz')).toBeInTheDocument();
      await user.click(within(rowWith('Ben')).getByRole('button', { name: 'Listen' }));
      expect(screen.queryByText(/^Microphone processing/)).toBeNull();
    });

    it('says where "Spoke for" comes from', () => {
      renderReview();
      expect(screen.getByText('Spoke for is measured by the student’s page, capped at the file’s real length.')).toBeInTheDocument();
    });
  });

  it('lists who has not turned it in', () => {
    h.missing = [{ id: 3, name: 'Carla', email: 'carla@example.com' }];
    renderReview();

    expect(screen.getByRole('heading', { name: 'Not turned in (1)' })).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();
  });
});
