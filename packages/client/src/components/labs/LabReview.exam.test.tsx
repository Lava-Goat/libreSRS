// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A test's Review page (v1.19.0): it says the lab is a form of its exam set,
 * and in place of "Still to do" lists who started this form, with Reset and a
 * link to the whole set. A practice lab's page has neither.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabReview from './LabReview';

const h = vi.hoisted(() => ({
  lab: {} as Record<string, unknown>,
  rosterInputs: [] as unknown[],
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      labs: {
        submissions: { invalidate: async () => {} },
        adminList: { invalidate: async () => {} },
        examRoster: { invalidate: async () => {} },
        examSets: { invalidate: async () => {} },
      },
    }),
    labs: {
      submissions: {
        useQuery: () => ({
          data: { lab: h.lab, submissions: [], summary: { byStudent: [], done: 0, redo: 0, check: 0 } },
          isLoading: false,
          error: null,
        }),
      },
      missing: { useQuery: () => ({ data: [{ id: 8, name: 'Hugo', opened: false, started: false, heardThroughMs: null, skips: 0, lastSeenAt: null }], error: null }) },
      listenLog: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      setCredit: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({ updated: 0, rows: [] }) }) },
      examRoster: {
        useQuery: (input: unknown) => {
          h.rosterInputs.push(input);
          return {
            data: {
              examSet: 'U3',
              labs: [],
              students: [{
                userId: 2, name: 'Ana López', email: 'ana@students.school.test', assigned: true, earlier: [],
                current: {
                  startId: 11, labId: 41, labTitle: 'Examen U3 · Forma A', source: 'start', startedAt: Date.parse('2026-10-08T16:05:00Z'),
                  heardThroughMs: 47_000, durationMs: 100_000, requiredThroughMs: 95_000, finished: false,
                  lastSeenAt: Date.parse('2026-10-08T16:06:00Z'), resetAt: null, resetByName: null,
                },
              }],
            },
            isLoading: false,
            error: null,
          };
        },
      },
      resetExamStart: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }) },
    },
  },
}));

const baseLab = {
  id: 41,
  title: 'Examen U3 · Forma A',
  durationMs: 100_000,
  requiredThroughMs: 95_000,
  minimumVoicedMs: 6_000,
  pauseCount: null,
  pauseTotal: null,
  pauseScan: null,
  pauseCountUntilMs: null,
  needsCheck: false,
  settings: { minAnsweredPct: 75, voicePerPauseMs: 250 },
  needed: null,
};

beforeEach(() => {
  h.rosterInputs.length = 0;
});

describe('LabReview of a test', () => {
  it('says it is a form of its set, and lists who started this form in place of Still to do', async () => {
    h.lab = { ...baseLab, examSet: 'U3' };
    const onOpenSet = vi.fn();
    render(<LabReview labId={41} onBack={() => {}} onOpenSet={onOpenSet} />);
    expect(screen.getByText("Test · exam set U3: one start per student across the set's forms.")).toBeInTheDocument();
    // No pause rule for a test.
    expect(screen.queryByText(/No pause list yet/)).toBeNull();
    expect(screen.queryByRole('heading', { name: /Still to do/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Starts on this form' })).toBeInTheDocument();
    expect(h.rosterInputs[0]).toEqual({ examSet: 'U3', labId: 41 });
    expect(screen.getByRole('button', { name: 'Reset: Ana López' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All students in U3' }));
    expect(onOpenSet).toHaveBeenCalledWith('U3');
  });

  it('a practice lab keeps Still to do, and has no test line or roster', () => {
    h.lab = { ...baseLab, title: 'ES1 Lab semana06', examSet: null };
    render(<LabReview labId={41} onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Still to do (1)' })).toBeInTheDocument();
    expect(screen.getByText('Hugo')).toBeInTheDocument();
    expect(screen.queryByText(/exam set/)).toBeNull();
    expect(h.rosterInputs).toEqual([]);
  });
});
