// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * What the legal pages say about AI right now: the privacy policy's AI section (/privacy#AI-Policy),
 * the privacy summary, the subprocessor page and the notice to schools read this instance's AI
 * settings at render time, so a "no student data goes to AI" sentence appears only while it is true.
 *
 * The one flow of student-made content to an AI provider is the "repeat the sentence" (Vocabulómetro
 * mode 'ei') transcription: the student's recording goes to the OpenAI-side provider, with no
 * identifier, when its own switch (services/transcriptionSetting.ts) AND the master AI switch are on
 * (routers/vocab.ts, transcribeEiRecording). Every other feature sends only teacher-written text, or
 * the AI's own output to the moderation check. The tables below follow the code's routing
 * (services/ai/providerFactory.ts, textProvider.ts, imageService.ts, mnemonicService.ts).
 *
 * Pure functions: the router (routers/legal.ts) reads the settings and passes the state in; null
 * means they could not be read, and the pages then make no claim about what is switched on.
 */

/** The AI settings the pages describe (read per request; never cached). */
export interface AiLegalState {
  /** The master switch: no AI call of any kind while it is off. */
  aiEnabled: boolean;
  /** Each feature's own switch (counts only while aiEnabled is on). */
  pronunciation: boolean;
  images: boolean;
  mnemonics: boolean;
  /** The "repeat the sentence" transcription switch (migration 0049). */
  transcription: boolean;
  /** 'openai' | 'elevenlabs': who speaks pronunciation audio. */
  ttsProvider: string;
  /** 'openai' | 'anthropic': who drafts memory tips. */
  textProvider: string;
  hasOpenAiKey: boolean;
  /** The OpenAI-side base URL is not OpenAI's own (an OpenAI-compatible service). */
  customOpenAiEndpoint: boolean;
  hasElevenLabsKey: boolean;
  hasAnthropicKey: boolean;
}

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** The settings fields the state is made from (AppSettings has them all; absent ones read as off). */
export interface AiSettingsLike {
  aiEnabled?: boolean;
  aiPronunciationEnabled?: boolean;
  aiImageEnabled?: boolean;
  aiMnemonicEnabled?: boolean;
  aiTtsProvider?: string;
  aiTextProvider?: string;
  openaiApiKey?: string | null;
  openaiBaseUrl?: string;
  elevenlabsApiKey?: string | null;
  anthropicApiKey?: string | null;
}

export function aiLegalStateFrom(settings: AiSettingsLike, transcriptionSwitch: boolean): AiLegalState {
  const baseUrl = (settings.openaiBaseUrl ?? OPENAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return {
    aiEnabled: settings.aiEnabled === true,
    pronunciation: settings.aiPronunciationEnabled === true,
    images: settings.aiImageEnabled === true,
    mnemonics: settings.aiMnemonicEnabled === true,
    transcription: transcriptionSwitch,
    ttsProvider: settings.aiTtsProvider === 'elevenlabs' ? 'elevenlabs' : 'openai',
    textProvider: settings.aiTextProvider === 'anthropic' ? 'anthropic' : 'openai',
    hasOpenAiKey: Boolean(settings.openaiApiKey),
    customOpenAiEndpoint: baseUrl !== '' && baseUrl !== OPENAI_DEFAULT_BASE_URL,
    hasElevenLabsKey: Boolean(settings.elevenlabsApiKey),
    hasAnthropicKey: Boolean(settings.anthropicApiKey),
  };
}

/** A fresh install: AI off, the transcription switch off (services/appSettings.ts defaults). */
export const FRESH_INSTALL_AI_STATE: AiLegalState = {
  aiEnabled: false,
  pronunciation: true,
  images: true,
  mnemonics: true,
  transcription: false,
  ttsProvider: 'openai',
  textProvider: 'openai',
  hasOpenAiKey: false,
  customOpenAiEndpoint: false,
  hasElevenLabsKey: false,
  hasAnthropicKey: false,
};

/** Whether a student's recording can go to an AI provider right now (the gate transcribeEiRecording applies). */
export function studentAudioToAi(state: AiLegalState): boolean {
  return state.aiEnabled && state.transcription;
}

/** Whether OpenAI's moderation check can run right now: it needs an OpenAI key (imageService, mnemonicService). */
function safetyCheckOn(state: AiLegalState): boolean {
  return state.aiEnabled && (state.images || state.mnemonics) && state.hasOpenAiKey;
}

/** Whether the OpenAI-side provider can be called at all (providerFactory: a key, or another endpoint). */
function openAiUsable(state: AiLegalState): boolean {
  return state.hasOpenAiKey || state.customOpenAiEndpoint;
}

function openAiName(state: AiLegalState): string {
  return state.customOpenAiEndpoint ? 'An OpenAI-compatible service chosen by the administrator (not OpenAI itself)' : 'OpenAI';
}

const NO_KEY = 'no key is saved, so nothing is sent';

function openAiProvider(state: AiLegalState, suffix = ''): string {
  return openAiUsable(state) ? `${openAiName(state)}${suffix}` : `OpenAI${suffix} (${NO_KEY})`;
}

interface FeatureRow {
  feature: string;
  on: boolean;
  /** Why it is off although its own switch is on. */
  offBecause: string | null;
  provider: string;
  /** Which provider row of the subprocessor page it reaches, and only when something is really sent. */
  reaches: 'openai' | 'elevenlabs' | 'anthropic' | null;
  sends: string;
  /** What the provider receives, as the subprocessor page lists it. */
  received: string;
  studentData: boolean;
}

function featureRows(state: AiLegalState): FeatureRow[] {
  const master = (own: boolean) => (own && !state.aiEnabled ? 'all AI is switched off' : null);
  const eleven = state.ttsProvider === 'elevenlabs';
  const ttsReaches = !eleven ? (openAiUsable(state) ? 'openai' : null) : (state.hasElevenLabsKey ? 'elevenlabs' : null);
  const claude = state.textProvider === 'anthropic';
  const tipsReach = !claude ? (openAiUsable(state) ? 'openai' : null) : (state.hasAnthropicKey ? 'anthropic' : null);
  const pronunciationOn = state.aiEnabled && state.pronunciation;
  const imagesOn = state.aiEnabled && state.images;
  const tipsOn = state.aiEnabled && state.mnemonics;
  const checkOn = safetyCheckOn(state);
  const transcriptionOn = studentAudioToAi(state);
  return [
    {
      feature: 'Pronunciation audio (cards and vocabulary tests)',
      on: pronunciationOn,
      offBecause: master(state.pronunciation),
      provider: eleven ? (state.hasElevenLabsKey ? 'ElevenLabs' : `ElevenLabs (${NO_KEY})`) : openAiProvider(state),
      reaches: pronunciationOn ? ttsReaches : null,
      sends: `The text to be spoken (a card's words, or a word or sentence from the vocabulary list), with the voice, model and language${eleven ? ', and a fixed lead-in sentence that is the same for everyone' : ''}. Nothing about who asked`,
      received: 'card and vocabulary text, for pronunciation audio',
      studentData: false,
    },
    {
      feature: 'Pictures for cards',
      on: imagesOn,
      offBecause: master(state.images),
      provider: openAiProvider(state),
      reaches: imagesOn && openAiUsable(state) ? 'openai' : null,
      sends: 'A prompt built from the card\'s text',
      received: 'picture prompts built from card text',
      studentData: false,
    },
    {
      feature: 'Memory-tip drafts (teachers only)',
      on: tipsOn,
      offBecause: master(state.mnemonics),
      provider: claude ? (state.hasAnthropicKey ? 'Anthropic (Claude)' : `Anthropic (${NO_KEY})`) : openAiProvider(state),
      reaches: tipsOn ? tipsReach : null,
      sends: 'The card\'s text, earlier drafts for that card, and the deck\'s accepted tips',
      received: 'card text, earlier drafts and accepted tips, for memory-tip drafts',
      studentData: false,
    },
    {
      feature: 'Automatic safety check (moderation) of picture prompts and memory-tip drafts',
      on: checkOn,
      offBecause: state.aiEnabled && (state.images || state.mnemonics) && !state.hasOpenAiKey
        ? 'it runs only with an OpenAI key saved'
        : master(state.images || state.mnemonics),
      provider: state.customOpenAiEndpoint && state.hasOpenAiKey ? openAiName(state) : 'OpenAI',
      reaches: checkOn ? 'openai' : null,
      sends: 'The picture prompt, or the drafted tip (card text and AI output)',
      received: 'picture prompts and drafted tips, for the safety check',
      studentData: false,
    },
    {
      feature: '"Repeat the sentence" test transcription',
      on: transcriptionOn,
      offBecause: master(state.transcription),
      provider: openAiProvider(state, ' (`whisper-1`)'),
      reaches: transcriptionOn && openAiUsable(state) ? 'openai' : null,
      sends: '**The student\'s voice recording**, with no name, email, ID or other identifier',
      received: '**students\' voice recordings in the "repeat the sentence" test, with no identifier**',
      studentData: true,
    },
  ];
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function status(row: FeatureRow): string {
  if (row.on) return '**On**';
  return row.offBecause ? `Off (${row.offBecause})` : 'Off';
}

const UNREAD = '*This site\'s AI settings could not be read just now, so this page cannot show which AI features are on. Reload the page to see them.*';

/** The privacy policy's AI table: every AI feature, on or off right now, with its provider and what it sends. */
export function aiFeaturesTable(state: AiLegalState | null): string {
  if (!state) return UNREAD;
  const rows = featureRows(state).map((r) => `| ${cell(r.feature)} | ${status(r)} | ${cell(r.provider)} | ${cell(r.sends)} | ${r.studentData ? '**Yes**' : 'No'} |`);
  return [
    '<caption>AI features on this site right now, read from its AI settings when this page was loaded.</caption>',
    '',
    '| Feature | Right now | Provider | What it sends when on | Student data? |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/** The subprocessor page: what each AI provider receives right now. */
export function aiProvidersTable(state: AiLegalState | null): string {
  if (!state) return UNREAD;
  const rows = featureRows(state);
  const providers: { key: 'openai' | 'elevenlabs' | 'anthropic'; name: string; configured: boolean }[] = [
    { key: 'openai', name: state.customOpenAiEndpoint ? openAiName(state) : 'OpenAI, L.L.C.', configured: openAiUsable(state) },
    { key: 'elevenlabs', name: 'ElevenLabs Inc.', configured: state.hasElevenLabsKey },
    { key: 'anthropic', name: 'Anthropic, PBC', configured: state.hasAnthropicKey },
  ];
  const lines = providers.map((p) => {
    const received = rows.filter((r) => r.reaches === p.key).map((r) => r.received);
    if (received.length > 0) {
      const text = received.join('; ').replace(/^(\**)([a-z])/, (_m, bold: string, first: string) => `${bold}${first.toUpperCase()}`);
      return `| ${cell(p.name)} | **Receives requests** | ${cell(text)} |`;
    }
    const idle = p.configured
      ? 'Configured; receives nothing while these features are off'
      : 'Not configured; receives nothing';
    return `| ${cell(p.name)} | ${idle} | Nothing |`;
  });
  return [
    '<caption>AI providers right now, read from this site\'s AI settings when this page was loaded.</caption>',
    '',
    '| Provider | Right now | What it receives right now |',
    '|---|---|---|',
    ...lines,
  ].join('\n');
}

/** The placeholders the pages use for the AI state (render.ts adds them to COMPUTED_KEYS). */
export const AI_COMPUTED_KEYS = [
  'ai_no_student_data',
  'ai_student_audio',
  'ai_settings_unknown',
  'ai_safety_check',
  'ai_features_table',
  'ai_providers_table',
] as const;

export function aiLegalValues(state: AiLegalState | null): Record<(typeof AI_COMPUTED_KEYS)[number], string> {
  const audio = state ? studentAudioToAi(state) : false;
  return {
    // Exactly one of the three is 'yes'.
    ai_no_student_data: state && !audio ? 'yes' : '',
    ai_student_audio: state && audio ? 'yes' : '',
    ai_settings_unknown: state ? '' : 'yes',
    ai_safety_check: state && safetyCheckOn(state) ? 'yes' : '',
    ai_features_table: aiFeaturesTable(state),
    ai_providers_table: aiProvidersTable(state),
  };
}
