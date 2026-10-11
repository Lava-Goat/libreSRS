// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Core's legal pages: the neutral defaults (src/legal/defaults/*.md) that every copy of libreSRS
 * serves until its operator publishes its own, and the renderer that fills them, or an
 * extension's own documents in their place (LegalDocumentSet).
 */
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { combine, type ServerExtension } from '../../extensions/api.js';
import { aiLegalStateFrom, FRESH_INSTALL_AI_STATE, type AiLegalState } from './aiDisclosure.js';
import { envNameFor, MISSING, OPERATOR_FIELDS, OPERATOR_FIELD_KEYS } from './operatorConfig.js';
import {
  COMPUTED_KEYS, fillTemplate, includedBody, LEGAL_DIR, LEGAL_DOCUMENTS, placeholdersIn, readLegalTemplate,
  renderLegalDocument, renderPriorLegalVersion, splitFrontMatter, templateFile, UnknownPlaceholderError,
  type LegalDocumentName, type RenderContext,
} from './render.js';

const none = combine().privacy;
const ctx = (env: NodeJS.ProcessEnv = {}, privacy = none, ai: AiLegalState | null = FRESH_INSTALL_AI_STATE): RenderContext => ({ env, privacy, cleverEnabled: false, ai });
const render = (name: LegalDocumentName, c = ctx()) => renderLegalDocument(name, c).markdown;
const all = (c = ctx()) => LEGAL_DOCUMENTS.map((n) => render(n, c)).join('\n');

const OPERATOR = {
  LEGAL_OPERATOR_LEGAL_NAME: 'Example Learning, Inc.',
  LEGAL_OPERATOR_SHORT_NAME: 'Example Learning',
  LEGAL_SERVICE_DOMAIN: 'learn.example.org',
  LEGAL_SUPPORT_EMAIL: 'help@example.org',
  LEGAL_SECURITY_EMAIL: 'security@example.org',
};

const SPEECH_ONLY = aiLegalStateFrom({
  aiEnabled: true, aiPronunciationEnabled: true, aiImageEnabled: false, aiMnemonicEnabled: false,
  aiTtsProvider: 'elevenlabs', aiTextProvider: 'openai', openaiApiKey: 'sk-test', elevenlabsApiKey: 'el-test', anthropicApiKey: null,
}, false);
const TRANSCRIBING: AiLegalState = { ...SPEECH_ONLY, transcription: true };
const AI_STATES: (AiLegalState | null)[] = [FRESH_INSTALL_AI_STATE, SPEECH_ONLY, TRANSCRIBING, null];

/** Every heading id of a page, aliases too ("## Title {#AI-Policy #ai}"). */
function allIds(md: string): string[] {
  return [...md.matchAll(/^#{1,6} .*\{#([A-Za-z0-9-]+)((?: +#[A-Za-z0-9-]+)*)\}$/gm)]
    .flatMap((m) => [m[1], ...m[2].split(' ').filter(Boolean).map((a) => a.slice(1))]);
}

describe("core's default pages", () => {
  it('are the five pages, each with a title, a version and a language', () => {
    expect(readdirSync(LEGAL_DIR).sort()).toEqual(LEGAL_DOCUMENTS.map(templateFile).sort());
    for (const name of LEGAL_DOCUMENTS) {
      const { meta } = splitFrontMatter(readLegalTemplate(name));
      expect(meta.title, name).toBeTruthy();
      expect(meta.version, name).toMatch(/^\d+\.\d+$/);
      expect(meta.lang, name).toBe('en');
    }
  });

  it('use only placeholders core fills, and every operator field core declares', () => {
    const used = new Set<string>();
    for (const name of LEGAL_DOCUMENTS) for (const key of placeholdersIn(readLegalTemplate(name))) used.add(key);
    expect([...used].filter((k) => !OPERATOR_FIELD_KEYS.has(k) && !(COMPUTED_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect([...OPERATOR_FIELD_KEYS].filter((k) => !used.has(k))).toEqual([]);
  });

  it('tell the reader, on every page, that the operator has not published its own text, and promise nothing for it', () => {
    for (const name of LEGAL_DOCUMENTS) {
      const md = render(name);
      expect(md, name).toMatch(/^\*\*The operator of this site has not published [^*]+\.\*\* This page is the default text that comes with the libreSRS software\./m);
      expect(md, name).not.toContain('{{');
    }
    expect(render('privacy')).toContain('It makes no promise on the operator\'s behalf.');
    expect(render('terms')).toContain('this page is not an agreement with anyone and makes no promise on the operator\'s behalf.');
    expect(render('coppa-notice')).toContain('Whoever runs this site is responsible for any such notice, and this page makes no promise on its behalf.');
    expect(render('privacy')).toContain('Any feature that is on sends only the text named in the table');
  });

  it('name no operator, place, school system or law of anyone\'s instance', () => {
    for (const name of LEGAL_DOCUMENTS) {
      const text = readLegalTemplate(name);
      expect(text, name).not.toMatch(/district|california|united states|ferpa|addendum|we will|we do not|section \d+/i);
      expect(text, name).not.toMatch(/@|https?:\/\//);
    }
  });

  it('show "[not yet stated]" where the operator has not said who it is, and are not marked configured', () => {
    expect(render('privacy')).toContain(`## Who runs this site {#who}\n\n- **Operator:** ${MISSING}\n- **Contact:** ${MISSING}\n- **Privacy questions:** ${MISSING}\n`);
    expect(render('privacy-summary')).toContain(`Until it does, ask ${MISSING}.`);
    for (const name of LEGAL_DOCUMENTS) expect(renderLegalDocument(name, ctx()).configured, name).toBe(false);
    // No domain, short name, source or security.txt sentence until they exist.
    expect(all()).not.toMatch(/\*\*Site:\*\*|doing business as|source code (this site runs )?is published|security\.txt/);
  });

  it('show the operator\'s name and contacts once set', () => {
    const c = ctx({ ...OPERATOR, LEGAL_SOURCE_URL: 'https://example.org/src' });
    const privacy = render('privacy', c);
    expect(privacy).toContain('- **Site:** learn.example.org\n- **Operator:** Example Learning, Inc., doing business as Example Learning\n- **Contact:** help@example.org\n- **Privacy questions:** help@example.org\n');
    expect(privacy).toContain('Its source code is published at [https://example.org/src](https://example.org/src).');
    expect(privacy).toContain('Security reports: security@example.org. A `security.txt` file at [/.well-known/security.txt](/.well-known/security.txt) says the same.');
    expect(render('terms', c)).toContain('- **Site:** learn.example.org\n- **Operator:** Example Learning, Inc., doing business as Example Learning\n- **Contact:** help@example.org\n');
    expect(render('coppa-notice', c)).toContain('should ask for it at help@example.org.');
    expect(renderLegalDocument('privacy', c).configured).toBe(true);
  });

  it('state what the software does as it is distributed', () => {
    const md = render('privacy');
    expect(md).toContain('- has no advertising, analytics or tracking built in, and its pages load scripts only from this site;');
    expect(md).toContain('- stores the API keys and sign-in secrets saved in the administrator\'s settings encrypted in the site\'s database;');
    expect(md).toContain('libreSRS is free software under the GNU Affero General Public License v3.0 or later.');
  });

  it('keep the addresses core links to: /privacy#AI-Policy, #ai, #security, #changes and /terms#aup', () => {
    const ids = allIds(render('privacy'));
    for (const id of ['AI-Policy', 'ai', 'security', 'changes', 'who', 'instance']) expect(ids, id).toContain(id);
    expect(allIds(render('terms'))).toEqual(expect.arrayContaining(['aup', 'changes']));
    expect(render('privacy')).toMatch(/^## AI features on this site \{#AI-Policy #ai\}$/m);
  });

  it('link only to pages and sections that exist', () => {
    const PAGES: Record<string, LegalDocumentName> = {
      '/privacy': 'privacy', '/privacy/summary': 'privacy-summary', '/terms': 'terms',
      '/subprocessors': 'subprocessors', '/privacy/coppa-notice': 'coppa-notice',
    };
    const c = ctx({ ...OPERATOR, LEGAL_SOURCE_URL: 'https://example.org/src' });
    for (const name of LEGAL_DOCUMENTS) {
      const md = render(name, c);
      for (const m of md.matchAll(/\]\(([^)\s]*)#([A-Za-z0-9-]+)\)/g)) {
        const target = m[1] === '' ? name : PAGES[m[1]];
        expect(target, `${name}: ${m[0]}`).toBeDefined();
        expect(allIds(render(target, c)), `${name}: ${m[0]}`).toContain(m[2]);
      }
      for (const m of md.matchAll(/\]\((\/[^)#\s]*)/g)) {
        expect([...Object.keys(PAGES), '/api/build-info', '/.well-known/security.txt'], `${name}: ${m[1]}`).toContain(m[1]);
      }
      const ids = allIds(md);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), name).toEqual([]);
    }
  });
});

describe("the defaults' AI parts follow the AI settings", () => {
  const privacy = (ai: AiLegalState | null) => render('privacy', ctx({}, none, ai));

  it('carry the live table of AI features, and the one sentence the settings make true', () => {
    expect(privacy(SPEECH_ONLY)).toContain('<caption>AI features on this site right now');
    expect(privacy(SPEECH_ONLY)).toContain('| Pronunciation audio (cards and vocabulary tests) | **On** | ElevenLabs |');
    expect(privacy(SPEECH_ONLY)).toContain('**With these settings, no AI feature that sends student data is on.**');
    expect(privacy(TRANSCRIBING)).toContain('**With these settings, one AI feature sends student data: the voice recording in the "repeat the sentence" test**');
    expect(privacy(TRANSCRIBING)).not.toContain('no AI feature that sends student data is on');
    expect(privacy(null)).toContain('**This site\'s AI settings could not be read when this page was made**');
    expect(privacy(null)).not.toMatch(/no AI feature that sends student data|one AI feature sends student data/);
    expect(render('privacy-summary', ctx({}, none, TRANSCRIBING))).toContain('one AI feature sends student data: your voice recording');
    expect(render('subprocessors', ctx({}, none, SPEECH_ONLY))).toContain('| ElevenLabs Inc. | **Receives requests** | Card and vocabulary text, for pronunciation audio |');
  });

  it('stay clean in every AI state: no placeholder, no gap, no table broken, no code formatting in the summary', () => {
    for (const ai of AI_STATES) {
      for (const env of [{}, OPERATOR]) {
        for (const name of LEGAL_DOCUMENTS) {
          const md = render(name, ctx(env, none, ai));
          expect(md, name).not.toContain('{{');
          expect(md, name).not.toMatch(/ [.;,](?:\s|$)/);
          expect(md, name).not.toMatch(/,\s*[;.]/);
          expect(md, name).not.toMatch(/\S {2,}\S/);
          expect(md, name).not.toMatch(/[^.]\.\.(?!\.)/);
          const lines = md.split('\n');
          lines.forEach((line, i) => {
            if (line.startsWith('|') && lines[i + 1] === '' && lines[i + 2]?.startsWith('|')) throw new Error(`${name}: a table is broken after line ${i + 1}`);
          });
        }
        expect(render('privacy-summary', ctx(env, none, ai))).not.toContain('`');
      }
    }
  });
});

describe('an extension in front of the defaults', () => {
  const base = { routers: {}, defaults: { review: {}, studyFinish: {}, answer: {}, answerGraded: {}, roundSummary: {}, studyAllOverview: {}, userDetail: { user: {}, detail: {} } }, hooks: {} };
  const disclosing: ServerExtension = {
    ...base, id: 'disclosing',
    privacy: {
      instanceSections: ['**Sample.** This extension keeps a note, for {{operator_short_name}}.'],
      summaryParagraphs: ['A sample extension keeps a note.'],
      plannedChanges: ['| A sample change | Planned | It is listed here first |'],
      priorVersions: [{ document: 'terms', slug: 'old', version: '0.1', effective: '(undated)', summary: 'First terms', markdown: '# Old terms\n\nAsk {{support_email}}.\n' }],
    },
  };
  const own: ServerExtension = {
    ...base, id: 'own-pages',
    legalDocuments: {
      documents: {
        privacy: '---\ntitle: Our Privacy Policy\nversion: 3.1\nlang: en\n---\n# Our Privacy Policy\n\nRun by {{operator_legal_name}} in {{home_town}}. {{town_line}}\n\n## Summary {#summary-part}\n\n{{include: privacy-summary.md}}\n',
      },
      fields: [
        { key: 'home_town', fallback: { kind: 'missing' }, help: 'Where the operator is.' },
        { key: 'cap', fallback: { kind: 'omit' }, help: 'A cap.' },
      ],
      computed: (values) => ({ town_line: values.cap ? `Capped at ${values.cap}.` : 'No cap.' }),
    },
  };

  it('places another extension\'s disclosures, planned changes and prior versions in the defaults', () => {
    const c = ctx({ LEGAL_OPERATOR_SHORT_NAME: 'Example Learning', LEGAL_SUPPORT_EMAIL: 'help@example.org' }, combine(disclosing).privacy);
    const md = render('privacy', c);
    expect(md).toContain('## Extensions on this site {#instance}\n\n**Sample.** This extension keeps a note, for Example Learning.');
    expect(md).not.toContain('No extension running on this site describes a data flow of its own.');
    expect(render('privacy-summary', c)).toContain('A sample extension keeps a note.');
    expect(render('subprocessors', c)).toContain('<caption>Planned changes.</caption>\n\n| Change | Status | What happens first |\n|---|---|---|\n| A sample change | Planned | It is listed here first |');
    expect(render('terms', c)).toContain('| 0.1 | (undated) | [/terms/old](/terms/old) | First terms |');
    expect(render('privacy', c)).not.toContain('Earlier versions of this page');
    expect(renderPriorLegalVersion('terms', 'old', c)?.markdown).toBe('# Old terms\n\nAsk help@example.org.\n');
    expect(render('privacy')).toContain('No extension running on this site describes a data flow of its own.');
  });

  it('replaces a page with its own text, its own fields and computed lines; the others stay core\'s', () => {
    const c = ctx({ LEGAL_OPERATOR_LEGAL_NAME: 'Example, Inc.', LEGAL_HOME_TOWN: 'Springfield' }, combine(own).privacy);
    const doc = renderLegalDocument('privacy', c);
    expect(doc).toMatchObject({ title: 'Our Privacy Policy', version: '3.1', configured: true });
    expect(doc.markdown).toMatch(/^# Our Privacy Policy\n\nRun by Example, Inc\. in Springfield\. No cap\.\n\n## Summary \{#summary-part\}\n\n\*\*The operator of this site has not published a privacy summary here yet\.\*\*/);
    // The include took core's summary, its H1 dropped and its headings one level down.
    expect(doc.markdown).toContain('### AI on this site right now {#summary-ai}');
    expect(render('privacy', ctx({ LEGAL_CAP: '$5' }, combine(own).privacy))).toContain(`Run by ${MISSING} in ${MISSING}. Capped at $5.`);
    expect(render('terms', c)).toBe(render('terms', ctx({ LEGAL_OPERATOR_LEGAL_NAME: 'Example, Inc.' })));
    // Its fields mean nothing to core's own pages without it.
    expect(render('privacy', ctx({ LEGAL_HOME_TOWN: 'Springfield' }))).not.toContain('Springfield');
  });

  it('takes an include from the extension\'s own text when it has one', () => {
    expect(includedBody('privacy-summary.md', { 'privacy-summary': '---\ntitle: S\n---\n# S\n\n## Part {#part}\n\nOwn summary.\n' }))
      .toBe('### Part {#part}\n\nOwn summary.');
    expect(() => includedBody('elsewhere.md')).toThrow(/Not a legal template/);
  });

  it('refuses a computed line that reuses a name core fills', () => {
    const clash: ServerExtension = { ...base, id: 'clash', legalDocuments: { documents: {}, computed: () => ({ support_email: 'x' }) } };
    expect(() => render('privacy', ctx({}, combine(clash).privacy))).toThrow(/reuses the name support_email/);
  });
});

describe('fillTemplate', () => {
  const values = { a: 'Alpha', empty: '', gone: MISSING, b: 'B' };

  it('fills values and drops the space before an empty one', () => {
    expect(fillTemplate('X {{a}} and {{empty}}.', values)).toBe('X Alpha and.\n');
    expect(fillTemplate('core {{empty}}; next', values)).toBe('core; next\n');
    expect(fillTemplate('(section 11), {{empty}};', values)).toBe('(section 11);\n');
    expect(fillTemplate('Up to {{gone}} days', values)).toBe(`Up to ${MISSING} days\n`);
  });

  it('keeps or drops conditionals, nested ones too, and drops a line a conditional emptied', () => {
    expect(fillTemplate('{{?a|A is {{a}}{{?b| and {{b}}}}}}', values)).toBe('A is Alpha and B\n');
    expect(fillTemplate('{{?gone|never}}{{!gone|shown}}', values)).toBe('shown\n');
    expect(fillTemplate('| h |\n|---|\n{{?empty|| row |}}\n| last |', values)).toBe('| h |\n|---|\n| last |\n');
    expect(fillTemplate('### Heading {#id} \n{{?a|### Kept {#kept} }}', values)).toBe('### Heading {#id}\n### Kept {#kept}\n');
  });

  it('refuses an unknown placeholder or an unclosed one', () => {
    expect(() => fillTemplate('{{nope}}', values)).toThrow(UnknownPlaceholderError);
    expect(() => fillTemplate('{{?nope|x}}', values)).toThrow(UnknownPlaceholderError);
    expect(() => fillTemplate('{{a', values)).toThrow(UnknownPlaceholderError);
  });
});

describe('aiLegalStateFrom', () => {
  it('reads absent settings as off, and only the OpenAI base URL as OpenAI', () => {
    expect(aiLegalStateFrom({}, false)).toMatchObject({ aiEnabled: false, pronunciation: false, transcription: false, customOpenAiEndpoint: false, hasOpenAiKey: false });
    expect(aiLegalStateFrom({ openaiBaseUrl: 'https://api.openai.com/v1/' }, false).customOpenAiEndpoint).toBe(false);
    expect(aiLegalStateFrom({ openaiBaseUrl: 'http://localhost:11434/v1' }, false).customOpenAiEndpoint).toBe(true);
    expect(aiLegalStateFrom({ aiTtsProvider: 'something', aiTextProvider: 'other' }, true)).toMatchObject({ ttsProvider: 'openai', textProvider: 'openai', transcription: true });
  });
});

describe('the operator documentation', () => {
  const repo = resolve(import.meta.dirname, '../../../../..');

  it('lists every field core reads (doc/legal-documents.md)', () => {
    const doc = readFileSync(resolve(repo, 'doc/legal-documents.md'), 'utf8');
    expect(OPERATOR_FIELDS.map((f) => envNameFor(f.key)).filter((name) => !doc.includes(`\`${name}\``))).toEqual([]);
  });

  it('is pointed to from .env.example, with every field core reads and the log and deletion-ledger keys', () => {
    const example = readFileSync(resolve(repo, '.env.example'), 'utf8');
    expect(example).toContain('doc/legal-documents.md');
    for (const name of [...OPERATOR_FIELDS.map((f) => envNameFor(f.key)), 'LOG_HASH_KEY', 'DELETION_LEDGER', 'DELETION_LEDGER_KEY']) {
      expect(example).toMatch(new RegExp(`^# ${name}=`, 'm'));
    }
    expect(example).not.toMatch(/^# LEGAL_(PRIMARY_HOST_LOCATION|STAFF_ACCESS_STATEMENT|EFFECTIVE_DATE)=/m);
  });
});
