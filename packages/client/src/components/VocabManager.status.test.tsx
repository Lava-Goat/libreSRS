// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// The test list's status pill shows what students actually see — the isOpen
// flag AND the opensAt/closesAt window (the server's isTestOpenNow rule) —
// not just the flag, and says what a click will do.
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabManager from './VocabManager';
import { vocabTestWindowState } from '../vocab/testWindow';

const toggleMutate = vi.fn();
let tests: Record<string, unknown>[] = [];

// Every other query on the page resolves to "no data", every mutation to a
// no-op; only listTests and updateTest matter here.
vi.mock('../api/trpc', () => {
  const invalidateProxy: unknown = new Proxy(() => undefined, { get: () => invalidateProxy, apply: () => undefined });
  const procedure = (path: string) => ({
    useQuery: () => ({ data: path === 'vocab.listTests' ? tests : undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
    useMutation: () => ({
      mutate: path === 'vocab.updateTest' ? toggleMutate : vi.fn(),
      mutateAsync: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn(),
    }),
  });
  const router = (prefix: string) => new Proxy({}, { get: (_t, key: string) => procedure(`${prefix}.${key}`) });
  return {
    trpc: new Proxy({}, {
      get: (_t, key: string) => (key === 'useUtils' ? () => invalidateProxy : router(key)),
    }),
  };
});

vi.mock('../i18n', () => ({
  useI18n: () => ({
    locale: 'en-US',
    t: (s: string, p?: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p?.[k] ?? '')),
    formatDate: (v: string | Date) => new Date(v).toLocaleDateString('en-US'),
  }),
}));

const NOW = new Date('2026-09-25T10:00:00Z');
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function makeTest(overrides: Record<string, unknown>) {
  return {
    id: 1, name: 'Sondeo semana 3', mode: 'size', occasion: null, settings: {},
    groups: [{ id: 1, name: 'P1' }], resultCount: 0,
    isOpen: true, opensAt: null, closesAt: null,
    ...overrides,
  };
}

function pill() {
  return screen.getByRole('button', { name: /Sondeo semana 3/ });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  toggleMutate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Vocabulómetro test status pill', () => {
  it('Closed: isOpen false, even inside the window; a click opens it', () => {
    tests = [makeTest({ isOpen: false, opensAt: iso(-HOUR), closesAt: iso(HOUR) })];
    render(<VocabManager />);
    const button = pill();
    expect(button.textContent).toBe('Closed');
    expect(button.getAttribute('data-state')).toBe('closed');
    expect(button.getAttribute('title')).toBe('Open “Sondeo semana 3” for students');
    expect(button.getAttribute('aria-label')).toBe('Closed: Open “Sondeo semana 3” for students');
    fireEvent.click(button);
    expect(toggleMutate).toHaveBeenCalledWith({ id: 1, isOpen: true });
  });

  it('Scheduled: isOpen but before opensAt, shows when it opens; a click closes it', () => {
    const opensAt = iso(2 * HOUR);
    tests = [makeTest({ opensAt, closesAt: iso(5 * HOUR) })];
    render(<VocabManager />);
    const button = pill();
    const when = new Date(opensAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    expect(button.getAttribute('data-state')).toBe('scheduled');
    expect(button.textContent).toBe(`ScheduledOpens ${when}`);
    expect(button.textContent).not.toMatch(/^Open\b/);
    expect(button.getAttribute('title')).toBe('Close “Sondeo semana 3” for students');
    expect(button.getAttribute('aria-label')).toBe(`Scheduled (Opens ${when}): Close “Sondeo semana 3” for students`);
    fireEvent.click(button);
    expect(toggleMutate).toHaveBeenCalledWith({ id: 1, isOpen: false });
  });

  it('Open: isOpen and inside the window (or no window at all)', () => {
    tests = [
      makeTest({ opensAt: iso(-HOUR), closesAt: iso(HOUR) }),
      makeTest({ id: 2, name: 'Sin ventana' }),
    ];
    render(<VocabManager />);
    const button = pill();
    expect(button.textContent).toBe('Open');
    expect(button.getAttribute('data-state')).toBe('open');
    expect(button.getAttribute('aria-label')).toBe('Open: Close “Sondeo semana 3” for students');
    expect(screen.getByRole('button', { name: /Sin ventana/ }).getAttribute('data-state')).toBe('open');
  });

  it('Ended: isOpen but after closesAt, shows when it closed', () => {
    const closesAt = iso(-HOUR);
    tests = [makeTest({ opensAt: iso(-5 * HOUR), closesAt })];
    render(<VocabManager />);
    const button = pill();
    const when = new Date(closesAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    expect(button.getAttribute('data-state')).toBe('ended');
    expect(button.textContent).toBe(`EndedEnded ${when}`);
    expect(button.getAttribute('aria-label')).toBe(`Ended (Ended ${when}): Close “Sondeo semana 3” for students`);
    fireEvent.click(button);
    expect(toggleMutate).toHaveBeenCalledWith({ id: 1, isOpen: false });
  });

  it('flips from Scheduled to Open to Ended as time passes, without a reload', () => {
    tests = [makeTest({ opensAt: iso(60_000), closesAt: iso(3 * 60_000) })];
    render(<VocabManager />);
    expect(pill().getAttribute('data-state')).toBe('scheduled');
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(pill().getAttribute('data-state')).toBe('open');
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(pill().getAttribute('data-state')).toBe('ended');
  });

  it('judges the window by the clock at render, not the last 30 s tick', () => {
    // The teacher saves opensAt = now + 10 s; 20 s later (no interval tick
    // yet) the listTests refetch re-renders the list. Students can already
    // take the test, so the pill must say Open, not Scheduled.
    tests = [makeTest({ opensAt: iso(10_000), closesAt: iso(HOUR) })];
    const { rerender } = render(<VocabManager />);
    expect(pill().getAttribute('data-state')).toBe('scheduled');
    vi.setSystemTime(new Date(NOW.getTime() + 20_000));
    tests = [makeTest({ opensAt: iso(10_000), closesAt: iso(HOUR) })];
    rerender(<VocabManager />);
    expect(pill().getAttribute('data-state')).toBe('open');
  });

  it('re-evaluates when a background tab becomes visible again', () => {
    tests = [makeTest({ opensAt: iso(10_000), closesAt: iso(HOUR) })];
    render(<VocabManager />);
    expect(pill().getAttribute('data-state')).toBe('scheduled');
    vi.setSystemTime(new Date(NOW.getTime() + 20_000));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(pill().getAttribute('data-state')).toBe('open');
  });

  it('Invalid window: isOpen but closes before it opens, promises no opening', () => {
    tests = [makeTest({ opensAt: iso(2 * HOUR), closesAt: iso(HOUR) })];
    render(<VocabManager />);
    const button = pill();
    expect(button.getAttribute('data-state')).toBe('invalid');
    expect(button.textContent).toBe('Invalid windowCloses before it opens');
    expect(button.textContent).not.toMatch(/Opens/);
    expect(button.getAttribute('aria-label')).toBe('Invalid window (Closes before it opens): Close “Sondeo semana 3” for students');
    // It never turns into Open, whatever the time.
    vi.setSystemTime(new Date(NOW.getTime() + 90 * 60_000));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(pill().getAttribute('data-state')).toBe('invalid');
  });
});

describe('test form window check', () => {
  function openEditor() {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  }
  function dateInputs() {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'));
  }

  it('blocks saving a window that closes before it opens', () => {
    tests = [makeTest({ isOpen: false })];
    render(<VocabManager />);
    openEditor();
    const [opens, closes] = dateInputs();
    fireEvent.change(opens, { target: { value: '2026-09-26T10:00' } });
    fireEvent.change(closes, { target: { value: '2026-09-26T09:00' } });
    expect(screen.getByRole('alert').textContent).toBe('The closing time must be after the opening time.');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);

    fireEvent.change(closes, { target: { value: '2026-09-26T11:00' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
  });
});

describe('vocabTestWindowState (mirrors the server isTestOpenNow)', () => {
  const now = NOW.getTime();
  it('treats both window ends as inclusive, like the server', () => {
    expect(vocabTestWindowState({ isOpen: true, opensAt: iso(0), closesAt: iso(0) }, now)).toBe('open');
    expect(vocabTestWindowState({ isOpen: true, opensAt: iso(1), closesAt: null }, now)).toBe('scheduled');
    expect(vocabTestWindowState({ isOpen: true, opensAt: null, closesAt: iso(-1) }, now)).toBe('ended');
    expect(vocabTestWindowState({ isOpen: false, opensAt: null, closesAt: null }, now)).toBe('closed');
  });

  it('calls an inverted window invalid at every point in time, not scheduled', () => {
    const inverted = { isOpen: true, opensAt: iso(2 * HOUR), closesAt: iso(HOUR) };
    for (const t of [now, now + 90 * 60_000, now + 3 * HOUR]) {
      expect(vocabTestWindowState(inverted, t)).toBe('invalid');
    }
    expect(vocabTestWindowState({ ...inverted, isOpen: false }, now)).toBe('closed');
  });
});
