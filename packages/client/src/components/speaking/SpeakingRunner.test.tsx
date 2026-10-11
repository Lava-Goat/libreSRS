// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpeakingRunner from './SpeakingRunner';

type Mine = {
  id: number;
  audioUrl: string;
  durationMs: number;
  submittedAt: string;
  score?: number | null;
  feedback?: string | null;
  gradedAt?: string | null;
  littleSpeech?: boolean;
};

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  task: null as unknown,
  invalidate: async () => {},
  /** The fake microphone's level: every sample the analyser reads is this value. */
  amplitude: 0,
  /** How many times the page has read the analyser: one per meter tick. */
  reads: 0,
  uploads: [] as { url: string; headers: Record<string, string> }[],
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      speaking: {
        get: { invalidate: h.invalidate, getData: () => h.task },
        list: { invalidate: h.invalidate },
      },
    }),
    speaking: {
      get: { useQuery: () => ({ data: h.task, isLoading: false, error: null }) },
    },
  },
}));

vi.mock('../../api/rawUpload', () => ({
  uploadRaw: async (url: string, _body: Blob, headers: Record<string, string>) => {
    h.uploads.push({ url, headers });
    return { success: true };
  },
  UploadError: class UploadError extends Error { status = 0; },
}));

// The browser's recording formats and the WebM repair are tested in utils/recording.test.ts.
vi.mock('../../utils/recording', () => ({
  pickRecordingMimeType: () => 'audio/webm',
  withWebmDuration: async (blob: Blob) => blob,
}));

const mine = (overrides: Partial<Mine>): Mine => ({
  id: 1,
  audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000001.webm',
  durationMs: 31_000,
  submittedAt: '2026-09-25T15:00:00.000Z',
  score: null,
  feedback: null,
  gradedAt: null,
  littleSpeech: false,
  ...overrides,
});

const taskWith = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  title: 'Cuento semana 3',
  instructions: null,
  referenceText: 'Había una vez una niña que vivía en el bosque.',
  recitesFromMemory: false,
  modelAudioUrl: null,
  targetSeconds: 30,
  attempts: 0,
  maxAttempts: 10,
  mySubmissions: [] as Mine[],
  ...overrides,
});

const renderRunner = () => render(<SpeakingRunner taskId={7} onExit={() => {}} />);
const turnedIn = () => within(screen.getByRole('heading', { name: 'What you have turned in' }).parentElement!).getAllByRole('listitem');

describe('SpeakingRunner: what the student has turned in', () => {
  beforeEach(() => {
    h.task = taskWith();
  });

  it('shows the teacher’s grade and comment under each recording, and "Not graded yet." only on the newest', () => {
    h.task = taskWith({
      attempts: 3,
      mySubmissions: [
        mine({ id: 3, submittedAt: '2026-09-26T15:00:00.000Z' }),
        mine({ id: 2, submittedAt: '2026-09-25T15:00:00.000Z', score: 87.5, feedback: 'Las "e" muy bien.\nOtra vez la "o".', gradedAt: '2026-09-25T18:00:00.000Z' }),
        mine({ id: 1, submittedAt: '2026-09-24T15:00:00.000Z', score: 70, gradedAt: '2026-09-24T18:00:00.000Z' }),
      ],
    });
    renderRunner();

    const [newest, graded, older] = turnedIn();
    expect(newest).toHaveTextContent('Not graded yet.');
    expect(newest).not.toHaveTextContent('Grade:');
    expect(newest).not.toHaveTextContent('Your teacher\'s comment');

    expect(graded).toHaveTextContent('Grade: 87.5 out of 100');
    expect(within(graded).getByText('Your teacher\'s comment')).toBeInTheDocument();
    const comment = within(graded).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Las "e" muy bien.\nOtra vez la "o".');
    expect(comment).toHaveClass('whitespace-pre-wrap');
    expect(graded).not.toHaveTextContent('Not graded yet.');

    // A grade with no comment: no comment label.
    expect(older).toHaveTextContent('Grade: 70 out of 100');
    expect(older).not.toHaveTextContent('Your teacher\'s comment');
    expect(older).not.toHaveTextContent('Not graded yet.');

    expect(screen.getAllByText('Not graded yet.')).toHaveLength(1);
  });

  it('shows a grade of 0 as a grade', () => {
    h.task = taskWith({ attempts: 1, mySubmissions: [mine({ score: 0, gradedAt: '2026-09-25T18:00:00.000Z' })] });
    renderRunner();

    expect(turnedIn()[0]).toHaveTextContent('Grade: 0 out of 100');
    expect(screen.queryByText('Not graded yet.')).toBeNull();
  });

  it('says a graded newest recording is graded, and asks nothing of older ungraded ones', () => {
    h.task = taskWith({
      attempts: 2,
      mySubmissions: [
        mine({ id: 2, score: 95, feedback: 'Excelente', gradedAt: '2026-09-26T18:00:00.000Z' }),
        mine({ id: 1 }),
      ],
    });
    renderRunner();

    const [newest, older] = turnedIn();
    expect(newest).toHaveTextContent('Grade: 95 out of 100');
    expect(newest).toHaveTextContent('Excelente');
    expect(older.textContent).not.toMatch(/Grade|Not graded yet/);
  });

  it('treats a recording from a page cached before grades (no grade fields) as not graded', () => {
    const cached: Partial<Mine> = mine({ id: 4 });
    delete cached.score;
    delete cached.feedback;
    delete cached.gradedAt;
    h.task = taskWith({ attempts: 1, mySubmissions: [cached] });
    renderRunner();

    expect(turnedIn()[0]).toHaveTextContent('Not graded yet.');
    expect(turnedIn()[0]).not.toHaveTextContent('undefined');
  });
});

// --- recording, with a fake microphone -------------------------------------

class FakeAudioContext {
  destination = {};
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createAnalyser() {
    return {
      fftSize: 2048,
      getFloatTimeDomainData: (a: Float32Array) => { h.reads += 1; a.fill(h.amplitude); },
      connect: (next: unknown) => next,
    };
  }
  createGain() { return { gain: { value: 1 }, connect: (next: unknown) => next }; }
  createMediaStreamSource() { return { connect: (next: unknown) => next }; }
}

class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

describe('SpeakingRunner: recording against the target length', () => {
  let now = 0;
  const saved = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
    AudioContext: window.AudioContext,
    MediaRecorder: (globalThis as { MediaRecorder?: unknown }).MediaRecorder,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  beforeEach(() => {
    now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    h.amplitude = 0;
    h.uploads.length = 0;
    const track = {
      stop: () => {},
      addEventListener: () => {},
      getSettings: () => ({ deviceId: 'abc', echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000 }),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
    URL.createObjectURL = () => 'blob:take';
    URL.revokeObjectURL = () => {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', saved.mediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    window.AudioContext = saved.AudioContext;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = saved.MediaRecorder;
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
  });

  /** A quiet room: about −60 dBFS. */
  const ROOM = 0.001;
  /** A voice: about −20 dBFS, 40 dB over the room. */
  const VOICE = 0.1;

  /**
   * Moves the page's clock on by `stepMs` and waits for the meter to read the
   * microphone once at `amplitude`. Readings in between add no time (the clock
   * stood still), so each step is one reading of `stepMs`, as a throttled tab takes it.
   */
  async function tick(stepMs: number, amplitude: number) {
    h.amplitude = amplitude;
    now += stepMs;
    const before = h.reads;
    await waitFor(() => expect(h.reads).toBeGreaterThan(before));
  }

  /** Turns the microphone on and lets the check hear the room for a few readings. */
  async function micCheck(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Turn on the microphone' }));
    await screen.findByRole('button', { name: 'Start recording' });
    for (let i = 0; i < 3; i++) await tick(50, ROOM);
  }

  /**
   * Records a take of `ms` in 1 s readings and waits for the review card.
   * `voice` says whether the student speaks (two readings in three) or is silent.
   */
  async function recordTake(ms: number, onRecording?: () => Promise<void>, voice = true) {
    const user = userEvent.setup();
    renderRunner();
    await micCheck(user);
    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    for (let at = 0, i = 0; at < ms; at += 1000, i++) {
      await tick(Math.min(1000, ms - at), voice && i % 3 !== 0 ? VOICE : ROOM);
    }
    await onRecording?.();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByRole('heading', { name: 'Your recording' });
    return user;
  }

  const warning = /This is much shorter than the/;

  it('shows the target next to the recording clock', async () => {
    h.task = taskWith({ targetSeconds: 30 });
    await recordTake(14_000, async () => {
      // The clock re-renders every 200 ms while recording.
      expect(await screen.findByText('0:14 / 0:30')).toBeInTheDocument();
    });
  });

  it('shows the clock alone when the task has no target', async () => {
    h.task = taskWith({ targetSeconds: null });
    await recordTake(14_000, async () => {
      expect(await screen.findByText('0:14')).toBeInTheDocument();
    });
  });

  it('warns, without an alert role, when the take is far under the target (0:14 of 0:30)', async () => {
    h.task = taskWith({ targetSeconds: 30 });
    await recordTake(14_000);

    const shown = screen.getByText('This is much shorter than the 0:30 goal. Check that you did all of it.');
    expect(shown.tagName).toBe('P');
    expect(shown).not.toHaveAttribute('role');
    expect(shown.closest('[role]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Still only a warning: the take can be turned in.
    expect(screen.getByRole('button', { name: 'Turn it in' })).toBeEnabled();
  });

  it('does not warn about a whole-passage take near the target (0:27 of 0:30)', async () => {
    h.task = taskWith({ targetSeconds: 30 });
    await recordTake(27_000);
    expect(screen.queryByText(warning)).toBeNull();
  });

  it('warns under 60% of the target, not at it', async () => {
    h.task = taskWith({ targetSeconds: 30 });
    await recordTake(18_000);
    expect(screen.queryByText(warning)).toBeNull();
  });

  it('just under 60% warns', async () => {
    h.task = taskWith({ targetSeconds: 30 });
    await recordTake(17_900);
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it('never warns when the task has no target', async () => {
    h.task = taskWith({ targetSeconds: null });
    await recordTake(1_000);
    expect(screen.queryByText(warning)).toBeNull();
  });
});

describe('SpeakingRunner: how much of a take is voice (v1.16.0)', () => {
  let now = 0;
  const saved = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
    AudioContext: window.AudioContext,
    MediaRecorder: (globalThis as { MediaRecorder?: unknown }).MediaRecorder,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const ROOM = 0.001;
  const VOICE = 0.1;
  const quietNote = 'We could hardly hear you. Listen back, and record it again closer to the microphone if your voice is hard to hear.';

  beforeEach(() => {
    now = 1_000;
    h.task = taskWith({ targetSeconds: null });
    h.amplitude = 0;
    h.uploads.length = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const track = {
      stop: () => {},
      addEventListener: () => {},
      getSettings: () => ({ deviceId: 'abc', groupId: 'g', echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000 }),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
    URL.createObjectURL = () => 'blob:take';
    URL.revokeObjectURL = () => {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', saved.mediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    window.AudioContext = saved.AudioContext;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = saved.MediaRecorder;
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
  });

  async function tick(stepMs: number, amplitude: number) {
    h.amplitude = amplitude;
    now += stepMs;
    const before = h.reads;
    await waitFor(() => expect(h.reads).toBeGreaterThan(before));
  }

  /** Records with these readings (ms, level) after a mic check in a quiet room. */
  async function record(readings: [number, number][], onRecording?: () => Promise<void>) {
    const user = userEvent.setup();
    renderRunner();
    await user.click(screen.getByRole('button', { name: 'Turn on the microphone' }));
    await screen.findByRole('button', { name: 'Start recording' });
    for (let i = 0; i < 3; i++) await tick(50, ROOM);
    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    for (const [ms, level] of readings) await tick(ms, level);
    await onRecording?.();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByRole('heading', { name: 'Your recording' });
    return user;
  }

  /** 1 s readings: `voiced` of them with a voice, then `quiet` of them in the room. */
  const speech = (voiced: number, quiet: number): [number, number][] => [
    ...Array.from({ length: voiced }, (): [number, number] => [1000, VOICE]),
    ...Array.from({ length: quiet }, (): [number, number] => [1000, ROOM]),
  ];

  it('counts a voice over the take’s own quiet level, and offers Turn it in first', async () => {
    const user = await record(speech(6, 4));
    expect(screen.getByText('Length 0:10 · you spoke for about 0:06')).toBeInTheDocument();
    expect(screen.queryByText(quietNote)).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn it in' })).toHaveClass('bg-blue-600');
    expect(screen.getByRole('button', { name: 'Record again' })).not.toHaveClass('bg-blue-600');

    await user.click(screen.getByRole('button', { name: 'Turn it in' }));
    await screen.findByText('Turned in. Your teacher can listen to it now.');
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].headers).toMatchObject({ 'x-recording-duration-ms': '10000', 'x-recording-voiced-ms': '6000' });
  });

  it('sends what the browser says it applied to the microphone, never its device id', async () => {
    const user = await record(speech(6, 4));
    await user.click(screen.getByRole('button', { name: 'Turn it in' }));
    await screen.findByText('Turned in. Your teacher can listen to it now.');
    expect(JSON.parse(h.uploads[0].headers['x-mic-settings'])).toEqual({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48_000,
    });
  });

  it('puts Record it again first on a quiet take, and still lets the student turn it in anyway', async () => {
    const user = await record(speech(0, 12));
    expect(screen.getByText('Length 0:12 · you spoke for about 0:00')).toBeInTheDocument();
    const note = screen.getByText(quietNote);
    // A nudge, not an alert: the page's alerts stay the upload's.
    expect(note.closest('[role]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn it in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Record it again' })).toHaveClass('bg-blue-600');
    expect(screen.getByRole('button', { name: 'Turn it in anyway' })).not.toHaveClass('bg-blue-600');

    await user.click(screen.getByRole('button', { name: 'Turn it in anyway' }));
    await screen.findByText('Turned in. Your teacher can listen to it now.');
    expect(h.uploads[0].headers['x-recording-voiced-ms']).toBe('0');
  });

  it('calls a steady sound (a fan, a hum) the room, not a voice', async () => {
    await record(Array.from({ length: 10 }, (): [number, number] => [1000, VOICE]));
    expect(screen.getByText(quietNote)).toBeInTheDocument();
  });

  it('counts a hidden tab’s throttled readings by the time they stand for, up to 1.1 s each', async () => {
    // Readings 5 s apart (a tab left in the background): each counts 1.1 s at most.
    await record([[5000, VOICE], [5000, VOICE], [5000, ROOM], [5000, ROOM], [5000, VOICE], [5000, ROOM]]);
    expect(screen.getByText('Length 0:30 · you spoke for about 0:03')).toBeInTheDocument();
  });

  it('counts live over the room the mic check heard', async () => {
    await record(speech(3, 0), async () => {
      expect(await screen.findByText('You have spoken for 0:03.')).toBeInTheDocument();
    });
  });

  it('after a failed upload of a quiet take, Try again comes first', async () => {
    const { UploadError } = await import('../../api/rawUpload');
    const user = await record(speech(0, 12));
    const rawUpload = await import('../../api/rawUpload');
    vi.spyOn(rawUpload, 'uploadRaw').mockRejectedValueOnce(new UploadError('Submission failed', 500));
    await user.click(screen.getByRole('button', { name: 'Turn it in anyway' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Submission failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('bg-blue-600');
    expect(screen.getByRole('button', { name: 'Record again' })).toBeInTheDocument();
  });
});

describe('SpeakingRunner: a task already turned in (v1.16.0)', () => {
  beforeEach(() => {
    h.task = taskWith();
  });

  const heading = /^You turned this in on /;

  it('shows the turned-in take first, not the microphone, until the student asks to record again', async () => {
    const user = userEvent.setup();
    h.task = taskWith({ attempts: 1, mySubmissions: [mine({ submittedAt: '2026-09-25T15:00:00.000Z' })] });
    renderRunner();

    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText('Turned in. Your teacher can listen to it now.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on the microphone' })).toBeNull();
    const again = screen.getByRole('button', { name: 'Record it again' });
    expect(again).not.toHaveClass('bg-blue-600');

    const confirm = vi.spyOn(window, 'confirm');
    await user.click(again);
    // Nothing graded to lose: no question.
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn on the microphone' })).toBeInTheDocument();
    expect(screen.queryByText(heading)).toBeNull();
    confirm.mockRestore();
  });

  it('shows the teacher’s grade, and asks before a new take replaces the graded one', async () => {
    const user = userEvent.setup();
    h.task = taskWith({ attempts: 2, mySubmissions: [mine({ id: 2, score: 87.5, gradedAt: '2026-09-26T18:00:00.000Z' }), mine({ id: 1 })] });
    renderRunner();
    expect(screen.getByText('Your teacher graded it: 87.5 out of 100.')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Record it again' }));
    expect(confirm).toHaveBeenLastCalledWith(
      'Your teacher already graded this recording (87.5 out of 100). A new recording replaces it and will need a new grade. Record again?',
    );
    expect(screen.queryByRole('button', { name: 'Turn on the microphone' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Record it again' }));
    expect(screen.getByRole('button', { name: 'Turn on the microphone' })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('asks for a new take of a quiet one, with Record it again first', () => {
    h.task = taskWith({ attempts: 1, mySubmissions: [mine({ littleSpeech: true })] });
    renderRunner();
    expect(screen.getByText('We could hardly hear you. Record it again, closer to the microphone.')).toBeInTheDocument();
    expect(screen.queryByText('Turned in. Your teacher can listen to it now.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Record it again' })).toHaveClass('bg-blue-600');
  });

  it('at the attempt limit shows the take and the limit, and no way to record', () => {
    h.task = taskWith({ attempts: 10, mySubmissions: [mine({})] });
    renderRunner();
    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText('You have already turned this in 10 times. Ask your teacher before recording it again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record it again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on the microphone' })).toBeNull();
  });

  it('opens straight to the microphone for a task never turned in', () => {
    renderRunner();
    expect(screen.queryByText(heading)).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn on the microphone' })).toBeInTheDocument();
  });
});

describe('SpeakingRunner: a speaking test (v1.21.0)', () => {
  it('says it is a test, and its way back goes to the Tests page', async () => {
    const user = userEvent.setup();
    const exit = vi.fn();
    h.task = taskWith({ title: 'Examen U2 · Expresión oral', examSet: 'U2' });
    render(<SpeakingRunner taskId={7} onExit={exit} />);

    expect(screen.getByText('Test · U2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Examen U2 · Expresión oral' })).toBeInTheDocument();
    // Recorded like any task.
    expect(screen.getByRole('button', { name: 'Turn on the microphone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to speaking' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to tests' }));
    await waitFor(() => expect(exit).toHaveBeenCalledWith(true));
  });

  it('a practice task says Back to speaking, with no badge, and tells the page it is not a test', async () => {
    const user = userEvent.setup();
    const exit = vi.fn();
    h.task = taskWith({ examSet: null });
    render(<SpeakingRunner taskId={7} onExit={exit} />);

    expect(screen.queryByText(/^Test · /)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to speaking' }));
    await waitFor(() => expect(exit).toHaveBeenCalledWith(false));
  });

  it('opened from the Tests page, says Back to tests even for a task that is practice by then', async () => {
    const user = userEvent.setup();
    const exit = vi.fn();
    h.task = taskWith();
    render(<SpeakingRunner taskId={7} fromTests onExit={exit} />);

    await user.click(screen.getByRole('button', { name: 'Back to tests' }));
    await waitFor(() => expect(exit).toHaveBeenCalledWith(false));
  });
});
