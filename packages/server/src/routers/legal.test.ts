// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = {
  cleverClientId: null as string | null,
  cleverClientSecret: null as string | null,
  aiEnabled: false,
  aiPronunciationEnabled: true,
  aiTtsProvider: 'openai',
  elevenlabsApiKey: null as string | null,
};
let transcriptionOn = false;
let settingsReadable = true;
const headers = new Map<string, string>();

async function caller() {
  vi.resetModules();
  vi.doMock('../services/appSettings.js', () => ({
    getAppSettings: async () => {
      if (!settingsReadable) throw new Error('database locked');
      return settings;
    },
  }));
  vi.doMock('../services/transcriptionSetting.js', () => ({ isTranscriptionEnabled: () => transcriptionOn }));
  const { legalRouter } = await import('./legal.js');
  const res = { setHeader: (name: string, value: string) => { headers.set(name, value); } } as unknown as Response;
  return legalRouter.createCaller({ req: {} as Request, res, user: null, requestId: 'legal-test' });
}

describe('legalRouter', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('LEGAL_') || key === 'CLEVER_AUTH_DISABLED') delete process.env[key];
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.doUnmock('../services/appSettings.js');
    vi.doUnmock('../services/transcriptionSetting.js');
    Object.assign(settings, { aiEnabled: false, aiTtsProvider: 'openai', elevenlabsApiKey: null });
    transcriptionOn = false;
    settingsReadable = true;
    headers.clear();
  });

  it('serves each page to anyone, signed in or not, filled from the environment', async () => {
    process.env.LEGAL_OPERATOR_LEGAL_NAME = 'Example Learning, Inc.';
    const legal = await caller();
    const doc = await legal.document({ name: 'privacy' });
    expect(doc).toMatchObject({ name: 'privacy', title: 'Privacy Policy', version: '1.0', lang: 'en', configured: true });
    expect(doc.markdown).toContain('- **Operator:** Example Learning, Inc.');
    expect(doc.markdown).toContain('**The operator of this site has not published its own privacy policy here yet.**');
    for (const name of ['privacy-summary', 'terms', 'subprocessors', 'coppa-notice'] as const) {
      expect((await legal.document({ name })).markdown).not.toContain('{{');
    }
    await expect(legal.document({ name: 'nope' as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('reads the AI settings on every request: a change shows on the next load, and the answer is not stored', async () => {
    const legal = await caller();
    let md = (await legal.document({ name: 'privacy' })).markdown;
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(md).toContain('## AI features on this site {#AI-Policy #ai}');
    expect(md).toContain('**With these settings, no AI feature that sends student data is on.**');
    expect(md).toContain('| Pronunciation audio (cards and vocabulary tests) | Off (all AI is switched off) |');

    settings.aiEnabled = true;
    settings.aiTtsProvider = 'elevenlabs';
    settings.elevenlabsApiKey = 'el-key';
    md = (await legal.document({ name: 'privacy' })).markdown;
    expect(md).toContain('| Pronunciation audio (cards and vocabulary tests) | **On** | ElevenLabs |');
    expect(md).toContain('**With these settings, no AI feature that sends student data is on.**');

    transcriptionOn = true;
    md = (await legal.document({ name: 'privacy' })).markdown;
    expect(md).toContain('**With these settings, one AI feature sends student data: the voice recording in the "repeat the sentence" test**');
    expect(md).not.toContain('no AI feature that sends student data is on');
    expect(md).toContain('| "Repeat the sentence" test transcription | **On** |');
  });

  it('claims nothing about AI when the settings cannot be read', async () => {
    settingsReadable = false;
    const legal = await caller();
    const md = (await legal.document({ name: 'privacy' })).markdown;
    expect(md).toContain('**This site\'s AI settings could not be read when this page was made**');
    expect(md).not.toContain('no AI feature that sends student data is on');
  });

  it('answers NOT_FOUND for a prior version nobody keeps, and refuses an odd slug', async () => {
    const legal = await caller();
    await expect(legal.priorVersion({ document: 'privacy', slug: 'v1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(legal.priorVersion({ document: 'privacy', slug: '../x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
