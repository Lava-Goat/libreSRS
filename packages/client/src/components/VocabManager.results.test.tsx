// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Teacher results panel: class tables leave quality-flagged attempts out (as
// the per-student profile does) and say so per table; the Anuario reads its
// per-word states from the census endpoint; nothing is truncated silently.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VocabResultsPanel } from './VocabManager';

interface Row {
  id: number; testId: number; testName: string; userId: number; userName: string; userEmail: string;
  mode: string; seed: number; blk: string | null; form: string | null; occasion: string | null;
  summaryJson: string; censusItems: number | null; qualityJson: string | null; completedAt: string; durationMs: number | null;
}

let results: Row[] = [];
let censusResults: Row[] = [];
let itemStats: Record<string, unknown> = { attempts: 0, items: [], truncated: false, maxAttempts: 2000 };
const censusQueryCalls: { enabled: boolean | undefined }[] = [];

vi.mock('../api/trpc', () => {
  const inv = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({ vocab: { getResults: inv, getCensusResults: inv, listTests: inv } }),
      vocab: {
        getResults: { useQuery: () => ({ data: results }) },
        getCensusResults: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
            censusQueryCalls.push({ enabled: opts?.enabled });
            return { data: opts?.enabled === false ? undefined : censusResults };
          },
        },
        deleteResult: { useMutation: () => ({ mutate: vi.fn() }) },
        getItemStats: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
            data: opts?.enabled ? itemStats : undefined, isFetching: false, isError: false, error: null, refetch: vi.fn(),
          }),
        },
      },
    },
  };
});

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (s: string, p?: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p?.[k] ?? '')),
    formatDate: (v: Date | string | number) => new Date(v).toISOString().slice(0, 10),
  }),
}));

const SIZE = { v: 1, yn: { bands: [[10, 9], [10, 7], [12, 6], [10, 3], [8, 1]], ps: [15, 1] } };
/** A size summary saying "sí" to `y` of 10 words in every band, no false alarms: coverage rises 8.8 pts per step of y. */
const sizeSummary = (y: number) => JSON.stringify({ v: 1, yn: { bands: [[10, y], [10, y], [10, y], [10, y], [10, y]], ps: [10, 0] } });
const FLAG = JSON.stringify({ flagged: true, faRate: 0.4, medianMs: 500, fastYesShare: 0.9 });
const CLEAN = JSON.stringify({ flagged: false, faRate: 0.05, medianMs: 1500, fastYesShare: 0.1 });

let nextId = 1;
function row(userId: number, occasion: string, date: string, over: Partial<Row> = {}): Row {
  return {
    id: nextId++, testId: 1, testName: 'Tamaño', userId, userName: `Alumno ${userId}`, userEmail: `a${userId}@x.test`,
    mode: 'size', seed: 0, blk: null, form: null, occasion,
    summaryJson: JSON.stringify(SIZE), censusItems: null, qualityJson: CLEAN,
    completedAt: `${date}T15:00:00.000Z`, durationMs: 1000, ...over,
  };
}

/** The table that follows a section heading (skipping notes in between). */
function tableAfter(heading: string): HTMLTableElement {
  let el = screen.getByText(heading, { exact: false, selector: 'h3' }).nextElementSibling;
  while (el && el.tagName !== 'TABLE' && !el.querySelector('table')) el = el.nextElementSibling;
  if (!el) throw new Error(`no table after ${heading}`);
  return (el.tagName === 'TABLE' ? el : el.querySelector('table')) as HTMLTableElement;
}

/** A paired-growth row's Δ cobertura and Δ tamaño cells for one student. */
function growthRow(table: HTMLTableElement, name: string): string[] {
  const tr = within(table).getAllByRole('row').find((r) => r.querySelector('td')?.textContent === name);
  if (!tr) throw new Error(`no growth row for ${name}`);
  return [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent ?? '');
}

function nFor(table: HTMLTableElement, occasion: string): string {
  const tr = within(table).getAllByRole('row').find((r) => r.querySelector('td')?.textContent === occasion);
  if (!tr) throw new Error(`no row ${occasion}`);
  return tr.querySelectorAll('td')[1].textContent ?? '';
}

const renderPanel = () => render(<VocabResultsPanel tests={[{ id: 1, name: 'Tamaño' }]} resultsTestId="all" setResultsTestId={() => {}} />);

beforeEach(() => {
  nextId = 1;
  censusResults = [];
  censusQueryCalls.length = 0;
  itemStats = { attempts: 0, items: [], truncated: false, maxAttempts: 2000 };
  results = [
    // baseline: two clean students + one flagged attempt
    row(1, '2026-08', '2026-08-20', { summaryJson: sizeSummary(4) }),
    row(2, '2026-08', '2026-08-20', { summaryJson: sizeSummary(6) }),
    row(3, '2026-08', '2026-08-20', { qualityJson: FLAG }),
    // middle occasion: one clean, one flagged
    row(1, '2026-09', '2026-09-20'), row(2, '2026-09', '2026-09-20', { qualityJson: FLAG }),
    // latest: student 1 has an earlier clean attempt, a later clean one and,
    // last of all, a flagged retake, each with a different summary
    row(1, '2026-10', '2026-10-01', { summaryJson: sizeSummary(5) }),
    row(2, '2026-10', '2026-10-01', { summaryJson: sizeSummary(8) }),
    row(1, '2026-10', '2026-10-02', { summaryJson: sizeSummary(7) }),
    row(1, '2026-10', '2026-10-03', { summaryJson: sizeSummary(10), qualityJson: FLAG }),
  ].reverse(); // server order: newest first
});

describe('VocabResultsPanel · attempt quality in class statistics', () => {
  it('leaves flagged attempts out of the per-occasion table and paired growth, and says how many', () => {
    renderPanel();
    const table = tableAfter('Tamaño y cobertura (escrito) · por ocasión');
    expect(nFor(table, '2026-08')).toBe('2');
    expect(nFor(table, '2026-09')).toBe('1');
    expect(nFor(table, '2026-10')).toBe('3');
    // per-mode table: all 3 flagged attempts; growth (first + last occasion only): 2
    expect(screen.getByText(/⚠ 3 intento\(s\) marcado\(s\) por baja calidad excluido\(s\)/)).toBeTruthy();
    expect(screen.getByText(/⚠ 2 intento\(s\) marcado\(s\) por baja calidad excluido\(s\)/)).toBeTruthy();
    // growth pairs each student's latest CLEAN attempt in each endpoint occasion.
    // Student 1: 4 → 7 (not the flagged retake's 10, +52.8 pts; not the
    // earlier clean attempt's 5, +8.8 pts). Student 2: 6 → 8.
    expect(screen.getByText(/n=2 parejas/)).toBeTruthy();
    const growth = tableAfter('Crecimiento pareado');
    expect(growthRow(growth, 'Alumno 1')).toEqual(['+26.4 pts', '+1,500']);
    expect(growthRow(growth, 'Alumno 2')).toEqual(['+17.6 pts', '+1,000']);
    expect(within(growth).getAllByRole('row')).toHaveLength(1 + 2);
  });

  it('the checkbox brings the flagged attempts back into the class tables', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Include flagged attempts in class tables'));
    const table = tableAfter('Tamaño y cobertura (escrito) · por ocasión');
    expect(nFor(table, '2026-08')).toBe('3');
    expect(nFor(table, '2026-09')).toBe('2');
    expect(nFor(table, '2026-10')).toBe('4');
    expect(screen.getByText(/Incluye 3 intento\(s\) marcado\(s\)/)).toBeTruthy();
    expect(screen.queryByText(/excluido\(s\) de esta tabla/)).toBeNull();
  });

  it('applies the same rule to the mastery, C-test and elicited-imitation tables', () => {
    results = [
      row(1, 'o1', '2026-08-20', { mode: 'mastery', summaryJson: JSON.stringify({ v: 1, mc: { n: 10, c: 8, w: 2, o: 0 } }) }),
      row(2, 'o1', '2026-08-20', { mode: 'mastery', summaryJson: JSON.stringify({ v: 1, mc: { n: 10, c: 2, w: 8, o: 0 } }), qualityJson: FLAG }),
      row(1, 'o1', '2026-08-20', { mode: 'ctest', summaryJson: JSON.stringify({ v: 1, ct: { n: 10, c: 5, cl: 6 } }) }),
      row(2, 'o1', '2026-08-20', { mode: 'ctest', summaryJson: JSON.stringify({ v: 1, ct: { n: 10, c: 1, cl: 1 } }), qualityJson: FLAG }),
      row(1, 'o1', '2026-08-20', { mode: 'ei', summaryJson: JSON.stringify({ v: 1, ei: { n: 5, sum: 4 } }), qualityJson: FLAG }),
    ];
    renderPanel();
    expect(nFor(tableAfter('Dominio Top 500 · por ocasión'), 'o1')).toBe('1');
    expect(nFor(tableAfter('C-test · por ocasión'), 'o1')).toBe('1');
    // every EI attempt is flagged: the section stays, with the note and no table
    const eiHeading = screen.getByText('Imitación provocada (habla) · por ocasión', { selector: 'h3' });
    expect(eiHeading.parentElement?.querySelector('table')).toBeNull();
    expect(screen.getAllByText(/⚠ 1 intento\(s\) marcado\(s\) por baja calidad excluido\(s\)/)).toHaveLength(3);
  });
});

describe('VocabResultsPanel · Anuario from the census endpoint', () => {
  const RES = [[0, 2], [1, 2], [2, 1]];
  beforeEach(() => {
    // getResults' summary shape: per-word states stripped, their count alongside
    results = [
      row(1, 'b1', '2026-09-01', { mode: 'c500', blk: '1', summaryJson: JSON.stringify({ v: 2, ps: [5, 0] }), censusItems: 3 }),
      row(2, 'b1', '2026-09-01', { mode: 'c500', blk: '1', summaryJson: JSON.stringify({ v: 2, ps: [5, 4] }), censusItems: 3, qualityJson: FLAG }),
    ];
    censusResults = [
      { ...results[0], summaryJson: JSON.stringify({ v: 2, res: RES, ps: [5, 0] }) },
      { ...results[1], summaryJson: JSON.stringify({ v: 2, res: RES, ps: [5, 4] }) },
    ];
  });

  it('builds the ledger from getCensusResults, leaving flagged blocks out unless included', () => {
    renderPanel();
    expect(censusQueryCalls.some((c) => c.enabled === true)).toBe(true);
    const anuario = tableAfter('Anuario · censo y sondeo');
    expect(within(anuario).getByText('Alumno 1')).toBeTruthy();
    expect(within(anuario).queryByText('Alumno 2')).toBeNull();
    // 2 of the 3 censused top-500 words verified
    expect(within(anuario).getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText(/⚠ 1 intento\(s\) marcado\(s\) por baja calidad excluido\(s\)/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Include flagged attempts in class tables'));
    expect(within(tableAfter('Anuario · censo y sondeo')).getByText('Alumno 2')).toBeTruthy();
  });

  it('labels census records from the server-side word count', () => {
    renderPanel();
    expect(screen.getAllByText('c500 bloque 1 · 3 palabras')).toHaveLength(2);
  });

  it('does not ask for census data when there are no census results', () => {
    results = [row(1, 'o', '2026-08-20')];
    renderPanel();
    expect(censusQueryCalls.every((c) => c.enabled === false)).toBe(true);
  });
});

describe('VocabResultsPanel · nothing truncated silently', () => {
  it('pages a long records table visibly instead of dropping rows', () => {
    results = Array.from({ length: 620 }, (_, i) => row(1 + (i % 40), 'o', '2026-08-20'));
    renderPanel();
    const recordsTable = tableAfter('Records');
    expect(within(recordsTable).getAllByRole('row')).toHaveLength(1 + 500);
    expect(screen.getByText(/Showing the newest 500 of 620 records\./)).toBeTruthy();
    fireEvent.click(screen.getByText('Show more'));
    expect(within(tableAfter('Records')).getAllByRole('row')).toHaveLength(1 + 620);
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it('warns when item statistics had to leave older attempts out', () => {
    itemStats = { attempts: 2000, items: [], truncated: true, maxAttempts: 2000 };
    renderPanel();
    fireEvent.click(screen.getByText('Compute item statistics'));
    expect(screen.getByText(/Hay más de 2,000 intentos con respuestas/)).toBeTruthy();
  });

  it('no item-statistics warning when everything fit', () => {
    itemStats = { attempts: 12, items: [], truncated: false, maxAttempts: 2000 };
    renderPanel();
    fireEvent.click(screen.getByText('Compute item statistics'));
    expect(screen.queryByText(/Hay más de/)).toBeNull();
  });
});
