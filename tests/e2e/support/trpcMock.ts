import type { Page, Request, Route } from '@playwright/test';

type TrpcHandler = (input: unknown, request: Request) => unknown | Promise<unknown>;
type TrpcHandlerMap = Record<string, unknown | TrpcHandler>;

export interface TrpcMockOptions {
  queries?: TrpcHandlerMap;
  mutations?: TrpcHandlerMap;
}

/** Thrown from a handler, it reaches the page as that procedure's tRPC error. */
export class TrpcMockError extends Error {
  /** `appCode` is the server's own error code (error.data.appCode), e.g. ROUND_EXPIRED. */
  constructor(message: string, readonly code = 'BAD_REQUEST', readonly httpStatus = 400, readonly appCode?: string) {
    super(message);
  }
}

function parseBatchPathnames(url: URL): string[] {
  const pathPrefix = '/api/trpc/';
  const start = url.pathname.indexOf(pathPrefix);
  if (start < 0) {
    return [];
  }
  const encodedSegment = url.pathname.slice(start + pathPrefix.length);
  if (!encodedSegment) {
    return [];
  }

  return encodedSegment
    .split(',')
    .map((part) => decodeURIComponent(part))
    .filter(Boolean);
}

function parseRawInput(request: Request): unknown {
  const url = new URL(request.url());

  if (request.method() === 'GET') {
    const rawInput = url.searchParams.get('input');
    if (!rawInput) {
      return null;
    }
    return JSON.parse(rawInput);
  }

  const postData = request.postData();
  if (!postData) {
    return null;
  }
  return JSON.parse(postData);
}

function readInputForOperation(rawInput: unknown, index: number): unknown {
  if (rawInput === null || rawInput === undefined) {
    return null;
  }

  const key = String(index);
  const slot = Array.isArray(rawInput)
    ? rawInput[index]
    : (rawInput as Record<string, unknown>)[key];

  if (!slot || typeof slot !== 'object') {
    return slot ?? null;
  }

  if ('json' in slot) {
    return (slot as { json: unknown }).json;
  }

  return slot;
}

async function resolveResult(
  handlers: TrpcHandlerMap,
  path: string,
  input: unknown,
  request: Request
): Promise<unknown> {
  const handler = handlers[path];
  if (handler === undefined) {
    return null;
  }
  if (typeof handler === 'function') {
    return (handler as TrpcHandler)(input, request);
  }
  return handler;
}

export async function mockTrpc(page: Page, options: TrpcMockOptions): Promise<void> {
  await page.route('**/api/trpc/**', async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const procedurePaths = parseBatchPathnames(url);
    const rawInput = parseRawInput(request);
    const handlers = request.method() === 'POST'
      ? (options.mutations ?? {})
      : (options.queries ?? {});

    const results = [];
    for (let index = 0; index < procedurePaths.length; index += 1) {
      const path = procedurePaths[index];
      const input = readInputForOperation(rawInput, index);
      try {
        const data = await resolveResult(handlers, path, input, request);
        results.push({ result: { data } });
      } catch (err) {
        if (!(err instanceof TrpcMockError)) throw err;
        results.push({ error: { message: err.message, code: -32600, data: { code: err.code, httpStatus: err.httpStatus, path, appCode: err.appCode } } });
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(results),
    });
  });
}

/** pins.loginOptions: whether the login page offers "Sign in with a PIN" (v1.22.0), and why. */
export type PinLoginOptions = { pin: boolean; reason: 'on' | 'auto' | null };

/** What the login page hears by default: no PIN sign-in (mode Auto while Google works). */
export const defaultPinOptions: PinLoginOptions = { pin: false, reason: null };

/** A legal page as legal.document returns it: enough of each page's structure for the mocked suite. */
export function mockLegalDocument(name: string): unknown {
  const titles: Record<string, [string, string]> = {
    privacy: ['Privacy Policy', 'Privacy Policy'],
    'privacy-summary': ['Privacy summary', 'Privacy summary'],
    terms: ['Terms of Service', 'Terms of Service'],
    subprocessors: ['Where data is stored', 'Where data is stored'],
    'coppa-notice': ['Notice to schools', 'Notice to schools'],
  };
  const [title, h1] = titles[name] ?? titles.privacy;
  const markdown = [
    `# ${h1}`,
    '',
    '**Version 1.0. Effective date: January 1, 2026.** [Change log](#changes) at the end.',
    '',
    '## Data {#data}',
    '',
    '<caption>Sample data table.</caption>',
    '',
    '| Data | Where it comes from | Who can see it |',
    '|---|---|---|',
    '| School email address | Google sign-in | The administrator |',
    '| Display name | Google profile | The teacher |',
    '',
    '## AI features on this site {#AI-Policy #ai}',
    '',
    'In the Vocabulómetro "repeat the sentence" test, the recording is sent to OpenAI. See [the summary](/privacy/summary).',
    '',
    '## Rules for using the site {#aup}',
    '',
    '1. **Rule one.**',
    '2. **Rule two.**',
    '',
    '## Changes {#changes}',
    '',
    '- Every version is listed here.',
  ].join('\n');
  return { name, title, version: '1.0', lang: 'en', markdown, configured: true };
}

type PublicTrpcOverrides = {
  authMe?: unknown;
  /** pins.loginOptions (default: no PIN sign-in). */
  pinOptions?: PinLoginOptions | null;
  setupStatus?: {
    needsSetup: boolean;
    callbackUrl: string;
    hasAdminEmail: boolean;
    cleverEnabled: boolean;
  };
  readmeMarkdown?: string;
  saveCredentialsResult?: { success: boolean };
};

export async function mockPublicTrpc(
  page: Page,
  overrides: PublicTrpcOverrides = {}
): Promise<void> {
  const defaultSetupStatus = {
    needsSetup: false,
    callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
    hasAdminEmail: true,
    cleverEnabled: false,
  };

  await mockTrpc(page, {
    queries: {
      'auth.me': overrides.authMe ?? null,
      'setup.getStatus': overrides.setupStatus ?? defaultSetupStatus,
      'public.getReadme': overrides.readmeMarkdown ?? '# Mock README\n\nThis is a mocked README response.',
      'pins.loginOptions': overrides.pinOptions === undefined ? defaultPinOptions : overrides.pinOptions,
      'legal.document': (input: unknown) => mockLegalDocument((input as { name?: string } | null)?.name ?? 'privacy'),
    },
    mutations: {
      'setup.saveCredentials': overrides.saveCredentialsResult ?? { success: true },
      'auth.logout': { success: true },
    },
  });
}

// ---------------------------------------------------------------------------
// Authenticated helpers
// ---------------------------------------------------------------------------

export const defaultAuthUser = {
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  picture: null,
  externalId: 'google-test-123',
  provider: 'google',
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const defaultSetupStatus = {
  needsSetup: false,
  callbackUrl: 'http://127.0.0.1:4173/auth/google/callback',
  hasAdminEmail: true,
  cleverEnabled: false,
};

type AuthenticatedTrpcOverrides = {
  authMe?: unknown;
  decks?: unknown[];
  virtualDecks?: unknown[];
  stats?: unknown;
  settings?: unknown;
  vocabOpenTests?: unknown[];
  vocabMyResults?: unknown[];
  labs?: unknown[];
  speakingTasks?: unknown[];
  signupSheets?: unknown[];
  /** conjugation.myQuizzes: the "[Deck] conjugation" links under the decks. */
  conjugationQuizzes?: unknown[];
  /** Further procedures, or replacements for the defaults (e.g. a lab session). */
  queries?: TrpcHandlerMap;
  mutations?: TrpcHandlerMap;
};

/**
 * Sets up tRPC mocks for an authenticated user browsing the dashboard.
 * All queries that the Dashboard and its child components fire are covered so
 * the page renders without network errors in tests.
 *
 * The `auth.me` / `auth.logout` handlers are stateful: after logout is called,
 * subsequent `auth.me` fetches return null so the ProtectedRoute correctly
 * redirects to /login.
 */
export const defaultAdminUser = {
  ...defaultAuthUser,
  id: 1,
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
};

// ---------------------------------------------------------------------------
// Shared sample data used by admin helpers
// ---------------------------------------------------------------------------

export const sampleUsers = [
  { id: 2, name: 'Jane Doe',   email: 'jane@example.com', role: 'user',  picture: null, createdAt: '2024-01-15T00:00:00.000Z', lastActiveAt: Date.parse('2024-03-01T10:00:00.000Z'), studentNumber: null },
  { id: 3, name: 'Bob Smith',  email: 'bob@example.com',  role: 'admin', picture: null, createdAt: '2024-02-01T00:00:00.000Z', lastActiveAt: null, studentNumber: null },
];

/** What admin.userDetail returns for one of the sample users: a student with a little of everything (core's fields; an extension's specs add their own). */
export function sampleUserDetail(userId: number) {
  const user = sampleUsers.find((u) => u.id === userId) ?? sampleUsers[0];
  return {
    user: {
      id: user.id, name: user.name, email: user.email, picture: null, role: user.role,
      createdAt: Date.parse(user.createdAt), lastActiveAt: user.lastActiveAt,
      studentNumber: user.studentNumber, studentNumberSetByTeacher: false,
    },
    groups: [{ id: 1, name: 'Spanish Class' }],
    settings: { newCardsPerDay: 20, reviewsPerDay: 100, isOverride: true, allowHigher: true, allowLower: false, limitRule: 'higher' },
    finishDays: ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01'],
    /** v1.18.0: the days nothing was left in any deck. */
    allDoneDays: ['2024-03-01'],
    flashcards: [{
      id: 1, name: 'Spanish Vocabulary', cardCount: 500, learned: 120, dueToday: 15, newToday: 5, reviewsToday: 30,
      newLimit: 20, reviewLimit: 100, reviews: 150, correctReviews: 128, lastStudiedAt: Date.parse('2024-03-01T10:00:00.000Z'),
      finishedDays: ['2024-02-28', '2024-03-01'],
    }],
    conjugation: [{ deckId: 1, deckName: 'Spanish Vocabulary', mastered: 12, total: 60, rounds: 4, lastPlayedAt: Date.parse('2024-02-29T10:00:00.000Z'), daysPractised: 3 }],
    labs: [
      { id: 1, title: 'ES1 Lab semana01', active: true, status: 'done', reason: null, attempts: 1, submittedAt: Date.parse('2024-02-28T15:12:00.000Z'), pausesAnswered: 18, pausesCounted: 20, needed: 15 },
      { id: 2, title: 'ES1 Lab semana02', active: true, status: 'check', reason: 'no-mic', attempts: 1, submittedAt: null, pausesAnswered: null, pausesCounted: 20, needed: 15 },
    ],
    speaking: [{ id: 1, title: 'Cuento semana 3', active: true, attempts: 1, lastSubmittedAt: Date.parse('2024-02-29T15:12:00.000Z'), durationMs: 28_000, score: 84, gradedBy: 'teacher', gradedAt: Date.parse('2024-03-01T02:00:00.000Z') }],
  };
}

/**
 * What pins.forUser returns for one of the sample users (v1.22.0): no PIN yet, and none at all
 * for an admin (they sign in with Google only).
 */
export function samplePinStatus(userId: number) {
  const user = sampleUsers.find((u) => u.id === userId);
  return { userId, eligible: user?.role !== 'admin', hasPin: false, createdAt: null, lastUsedAt: null, lockedUntil: null, failedCount: 0 };
}

/** A group's "Flashcards by day" (admin.groupFlashcardDay) with nothing assigned. */
export const emptyFlashcardDay = { day: '2024-03-01', groupNewLimit: 20, decks: [], students: [] };

/** The pause rule as the migrations seed it: 0% (every lab counts), 0.25 s of voice, a 6 dB room margin, no extra hold. */
export const defaultLabSettings = { minAnsweredPct: 0, voicePerPauseMs: 250, gateMarginDb: 6, holdOutsideVoice: false };

export const sampleGroups = [
  { id: 0, name: 'All',           description: 'All users',                  memberCount: 3, deckCount: 0 },
  { id: 1, name: 'Spanish Class', description: 'Main Spanish learning group', memberCount: 5, deckCount: 1 },
];

export const sampleAdminDecks = [
  { id: 1, name: 'Spanish Vocabulary', description: null, cardCount: 500, reversible: false },
];

export const sampleAllowedEmails = [
  { id: 1, email: '.*@school\\.edu$', isRegex: true },
];

export const sampleUserSettings = [
  { userId: 2, newCardsLimit: 20, reviewsLimit: 100, isOverride: false, allowHigher: false, allowLower: false, newCardsDone: 5,  reviewsDone: 30 },
  { userId: 3, newCardsLimit: 30, reviewsLimit: 150, isOverride: true,  allowHigher: true,  allowLower: false, newCardsDone: 10, reviewsDone: 50 },
];

/** What admin.getUserStats returns for the sample users (the Dashboard's User Activity). */
export const sampleUserStats = [
  { userId: 2, userName: 'Jane Doe',  email: 'jane@example.com', role: 'user',  totalReviews: 150, totalTimeMs: 900_000,   correctReviews: 128, retentionRate: 128 / 150, lastActive: '2024-03-01T10:00:00.000Z' },
  { userId: 3, userName: 'Bob Smith', email: 'bob@example.com',  role: 'admin', totalReviews: 300, totalTimeMs: 1_800_000, correctReviews: 276, retentionRate: 276 / 300, lastActive: '2024-03-02T10:00:00.000Z' },
];

export const defaultAiAdminConfig = {
  aiEnabled: false,
  provider: 'openai',
  hasApiKey: false,
  baseUrl: 'https://api.openai.com/v1',
  enabled: false,
  apiKey: null,
  pronunciation: false,
  image: false,
  mnemonic: false,
  mnemonicModel: null,
  imageModel: null,
  imageQuality: null,
  ttsModel: null,
  ttsProvider: 'openai',
  hasElevenLabsKey: false,
  ttsVoiceMap: {},
  // Mirrors AVAILABLE_MODELS from the server (ai.getAdminConfig always returns
  // this). The AI config UI reads availableModels.* on load, so the mock must
  // supply it or the AI tab white-screens.
  availableModels: {
    mnemonic: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5.2'],
    image: ['gpt-image-1', 'gpt-image-1.5'],
    imageQuality: ['low', 'medium', 'high', 'auto'],
    tts: ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'tts-1', 'tts-1-hd'],
  },
  // v1.20.0: who writes mnemonic suggestions, and the Claude model (the key itself is never sent,
  // only whether one is saved).
  textProvider: 'openai',
  hasAnthropicKey: false,
  anthropicMnemonicModel: 'claude-opus-5-5',
  anthropicModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
};

type AdminTrpcOverrides = {
  authMe?: unknown;
  users?: unknown[];
  userSettings?: unknown[];
  userStats?: unknown[];
  groups?: unknown[];
  decks?: unknown[];
  allowedEmails?: unknown[];
  groupMembers?: unknown[];
  groupDecks?: unknown[];
  groupSettings?: unknown;
  deckGroups?: unknown[];
  aiConfig?: unknown;
  scanProgress?: unknown[];
  vocabTests?: unknown[];
  vocabResults?: unknown[];
  labs?: unknown[];
  /** labs.settings: the pause rule. */
  labSettings?: unknown;
  /** admin.groupFlashcardDay: the group screen's "Flashcards by day". */
  flashcardDay?: unknown;
  speakingTasks?: unknown[];
  signupSheets?: unknown[];
  /** pins.settings: the Access tab's "Sign in with a PIN" (default null: the card shows its radios off). */
  pinSettings?: unknown;
  queries?: TrpcHandlerMap;
  mutations?: TrpcHandlerMap;
};

/** A deck's conjugation settings as the server sends them before a teacher turns the quiz on. */
export function conjugationSettingsView(deckId: number, deckName: string, cardCount = 0) {
  return {
    deckId,
    deckName,
    settings: {
      enabled: false,
      tenses: ['present'],
      includeVosotros: false,
      vos: 'none',
      directions: 'both',
      answerMode: 'progressive',
      accentMode: 'progressive',
      roundLength: 20,
      excludedEntries: [],
      extraEntries: [],
      sentences: 'off',
      sentenceHoldback: false,
    },
    sentencesSince: null,
    effective: [],
    verbCount: 0,
    itemCount: 0,
    cardCount,
    entries: [],
  };
}

/** A deck's Sentences panel (v1.25.0) as conjugation.sentences.panel gives it: off, and what Built-in would give. */
export function conjugationSentencesPanel(deckId: number, overrides: Record<string, unknown> = {}) {
  return {
    deckId,
    mode: 'off',
    countedMode: 'builtIn',
    holdback: false,
    sentencesSince: null,
    levels: ['choice', 'typed-lenient', 'typed-strict'],
    coverage: { cells: 0, covered: 0, label: 0 },
    verbs: [],
    parked: [],
    parkedCount: 0,
    reports: [],
    hard: [],
    ...overrides,
  };
}

/** The deck the admin deck panel asked about, from the mocked deck list. */
function adminDeckFor(input: unknown, decks: unknown[]): { id: number; name: string; cardCount: number } {
  const deckId = Number((input as { deckId?: number } | null)?.deckId ?? 0);
  const deck = (decks as { id: number; name: string; cardCount?: number }[]).find((d) => d.id === deckId);
  return { id: deckId, name: deck?.name ?? '', cardCount: deck?.cardCount ?? 0 };
}

/**
 * Sets up tRPC mocks for an admin user. Covers all queries fired by the admin
 * panel (Users, Groups, Decks, Access, AI tabs) plus the shared dashboard
 * queries so navigation works cleanly.
 */
export async function mockAdminTrpc(
  page: Page,
  overrides: AdminTrpcOverrides = {}
): Promise<void> {
  let isLoggedOut = false;
  const user = overrides.authMe ?? defaultAdminUser;

  await mockTrpc(page, {
    queries: {
      // Auth
      'auth.me': () => (isLoggedOut ? null : user),
      'setup.getStatus': defaultSetupStatus,
      // Dashboard (needed so '/' renders without errors after navigation)
      'cards.getMyDecks': [],
      'cards.getStats': { totalReviews: 0, totalCards: 0, cardsLearnedToday: 0, reviewsToday: 0, currentStreak: 0 },
      'virtualDecks.list': [],
      'settings.get': { newCardsPerDay: 20, reviewsPerDay: 100, aiEnabled: false, autoPlayAudio: false, autoPlayAudioFront: false, mnemonicMode: 'manual', locale: null },
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      // Admin – Users tab
      'admin.getUsers':           overrides.users         ?? sampleUsers,
      'admin.getAllUserSettings':  overrides.userSettings  ?? sampleUserSettings,
      'admin.getUserStats':        overrides.userStats     ?? sampleUserStats,
      // Admin – Groups tab
      'admin.getGroups':           overrides.groups        ?? sampleGroups,
      'admin.getGroupMembers':     overrides.groupMembers  ?? [],
      'admin.getGroupDecks':       overrides.groupDecks    ?? [],
      'admin.getGroupSettings':    overrides.groupSettings ?? null,
      'admin.groupFlashcardDay':   overrides.flashcardDay  ?? emptyFlashcardDay,
      // Admin – Users tab, a user's page (/admin/users/:userId)
      'admin.userDetail':          (input: unknown) => sampleUserDetail(Number((input as { userId?: number } | null)?.userId ?? 2)),
      // Admin – Decks tab
      'admin.getDecks':            overrides.decks         ?? sampleAdminDecks,
      'admin.getDeckGroups':       overrides.deckGroups    ?? [],
      // Admin – Access tab
      'admin.getAllowedEmails':     overrides.allowedEmails ?? sampleAllowedEmails,
      'admin.testEmailPattern':    null,
      // Sign in with a PIN (v1.22.0): the Access tab's card, a user's PIN, a group's count, the login page
      'pins.settings':             overrides.pinSettings ?? null,
      'pins.forUser':              (input: unknown) => samplePinStatus(Number((input as { userId?: number } | null)?.userId ?? 2)),
      'pins.groupStatus':          { students: 0, withPin: 0 },
      'pins.loginOptions':         defaultPinOptions,
      // Admin – AI tab
      'ai.getAdminConfig':         overrides.aiConfig      ?? defaultAiAdminConfig,
      'ai.getAllScanProgress':      overrides.scanProgress  ?? [],
      'ai.getScanProgress':        null,
      // Admin – Dashboard tab
      'admin.exportUserProgress':  null,
      // Admin – Vocabulómetro tab
      'vocab.listTests':           overrides.vocabTests    ?? [],
      'vocab.getResults':          overrides.vocabResults  ?? [],
      'vocab.getCensusResults':    [],
      'vocab.getItemStats':        { attempts: 0, items: [], truncated: false, maxAttempts: 2000 },
      'vocab.getAudioBankWords':   { words: [] },
      'vocab.listTexts':           [],
      'vocab.listEiSentences':     [],
      'vocab.getAudioBankProgress': { status: 'idle', kind: 'word', accent: '', processed: 0, total: 0, failed: 0, startedAt: null, lastError: null },
      'vocab.getVocabVoice':       { ttsProvider: 'openai', hasElevenLabsKey: false, vocabVoiceId: null, defaultVoiceId: null, effectiveVoiceId: null },
      'vocab.getEiSentenceAudioStatus': { total: 0, ready: 0, readyIds: [] },
      'vocab.listOpenTests':       [],
      // Admin – Labs and Speaking tabs (and the dashboard cards)
      'labs.adminList':            overrides.labs          ?? [],
      'labs.list':                 [],
      'labs.settings':             overrides.labSettings   ?? defaultLabSettings,
      'labs.missing':              [],
      'speaking.adminList':        overrides.speakingTasks ?? [],
      'speaking.list':             [],
      // Admin – Sign-ups tab (and the dashboard card)
      'signups.adminList':         overrides.signupSheets  ?? [],
      'signups.list':              [],
      // Admin – Decks tab, the selected deck's Conjugation section (and the dashboard links)
      'conjugation.myQuizzes':     [],
      'conjugation.settings':      (input: unknown) => {
        const deck = adminDeckFor(input, overrides.decks ?? sampleAdminDecks);
        return conjugationSettingsView(deck.id, deck.name, deck.cardCount);
      },
      'conjugation.results':       (input: unknown) => {
        const deck = adminDeckFor(input, overrides.decks ?? sampleAdminDecks);
        return { deckId: deck.id, deckName: deck.name, enabled: false, total: 0, students: [], mostMissed: [], topMistakes: [] };
      },
      'conjugation.sentences.panel': (input: unknown) => conjugationSentencesPanel(adminDeckFor(input, overrides.decks ?? sampleAdminDecks).id),
      ...overrides.queries,
    },
    mutations: {
      'auth.logout': () => { isLoggedOut = true; return { success: true }; },
      'admin.createGroup':            { id: 99, name: 'New Group', description: null, memberCount: 0 },
      'admin.deleteGroup':            { success: true },
      'admin.updateGroup':            { success: true },
      'admin.updateUserRole':         { success: true },
      'admin.addUserToGroup':         { success: true, settingsApplied: false },
      'admin.addUsersToGroup':        (input: unknown) => {
        const requested = ((input as { userIds?: number[] } | null)?.userIds ?? []).length;
        return { success: true, requested, added: requested, settingsApplied: 0 };
      },
      'admin.removeUserFromGroup':    { success: true },
      'admin.assignDeckToGroup':      { success: true },
      'admin.removeDeckFromGroup':    { success: true },
      'admin.updateGroupSettings':    { success: true },
      'admin.applyGroupSettingsToMembers': { success: true },
      'admin.createDeck':             { id: 99, name: 'New Deck', description: null, cardCount: 0, reversible: false },
      'admin.deleteDeck':             { success: true },
      'admin.updateDeck':             { success: true },
      'admin.addAllowedEmail':        { id: 99, email: 'new@example.com', isRegex: false },
      'admin.deleteAllowedEmail':     { success: true },
      'admin.updateUserSettings':     { success: true },
      'ai.saveAdminConfig':           { success: true },
      'ai.testAnthropicKey':          { ok: true, checks: [{ model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', seconds: 1.2 }] },
      'labs.update':                  { success: true },
      'labs.saveSettings':            (input: unknown) => ({ ...defaultLabSettings, ...(input as object) }),
      'labs.setCredit':               (input: unknown) => ({ updated: ((input as { submissionIds?: number[] } | null)?.submissionIds ?? []).length, rows: [] }),
      'labs.remove':                  { success: true },
      'speaking.update':              { success: true },
      'speaking.remove':              { success: true },
      'speaking.grade':               { success: true },
      'signups.update':               { success: true },
      'signups.remove':               { success: true },
      'pins.remove':                  { removed: true },
      'pins.unlock':                  { unlocked: true },
      ...overrides.mutations,
    },
  });
}

export async function mockAuthenticatedTrpc(
  page: Page,
  overrides: AuthenticatedTrpcOverrides = {}
): Promise<void> {
  let isLoggedOut = false;
  const user = overrides.authMe ?? defaultAuthUser;

  await mockTrpc(page, {
    queries: {
      'auth.me': () => (isLoggedOut ? null : user),
      'setup.getStatus': defaultSetupStatus,
      'cards.getMyDecks': overrides.decks ?? [],
      'cards.getStats': overrides.stats ?? {
        totalReviews: 0,
        totalCards: 0,
        cardsLearnedToday: 0,
        reviewsToday: 0,
        currentStreak: 0,
      },
      'virtualDecks.list': overrides.virtualDecks ?? [],
      'settings.get': overrides.settings ?? {
        newCardsPerDay: 20,
        reviewsPerDay: 100,
        aiEnabled: true,
        autoPlayAudio: false,
        autoPlayAudioFront: false,
        mnemonicMode: 'manual',
        locale: null,
      },
      'ai.getConfig': { pronunciation: false, image: false, mnemonic: false },
      'vocab.listOpenTests': overrides.vocabOpenTests ?? [],
      'vocab.getMyResults': overrides.vocabMyResults ?? [],
      'vocab.getMySeenWords': { words: [] },
      'vocab.getAudioBankWords': { words: [] },
      'vocab.getVocabAudioUrls': { urls: {} },
      'vocab.getTestTexts': { texts: [] },
      'vocab.getTestEiSentences': { sentences: [] },
      'labs.list': overrides.labs ?? [],
      'speaking.list': overrides.speakingTasks ?? [],
      'signups.list': overrides.signupSheets ?? [],
      'conjugation.myQuizzes': overrides.conjugationQuizzes ?? [],
      // Sign in with a PIN (v1.22.0): the login page after signing out; the admin procedures answer nothing.
      'pins.loginOptions': defaultPinOptions,
      'pins.settings': null,
      'pins.forUser': null,
      ...overrides.queries,
    },
    mutations: {
      'auth.logout': () => {
        isLoggedOut = true;
        return { success: true };
      },
      'vocab.submitResult': { id: 1 },
      ...overrides.mutations,
    },
  });
}

// ---------------------------------------------------------------------------
// The teacher's mnemonic suggestions (v1.20.0)
// ---------------------------------------------------------------------------

export type MnemonicStyle = 'keyword' | 'sentence';

/** One ai_mnemonics row as the mock keeps it. */
export interface MockMnemonicRow {
  id: number;
  cardId: number;
  text: string;
  style: MnemonicStyle;
  accepted: boolean;
  /** Set by a reject: the row is kept, so the model is told it was suggested, but never offered as pending again. */
  rejectedAt: number | null;
}

/**
 * The card mnemonics the server keeps since v1.20.0, for a study session's mock: the approved
 * mnemonic of each card, and the teacher's suggestions, each a keyword picture or an example
 * sentence. A reject is soft (the row stays, with rejectedAt), the pending suggestion is the
 * newest one neither rejected nor accepted (with the newest of each style beside it, so switching
 * style shows a waiting one again), and students are never sent one. Spread `queries` and
 * `mutations` into the mock; `calls` records what the page asked for, and `rows` what is stored.
 */
export function mockMnemonicSuggestions(options: { teacher?: boolean; approved?: Record<number, string> } = {}) {
  const teacher = options.teacher ?? true;
  const approved = new Map(Object.entries(options.approved ?? {}).map(([cardId, text]) => [Number(cardId), text]));
  const rows: MockMnemonicRow[] = [];
  const calls = {
    generate: [] as { cardId: number; style?: MnemonicStyle }[],
    reject: [] as number[],
    accept: [] as number[],
    deleteMnemonic: [] as number[],
    removeImage: [] as number[],
  };
  const cardOf = (input: unknown) => Number((input as { cardId?: number } | null)?.cardId ?? 0);
  const rowOf = (input: unknown) => {
    const id = Number((input as { mnemonicId?: number } | null)?.mnemonicId ?? 0);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new TrpcMockError('Mnemonic not found', 'NOT_FOUND', 404);
    return row;
  };
  const pendingFor = (cardId: number, style?: MnemonicStyle) =>
    [...rows].reverse().find((r) => r.cardId === cardId && !r.accepted && r.rejectedAt === null && (!style || r.style === style)) ?? null;
  const asPending = (row: MockMnemonicRow | null) => (row ? { id: row.id, text: row.text, style: row.style } : null);

  return {
    calls,
    rows,
    queries: {
      'ai.getCardAiState': (input: unknown) => {
        const cardId = cardOf(input);
        const text = approved.get(cardId);
        const waiting = teacher && !text;
        // The teacher also gets the approved mnemonic's style (Regenerate asks for the same kind).
        const approvedRow = [...rows].reverse().find((r) => r.cardId === cardId && r.accepted && r.text === text);
        return {
          acceptedMnemonic: text ? { text, source: 'teacher', ...(teacher ? { style: approvedRow?.style ?? 'keyword' } : {}) } : null,
          pendingMnemonic: waiting ? asPending(pendingFor(cardId)) : null,
          pendingByStyle: {
            keyword: waiting ? asPending(pendingFor(cardId, 'keyword')) : null,
            sentence: waiting ? asPending(pendingFor(cardId, 'sentence')) : null,
          },
        };
      },
    },
    mutations: {
      'ai.generateMnemonic': (input: unknown) => {
        const { cardId, style } = input as { cardId: number; style?: MnemonicStyle };
        calls.generate.push({ cardId, style });
        const id = rows.length + 1;
        const kind = style ?? 'keyword';
        const row: MockMnemonicRow = {
          id,
          cardId,
          text: kind === 'sentence' ? `Sentence ${id} for card ${cardId}` : `KEYWORD ${id} for card ${cardId}`,
          style: kind,
          accepted: false,
          rejectedAt: null,
        };
        rows.push(row);
        return { ...row, userId: 1, provider: 'openai', sourcePrompt: '', createdAt: Date.now() };
      },
      'ai.rejectMnemonic': (input: unknown) => {
        const row = rowOf(input);
        calls.reject.push(row.id);
        row.rejectedAt = Date.now();
        return { success: true };
      },
      'ai.acceptMnemonic': (input: unknown) => {
        const row = rowOf(input);
        calls.accept.push(row.id);
        row.accepted = true;
        approved.set(row.cardId, row.text);
        return { success: true };
      },
      'ai.deleteMnemonic': (input: unknown) => {
        calls.deleteMnemonic.push(cardOf(input));
        approved.delete(cardOf(input));
        return { success: true };
      },
      'ai.removeImage': (input: unknown) => {
        if (!teacher) throw new TrpcMockError('Admin access required', 'FORBIDDEN', 403);
        calls.removeImage.push(cardOf(input));
        return { success: true };
      },
    },
  };
}

/** ai.getCardAssets for a card with a picture and no audio (a 1×1 PNG, so the page can draw it). */
export const cardAssetsWithImage = {
  audio: null,
  audioFront: null,
  audioBack: null,
  audioFrontEnabled: true,
  audioBackEnabled: true,
  image: {
    id: 1,
    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  },
};
