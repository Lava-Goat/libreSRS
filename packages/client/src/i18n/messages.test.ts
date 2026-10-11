// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The translations against the code. Every English text the client hands t() as a literal
 * has its Spanish; every translation keeps its English's {{placeholders}}; a text that quotes
 * a button (or "All Done!") quotes that button's Spanish; and keys the code stopped using
 * leave every locale, so they can't hide a missing translation.
 *
 * Core's code only: an extension brings its own messages and checks them against its own
 * code (src/extensions/<id>/messages.test.ts), so a text only an extension shows has its
 * home there, never here.
 */
import { describe, expect, it } from 'vitest';
import { MESSAGES, SUPPORTED_LOCALES } from './messages';
import { literalsInCode as literalsIn, placeholders, quotedButtons, textsForT as textsIn } from '../test/i18nChecks';

/** Every core client source file but the tests (no extension), as text, keyed by its path from this folder. */
const SOURCES = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.d.ts', '!./messages.ts', '!../extensions/*/**', '!../extensions/enabled.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

/**
 * Admin and setup texts that had no Spanish before v1.15.0. Nothing new may join them:
 * translate one, then take it off this list (the "is current" test below says when).
 */
const ENGLISH_ONLY_BEFORE_V115 = new Set([
  // components/AdminDashboard.tsx
  'Exporting...',
  // components/CSVUpload.tsx
  'Reading file... {{percent}}%',
  'Importing...',
  'notes',
  // components/FlashcardReview.tsx
  'Admin: delete and regenerate AI assets for this card',
  '↺ Regenerate assets',
  'Card font size',
  // components/GroupManager.tsx
  'Clever OAuth is not configured on the server.',
  'Clever connection failed. Please try again.',
  'Settings applied to {{count}} member(s).',
  'Failed to apply settings.',
  'CSV',
  'Google Classroom',
  'Clever',
  'Connect to browse and select your courses.',
  'Your Google Classroom courses:',
  'Reconnect',
  'Loading courses...',
  'No active courses found.',
  'Back to courses',
  'Loading students...',
  'Import {{n}} students',
  'Connect Clever',
  'Connect to browse and select your sections.',
  'Your Clever sections:',
  'Loading sections...',
  'No sections found.',
  'Back to sections',
  'Group Settings: {{name}}',
  "Configure default settings for this group. Use \"Apply to All Members\" to push these to every member's settings.",
  'Allow user to adjust:',
  'Allow higher limits',
  'Allow lower limits',
  'Interface language',
  'None (use user preference)',
  'Applying...',
  'Apply to All Members',
  // pages/Admin.tsx
  'Are you sure you want to promote {{name}} to admin?',
  'Are you sure you want to demote {{name}} to user?',
  'Edit Settings for {{name}}',
  'Lock a setting to prevent the user from changing it.',
  'Edit user settings',
  'Active AI Tasks',
  'Scanning',
  'Features',
  'Map each accent your decks use to a voice from your ElevenLabs account (add voices to “My Voices” in ElevenLabs first). An unmapped accent falls back to the default voice — so if your default is a Spanish voice, an English side will be read by that Spanish voice.',
  'Locked — user cannot change',
  'Unlocked — user can change',
  'Card',
  // pages/Setup.tsx
  "Let's set up Google authentication so you can sign in.",
  "You'll need this URL when creating your Google OAuth credentials.",
]);

/** The English keys v1.15.0 replaced. No locale keeps them: the new text falls back to English. */
const REPLACED_IN_V115 = [
  'Reviews include learning and review cards (not new cards).',
  'Card {{current}} of {{total}}',
  'Across all users',
  'Choose one lab or a whole semester. Each file is scanned for where the last speech ends; students must hear through that point, and you can change it before uploading.',
  'Feedback (optional)',
];

/**
 * The English keys v1.16.0 replaced. "Show earlier attempts" and "Spoke for" stay (the speaking
 * review uses both), and so does the no-microphone confirm before a lab starts.
 */
const REPLACED_IN_V116 = [
  // The lab page's tally, now "of the N needed"
  'Pauses answered: {{answered}} of {{done}} · {{needed}} needed',
  // The lab review: its header lines ("labs started from now on"), labels and tooltips
  'Must hear through {{required}} · the pause rule is off, so every lab counts',
  'Must hear through {{required}} · counts with {{needed}} of {{total}} pauses answered',
  'Needs redo · {{answered}} of {{total}} pauses',
  'Noisy mic',
  'The mic heard voice outside the pauses about as often as in them: a noisy room, or speakers instead of headphones.',
  'The page sent {{count}} pause result(s) that do not match what the log shows was played. Check the log.',
  'Use a number of seconds from 0.25 to 2.',
  "Didn't count: you answered {{answered}} of {{total}} pauses",
  // Flashcards: the old counter, and the grid cell before it showed minutes
  '{{done}} of {{total}} cards done',
  '{{new}} new · {{answers}} answers',
  // Conjugation Results legend lines
  'A round’s score is the share of its questions answered right the first time.',
  'Median time: seconds to answer on a first try, typed and multiple choice. Students never see a clock.',
  // Speaking: the quiet-take hint, now "We could hardly hear you"
  'We heard very little speaking. Listen back before you turn it in.',
];

/**
 * The English keys v1.20.0 replaced. The cognate system is gone (its badge, switches, false-friend
 * warning, "Auto for non-cognates" mode and Admin > AI scoring), so every text that named it says
 * mnemonics alone. With an Anthropic key, mnemonic suggestions (the "chat") may run on Claude, so
 * the TTS provider's note no longer says chat stays on the endpoint. The teacher's suggestion
 * buttons now read "Suggest a mnemonic" / "Suggest a sentence" and "Try another", next to
 * "Try a sentence" / "Try a keyword".
 */
const REPLACED_IN_V120 = [
  'Affects speech only — chat, image and transcription stay on the endpoint above.',
  'Auto for non-cognates',
  'Mnemonics are suggested automatically when a word is not a cognate or after a lapse.',
  'Cognate: {{pct}}%',
  'Cognate similarity: {{pct}}%',
  'False friend: these words look similar but have different meanings!',
  'Show cognate score',
  'Regenerate pronunciation, images, and cognate scores',
  'Configure AI-powered features like pronunciation, image generation, mnemonics, and cognate detection.',
  'AI features are currently disabled. Enable the master switch and configure an OpenAI-compatible endpoint, with an API key if required, to use pronunciation, images, mnemonics, and cognate detection during flashcard review.',
  'AI-generated memory aids when cards are difficult',
  'Get Mnemonic Suggestion',
  'Try Another',
  // English only until now (ENGLISH_ONLY_BEFORE_V115)
  'Cognate Scoring',
  'Use AI to detect cognates between vocabulary pairs. Requires AI to be enabled.',
  'Cognate AI model',
];

/** Each text the code passes to t() as a literal, with the first place it is used. */
const TEXTS = textsIn(SOURCES);

/**
 * Every string literal in the client code. A key the code reaches through a table (a lab log's
 * "Paused at") is passed to t() as a variable, so it is found here.
 */
const literalsInCode = () => literalsIn(SOURCES);
const es = MESSAGES.es;

describe('MESSAGES against the client code', () => {
  it('reads the client code (so the checks below cannot pass on nothing)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(80);
    expect(Object.keys(SOURCES).filter((path) => path.includes('.test.'))).toEqual([]);
    // No extension's code: its texts are its own catalog's.
    expect(Object.keys(SOURCES).filter((path) => /^\.\.\/extensions\/(?:[^/]+\/|enabled\.)/.test(path))).toEqual([]);
    expect(Object.keys(SOURCES)).toContain('../extensions/index.tsx');
    expect(TEXTS.size).toBeGreaterThan(1000);
    expect(TEXTS.get('{{seen}} of {{total}} seen · {{done}} done')).toMatch(/^components\/FlashcardReview\.tsx:\d+$/);
    // Both sides of a conditional count, and keys keep the code's straight apostrophes.
    expect(TEXTS.has('Find pauses again')).toBe(true);
    expect(TEXTS.has("The mic didn't hear me")).toBe(true);
  });

  it('has Spanish for every text the code passes to t()', () => {
    const missing = [...TEXTS]
      .filter(([text]) => !(text in es) && !ENGLISH_ONLY_BEFORE_V115.has(text))
      .map(([text, where]) => `${where}  ${text}`);
    expect(missing).toEqual([]);
  });

  it('keeps the list of texts still in English only current', () => {
    const translated = [...ENGLISH_ONLY_BEFORE_V115].filter((text) => text in es);
    const unused = [...ENGLISH_ONLY_BEFORE_V115].filter((text) => !TEXTS.has(text));
    expect({ translated, unused }).toEqual({ translated: [], unused: [] });
  });

  it('drops the keys v1.15.0 replaced from every locale', () => {
    for (const text of REPLACED_IN_V115) {
      expect(TEXTS.has(text)).toBe(false);
      for (const locale of SUPPORTED_LOCALES) expect(MESSAGES[locale][text], `${locale}: ${text}`).toBeUndefined();
    }
  });

  it('drops the keys v1.16.0 replaced from every locale', () => {
    for (const text of REPLACED_IN_V116) {
      expect(TEXTS.has(text), text).toBe(false);
      for (const locale of SUPPORTED_LOCALES) expect(MESSAGES[locale][text], `${locale}: ${text}`).toBeUndefined();
    }
    // Still used, so still translated.
    for (const text of ['Show earlier attempts', 'Spoke for', "Do the lab without a microphone? It won't count until your teacher checks it."]) {
      expect(TEXTS.has(text), text).toBe(true);
      expect(es[text], text).toBeDefined();
    }
  });

  it('drops the keys v1.20.0 replaced from every locale', () => {
    for (const text of REPLACED_IN_V120) {
      expect(TEXTS.has(text), text).toBe(false);
      for (const locale of SUPPORTED_LOCALES) expect(MESSAGES[locale][text], `${locale}: ${text}`).toBeUndefined();
    }
    expect(TEXTS.has('Affects speech only — images and transcription stay on the endpoint above.')).toBe(true);
    // No text the client shows names cognates any more.
    expect([...TEXTS.keys()].filter((text) => /cognate|false friend/i.test(text))).toEqual([]);
  });

  it('keeps no key the code never uses, in any locale', () => {
    const inCode = literalsInCode();
    expect(inCode.has('Paused at')).toBe(true);
    const unused: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      for (const text of Object.keys(MESSAGES[locale])) {
        if (!TEXTS.has(text) && !inCode.has(text)) unused.push(`${locale}: ${text}`);
      }
    }
    expect(unused).toEqual([]);
  });

  it('keeps every English {{placeholder}} in every translation', () => {
    const broken: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      for (const [english, translated] of Object.entries(MESSAGES[locale])) {
        if (placeholders(english) !== placeholders(translated)) broken.push(`${locale}: ${english}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('quotes a button (or “All Done!”) by its Spanish name', () => {
    const { quoted, wrong } = quotedButtons(es, (name) => es[name]);
    expect(quoted).toEqual(expect.arrayContaining(['Start the lab', "The mic didn't hear me", 'All Done!']));
    expect(wrong).toEqual([]);
  });
});

describe('the v1.15.0 Spanish', () => {
  it('reads as the spec gives it', () => {
    expect(es["The mic didn't hear me"]).toBe('El micrófono no me oyó');
    expect(es['Comment for the student (they will see it)']).toBe('Comentario para el estudiante (lo verá)');
    expect(es['Reviews are cards that come back after you learned them (not new cards).'])
      .toBe('Los repasos son tarjetas que vuelven después de aprenderlas (no las nuevas).');
    expect(es['Locked by admin']).toBe('Bloqueado por tu profesor');
  });
});

describe('the v1.18.0 Spanish', () => {
  it('quotes each “Study all” by the Spanish of its own button', () => {
    const flashcards = es['Study all flashcards'];
    const conjugation = es['Study all conjugation'];
    expect(flashcards).toBe('Estudiar todas las tarjetas');
    expect(conjugation).toBe('Estudiar toda la conjugación');
    expect(es['Study all flashcards ({{count}})']).toBe(`${flashcards} ({{count}})`);
    // Every text naming "Study all" names one of the two buttons (an extension's texts are checked with it).
    const naming = Object.keys(es).filter((english) => /Study all/.test(english) && !/^Study all /.test(english));
    expect(naming.length).toBeGreaterThanOrEqual(2);
    for (const english of naming) {
      const button = /flashcards|deck by deck/.test(english) && !/conjugation/.test(english) ? flashcards : conjugation;
      expect(es[english], english).toContain(`«${button}»`);
    }
  });
});

describe('the v1.20.0 Spanish', () => {
  it('quotes “Test key” and “Model Settings” by their Spanish', () => {
    expect(es['Test key']).toBe('Probar la clave');
    expect(es['Model Settings']).toBe('Configuración del modelo');
    expect(es['Mnemonic suggestions are paused until the Anthropic account has credit. Add credit in the Claude Console, then press “Test key” to resume right away.'])
      .toContain('“Probar la clave”');
    expect(es['This account can’t use the model {{model}}. Pick another one under “Model Settings”.']).toContain('“Configuración del modelo”');
  });

  it('keeps names that are names', () => {
    expect(es['Anthropic (Claude)']).toBe('Anthropic (Claude)');
    expect(es['Anthropic API Key']).toBe('Clave API de Anthropic');
  });

  it('names the two styles of mnemonic suggestion the same way on the buttons and the label', () => {
    expect(es['Suggest a mnemonic']).toBe('Sugerir un mnemotécnico');
    expect(es['Suggest a sentence']).toBe('Sugerir una frase');
    expect(es['Try another']).toBe('Probar otro');
    expect(es['Keyword picture']).toBe('Imagen con palabra clave');
    expect(es['Try a keyword']).toBe('Probar una palabra clave');
    expect(es['Example sentence']).toBe('Frase de ejemplo');
    expect(es['Try a sentence']).toBe('Probar una frase');
  });

  it('never calls the keyword style a picture on a button: the card’s own picture is “Generar imagen” just above', () => {
    expect(es['Try a picture']).toBeUndefined();
    expect(es['Try a keyword']).not.toMatch(/imagen/i);
  });
});

describe('the v1.16.0 Spanish', () => {
  it('reads as written for Spanish 1 students', () => {
    expect(es['{{seen}} of {{total}} seen · {{done}} done']).toBe('{{seen}} de {{total}} vistas · {{done}} hechas');
    expect(es['Pauses answered: {{answered}} of the {{needed}} needed · {{left}} pauses left'])
      .toBe('Pausas contestadas: {{answered}} de las {{needed}} que hacen falta · quedan {{left}} pausas');
    // The singulars say "1" in Spanish too, not "1 pausas" or "1 van".
    expect(es['Pauses answered: {{answered}} of the {{needed}} needed · 1 pause left'])
      .toBe('Pausas contestadas: {{answered}} de las {{needed}} que hacen falta · queda 1 pausa');
    expect(es['1 on the way up']).toBe('1 va subiendo');
    expect(es['We could hardly hear you. Record it again, closer to the microphone.']).toBe('Casi no te oímos. Grábalo otra vez, más cerca del micrófono.');
    expect(es['Record it again']).toBe('Grabarlo otra vez');
    expect(es['Turn it in anyway']).toBe('Entregarlo de todos modos');
  });

  it('names the texts it points to by their Spanish', () => {
    // "Spoke for" is a column heading, not a button, so the check above does not see it.
    expect(es['Spoke for is measured by the student’s page, capped at the file’s real length.']).toContain(`«${es['Spoke for']}»`);
    expect(es['Easy on {{easy}} of {{new}} new cards']).toContain(`«${es.Easy}»`);
  });
});

describe('the v1.25.0 Spanish', () => {
  it('names the blank the same way everywhere a student meets it, in Spanish I words', () => {
    expect(es.blank).toBe('espacio en blanco');
    expect(es['Pick the verb that fills the blank.']).toContain(es.blank);
    expect(es['Type the verb that fills the blank.']).toContain(es.blank);
    // A sentence is "frase" for students, as the guide says it.
    expect(es['Something’s wrong with this sentence']).toBe('Algo está mal en esta frase');
    expect(es['Thank you. Your teacher will look at this sentence.']).toContain('frase');
    expect(es['Word help']).toBe('Ayuda con las palabras');
  });

  it('quotes the Save button by its Spanish', () => {
    expect(es['Saved when you press Save.']).toContain(es.Save);
  });
});
