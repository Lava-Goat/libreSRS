// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Accessibility scans (axe-core, WCAG 2.0–2.2 A and AA plus best practice) of
 * every main screen, in the light and the dark theme, and the conjugation
 * screens and guide again at a phone's width: students commonly use
 * Chromebooks, desktops and phones, and colour contrast is checked per theme.
 *
 * One screen per test, so one failing screen does not hide the next (the
 * teacher's walk through every guide chapter records each chapter softly).
 *
 * Runs in the chromium and mobile-safari projects only (playwright.config.ts
 * says why); on the phone the "conjugation on a phone" block would repeat itself.
 */
import { test, expect as baseExpect, type Page } from '@playwright/test';
import { expectNoA11yViolations, type A11yScanOptions } from './support/axe';
import { PAUSE_LAB_PAUSES, pauseLabMs, pauseLabWav, serveAudio } from './support/labWav';
import { SPEAKING, scriptedMicrophone, setMicLevel } from './support/scriptedMicrophone';
import {
  defaultAdminUser,
  defaultAiAdminConfig,
  defaultAuthUser,
  mockAdminTrpc,
  mockAuthenticatedTrpc,
  mockPublicTrpc,
  mockTrpc,
  conjugationSentencesPanel,
  conjugationSettingsView,
  defaultSetupStatus,
  sampleAdminDecks,
  sampleGroups,
  sampleUsers,
} from './support/trpcMock';

/**
 * Room for a lazy page's first load: run across five browsers at once, the dev
 * server can take longer than the default 5 s to compile a chunk the first time.
 */
const expect = baseExpect.configure({ timeout: 10_000 });

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];
/** An iPhone 14/15 held upright: the phone most students carry. */
const PHONE = { width: 390, height: 844 };
/** An iPhone SE / mini: 375 px wide, where a 390 px pass can hide a wrap (v1.24.0: the accent keys, the person cue). */
const SMALL_PHONE = { width: 375, height: 667 };

/** The theme as ThemeToggle keeps it, set before the page's first script reads it (index.html applies it pre-render). */
async function chooseTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('libresrs.theme', value); } catch { /* storage off: prefers-color-scheme decides */ }
  }, theme);
}

/** Scans the page as it stands, after checking the theme under test is the one showing. */
async function scan(page: Page, theme: Theme, label: string, options: A11yScanOptions = {}): Promise<void> {
  // Off every control: a hover colour left under the pointer by the last click would make the contrast check flaky.
  await page.mouse.move(0, 0);
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await expectNoA11yViolations(page, { ...options, label: `${label} (${theme})` });
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const deck = { id: 1, name: 'Unit 1', description: 'Core vocabulary deck', cardCount: 30, learnedCount: 10, dueCount: 4 };
const doneDeck = { id: 2, name: 'Unit 2', description: null, cardCount: 25, learnedCount: 25, dueCount: 0 };
const virtualDeck = { id: 1, name: 'My Subset', sourceDeckId: 1, sourceDeckName: 'Unit 1', cardSelection: '1-10', cardCount: 10 };
const stats = { totalReviews: 50, totalCards: 200, cardsLearnedToday: 10, reviewsToday: 25, currentStreak: 3 };
const openSizeTest = {
  id: 1, name: 'Tamaño y cobertura · Otoño', mode: 'size', occasion: 'Otoño 2026',
  settings: { bandCounts: [4, 4, 4, 4, 4], npseudo: 6, seed: 42 }, closesAt: null, myAttempts: 0,
};
const lab = {
  id: 1, title: 'ES1 Lab semana01', description: null, durationMs: 3000, requiredThroughMs: 2600, status: 'todo', redoByTeacher: false,
  submittedAt: null, attempts: 0, pausesAnswered: null, pausesCounted: null, needed: null,
};
const doneLab = { ...lab, id: 2, title: 'ES1 Lab semana02', status: 'done', submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1, pausesAnswered: 18, pausesCounted: 20, needed: 15 };
/** Turned in without counting, and waiting for the teacher: the list's amber lines. */
const redoLab = { ...lab, id: 3, title: 'ES1 Lab semana03', status: 'redo', attempts: 1, pausesAnswered: 3, pausesCounted: 20, needed: 15 };
const checkLab = { ...lab, id: 4, title: 'ES1 Lab semana04', status: 'check', attempts: 1, pausesAnswered: 0, pausesCounted: 20, needed: 15 };
const speakingListed = { id: 1, title: 'Cuento semana 3', targetSeconds: 60, submittedAt: null, attempts: 0 };
const speakingTask = {
  id: 1, title: 'Cuento semana 3', instructions: 'Recita el cuento de esta semana.',
  referenceText: 'Había una vez una niña que vivía en un pueblo pequeño.', recitesFromMemory: false,
  modelAudioUrl: null, targetSeconds: 60, attempts: 0, maxAttempts: 10, mySubmissions: [] as unknown[],
};
/** Two takes turned in: the newest not graded yet, the one before graded by the teacher, with a comment. */
const gradedSpeakingTask = {
  ...speakingTask,
  attempts: 2,
  mySubmissions: [
    { id: 5, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000005.webm', durationMs: 30_000, submittedAt: '2026-09-26T15:12:00.000Z', score: null, feedback: null, gradedAt: null },
    { id: 4, audioUrl: '/api/recordings/00000000-0000-4000-8000-000000000004.webm', durationMs: 29_000, submittedAt: '2026-09-25T15:12:00.000Z', score: 84, feedback: 'Keep your e short.', gradedAt: '2026-09-26T02:00:00.000Z' },
  ],
};
/** The Tests page (v1.21.0): U3's two forms not started and its speaking test; U2 started and turned in, its speaking test quiet. */
const examForm = (id: number, title: string, set: string, start: unknown = null) => ({
  ...lab, id, title, durationMs: 600_000, requiredThroughMs: 590_000, exam: { set, preview: false, start },
});
const u2Start = { labId: 51, title: 'Examen U2 · Escucha · Forma A', startedAt: Date.parse('2026-10-08T16:05:00Z'), finished: true };
const testLabs = [
  examForm(41, 'Examen U3 · Escucha · Forma A', 'U3'),
  examForm(42, 'Examen U3 · Escucha · Forma B', 'U3'),
  examForm(51, 'Examen U2 · Escucha · Forma A', 'U2', u2Start),
  examForm(52, 'Examen U2 · Escucha · Forma B', 'U2', u2Start),
];
const speakingTests = [
  { ...speakingListed, id: 7, title: 'Examen U3 · Expresión oral', littleSpeech: false, examSet: 'U3' },
  { ...speakingListed, id: 8, title: 'Examen U2 · Expresión oral', submittedAt: '2026-10-08T17:00:00.000Z', attempts: 1, littleSpeech: true, examSet: 'U2' },
];
const sheetListed = { id: 1, title: 'Show and tell', open: true, picksPerStudent: 2, myDates: [] as string[] };
const sheet = {
  id: 1, title: 'Show and tell', description: 'Pick two days to present something you found.',
  open: true, picksPerStudent: 2, showNames: true, today: '2099-03-01', myCount: 1,
  dates: [
    { id: 11, date: '2099-03-02', label: 'Day 31 · Rivers', capacity: 2, taken: 2, locked: false, mine: true, assigned: false,
      people: [{ you: false, name: 'Ana R.' }, { you: true, name: 'Test U.' }] },
    { id: 12, date: '2099-03-03', label: 'Day 32 · Volcanoes', capacity: 2, taken: 2, locked: false, mine: false, assigned: false,
      people: [{ you: false, name: 'Ana R.' }, { you: false, name: null }] },
    { id: 13, date: '2099-04-06', label: 'Day 50 · Experiments', capacity: 2, taken: 0, locked: false, mine: false, assigned: false, people: [] },
  ],
};
const conjugationQuiz = { deckId: 1, deckName: 'Unit 1', mastered: 12, total: 60, lastScore: 0.75 };

/** A short mono WAV of silence: enough for the lab player to load. */
function silentWav(seconds = 1): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(seconds * rate * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * A scored lab on the pause lab (support/labWav.ts) with a scripted
 * microphone: only its first pause counts and it needs it (so a silent pass
 * through it leaves "Missed that pause" and "can't count now" up to the end),
 * and a server that says the attempt did not count.
 */
async function openScoredLab(page: Page, begin: Record<string, unknown> = {}) {
  await scriptedMicrophone(page);
  await mockBusyStudent(page, {
    mutations: {
      'labs.begin': {
        ...lab, durationMs: pauseLabMs(), requiredThroughMs: pauseLabMs(), audioUrl: '/a11y-pause-lab.wav', minimumVoicedMs: 130,
        startToken: '1.x', pauses: [PAUSE_LAB_PAUSES[0]], minAnsweredPct: 75, voicePerPauseMs: 250, needed: 1, ...begin,
      },
      'labs.heartbeat': { recorded: true },
      'labs.submit': { success: true, result: { submissionId: 7, credit: false, status: 'redo', scored: true, pausesAnswered: 0, pausesCounted: 1, needed: 1, mic: 'on' } },
      'labs.askTeacher': { status: 'check' },
    },
  });
  const body = pauseLabWav();
  await page.route('**/a11y-pause-lab.wav', (route) => serveAudio(route, body));
  await page.goto('/labs?lab=1');
  await page.getByRole('button', { name: 'Turn on the microphone' }).click();
  await expect(page.getByText('Say “hola”. “Start the lab” turns on once we hear you.')).toBeVisible();
}

/** Says "hola" to pass the check, falls silent, and starts. */
async function startScoredLab(page: Page) {
  await setMicLevel(page, SPEAKING);
  await expect(page.getByText('We hear you. You can start.')).toBeVisible();
  await setMicLevel(page, 0);
  await page.getByRole('button', { name: 'Start the lab' }).click();
  await expect(page.getByText('Playing', { exact: true })).toBeVisible();
}

/** An admin's Labs tab with a lab of each kind: scanned with students in every state, not scanned, and one to check. */
const adminLabRow = {
  id: 1, title: 'ES1 Lab semana01', description: null, audioUrl: '/api/assets/semana01.wav', mimeType: 'audio/wav',
  durationMs: 900_000, requiredThroughMs: 880_000, active: true, createdBy: 1, createdAt: '2026-09-20T00:00:00.000Z',
  forEveryone: false, groupIds: [1], pauseCount: 95, pauseTotal: 101,
  pauseScan: { minPauseMs: 3300, thresholdDb: -41, noiseDb: -200, shortestKeptMs: 3540, longestLeftOutMs: 2100, closeCalls: 0, scannedAt: 0 },
  pauseCountUntilMs: 846_000, needsCheck: false,
  turnedInCount: 5, studentCount: 5, doneCount: 2, redoCount: 1, checkCount: 2, flaggedCount: 1, lookCount: 1, lastSubmittedAt: '2026-09-25T15:12:00.000Z',
};
const adminLabs = [
  adminLabRow,
  { ...adminLabRow, id: 2, title: 'ES1 Lab semana02', pauseCount: null, pauseTotal: null, pauseScan: null, pauseCountUntilMs: null,
    turnedInCount: 0, studentCount: 0, doneCount: 0, redoCount: 0, checkCount: 0, flaggedCount: 0, lookCount: 0, lastSubmittedAt: null },
  { ...adminLabRow, id: 3, title: 'ES1 Lab semana03', pauseCount: 8, pauseTotal: 8, pauseCountUntilMs: null, needsCheck: true, flaggedCount: 0 },
];

/**
 * labs.submissions for semana01: a student in each state, with flags and the
 * teacher's decisions, marks for flags on another attempt, a held lab, a row
 * judged by an older rule, and what the page's voice meter measured.
 */
function labReviewData() {
  const base = {
    isTeacher: false, requiredThroughMs: 880_000, listenedCoveredMs: 880_000, listenWallMs: 0, skipCount: 0,
    startedAt: '2026-09-25T15:00:00.000Z', submittedAt: '2026-09-25T15:16:00.000Z', elapsedMs: 960_000, attempts: 1,
    mic: 'on', pausesCounted: 20, pausesAnswered: 18, pauseResults: [[5_000, 1_200], [15_000, -1], [25_000, 100], [35_000, -2]], rejectedAnswers: 0, lateAnswers: 0,
    minAnsweredPct: 75, voicePerPauseMs: 250, outsideVoicedMs: 0, outsidePlayedMs: 0, credit: true, creditOverride: null,
    creditOverrideAt: null, checkRequestedAt: null, needed: 15, effectiveCredit: true, status: 'done', statusReason: null, flags: [] as string[],
    heldFor: null as string[] | null, micStats: null as Record<string, unknown> | null,
  };
  const submissions = [
    {
      ...base, id: 11, userId: 2, studentName: 'Ana', studentEmail: 'ana@example.com', voicedMs: 41_000, attempts: 2,
      micStats: {
        meter: 2, ambientDbP50: -51.6, gateDbP50: -45.6, voiceOverGateDbP50: 12, levelOnlyAnswered: 19,
        loudNotVoiceInPausesMs: 1_500, unfocusedPlayedMs: 95_000, micCheck: 'voice',
        processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      },
    },
    // Ana's other attempt: its flags are marks on the attempt that counts.
    { ...base, id: 10, userId: 2, studentName: 'Ana', studentEmail: 'ana@example.com', voicedMs: 0, attempts: 2, submittedAt: '2026-09-25T14:00:00.000Z', credit: false, effectiveCredit: false, status: 'redo', rejectedAnswers: 12, flags: ['odd-answers', 'noisy'] },
    { ...base, id: 12, userId: 3, studentName: 'Beto', studentEmail: 'beto@example.com', voicedMs: 3_000, pausesAnswered: 3, credit: false, effectiveCredit: false, status: 'redo', rejectedAnswers: 4, lateAnswers: 2, flags: ['skipped', 'odd-answers', 'late'] },
    { ...base, id: 13, userId: 4, studentName: 'Carla', studentEmail: 'carla@example.com', voicedMs: 0, mic: 'off', pausesAnswered: 0, credit: false, effectiveCredit: false, status: 'check', statusReason: 'no-mic', flags: ['no-mic'] },
    { ...base, id: 14, userId: 5, studentName: 'Dani', studentEmail: 'dani@example.com', voicedMs: 30_000, pausesAnswered: 19, flags: ['overlap', 'constant-sound', 'noisy'] },
    { ...base, id: 15, userId: 6, studentName: 'Eli', studentEmail: 'eli@example.com', voicedMs: 9_000, pausesAnswered: 10, credit: false, creditOverride: true, creditOverrideAt: '2026-09-25T16:00:00.000Z', status: 'done', minAnsweredPct: 50, needed: 10 },
    { ...base, id: 16, userId: 7, studentName: 'Fede', studentEmail: 'fede@example.com', voicedMs: 20_000, credit: false, effectiveCredit: false, status: 'check', statusReason: 'held', heldFor: ['odd-answers', 'overlap'], rejectedAnswers: 2, flags: ['odd-answers', 'overlap'] },
  ];
  // One standing per student, from the attempt that counts (as the server does).
  const counting = submissions.filter((r) => r.id !== 10);
  return {
    lab: { id: 1, title: 'ES1 Lab semana01', durationMs: 900_000, requiredThroughMs: 880_000, minimumVoicedMs: 30_000, pauseCount: 20, pauseTotal: 20, pauseScan: null, pauseCountUntilMs: null, needsCheck: false, settings: { minAnsweredPct: 75, voicePerPauseMs: 250 }, needed: 15 },
    submissions,
    summary: {
      byStudent: counting.map((r) => ({ userId: r.userId, name: r.studentName, status: r.status, reason: r.statusReason, countingRowId: r.id, answered: r.pausesAnswered, counted: r.pausesCounted })),
      done: 3, redo: 1, check: 2,
    },
  };
}

/** A student with something of everything: decks, a conjugation quiz, labs, speaking, a sign-up sheet, a vocabulary test, AI on. */
async function mockBusyStudent(page: Page, extra: { queries?: Record<string, unknown>; mutations?: Record<string, unknown> } = {}) {
  await mockAuthenticatedTrpc(page, {
    decks: [deck, doneDeck],
    virtualDecks: [virtualDeck],
    stats,
    vocabOpenTests: [openSizeTest],
    labs: [lab, doneLab, redoLab, checkLab],
    speakingTasks: [speakingListed, { ...speakingListed, id: 2, title: 'Escalera oral', submittedAt: '2026-09-25T15:12:00.000Z', attempts: 1 }],
    signupSheets: [sheetListed],
    conjugationQuizzes: [conjugationQuiz],
    queries: {
      // Every AI option on, so the settings show all their controls.
      'ai.getConfig': { pronunciation: true, image: true, mnemonic: true },
      'settings.getDeckSettings': {
        aiEnabled: null, autoPlayAudio: null, autoPlayAudioFront: null, mnemonicMode: null, locale: null, newCardsPerDay: 10, reviewsPerDay: null,
      },
      ...extra.queries,
    },
    mutations: extra.mutations,
  });
}

// A study session: one new card.
const futureDate = new Date(Date.now() + 86_400_000).toISOString();
const studyCard = {
  card: { id: 1, deckId: 1, front: 'Hello', back: 'Hola' },
  state: { id: 1, stability: 0, difficulty: 0.3, reps: 0, lapses: 0, state: 0 },
  direction: 0,
  nextReviewOptions: { 1: futureDate, 2: futureDate, 3: futureDate, 4: futureDate },
};

/** A study session; `queries` replaces any of its answers (who is signed in, the card's mnemonic). */
async function mockStudy(page: Page, cards: unknown[], queries: Record<string, unknown> = {}) {
  await mockTrpc(page, {
    queries: {
      'auth.me': defaultAuthUser,
      'setup.getStatus': defaultSetupStatus,
      'cards.getDueCards': { cards, counts: { remainingNewCardsToday: 20, remainingReviewsToday: 100, newCardsLimit: 20, reviewsLimit: 100 } },
      'cards.getDeckProgress': { totalCards: 50, learnedCards: 10, retentionRate: 0.85, totalTimeMs: 300_000 },
      'settings.getDeckSettings': { aiEnabled: null, autoPlayAudio: null, autoPlayAudioFront: null, mnemonicMode: null, locale: null },
      'settings.get': { newCardsPerDay: 20, reviewsPerDay: 100, aiEnabled: false, autoPlayAudio: false, autoPlayAudioFront: false, mnemonicMode: 'manual', locale: null },
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      'ai.getCardAiState': null,
      'ai.getCardAssets': null,
      ...queries,
    },
    mutations: { 'auth.logout': { success: true } },
  });
}

/** A mnemonic suggestion waiting for the teacher (v1.20.0), as ai.getCardAiState answers it. */
const waitingSuggestion = { id: 1, text: 'Picture yourself waving HOLA to a friend: hello!', style: 'keyword' };

/** A virtual deck (a slice of a real one) with one card due. */
async function mockVirtualStudy(page: Page) {
  await mockTrpc(page, {
    queries: {
      'auth.me': defaultAuthUser,
      'setup.getStatus': defaultSetupStatus,
      'virtualDecks.get': virtualDeck,
      'virtualDecks.getDueCards': [studyCard],
      'settings.getDeckSettings': { aiEnabled: null, autoPlayAudio: null, autoPlayAudioFront: null, mnemonicMode: null, locale: null, newCardsPerDay: null, reviewsPerDay: null },
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      'ai.getCardAiState': null,
      'ai.getCardAssets': null,
    },
    mutations: { 'auth.logout': { success: true } },
  });
}

// ---------------------------------------------------------------------------
// Conjugation: a three-question round the mocked server plays, one of each kind
// ---------------------------------------------------------------------------

const conjugationOverview = {
  deckId: 1,
  deckName: 'Unit 1',
  enabled: true,
  tenses: [{ id: 'present', label: 'presente' }, { id: 'preterite', label: 'pretérito' }],
  includeVosotros: false,
  vos: 'none',
  directions: 'both',
  answerMode: 'progressive',
  accentMode: 'progressive',
  roundLength: 3,
  levels: ['choice', 'typed-lenient', 'typed-strict'],
  // Every rung reached: the guide shows its typing and accent sections too.
  reachedRungs: ['choice', 'typed-lenient', 'typed-strict'],
  verbs: [
    { entry: 'tener', label: 'tener', kind: 'plain', mastered: 4, total: 12 },
    { entry: 'ser', label: 'ser', kind: 'plain', mastered: 2, total: 12 },
    { entry: 'estar', label: 'estar', kind: 'plain', mastered: 2, total: 12 },
    { entry: 'querer', label: 'querer', kind: 'plain', mastered: 0, total: 12 },
    { entry: 'llamarse', label: 'llamarse', kind: 'pronominal', mastered: 2, total: 12 },
    { entry: 'gustarle', label: 'gustarle', kind: 'dative', mastered: 6, total: 24 },
    { entry: 'haber-impersonal', label: 'haber (hay)', kind: 'impersonal', mastered: 0, total: 12 },
  ],
  mastered: 16,
  total: 96,
  rounds: 2,
  lastScore: 0.5,
  bestScore: 0.75,
  lastPlayed: '2026-09-24T15:00:00.000Z',
  openRound: null,
};

function conjugationPrompt(index: number, level: string, fields: Record<string, unknown>) {
  return {
    index, total: 3, itemKey: `tok${index}`, kind: level === 'choice' ? 'choice' : 'typed', level,
    strictAccents: level === 'typed-strict', direction: 'toForm', retry: false, cue: null, form: null, options: null,
    askTense: false, askPerson: false, personOptions: null, tenseOptions: null, ...fields,
  };
}

// v1.24.0: one subject at a time, with its grey gloss at multiple choice.
const CHOICE = conjugationPrompt(0, 'choice', {
  entryLabel: 'tener', tense: 'present', tenseLabel: 'presente', personLabel: 'ustedes', personId: 'ellos', options: ['tienes', 'tienen', 'tenemos', 'tiene'],
});
const TYPED = conjugationPrompt(1, 'typed-lenient', { entryLabel: 'estar', tense: 'present', tenseLabel: 'presente', personLabel: 'tú' });
// v1.24.0: every option is llamarse, so the question names it; usted and ustedes have their gloss under them.
const FROM_FORM = {
  ...conjugationPrompt(2, 'choice', {}),
  direction: 'fromForm', entryLabel: null, tense: null, tenseLabel: null, personLabel: null, form: 'nos llamamos',
  askTense: true, optionsVerb: 'llamarse', // The longest option a Spanish I deck makes (presente progresivo), to keep it on one line at 375 px.
  options: ['nosotras · presente progresivo', 'nosotras · presente', 'ustedes · presente', 'usted · presente'],
};
/** A typed "name the verb" question: only a round begun before v1.13 still has one. */
const LEGACY_FROM_FORM = {
  ...conjugationPrompt(0, 'typed-lenient', {}),
  direction: 'fromForm', entryLabel: null, tense: null, tenseLabel: null, personLabel: null, form: 'nos llamamos',
  askTense: true, askPerson: true,
  personOptions: [
    { id: 'yo', label: 'yo' }, { id: 'tu', label: 'tú' }, { id: 'el', label: 'él / ella / usted' },
    { id: 'nosotros', label: 'nosotros / nosotras' }, { id: 'ellos', label: 'ellos / ellas / ustedes' },
  ],
  tenseOptions: [{ id: 'present', label: 'presente' }, { id: 'preterite', label: 'pretérito' }],
};
const verdictBase = {
  result: 'correct', counted: true, nearMiss: false, alsoCorrect: [], levelBefore: 0, levelAfter: 1, levelKindAfter: 'typed-lenient',
  mastered: false, requeued: false, next: null, finished: false, summary: null, total: 3,
};
const VERDICTS: Record<number, unknown> = {
  // A wrong pick: the right answer is marked green, the pick red.
  0: {
    ...verdictBase, result: 'wrong', counted: false, correctAnswer: 'tienen', rightOptions: ['tienen'], levelAfter: 0, levelKindAfter: 'choice', next: TYPED,
    mistake: { kind: 'person', detail: { person: 'el' }, guideSection: null, guideSections: [] },
    sharedBy: { form: 'tienen', person: 'ellos', subjects: ['ellos', 'ellas', 'ustedes'] },
  },
  // A near miss on the accent.
  1: { ...verdictBase, result: 'accent', counted: false, nearMiss: true, correctAnswer: 'estás', levelBefore: 1, levelAfter: 1, next: FROM_FORM },
  2: {
    ...verdictBase, correctAnswer: 'llamarse · nosotras · presente', rightOptions: ['nosotras · presente'], levelBefore: 0, levelAfter: 0,
    levelKindAfter: 'choice', sharedBy: { form: 'nos llamamos', person: 'nosotros', subjects: ['nosotros', 'nosotras'] },
    finished: true,
    summary: { roundId: 41, score: 1 / 3, firstTryCorrect: 1, prompts: 3, answers: 3, abandoned: false, mastered: 17, total: 96 },
  },
};

// v1.25.0: sentences with a blank, the longest a Spanish I deck makes (two lines at 375 px), the hint at multiple choice.
const SENTENCE = {
  before: 'Mis primos y mis abuelos', after: 'en una casa grande en Guatemala.', cue: 'vivir',
  glosses: [{ es: 'mis', en: 'my' }, { es: 'primos', en: 'cousin' }, { es: 'abuelos', en: 'grandparents' }, { es: 'casa', en: 'house' }],
};
const SENTENCE_CHOICE = conjugationPrompt(0, 'choice', {
  entryLabel: 'vivir', tense: 'present', tenseLabel: 'presente', personLabel: null, personId: null,
  options: ['vive', 'viven', 'vivimos', 'vives'], sentence: { ...SENTENCE, hint: 'ellos' },
});
const SENTENCE_TYPED = conjugationPrompt(1, 'typed-lenient', {
  entryLabel: 'vivir', tense: 'present', tenseLabel: 'presente', personLabel: null, personId: null, sentence: { ...SENTENCE, hint: null },
});
const SENTENCE_FEEDBACK = {
  filled: 'Mis primos y mis abuelos viven en una casa grande en Guatemala.',
  english: 'My cousins and my grandparents live in a big house in Guatemala.',
  subject: { es: 'mis primos y mis abuelos', pronoun: 'ellos', person: 'ellos', kind: 'coord', form: 'viven' },
};
const SENTENCE_VERDICTS: Record<number, unknown> = {
  0: {
    ...verdictBase, result: 'wrong', counted: false, correctAnswer: 'viven', rightOptions: ['viven'], levelAfter: 0, levelKindAfter: 'choice', next: SENTENCE_TYPED,
    mistake: { kind: 'person', detail: { person: 'el' }, guideSection: null, guideSections: [] },
    sharedBy: { form: 'viven', person: 'ellos', subjects: ['ellos', 'ellas', 'ustedes'] }, sentence: SENTENCE_FEEDBACK,
  },
  1: { ...verdictBase, correctAnswer: 'viven', sentence: SENTENCE_FEEDBACK, finished: true, summary: (VERDICTS[2] as { summary: unknown }).summary },
};

async function mockSentences(page: Page) {
  await mockAuthenticatedTrpc(page, {
    authMe: defaultAuthUser,
    decks: [deck],
    conjugationQuizzes: [conjugationQuiz],
    queries: { 'conjugation.overview': conjugationOverview },
    mutations: {
      'conjugation.start': { roundId: 42, deckName: 'Unit 1', total: 2, review: false, levels: conjugationOverview.levels, prompt: SENTENCE_CHOICE },
      'conjugation.answer': (input: unknown) => SENTENCE_VERDICTS[(input as { index: number }).index],
      'conjugation.reportSentence': { reported: true },
      'conjugation.finish': (VERDICTS[2] as { summary: unknown }).summary,
    },
  });
  await page.goto('/conjugation/1');
  await page.getByRole('button', { name: 'Start a round' }).click();
  await expect(page.getByText('Pick the verb that fills the blank.')).toBeVisible();
}

async function mockConjugation(page: Page, user: unknown = defaultAuthUser, first: unknown = CHOICE) {
  await mockAuthenticatedTrpc(page, {
    authMe: user,
    decks: [deck],
    conjugationQuizzes: [conjugationQuiz],
    queries: { 'conjugation.overview': conjugationOverview },
    mutations: {
      'conjugation.start': { roundId: 41, deckName: 'Unit 1', total: 3, review: false, levels: conjugationOverview.levels, prompt: first },
      'conjugation.answer': (input: unknown) => VERDICTS[(input as { index: number }).index],
      'conjugation.finish': (VERDICTS[2] as { summary: unknown }).summary,
    },
  });
}

const feedback = (page: Page) => page.getByRole('status').filter({ hasText: /Correct|Not quite|Almost/ });

/** The quiz page before a round. */
async function openConjugation(page: Page) {
  await mockConjugation(page);
  await page.goto('/conjugation/1');
  await expect(page.getByRole('button', { name: 'Start a round' })).toBeVisible();
}

async function toChoice(page: Page) {
  await openConjugation(page);
  await page.getByRole('button', { name: 'Start a round' }).click();
  await expect(page.getByText('Pick the right form.')).toBeVisible();
}

async function toChoiceVerdict(page: Page) {
  await toChoice(page);
  await page.getByRole('button', { name: 'tiene', exact: true }).click();
  await expect(feedback(page)).toContainText('Not quite');
  await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
}

async function toTyped(page: Page) {
  await toChoiceVerdict(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Your answer', { exact: true })).toBeFocused();
}

async function toTypedVerdict(page: Page) {
  await toTyped(page);
  await page.getByLabel('Your answer', { exact: true }).fill('estas');
  await page.keyboard.press('Enter');
  await expect(feedback(page)).toContainText('Almost');
}

async function toFromForm(page: Page) {
  await toTypedVerdict(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Which form of llamarse is this?')).toBeVisible();
}

/** A round begun before v1.13, on its typed "name the verb" question (who and which tense as chips). */
async function toLegacyFromForm(page: Page) {
  await mockConjugation(page, defaultAuthUser, LEGACY_FROM_FORM);
  await page.goto('/conjugation/1');
  await page.getByRole('button', { name: 'Start a round' }).click();
  await expect(page.getByRole('group', { name: 'Who?' })).toBeVisible();
}

async function toSummary(page: Page) {
  await toFromForm(page);
  await page.getByRole('button', { name: 'nosotras · presente', exact: true }).click();
  await expect(feedback(page)).toContainText('Correct');
  await page.getByRole('button', { name: 'See results' }).click();
  await expect(page.getByText('Round complete')).toBeVisible();
}

const guideDialog = (page: Page) => page.getByRole('dialog', { name: 'Intro to conjugation' });

/** Opens the guide from the card; a newcomer starts at the first chapter. */
async function openGuide(page: Page) {
  await openConjugation(page);
  await page.getByRole('button', { name: 'Start here' }).click();
  await expect(guideDialog(page).getByRole('heading', { level: 3 })).toBeFocused();
}

/** Goes to a chapter the way the screen offers it: the list on a wide screen, the select on a narrow one. */
async function guideChapter(page: Page, title: RegExp) {
  const dialog = guideDialog(page);
  const select = dialog.getByRole('combobox', { name: /^Chapter/ });
  if (await select.isVisible()) {
    const value = await select.locator('option', { hasText: title }).getAttribute('value');
    await select.selectOption(value!);
  } else {
    await dialog.getByRole('navigation', { name: 'Contents' }).getByRole('button', { name: title }).click();
  }
  await expect(dialog.getByRole('heading', { level: 3 })).toContainText(title);
}

/** The guide is a modal over the page: scan the dialog, not the dimmed page under its backdrop (scanned on its own). */
const IN_GUIDE: A11yScanOptions = { include: ['[role="dialog"]'] };

/** The conjugation screens, run at the default size and at a phone's width. */
function conjugationScreens(theme: Theme) {
  test('the quiz page before a round', async ({ page }) => {
    await openConjugation(page);
    await scan(page, theme, 'conjugation: before a round');
  });

  test('a multiple-choice question', async ({ page }) => {
    await toChoice(page);
    await scan(page, theme, 'conjugation: multiple-choice question');
  });

  test('the verdict on a wrong pick, with the right answer marked', async ({ page }) => {
    await toChoiceVerdict(page);
    await scan(page, theme, 'conjugation: multiple-choice verdict');
  });

  test('a typed question, with the accent keys', async ({ page }) => {
    await toTyped(page);
    await scan(page, theme, 'conjugation: typed question');
  });

  test('the verdict on a near miss (the accent)', async ({ page }) => {
    await toTypedVerdict(page);
    await scan(page, theme, 'conjugation: typed verdict');
  });

  test('a form → verb question, the verb in the question and usted / ustedes glossed', async ({ page }) => {
    await toFromForm(page);
    await scan(page, theme, 'conjugation: form → verb question');
  });

  test('a typed form → verb question from a round begun before v1.13, with who and which tense', async ({ page }) => {
    await toLegacyFromForm(page);
    await scan(page, theme, 'conjugation: typed form → verb question');
  });

  test('the round summary', async ({ page }) => {
    await toSummary(page);
    await scan(page, theme, 'conjugation: round summary');
  });

  test('the guide, on its first chapter (the basics)', async ({ page }) => {
    await openGuide(page);
    await expect(guideDialog(page).locator('#guide-basics-dictionary-form')).toBeVisible();
    await scan(page, theme, 'guide: basics', IN_GUIDE);
  });

  test('the guide, on the present tense (verb tables)', async ({ page }) => {
    await openGuide(page);
    await guideChapter(page, /The present tense/);
    await expect(guideDialog(page).locator('table').first()).toBeVisible();
    await scan(page, theme, 'guide: present tense', IN_GUIDE);
  });

  test('the guide, on how the practice works (figures)', async ({ page }) => {
    await openGuide(page);
    await guideChapter(page, /How this practice works/);
    await expect(guideDialog(page).locator('#guide-quiz-verdicts')).toBeVisible();
    await scan(page, theme, 'guide: how this practice works', IN_GUIDE);
  });
}

// ---------------------------------------------------------------------------
// The scans
// ---------------------------------------------------------------------------

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await chooseTheme(page, theme);
    });

    test.describe('public pages', () => {
      test('the login page', async ({ page }) => {
        await mockPublicTrpc(page);
        await page.goto('/login');
        await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
        await scan(page, theme, 'login');
      });

      test('the login page with “Sign in with a PIN” open, a wrong PIN answered', async ({ page }) => {
        await mockPublicTrpc(page, { pinOptions: { pin: true, reason: 'auto' } });
        await page.route('**/auth/pin', (route) => route.fulfill({
          status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'INVALID' }),
        }));
        await page.goto('/login');
        await page.getByRole('button', { name: 'Sign in with a PIN' }).click();
        await page.getByLabel('Student number or school email').fill('123456');
        // A test PIN (never a real one).
        await page.getByLabel('PIN', { exact: true }).fill('5927');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText('Wrong student number, email or PIN.');
        await expect(page.getByText("Google sign-in isn't letting students in right now. Use your PIN.")).toBeVisible();
        await scan(page, theme, 'login: sign in with a PIN');
      });

      test('the first-run setup page', async ({ page }) => {
        await mockPublicTrpc(page, {
          setupStatus: { needsSetup: true, callbackUrl: 'http://127.0.0.1:4173/auth/google/callback', hasAdminEmail: false, cleverEnabled: false },
        });
        await page.goto('/setup');
        await expect(page.getByRole('heading').first()).toBeVisible();
        await scan(page, theme, 'setup');
      });

      for (const path of ['/readme', '/privacy', '/privacy/summary', '/privacy/coppa-notice', '/terms', '/subprocessors']) {
        test(`the ${path.slice(1)} page`, async ({ page }) => {
          await mockPublicTrpc(page);
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          await scan(page, theme, path.slice(1).replace('/', '-'));
        });
      }
    });

    test.describe('student', () => {
      test('the dashboard, with decks, a conjugation quiz, labs, speaking, sign-ups, a vocabulary test and the settings', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Your Decks' })).toBeVisible();
        await expect(page.getByRole('link', { name: /Unit 1 conjugation/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Default Settings' })).toBeVisible();
        await expect(page.getByText('AI & Audio')).toBeVisible();
        await scan(page, theme, 'student dashboard');
      });

      test('the deck settings panel', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/');
        await page.getByRole('button', { name: 'Deck settings' }).first().click();
        await expect(page.getByRole('heading', { name: 'Deck Settings' })).toBeVisible();
        await scan(page, theme, 'deck settings');
      });

      test('a study card, front', async ({ page }) => {
        await mockStudy(page, [studyCard]);
        await page.goto('/study/1');
        await expect(page.getByRole('button', { name: /Show Answer/ })).toBeVisible();
        await scan(page, theme, 'study: card front');
      });

      test('a study card, back, with the rating buttons', async ({ page }) => {
        await mockStudy(page, [studyCard]);
        await page.goto('/study/1');
        await page.getByRole('button', { name: /Show Answer/ }).click();
        await expect(page.getByRole('button', { name: /Good/ })).toBeVisible();
        await scan(page, theme, 'study: card back');
      });

      test('a study card, back, with the teacher’s mnemonic', async ({ page }) => {
        await mockStudy(page, [studyCard], {
          'ai.getCardAiState': {
            acceptedMnemonic: { text: 'OH-lah: wave HOLA to say hello', source: 'teacher' },
            pendingMnemonic: null,
            pendingByStyle: { keyword: null, sentence: null },
          },
        });
        await page.goto('/study/1');
        await page.getByRole('button', { name: /Show Answer/ }).click();
        await expect(page.getByText('Chosen by your teacher')).toBeVisible();
        await scan(page, theme, 'study: card back with the teacher’s mnemonic');
      });

      test('a study card, back, with a mnemonic suggestion waiting for the teacher', async ({ page }) => {
        await mockStudy(page, [studyCard], {
          'auth.me': defaultAdminUser,
          'ai.getConfig': { pronunciation: false, image: false, mnemonic: true },
          'ai.getCardAiState': {
            acceptedMnemonic: null,
            pendingMnemonic: waitingSuggestion,
            pendingByStyle: { keyword: waitingSuggestion, sentence: null },
          },
        });
        await page.goto('/study/1');
        await page.getByRole('button', { name: /Show Answer/ }).click();
        await expect(page.getByText('Keyword picture')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try a sentence' })).toBeVisible();
        await scan(page, theme, 'study: a teacher’s mnemonic suggestion');
      });

      test('a finished study session', async ({ page }) => {
        await mockStudy(page, []);
        await page.goto('/study/1');
        await expect(page.getByRole('heading', { name: 'All Done!' })).toBeVisible();
        await scan(page, theme, 'study: all done');
      });

      test('a virtual deck’s study card', async ({ page }) => {
        await mockVirtualStudy(page);
        await page.goto('/study/virtual/1');
        await expect(page.getByRole('button', { name: /Show Answer/ })).toBeVisible();
        await scan(page, theme, 'virtual study: card front');
      });

      test('the labs list', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/labs');
        await expect(page.getByText('ES1 Lab semana01')).toBeVisible();
        await scan(page, theme, 'labs list');
      });

      test('a lab, before it starts', async ({ page }) => {
        await mockBusyStudent(page, {
          mutations: { 'labs.begin': { ...lab, audioUrl: '/a11y-lab.wav', minimumVoicedMs: 0, startToken: '1.x' } },
        });
        await page.route('**/a11y-lab.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: silentWav() }));
        await page.goto('/labs?lab=1');
        await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
        await scan(page, theme, 'lab: setup');
      });

      test('a scored lab, before it starts: the microphone check holds Start', async ({ page }) => {
        await openScoredLab(page);
        await expect(page.getByRole('button', { name: 'Start the lab' })).toBeDisabled();
        await expect(page.getByText('Answer out loud in at least 1 of the 1 pauses for this lab to count.')).toBeVisible();
        await scan(page, theme, 'lab: the microphone check');
      });

      test('a scored lab, paused after a missed pause: the nudge, the tally and “can’t count now”', async ({ page }) => {
        await openScoredLab(page);
        await startScoredLab(page);
        await expect(page.getByText('Missed that pause. Answer out loud in the next one.')).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: 'Pause' }).click();
        await expect(page.getByText('Paused', { exact: true })).toBeVisible();
        await expect(page.getByText('Missed that pause. Answer out loud in the next one.')).toBeVisible();
        await expect(page.getByText("This lab can't count now. You can start over.")).toBeVisible();
        await expect(page.getByText('Pauses answered: 0 of the 1 needed')).toBeVisible();
        await scan(page, theme, 'lab: a missed pause');
      });

      test('a scored lab that did not count: the end screen', async ({ page }) => {
        // Finish opens at once, so the attempt is turned in straight away.
        await openScoredLab(page, { requiredThroughMs: 1500 });
        await startScoredLab(page);
        await page.getByRole('button', { name: 'Finish' }).click();
        await expect(page.getByText('It needs 1 to count. Do it again.')).toBeVisible();
        await expect(page.getByRole('button', { name: "The mic didn't hear me" })).toBeVisible();
        await scan(page, theme, 'lab: did not count');
      });

      test('the speaking list', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/speaking');
        await expect(page.getByText('Cuento semana 3')).toBeVisible();
        await scan(page, theme, 'speaking list');
      });

      test('the tests page: each set’s forms and speaking test, one set started', async ({ page }) => {
        await mockBusyStudent(page, { queries: { 'labs.list': [lab, ...testLabs], 'speaking.list': [speakingListed, ...speakingTests] } });
        await page.goto('/tests');
        await expect(page.getByRole('heading', { name: 'Test U3' })).toBeVisible();
        await expect(page.getByText('To start again, ask your teacher.')).toBeVisible();
        await expect(page.getByText(/We could hardly hear you/)).toBeVisible();
        await scan(page, theme, 'tests page');
      });

      test('a speaking test, before recording', async ({ page }) => {
        await mockBusyStudent(page, {
          queries: { 'speaking.get': { ...speakingTask, id: 7, title: 'Examen U3 · Expresión oral', examSet: 'U3' } },
        });
        await page.goto('/tests?task=7');
        await expect(page.getByText('Test · U3')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to tests' })).toBeVisible();
        await scan(page, theme, 'speaking test: task');
      });

      test('a speaking task, before recording', async ({ page }) => {
        await mockBusyStudent(page, { queries: { 'speaking.get': speakingTask } });
        await page.goto('/speaking?task=1');
        await expect(page.getByRole('button', { name: 'Turn on the microphone' })).toBeVisible();
        await scan(page, theme, 'speaking: task');
      });

      test('a speaking task with a take the teacher graded', async ({ page }) => {
        await mockBusyStudent(page, { queries: { 'speaking.get': gradedSpeakingTask } });
        await page.goto('/speaking?task=1');
        await expect(page.getByText("Your teacher's comment")).toBeVisible();
        await expect(page.getByText('Not graded yet.')).toBeVisible();
        await scan(page, theme, 'speaking: graded');
      });

      test('the sign-up sheets list', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/signups');
        await expect(page.getByText('Show and tell')).toBeVisible();
        await scan(page, theme, 'sign-ups list');
      });

      test('a sign-up sheet, one day picked', async ({ page }) => {
        await mockBusyStudent(page, { queries: { 'signups.get': sheet } });
        await page.goto('/signups?sheet=1');
        await expect(page.getByRole('heading', { name: 'Show and tell' })).toBeVisible();
        await expect(page.getByText('You have picked 1 of 2 day(s).')).toBeVisible();
        await scan(page, theme, 'sign-up sheet');
      });

      test('the Vocabulómetro, its open tests', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/vocabulometro');
        await expect(page.getByRole('heading', { name: 'Tamaño y cobertura · Otoño' })).toBeVisible();
        await scan(page, theme, 'vocabulómetro');
      });

      test('the Vocabulómetro, a question', async ({ page }) => {
        await mockBusyStudent(page);
        await page.goto('/vocabulometro');
        await page.getByRole('button', { name: /Start|Comenzar/ }).click();
        await expect(page.getByText('1 / 26')).toBeVisible();
        await scan(page, theme, 'vocabulómetro: question');
      });

      test('the Vocabulómetro, a finished test’s results', async ({ page }) => {
        // Twenty-six answers at a student's pace (the runner ignores answers in an item's first 250 ms).
        test.slow();
        await mockBusyStudent(page, { mutations: { 'vocab.submitResult': { id: 7 } } });
        await page.goto('/vocabulometro');
        await page.getByRole('button', { name: /Start|Comenzar/ }).click();
        for (let i = 0; i < 26; i += 1) {
          await expect(page.getByText(`${i + 1} / 26`)).toBeVisible();
          await page.waitForTimeout(300);
          await page.getByRole('button', { name: /No/, exact: false }).last().click();
        }
        await expect(page.getByText('Resultado guardado en tu cuenta ✓')).toBeVisible();
        await scan(page, theme, 'vocabulómetro: results');
      });
    });

    test.describe('conjugation', () => {
      conjugationScreens(theme);

      test('the guide, every chapter as a teacher sees it', async ({ page }) => {
        // Fifteen chapters, one scan each: more than a single screen's time on a phone-sized project.
        test.slow();
        await mockConjugation(page, defaultAdminUser);
        await page.goto('/conjugation/1');
        await page.getByRole('button', { name: 'Start here' }).click();
        const dialog = guideDialog(page);
        await dialog.getByRole('checkbox', { name: /Show every chapter/ }).check();
        const select = dialog.getByRole('combobox', { name: /^Chapter/ });
        const narrow = await select.isVisible();
        const chapters = narrow
          ? await select.locator('option').allTextContents()
          : await dialog.getByRole('navigation', { name: 'Contents' }).locator('ol button').allTextContents();
        expect(chapters.length).toBeGreaterThan(10);
        for (let i = 0; i < chapters.length; i += 1) {
          if (narrow) {
            await select.selectOption({ index: i });
          } else {
            const entry = dialog.getByRole('navigation', { name: 'Contents' }).locator('ol button').nth(i);
            await entry.click();
            await expect(entry).toHaveAttribute('aria-current', 'true');
          }
          const title = (await dialog.getByRole('heading', { level: 3 }).textContent()) ?? `chapter ${i + 1}`;
          // Soft: one chapter's failure should not hide the next one's.
          await expectNoA11yViolations(page, { ...IN_GUIDE, soft: true, label: `guide chapter ${i + 1}, ${title} (${theme})` });
        }
      });
    });

    test.describe('admin', () => {
      const tabs: { tab: string; ready: (page: Page) => ReturnType<Page['getByRole']> }[] = [
        // Loaded, not just its heading: the table's links, the teacher's Admin tag and the pager are scanned too.
        { tab: 'dashboard', ready: (page) => page.getByRole('link', { name: 'Bob Smith' }) },
        { tab: 'groups', ready: (page) => page.getByRole('heading', { name: 'Groups', exact: true }) },
        { tab: 'decks', ready: (page) => page.getByRole('heading', { name: 'Decks', exact: true }) },
        { tab: 'labs', ready: (page) => page.getByRole('heading', { name: 'Upload labs' }) },
        { tab: 'speaking', ready: (page) => page.getByRole('heading', { name: 'Speaking tasks' }) },
        { tab: 'signups', ready: (page) => page.getByRole('heading', { name: 'Sign-up sheets' }) },
        { tab: 'users', ready: (page) => page.getByRole('cell', { name: 'Jane Doe' }).first() },
        { tab: 'access', ready: (page) => page.getByRole('heading', { name: 'Add Allowed Email' }) },
        { tab: 'ai', ready: (page) => page.getByRole('heading', { name: 'AI Configuration' }) },
        { tab: 'vocab', ready: (page) => page.getByRole('button', { name: /New test|Nueva prueba/ }) },
      ];
      for (const { tab, ready } of tabs) {
        test(`the ${tab} tab`, async ({ page }) => {
          await mockAdminTrpc(page);
          await page.goto(`/admin?tab=${tab}`);
          await expect(ready(page)).toBeVisible();
          await scan(page, theme, `admin: ${tab} tab`);
        });
      }

      test('the Sentences panel (v1.25.0): a verb\'s list, its rows named by their sentence, a preview with its rung chosen', async ({ page }) => {
        const unit1Admin = { id: 1, name: 'Unit 1', description: null, cardCount: 30, reversible: false };
        const view = { ...conjugationSettingsView(1, 'Unit 1', 30), effective: ['vivir'], verbCount: 1, itemCount: 10, entries: [] };
        const row = (ref: string, before: string, after: string, english: string, used: boolean) => ({
          ref, source: 'builtIn', before, form: 'viven', after, cue: 'vivir', english, subjectKind: 'np_pl', warnings: [], status: null, hidden: false, used,
        });
        await mockAdminTrpc(page, {
          decks: [unit1Admin],
          queries: {
            'conjugation.settings': { ...view, settings: { ...view.settings, sentences: 'builtIn' } },
            'conjugation.sentences.panel': conjugationSentencesPanel(1, {
              mode: 'builtIn',
              coverage: { cells: 5, covered: 4, label: 1 },
              verbs: [{ entry: 'vivir', label: 'vivir', kind: 'plain', cells: 5, covered: 4, sentences: 2, hidden: 0 }],
              reports: [{ ref: 'tpl:a', sentence: 'Mis primos ___ (vivir) en Lima.', itemKey: 'vivir|present|ellos|-|to', count: 1, lastAt: '2026-10-13T15:00:00.000Z' }],
            }),
            'conjugation.sentences.list': {
              deckId: 1, entry: 'vivir', label: 'vivir', mode: 'builtIn',
              cells: [{
                tense: 'present', tenseLabel: 'presente', person: 'ellos', personLabel: 'ellos/ellas/Uds.', number: null, parked: [],
                sentences: [row('tpl:a', 'Mis primos', 'en Lima.', 'My cousins live in Lima.', true), row('tpl:b', 'Mis tíos', 'en Quito.', 'My uncles live in Quito.', false)],
              }],
            },
            'conjugation.sentences.preview': (input: unknown) => {
              const level = (input as { level: string }).level;
              return {
                levels: ['choice', 'typed-lenient', 'typed-strict'],
                prompt: conjugationPrompt(0, level, {
                  entryLabel: 'vivir', entryHint: null, optionsVerb: null, tense: 'present', tenseLabel: 'presente', personLabel: 'mis primos', personId: null,
                  options: level === 'choice' ? ['vive', 'viven', 'vivimos', 'vives'] : null, scheduledReview: false, fromDeck: null,
                  sentence: { before: 'Mis primos', after: 'en Lima.', cue: 'vivir', hint: level === 'choice' ? 'ellos' : null, glosses: [] },
                }),
                answer: 'viven', filled: 'Mis primos viven en Lima.', english: 'My cousins live in Lima.', hint: 'ellos',
              };
            },
          },
        });
        await page.goto('/admin?tab=decks');
        await page.getByText('Unit 1', { exact: true }).click();
        const panel = page.getByRole('region', { name: 'Sentences' });
        await panel.getByRole('button', { name: 'Show sentences: vivir' }).click();
        const item = panel.getByRole('listitem').filter({ hasText: 'My cousins live in Lima.' }).last();
        await expect(item.getByRole('button', { name: 'Hide', exact: true })).toHaveAccessibleDescription('Mis primos viven en Lima.');
        await expect(panel.getByRole('listitem').filter({ hasText: 'My uncles live in Quito.' }).last()).toContainText('not shown in this mode');
        await item.getByRole('button', { name: 'Preview as a student' }).click();
        await expect(item.getByRole('button', { name: 'Multiple choice' })).toHaveAttribute('aria-pressed', 'true');
        await expect(item.getByText('(ellos)')).toBeVisible();
        await scan(page, theme, 'admin: Sentences panel, a preview at multiple choice');
        await item.getByRole('button', { name: 'Typed · accents forgiven' }).click();
        await expect(item.getByRole('button', { name: 'Typed · accents forgiven' })).toHaveAttribute('aria-pressed', 'true');
        await expect(item.getByText('The student types the form; accent slips are forgiven.')).toBeVisible();
        await scan(page, theme, 'admin: Sentences panel, a typed preview');
        // The list ends with its own "Hide sentences", and the focus goes back to the verb's toggle.
        await panel.getByRole('button', { name: 'Hide sentences: vivir' }).last().click();
        await expect(panel.getByRole('button', { name: 'Show sentences: vivir' })).toBeFocused();
      });

      test('the access tab with Google sign-in looking blocked for students', async ({ page }) => {
        const since = Date.parse('2026-03-02T19:00:00Z');
        await mockAdminTrpc(page, {
          pinSettings: {
            mode: 'auto',
            showing: true,
            google: { looksBlocked: true, since, reason: 'no_returns', unansweredBrowsers: 8, lastStudentSignInAt: null, watchingSince: since - 4 * 60 * 60_000 },
          },
        });
        await page.goto('/admin?tab=access');
        await expect(page.getByRole('radio', { name: 'Auto' })).toBeChecked();
        await expect(page.getByText(/Google sign-in looks blocked for students since/)).toBeVisible();
        await scan(page, theme, 'admin: access tab, PIN sign-in on');
      });

      test('a group’s “Make PINs…” dialog with the new PINs', async ({ page }) => {
        await mockAdminTrpc(page, {
          queries: { 'pins.groupStatus': { students: 3, withPin: 1 } },
          mutations: {
            // Test PINs (never real ones).
            'pins.createForGroup': {
              pins: [
                { userId: 2, name: 'Jane Doe', email: '123456@school.test', studentNumber: '123456', pin: '5927' },
                { userId: 4, name: 'Cata Ruiz', email: '234567@school.test', studentNumber: '234567', pin: '6184' },
              ],
              skippedHavePin: 1,
              skippedNotStudent: 1,
            },
          },
        });
        await page.goto('/admin?tab=groups&group=1');
        await page.getByRole('button', { name: 'Make PINs…' }).click();
        const dialog = page.getByRole('dialog', { name: 'Make PINs for Spanish Class' });
        await expect(dialog.getByText('1 of 3 students have a PIN.')).toBeVisible();
        await dialog.getByRole('button', { name: 'Make PINs', exact: true }).click();
        await expect(dialog.getByRole('table')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Download CSV' })).toBeVisible();
        await scan(page, theme, 'admin: a group’s new PINs', { include: ['[role="dialog"]'] });
      });

      test('the ai tab with Claude chosen and a key saved: the key field, Test key and its answer, Remove key', async ({ page }) => {
        await mockAdminTrpc(page, {
          aiConfig: {
            ...defaultAiAdminConfig,
            aiEnabled: true,
            enabled: true,
            mnemonic: true,
            mnemonicModel: 'gpt-5.6-luna',
            imageModel: 'gpt-image-1.5',
            imageQuality: 'low',
            ttsModel: 'gpt-4o-mini-tts',
            textProvider: 'anthropic',
            hasAnthropicKey: true,
          },
        });
        await page.goto('/admin?tab=ai');
        await expect(page.getByLabel('Anthropic API Key')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove key' })).toBeVisible();
        await page.getByRole('button', { name: 'Test key' }).click();
        await expect(page.getByText('Key works. Claude answered with claude-opus-5-5.')).toBeVisible();
        await scan(page, theme, 'admin: ai tab, Claude chosen');
      });

      test('the groups tab with a group open: its members, “Add students”, flashcards by day and decks', async ({ page }) => {
        const finished = (deckId: number, answers: number) => ({
          deckId, finishedAt: Date.parse('2024-03-01T20:00:00Z'), finishes: 1, newCards: 20, reviews: 10, answers, minutes: 12, newLimit: 20, lowLimit: false,
        });
        await mockAdminTrpc(page, {
          groupMembers: sampleUsers.map((u) => ({ ...u, joinedAt: '2024-02-01T00:00:00.000Z' })),
          users: [...sampleUsers, { id: 4, name: 'Cata Ruiz', email: 'cata@example.com', role: 'user', picture: null, createdAt: '2024-02-10T00:00:00.000Z', lastActiveAt: null, studentNumber: null }],
          groupDecks: sampleAdminDecks,
          flashcardDay: {
            day: '2024-03-01',
            groupNewLimit: 20,
            decks: [{ id: 1, name: 'Spanish Vocabulary' }],
            students: [
              { id: 2, name: 'Jane Doe', email: 'jane@example.com', cells: [finished(1, 30)] },
              { id: 3, name: 'Bob Smith', email: 'bob@example.com', cells: [{ ...finished(1, 0), finishedAt: null, finishes: 0, newCards: 0, answers: 0, newLimit: 10, lowLimit: true }] },
            ],
          },
        });
        await page.goto('/admin?tab=groups&group=1');
        // Loaded, not just the headings: the tables' links, the teacher's Admin tag and the pagers are scanned too.
        await expect(page.getByRole('region', { name: 'Members' }).getByRole('link', { name: 'Bob Smith' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Flashcards by day' }).getByRole('link', { name: 'Jane Doe' })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Add students', exact: true }).getByRole('checkbox', { name: /Cata Ruiz/ })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Assigned Decks' }).getByRole('link', { name: 'Spanish Vocabulary' })).toBeVisible();
        await scan(page, theme, 'admin: a group open');
      });

      test('a Google Classroom roster to import, a page at a time', async ({ page }) => {
        await mockAdminTrpc(page, {
          queries: {
            'admin.listGoogleClassroomCourses': [{ id: 'c1', name: 'Spanish 1', section: 'Period 3', description: null }],
            'admin.previewGoogleClassroomStudents': Array.from({ length: 14 }, (_, i) => ({
              email: `${40000 + i + 1}@students.school.test`, fullName: `Alumno ${String(i + 1).padStart(2, '0')}`,
            })),
          },
        });
        await page.goto('/admin?tab=groups&classroom=connected');
        await page.getByRole('button', { name: /Spanish 1/ }).click();
        await expect(page.getByRole('button', { name: 'Deselect all 14' })).toBeVisible();
        await expect(page.getByLabel('Search students to import')).toBeVisible();
        await scan(page, theme, 'admin: a Classroom roster');
      });

      test('the decks tab with a deck open, its Conjugation section', async ({ page }) => {
        await mockAdminTrpc(page);
        await page.goto('/admin?tab=decks');
        await page.getByText('Spanish Vocabulary', { exact: true }).click();
        await expect(page.getByRole('region', { name: 'Conjugation' })).toBeVisible();
        await scan(page, theme, 'admin: deck open');
      });

      test('the labs tab with the pause rule, and a lab of each kind', async ({ page }) => {
        await mockAdminTrpc(page, { labs: adminLabs, labSettings: { minAnsweredPct: 75, voicePerPauseMs: 250 } });
        await page.goto('/admin?tab=labs');
        await expect(page.getByRole('region', { name: 'Speaking in the pauses' }).getByLabel('Pauses a student must answer (%)')).toHaveValue('75');
        await expect(page.getByText('1 lab(s) have no pause list yet, so they use the old rule.')).toBeVisible();
        await expect(page.getByText('Check the count')).toBeVisible();
        await scan(page, theme, 'admin: labs tab, the pause rule');
      });

      test('a lab’s Edit row with its pauses', async ({ page }) => {
        await mockAdminTrpc(page, { labs: [adminLabRow] });
        await page.goto('/admin?tab=labs');
        await page.getByRole('button', { name: 'Edit' }).click();
        await expect(page.getByLabel("Don't count pauses after (m:ss)")).toHaveValue('14:06');
        await scan(page, theme, 'admin: a lab’s pauses');
      });

      test('a lab’s review: results, flags, marks, a held lab, the teacher’s credit, the pause strip and the meter', async ({ page }) => {
        await mockAdminTrpc(page, {
          labs: [adminLabRow],
          queries: {
            'labs.submissions': labReviewData(),
            'labs.missing': [{ id: 9, name: 'Gabi', email: 'g@example.com', opened: false, started: false, heardThroughMs: null, skips: 0, lastSeenAt: null }],
            'labs.listenLog': [{
              startedAt: Date.parse('2026-09-25T15:00:00Z'), started: true, submitted: true,
              summary: { heardThroughMs: 880_000, skips: 0, lastPositionMs: 900_000, lastAt: 0 },
              events: [
                { kind: 'open', positionMs: 0, clientMs: 0, at: Date.parse('2026-09-25T15:00:00Z'), answers: null },
                { kind: 'play', positionMs: 0, clientMs: 1_000, at: Date.parse('2026-09-25T15:00:01Z'), answers: null },
                { kind: 'tick', positionMs: 10_000, clientMs: 11_000, at: Date.parse('2026-09-25T15:00:11Z'), answers: [[5_000, 1_200]] },
              ],
            }],
          },
        });
        await page.goto('/admin?tab=labs');
        await expect(page.getByText(sampleGroups[1].name)).toBeVisible();
        await page.getByRole('button', { name: 'Review' }).click();
        await expect(page.getByRole('heading', { name: 'Still to do (4)' })).toBeVisible();
        await expect(page.getByText('Odd results · on 1 other attempt(s)')).toBeVisible();
        // exact: "Still to do" says the same after "Waiting for you · held:".
        await expect(page.getByText('Held: Odd results, Two at once', { exact: true })).toBeVisible();
        await expect(page.getByText('Held labs (1) are not in “Give credit to all”: look at each one.')).toBeVisible();
        await expect(page.getByText('Room level −52 dB · a voice needed −46 dB')).toBeVisible();
        await page.getByRole('row', { name: /^Ana/ }).getByRole('button', { name: 'Log' }).click();
        await expect(page.getByRole('list', { name: 'Microphone' })).toBeVisible();
        await expect(page.getByRole('img', { name: 'Pause 4 at 0:35: two results for one pause in one playback; neither counted.' })).toBeVisible();
        await expect(page.getByText(/voice in the pause at 0:05/)).toBeVisible();
        await scan(page, theme, 'admin: lab review');
      });

      test('a user’s page', async ({ page }) => {
        await mockAdminTrpc(page);
        await page.goto('/admin/users/2');
        await expect(page.getByRole('heading', { name: 'Jane Doe', level: 2 })).toBeFocused();
        await expect(page.getByRole('region', { name: 'PIN sign-in' }).getByRole('button', { name: 'Make a new PIN' })).toBeVisible();
        await scan(page, theme, 'admin: a user’s page');
      });

      test('a group’s flashcards by day', async ({ page }) => {
        const cell = (deckId: number, extra: Record<string, unknown> = {}) => ({
          deckId, finishedAt: null, finishes: 0, newCards: 0, reviews: 0, answers: 0, minutes: 0, newLimit: 20, lowLimit: false, ...extra,
        });
        await mockAdminTrpc(page, {
          flashcardDay: {
            day: '2026-09-25', groupNewLimit: 20,
            decks: [{ id: 1, name: 'Unidad 1' }, { id: 2, name: 'Unidad 2' }],
            students: [
              { id: 2, name: 'Jane Doe', email: 'jane@example.com', cells: [
                cell(1, { finishedAt: Date.parse('2026-09-25T22:15:00Z'), finishes: 1, newCards: 20, answers: 34 }),
                cell(2, { newCards: 5, answers: 9, newLimit: 10, lowLimit: true }),
              ] },
              { id: 4, name: 'Beto Ruiz', email: 'beto@example.com', cells: [cell(1), cell(2)] },
            ],
          },
        });
        await page.goto('/admin?tab=groups');
        await page.getByRole('button', { name: 'Spanish Class' }).click();
        await expect(page.getByText('limit 10')).toBeVisible();
        // The grid only: the rest of the group screen is older than this release and outside this scan.
        await scan(page, theme, 'admin: a group’s flashcards by day', { include: ['section[aria-labelledby^="flashcards-day-"]'] });
      });

      test('a student’s settings dialog', async ({ page }) => {
        // What admin.getAllUserSettings returns today (sampleUserSettings predates the AI and lock fields).
        const settings = [2, 3].map((userId) => ({
          userId, userName: userId === 2 ? 'Jane Doe' : 'Bob Smith', email: userId === 2 ? 'jane@example.com' : 'bob@example.com',
          newCardsPerDay: 20, reviewsPerDay: 100, isOverride: false, allowHigher: true, allowLower: true,
          aiEnabled: true, aiEnabledLocked: false, autoPlayAudio: false, autoPlayAudioLocked: true,
          autoPlayAudioFront: false, autoPlayAudioFrontLocked: false, mnemonicMode: 'manual', mnemonicModeLocked: false,
          locale: null, localeLocked: false,
          reviewsDoneToday: 30, newCardsDoneToday: 5,
        }));
        await mockAdminTrpc(page, { userSettings: settings });
        await page.goto('/admin?tab=users');
        await page.getByRole('button', { name: 'Settings' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await scan(page, theme, 'admin: user settings dialog', { include: ['[role="dialog"]'] });
      });
    });

    test.describe('conjugation on a phone', () => {
      test.skip(({ isMobile }) => isMobile, 'this project is already a phone');
      test.use({ viewport: PHONE });
      conjugationScreens(theme);
    });

    test.describe('conjugation on a 375 px phone (v1.24.0)', () => {
      test.skip(({ isMobile }) => isMobile, 'this project is already a phone');
      test.use({ viewport: SMALL_PHONE });

      test('a multiple-choice question: the one-subject cue on one line, its gloss under it', async ({ page }) => {
        await toChoice(page);
        const title = page.locator('[id^="conj-prompt-"]');
        await expect(title).toHaveText('ustedes (tener)');
        // One line of text-2xl (32 px), not two.
        expect((await title.boundingBox())?.height ?? 0).toBeLessThan(48);
        await expect(page.getByText('you all', { exact: true })).toBeVisible();
        // A screen reader hears the gloss when focus lands on the card, after its name.
        await expect(page.getByRole('group', { name: 'ustedes (tener)' })).toHaveAccessibleDescription('you all');
        await scan(page, theme, 'conjugation 375 px: multiple-choice question');
      });

      test('a typed question: all seven accent keys on one row', async ({ page }) => {
        await toTyped(page);
        const first = await page.getByRole('button', { name: 'insertar á' }).boundingBox();
        const last = await page.getByRole('button', { name: 'insertar ñ' }).boundingBox();
        expect(first && last && Math.abs(first.y - last.y)).toBe(0);
        await scan(page, theme, 'conjugation 375 px: typed question');
      });

      test('a form → verb question with short options', async ({ page }) => {
        await toFromForm(page);
        const options = await page.getByRole('group', { name: 'Options' }).getByRole('button').all();
        expect(options).toHaveLength(4);
        for (const option of options) {
          // The option's own text on one line (24 px at text-base), whatever the gloss line under usted / ustedes adds.
          expect((await option.locator('span[lang="es"]').boundingBox())?.height ?? 0).toBeLessThan(40);
        }
        await expect(page.getByRole('button', { name: 'nosotras · presente progresivo', exact: true })).toBeVisible();
        await scan(page, theme, 'conjugation 375 px: form → verb question');
      });

      test('a sentence at multiple choice (v1.25.0): the blank read as "blank", the hint, Word help, 24 px targets', async ({ page }) => {
        await mockSentences(page);
        const card = page.getByRole('group', { name: 'Mis primos y mis abuelos (ellos) blank (vivir) en una casa grande en Guatemala.' });
        await expect(card).toBeVisible();
        await expect(card.locator('[id^="conj-prompt-"]')).toHaveAttribute('lang', 'es');
        // No sideways scroll at 375 px.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
        const help = page.getByRole('button', { name: 'Word help' });
        expect((await help.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
        await help.click();
        await expect(page.getByText('grandparents')).toBeVisible();
        await scan(page, theme, 'conjugation 375 px: sentence, multiple choice');

        await page.keyboard.press('1');
        await expect(feedback(page)).toContainText('My cousins and my grandparents live in a big house in Guatemala.');
        const report = page.getByRole('button', { name: 'Something’s wrong with this sentence' });
        expect((await report.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
        // After a wrong pick the big sentence holds the right form, not the wrong one.
        await expect(page.locator('[id^="conj-prompt-"] [aria-hidden="true"]')).toHaveText('viven');
        await scan(page, theme, 'conjugation 375 px: sentence verdict');
        // The report's thanks goes into a live region already on the page, and the focus moves on to Next.
        await report.click();
        await expect(page.getByRole('status').filter({ hasText: 'Thank you. Your teacher will look at this sentence.' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
        await scan(page, theme, 'conjugation 375 px: sentence reported');
      });

      test('a typed sentence with the keyboard open (v1.25.0): sentence, box, keys and Check fit above it, and typing does not move the box', async ({ page }) => {
        await mockSentences(page);
        await page.keyboard.press('2');
        await page.getByRole('button', { name: 'Next' }).click();
        const box = page.getByRole('textbox', { name: /^Your answer Mis primos y mis abuelos blank \(vivir\)/ });
        await expect(box).toBeFocused();
        // A phone's keyboard leaves about 330 px of a 667 px screen.
        await page.setViewportSize({ width: 375, height: 330 });
        const sentence = page.locator('[id^="conj-prompt-"]');
        const check = page.getByRole('button', { name: 'Check' });
        const top = (await sentence.boundingBox())!.y;
        const bottom = (await check.boundingBox())!;
        expect(bottom.y + bottom.height - top).toBeLessThanOrEqual(330);
        // Typing may scroll the page to the box; the layout itself does not move (the box keeps its place under the sentence).
        const offset = async () => (await box.boundingBox())!.y - (await sentence.boundingBox())!.y;
        const before = await offset();
        await box.pressSequentially('viven');
        await expect(sentence.locator('[aria-hidden="true"]')).toHaveText('viven');
        expect(await offset()).toBe(before);
        await expect(box).toBeFocused();
        await page.setViewportSize(SMALL_PHONE);
        await scan(page, theme, 'conjugation 375 px: typed sentence');
      });
    });
  });
}
