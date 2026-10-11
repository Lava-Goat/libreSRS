// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';
import { ANTHROPIC_TEXT_MODELS, AVAILABLE_MODELS } from '../services/ai/aiTemplates.js';

const { client, db: testDb } = createTestDb();
const originalEnv = process.env;

const adminUser = {
  id: 1,
  googleId: 'admin',
  email: 'admin@example.com',
  name: 'Admin',
  picture: null,
  role: 'admin' as const,
};

const studentUser = {
  id: 2,
  googleId: 'student',
  email: '123456@students.school.test',
  name: 'Ana',
  picture: null,
  role: 'user' as const,
};

async function createCaller(user: typeof adminUser | typeof studentUser = adminUser) {
  const { aiRouter } = await import('./ai.js');
  return aiRouter.createCaller({
    req: { user } as Request,
    res: {} as Response,
    user,
  });
}

async function createAdminCaller() {
  return createCaller(adminUser);
}

/** A save that changes nothing but what each test spreads over it. */
const BASE_SAVE = {
  aiEnabled: true,
  baseUrl: 'https://api.openai.com/v1',
  pronunciation: true,
  image: true,
  mnemonic: true,
  mnemonicModel: 'gpt-5.6-luna',
  imageModel: 'gpt-image-1',
  imageQuality: 'low',
  ttsModel: 'gpt-4o-mini-tts-2025-12-15',
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const BILLING_MESSAGE = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

function anthropicJson(status: number, body: unknown, requestId = 'req_router_test') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': requestId },
  });
}

function anthropicOk(model: string) {
  return anthropicJson(200, {
    id: 'msg_router_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 14, output_tokens: 2 },
  });
}

function anthropicError(status: number, type: string, message: string, requestId = 'req_router_error') {
  return anthropicJson(status, { type: 'error', error: { type, message }, request_id: requestId }, requestId);
}

/** Stubs fetch: Anthropic answers with `reply`; anything else (a model catalog) is offline. */
function stubAnthropic(reply: (body: { model: string }) => Response) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) !== ANTHROPIC_URL) throw new TypeError('fetch failed (offline in tests)');
    return reply(JSON.parse(String(init?.body)) as { model: string });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe('ai router admin config', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });
    process.env = { ...originalEnv };

    delete process.env.AI_ENABLED;
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.AI_PRONUNCIATION_ENABLED;
    delete process.env.AI_IMAGE_ENABLED;
    delete process.env.AI_MNEMONIC_ENABLED;
    delete process.env.AI_MNEMONIC_MODEL;
    delete process.env.AI_IMAGE_MODEL;
    delete process.env.AI_IMAGE_QUALITY;
    delete process.env.AI_TTS_MODEL;
    // A developer's shell may export ANTHROPIC_API_KEY: it would seed the key and
    // break the exact matches below.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_TEXT_PROVIDER;
    delete process.env.ELEVENLABS_API_KEY;
    process.env.APP_SETTINGS_ENCRYPTION_KEY = 'router-ai-test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../logger.js');
  });

  afterAll(async () => {
    process.env = originalEnv;
    await client.close();
  });

  it('returns persisted defaults when no admin config is saved yet', async () => {
    const caller = await createAdminCaller();
    const config = await caller.getAdminConfig();

    expect(config).toEqual({
      pausedProviders: [],
      aiEnabled: false,
      provider: 'openai',
      hasApiKey: false,
      baseUrl: 'https://api.openai.com/v1',
      pronunciation: true,
      image: true,
      mnemonic: true,
      transcription: false,
      mnemonicModel: 'gpt-4.1',
      imageModel: 'gpt-image-1',
      imageQuality: 'low',
      ttsModel: 'gpt-4o-mini-tts',
      ttsProvider: 'openai',
      hasElevenLabsKey: false,
      ttsVoiceMap: {},
      availableModels: { ...AVAILABLE_MODELS, cognate: [] },
      modelsFetchedAt: null,
      cognate: false,
      cognateModel: '',
      textProvider: 'openai',
      hasAnthropicKey: false,
      anthropicMnemonicModel: 'claude-opus-5-5',
      anthropicModels: [...ANTHROPIC_TEXT_MODELS],
    });
  });

  it('persists admin config and encrypts the OpenAI API key at rest', async () => {
    const caller = await createAdminCaller();

    const saveResult = await caller.saveAdminConfig({
      aiEnabled: true,
      openaiApiKey: 'sk-router-key',
      baseUrl: 'http://model-host:11434/v1',
      pronunciation: false,
      image: true,
      mnemonic: true,
      transcription: true,
      mnemonicModel: 'gpt-4.1',
      imageModel: 'gpt-image-1',
      imageQuality: 'high',
      ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });

    expect(saveResult).toEqual({ success: true });

    const config = await caller.getAdminConfig();
    expect(config).toEqual({
      pausedProviders: [],
      aiEnabled: true,
      provider: 'openai',
      hasApiKey: true,
      baseUrl: 'http://model-host:11434/v1',
      pronunciation: false,
      image: true,
      mnemonic: true,
      transcription: true,
      mnemonicModel: 'gpt-4.1',
      imageModel: 'gpt-image-1',
      imageQuality: 'high',
      ttsModel: 'gpt-4o-mini-tts-2025-12-15',
      ttsProvider: 'openai',
      hasElevenLabsKey: false,
      ttsVoiceMap: {},
      availableModels: { ...AVAILABLE_MODELS, cognate: [] },
      modelsFetchedAt: null,
      cognate: false,
      cognateModel: '',
      textProvider: 'openai',
      hasAnthropicKey: false,
      anthropicMnemonicModel: 'claude-opus-5-5',
      anthropicModels: [...ANTHROPIC_TEXT_MODELS],
    });

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });

    expect(row).toBeTruthy();
    expect(row?.openaiApiKey).not.toBe('sk-router-key');
    expect(row?.openaiApiKey?.startsWith('enc:v1:')).toBe(true);
    expect(row?.openaiBaseUrl).toBe('http://model-host:11434/v1');
    expect(row?.aiEnabled).toBe(true);
    expect(row?.aiPronunciationEnabled).toBe(false);
    expect(row?.aiMnemonicModel).toBe('gpt-4.1');
    expect(row?.aiImageModel).toBe('gpt-image-1');
    expect(row?.aiImageQuality).toBe('high');
    expect(row?.aiTranscriptionEnabled).toBe(true);

    // A save without the field (an Admin page loaded before the switch existed) leaves it as it is.
    await caller.saveAdminConfig({
      aiEnabled: true, baseUrl: 'http://model-host:11434/v1', pronunciation: false, image: true, mnemonic: true,
      mnemonicModel: 'gpt-4.1', imageModel: 'gpt-image-1', imageQuality: 'high', ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    });
    expect((await caller.getAdminConfig()).transcription).toBe(true);
    await caller.saveAdminConfig({
      aiEnabled: true, baseUrl: 'http://model-host:11434/v1', pronunciation: false, image: true, mnemonic: true,
      mnemonicModel: 'gpt-4.1', imageModel: 'gpt-image-1', imageQuality: 'high', ttsModel: 'gpt-4o-mini-tts-2025-12-15',
      transcription: false,
    });
    expect((await caller.getAdminConfig()).transcription).toBe(false);
  });

  it('persists the ElevenLabs TTS provider config and encrypts its key at rest', async () => {
    const caller = await createAdminCaller();

    await caller.saveAdminConfig({
      aiEnabled: true,
      baseUrl: 'https://api.openai.com/v1',
      pronunciation: true,
      image: true,
      mnemonic: true,
      mnemonicModel: 'gpt-4o-mini',
      imageModel: 'gpt-image-1',
      imageQuality: 'low',
      ttsModel: 'eleven_multilingual_v2',
      ttsProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-secret-key',
      ttsVoiceMap: { '': 'voice-default', Mexican: 'voice-mx' },
    });

    const config = await caller.getAdminConfig();
    expect(config.ttsProvider).toBe('elevenlabs');
    expect(config.hasElevenLabsKey).toBe(true);
    expect(config.ttsVoiceMap).toEqual({ '': 'voice-default', Mexican: 'voice-mx' });
    expect(config.ttsModel).toBe('eleven_multilingual_v2');

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    expect(row?.aiTtsProvider).toBe('elevenlabs');
    expect(row?.elevenlabsApiKey).not.toBe('xi-secret-key');
    expect(row?.elevenlabsApiKey?.startsWith('enc:v1:')).toBe(true);
    expect(JSON.parse(row?.aiTtsVoiceMap ?? '{}')).toEqual({ '': 'voice-default', Mexican: 'voice-mx' });

    // A later save WITHOUT the key leaves the stored key untouched.
    await caller.saveAdminConfig({
      aiEnabled: true,
      baseUrl: 'https://api.openai.com/v1',
      pronunciation: true,
      image: true,
      mnemonic: true,
      mnemonicModel: 'gpt-4o-mini',
      imageModel: 'gpt-image-1',
      imageQuality: 'low',
      ttsModel: 'eleven_multilingual_v2',
      ttsProvider: 'elevenlabs',
      ttsVoiceMap: { '': 'voice-default' },
    });
    const after = await caller.getAdminConfig();
    expect(after.hasElevenLabsKey).toBe(true);
    expect(after.ttsVoiceMap).toEqual({ '': 'voice-default' });
  });

  it('rejects a TTS provider/model mismatch in both directions', async () => {
    const caller = await createAdminCaller();
    const base = {
      aiEnabled: true,
      baseUrl: 'https://api.openai.com/v1',
      pronunciation: true, image: true, mnemonic: true, mnemonicModel: 'gpt-4o-mini',
      imageModel: 'gpt-image-1', imageQuality: 'low',
    };
    await expect(caller.saveAdminConfig({
      ...base, ttsProvider: 'openai', ttsModel: 'eleven_multilingual_v2',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.saveAdminConfig({
      ...base, ttsProvider: 'elevenlabs', elevenlabsApiKey: 'xi-key', ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Sanity: matched pairs still save.
    await expect(caller.saveAdminConfig({
      ...base, ttsProvider: 'openai', ttsModel: 'gpt-4o-mini-tts-2025-12-15',
    })).resolves.toEqual({ success: true });
  });

  it('has no cognate controls (v1.20.0): drops the cognate fields an older page sends, and never writes the deprecated columns', async () => {
    const caller = await createAdminCaller();
    const config = await caller.getAdminConfig();
    // Only the inert values a page loaded before v1.20.0 reads (next test); nothing else about cognates.
    expect(Object.keys(config).filter((key) => /cognate/i.test(key)).sort()).toEqual(['cognate', 'cognateModel']);

    // What a page loaded before v1.20.0 sends.
    const oldPage = { ...BASE_SAVE, cognate: false, cognateModel: 'gpt-4.1', anthropicCognateModel: 'claude-haiku-5-5' };
    await expect(caller.saveAdminConfig(oldPage as typeof BASE_SAVE)).resolves.toEqual({ success: true });

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });
    // The column defaults, as the migrations left them: nothing reads or writes them any more.
    expect(row).toMatchObject({ aiCognateEnabled: true, aiCognateModel: 'heuristic-v1', aiMnemonicModel: 'gpt-5.6-luna' });
    expect(row).not.toHaveProperty('aiAnthropicCognateModel');
    expect(Object.keys((await caller.getConfig()))).toEqual(['pronunciation', 'image', 'mnemonic']);
  });

  it('still answers a page loaded before v1.20.0 with the cognate fields it reads, inert, so it does not crash', async () => {
    // The v1.19.0 Admin page calls cognateModel.trim() on Save and availableModels.cognate.map() in
    // Model Settings: without them a page left open across the deploy white-screens on refetch.
    const caller = await createAdminCaller();
    const config = await caller.getAdminConfig();
    expect(config.cognate).toBe(false);
    expect(config.cognateModel).toBe('');
    expect(config.availableModels.cognate).toEqual([]);
    // Inert: they never come from the deprecated columns.
    await testDb.update(schema.appSettings).set({ aiCognateEnabled: true, aiCognateModel: 'gpt-4.1' });
    expect(await caller.getAdminConfig()).toMatchObject({ cognate: false, cognateModel: '', availableModels: { cognate: [] } });
  });

  describe('the Anthropic key and the text provider (v1.20.0)', () => {
    const readRow = () => testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });

    it('stores the Anthropic key encrypted, keeps it on a save without it, and clears it on an empty one', async () => {
      const caller = await createAdminCaller();

      await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: 'sk-ant-router-0123456789' });
      const row = await readRow();
      expect(row?.anthropicApiKey?.startsWith('enc:v1:')).toBe(true);
      expect(row?.anthropicApiKey).not.toContain('sk-ant-router');
      const config = await caller.getAdminConfig();
      expect(config.hasAnthropicKey).toBe(true);
      expect(JSON.stringify(config)).not.toContain('sk-ant-router');

      // A later save WITHOUT the key keeps it (re-encrypted under a new IV, as every save does).
      await caller.saveAdminConfig({ ...BASE_SAVE, mnemonicModel: 'gpt-5.5' });
      expect((await caller.getAdminConfig()).hasAnthropicKey).toBe(true);
      expect((await readRow())?.anthropicApiKey?.startsWith('enc:v1:')).toBe(true);
      const { getAppSettings } = await import('../services/appSettings.js');
      expect((await getAppSettings()).anthropicApiKey).toBe('sk-ant-router-0123456789');

      // Remove key: '' clears it (OpenAI is selected, so Claude does not need it).
      await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: '' });
      expect((await caller.getAdminConfig()).hasAnthropicKey).toBe(false);
      expect((await readRow())?.anthropicApiKey).toBeNull();
    });

    it('switches mnemonic suggestions to Claude without touching the OpenAI model, and back', async () => {
      const caller = await createAdminCaller();
      await caller.saveAdminConfig(BASE_SAVE);

      await caller.saveAdminConfig({
        ...BASE_SAVE,
        textProvider: 'anthropic',
        anthropicApiKey: 'sk-ant-switch-0123456789',
        anthropicMnemonicModel: 'claude-sonnet-5-5',
      });
      expect(await caller.getAdminConfig()).toMatchObject({
        textProvider: 'anthropic',
        hasAnthropicKey: true,
        anthropicMnemonicModel: 'claude-sonnet-5-5',
        mnemonicModel: 'gpt-5.6-luna',
      });
      expect(await readRow()).toMatchObject({
        aiTextProvider: 'anthropic',
        aiMnemonicModel: 'gpt-5.6-luna',
        aiAnthropicMnemonicModel: 'claude-sonnet-5-5',
      });

      await caller.saveAdminConfig({ ...BASE_SAVE, textProvider: 'openai' });
      expect(await caller.getAdminConfig()).toMatchObject({
        textProvider: 'openai',
        hasAnthropicKey: true,
        mnemonicModel: 'gpt-5.6-luna',
        anthropicMnemonicModel: 'claude-sonnet-5-5',
      });
    });

    it('keeps OpenAI until the teacher switches: a save that names no provider leaves it, with or without a key', async () => {
      const caller = await createAdminCaller();
      expect((await caller.getAdminConfig()).textProvider).toBe('openai');

      // Saving a key alone (what "paste a key now, switch later" does) does not move mnemonics to Claude.
      await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: 'sk-ant-ready-later-01' });
      expect(await caller.getAdminConfig()).toMatchObject({ textProvider: 'openai', hasAnthropicKey: true });
      expect((await readRow())?.aiTextProvider).toBe('openai');
    });

    it('refuses Claude with no Anthropic key, and refuses removing the key while Claude is selected', async () => {
      const caller = await createAdminCaller();
      const missing = { code: 'BAD_REQUEST', cause: { appCode: 'ANTHROPIC_KEY_MISSING' } };

      await expect(caller.saveAdminConfig({ ...BASE_SAVE, textProvider: 'anthropic' })).rejects.toMatchObject(missing);
      await expect(caller.saveAdminConfig({ ...BASE_SAVE, textProvider: 'anthropic', anthropicApiKey: '   ' }))
        .rejects.toMatchObject(missing);
      expect((await readRow())?.aiTextProvider ?? 'openai').toBe('openai');

      // Accepted: the key typed in the same save.
      await expect(caller.saveAdminConfig({ ...BASE_SAVE, textProvider: 'anthropic', anthropicApiKey: 'sk-ant-same-save-01' }))
        .resolves.toEqual({ success: true });
      // Claude stays selected (no textProvider sent), so clearing the key is refused.
      await expect(caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: '' })).rejects.toMatchObject(missing);
      expect((await caller.getAdminConfig()).hasAnthropicKey).toBe(true);
    });

    it('refuses a gpt id in a Claude field and a claude id in an OpenAI field on api.openai.com', async () => {
      const caller = await createAdminCaller();
      const mismatch = { code: 'BAD_REQUEST', cause: { appCode: 'TEXT_MODEL_PROVIDER_MISMATCH' } };
      const claude = { textProvider: 'anthropic' as const, anthropicApiKey: 'sk-ant-mismatch-01' };

      await expect(caller.saveAdminConfig({ ...BASE_SAVE, ...claude, anthropicMnemonicModel: 'gpt-5.6-luna' }))
        .rejects.toMatchObject(mismatch);
      await expect(caller.saveAdminConfig({ ...BASE_SAVE, mnemonicModel: 'claude-opus-5-5' }))
        .rejects.toMatchObject(mismatch);
      await expect(caller.saveAdminConfig({ ...BASE_SAVE, mnemonicModel: 'Claude-Haiku-5-5' }))
        .rejects.toMatchObject(mismatch);
      // Nothing was saved: the row still holds the seeded defaults.
      expect(await readRow()).toMatchObject({
        aiTextProvider: 'openai',
        anthropicApiKey: null,
        aiAnthropicMnemonicModel: 'claude-opus-5-5',
        aiMnemonicModel: 'gpt-4.1',
      });
    });

    it('refuses a key with a character no key has, without storing it or echoing it', async () => {
      const caller = await createAdminCaller();
      await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: 'sk-ant-saved-0123456789' });

      // A zero-width space, a line break or a typographic "…" from copying: fetch could never send
      // it, so every mnemonic would fail as "busy".
      for (const bad of ['sk-ant-api03-AAAAAAAA​BBBB', 'sk-ant-api03-abcdefgh\nijkl', 'sk-ant-api03-abcdefgh…ijkl']) {
        const err = await caller.saveAdminConfig({ ...BASE_SAVE, textProvider: 'anthropic', anthropicApiKey: bad })
          .catch((e: unknown) => e as Error);
        expect(err).toMatchObject({ code: 'BAD_REQUEST', cause: { appCode: 'ANTHROPIC_KEY_INVALID' } });
        expect(err.message).not.toContain('sk-ant-api03');
      }
      const { getAppSettings } = await import('../services/appSettings.js');
      expect((await getAppSettings()).anthropicApiKey).toBe('sk-ant-saved-0123456789');
      expect((await readRow())?.aiTextProvider).toBe('openai');

      // Spaces around the key are only trimmed.
      await expect(caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: '  sk-ant-pasted-0123456789\n' }))
        .resolves.toEqual({ success: true });
      expect((await getAppSettings()).anthropicApiKey).toBe('sk-ant-pasted-0123456789');
    });

    it('refuses a key pasted into a model field without echoing it into the error (which the server logs)', async () => {
      const caller = await createAdminCaller();
      const pasted = `sk-ant-api03-${'A1b2C3d4'.repeat(11)}-xyzAA`; // a real key's shape and length (~108)
      const openAiKey = `sk-proj-${'Z9y8X7w6'.repeat(8)}`;
      const claude = { textProvider: 'anthropic' as const, anthropicApiKey: 'sk-ant-saved-0123456789' };

      for (const save of [
        { ...BASE_SAVE, ...claude, anthropicMnemonicModel: pasted },
        // On OpenAI a key in a model field was saved as the model id, then logged and shown in the panel.
        { ...BASE_SAVE, mnemonicModel: pasted },
        { ...BASE_SAVE, mnemonicModel: openAiKey },
        { ...BASE_SAVE, imageModel: openAiKey },
        { ...BASE_SAVE, ttsModel: pasted },
      ]) {
        const err = await caller.saveAdminConfig(save).catch((e: unknown) => e as Error);
        expect(err).toMatchObject({ code: 'BAD_REQUEST', cause: { appCode: 'API_KEY_IN_MODEL_FIELD' } });
        expect(err.message).not.toContain('A1b2C3d4');
        expect(err.message).not.toContain('Z9y8X7w6');
      }
      // Nothing was saved: neither the row nor what the panel reads holds either key.
      const stored = JSON.stringify([await caller.getAdminConfig(), await readRow()]);
      expect(stored).not.toContain('A1b2C3d4');
      expect(stored).not.toContain('Z9y8X7w6');
    });

    it('accepts a claude id on a custom OpenAI-compatible endpoint', async () => {
      const caller = await createAdminCaller();

      // A LiteLLM proxy, say, may serve claude-* names on the OpenAI path.
      await expect(caller.saveAdminConfig({
        ...BASE_SAVE,
        textProvider: 'openai',
        baseUrl: 'http://litellm.internal:4000/v1',
        mnemonicModel: 'claude-sonnet-5-5',
      })).resolves.toEqual({ success: true });
      expect((await readRow())?.aiMnemonicModel).toBe('claude-sonnet-5-5');
    });

    it('closes an open Anthropic breaker when a key is saved, and leaves the OpenAI one open', async () => {
      const caller = await createAdminCaller();
      const { getQuotaBreakerState, noteAiOutcome } = await import('../services/ai/quotaBreaker.js');
      noteAiOutcome('anthropic', false, `Anthropic mnemonic generation failed: 402 billing_error: ${BILLING_MESSAGE}`);
      noteAiOutcome('openai', false, '429 You exceeded your current quota (insufficient_quota)');
      expect(getQuotaBreakerState('anthropic').open).toBe(true);
      expect(getQuotaBreakerState('openai').open).toBe(true);

      // A save that leaves the key alone leaves the breaker alone.
      await caller.saveAdminConfig(BASE_SAVE);
      expect(getQuotaBreakerState('anthropic').open).toBe(true);

      await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: 'sk-ant-new-account-01' });
      expect(getQuotaBreakerState('anthropic').open).toBe(false);
      expect(getQuotaBreakerState('openai').open).toBe(true);
    });

    describe('testAnthropicKey', () => {
      const MODELS = { mnemonicModel: 'claude-opus-5-5' };

      it('answers no_key when nothing is typed and no key is saved, without a call', async () => {
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));
        const caller = await createAdminCaller();

        await expect(caller.testAnthropicKey({ ...MODELS, apiKey: '   ' })).resolves.toMatchObject({ ok: false, kind: 'no_key' });
        await expect(caller.testAnthropicKey(MODELS)).resolves.toMatchObject({ ok: false, kind: 'no_key' });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('answers model, without a call, when the mnemonic model is not a Claude id', async () => {
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));
        const caller = await createAdminCaller();

        await expect(caller.testAnthropicKey({
          apiKey: 'sk-ant-typed-0123456789', mnemonicModel: 'gpt-5.6-luna',
        })).resolves.toMatchObject({ ok: false, kind: 'model', model: 'gpt-5.6-luna' });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('tests only the mnemonic model, with one call', async () => {
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));
        const caller = await createAdminCaller();

        await expect(caller.testAnthropicKey({
          apiKey: 'sk-ant-typed-0123456789', mnemonicModel: 'claude-sonnet-5-5',
        })).resolves.toEqual({ ok: true, checks: [{ model: 'claude-sonnet-5-5', servedModel: 'claude-sonnet-5-5', seconds: expect.any(Number) }] });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // A dev build of v1.20.0 also sent the cognate model: it is dropped unread, never called.
        await caller.testAnthropicKey({
          apiKey: 'sk-ant-typed-0123456789', mnemonicModel: 'claude-opus-5-5', cognateModel: 'claude-haiku-5-5',
        } as Parameters<typeof caller.testAnthropicKey>[0]);
        expect(fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).model))
          .toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
      });

      it('uses a typed key without saving it or logging it', async () => {
        const calls: unknown[][] = [];
        const capture = (...args: unknown[]) => { calls.push(args); };
        const capturingLogger: Record<string, unknown> = { info: capture, warn: capture, debug: capture, error: capture };
        capturingLogger.child = () => capturingLogger;
        vi.doMock('../logger.js', () => ({ logger: capturingLogger }));
        const typed = 'sk-ant-typed-never-saved-0123456789';
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));
        const caller = await createAdminCaller();
        await caller.getAdminConfig(); // seeds the settings row

        await expect(caller.testAnthropicKey({ ...MODELS, apiKey: `  ${typed}  ` })).resolves.toMatchObject({ ok: true });

        expect(headerOf(fetchMock.mock.calls[0][1], 'x-api-key')).toBe(typed);
        const row = await readRow();
        expect(row?.anthropicApiKey).toBeNull();
        expect(JSON.stringify(row)).not.toContain(typed);
        expect(JSON.stringify(calls)).toContain('"event":"ai.anthropic_key_test"');
        expect(JSON.stringify(calls)).not.toContain(typed);
      });

      it('closes the Anthropic breaker on a pass with the saved key', async () => {
        const caller = await createAdminCaller();
        await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: 'sk-ant-saved-0123456789' });
        const { getQuotaBreakerState, noteAiOutcome } = await import('../services/ai/quotaBreaker.js');
        noteAiOutcome('anthropic', false, `Anthropic mnemonic generation failed: 402 billing_error: ${BILLING_MESSAGE}`);
        expect(getQuotaBreakerState('anthropic').open).toBe(true);
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));

        await expect(caller.testAnthropicKey(MODELS)).resolves.toMatchObject({ ok: true });

        expect(headerOf(fetchMock.mock.calls[0][1], 'x-api-key')).toBe('sk-ant-saved-0123456789');
        expect(getQuotaBreakerState('anthropic').open).toBe(false);
      });

      it('trips the Anthropic breaker on a 402 with the saved key, but never with a typed one', async () => {
        const caller = await createAdminCaller();
        const { getQuotaBreakerState } = await import('../services/ai/quotaBreaker.js');
        stubAnthropic(() => anthropicError(402, 'billing_error', BILLING_MESSAGE, 'req_billing'));

        await expect(caller.testAnthropicKey({ ...MODELS, apiKey: 'sk-ant-other-account-01' }))
          .resolves.toMatchObject({ ok: false, kind: 'billing', model: 'claude-opus-5-5', status: 402, requestId: 'req_billing' });
        expect(getQuotaBreakerState('anthropic').open).toBe(false);

        await caller.saveAdminConfig({ ...BASE_SAVE, anthropicApiKey: 'sk-ant-saved-0123456789' });
        await expect(caller.testAnthropicKey(MODELS)).resolves.toMatchObject({ ok: false, kind: 'billing' });
        expect(getQuotaBreakerState('anthropic').open).toBe(true);
        expect(getQuotaBreakerState('openai').open).toBe(false);
      });

      it('answers auth on a 401 and model, naming it, on a 404', async () => {
        const caller = await createAdminCaller();
        stubAnthropic(() => anthropicError(401, 'authentication_error', 'invalid x-api-key'));
        const auth = await caller.testAnthropicKey({ ...MODELS, apiKey: 'sk-ant-wrong-0123456789' });
        expect(auth).toMatchObject({ ok: false, kind: 'auth', status: 401 });
        expect(JSON.stringify(auth)).not.toContain('sk-ant-wrong');

        stubAnthropic((body) => anthropicError(404, 'not_found_error', `model: ${body.model}`));
        await expect(caller.testAnthropicKey({
          apiKey: 'sk-ant-typed-0123456789', mnemonicModel: 'claude-retired-1',
        })).resolves.toMatchObject({ ok: false, kind: 'model', model: 'claude-retired-1', status: 404 });
      });

      it('answers auth, without a call or a wait, for a typed key with a character no key has', async () => {
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));
        const caller = await createAdminCaller();
        const typed = 'sk-ant-api03-AAAAAAAA​BBBB';

        const result = await caller.testAnthropicKey({ ...MODELS, apiKey: typed });
        expect(result).toMatchObject({ ok: false, kind: 'auth', model: 'claude-opus-5-5', status: null });
        expect(JSON.stringify(result)).not.toContain('sk-ant-api03');
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('is for the admin only', async () => {
        const fetchMock = stubAnthropic((body) => anthropicOk(body.model));
        const student = await createCaller(studentUser);

        await expect(student.testAnthropicKey({ ...MODELS, apiKey: 'sk-ant-student-0123456789' }))
          .rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });

  describe('resumeProvider: "Resume now" on a paused provider', () => {
    it('lets the teacher resume a paused OpenAI at once, and leaves other paused providers alone', async () => {
      const caller = await createAdminCaller();
      const { getQuotaBreakerState, noteAiOutcome } = await import('../services/ai/quotaBreaker.js');
      noteAiOutcome('openai', false, 'OpenAI mnemonic generation failed: You have no credits remaining. (insufficient_quota)');
      noteAiOutcome('elevenlabs', false, 'quota_exceeded');
      expect(getQuotaBreakerState('openai').open).toBe(true);
      expect((await caller.getAdminConfig()).pausedProviders.map((p) => p.provider)).toEqual(['openai', 'elevenlabs']);

      await expect(caller.resumeProvider({ provider: 'openai' })).resolves.toEqual({ cleared: true });
      expect(getQuotaBreakerState('openai').open).toBe(false);
      expect(getQuotaBreakerState('elevenlabs').open).toBe(true);
      expect((await caller.getAdminConfig()).pausedProviders.map((p) => p.provider)).toEqual(['elevenlabs']);
    });

    it('answers cleared: false when the provider was not paused (a second click, or two tabs)', async () => {
      const caller = await createAdminCaller();
      await expect(caller.resumeProvider({ provider: 'anthropic' })).resolves.toEqual({ cleared: false });
    });

    it('pauses again on the next empty-balance answer: resuming does not hide a still-empty account', async () => {
      const caller = await createAdminCaller();
      const { getQuotaBreakerState, noteAiOutcome } = await import('../services/ai/quotaBreaker.js');
      noteAiOutcome('openai', false, 'insufficient_quota');
      await caller.resumeProvider({ provider: 'openai' });
      noteAiOutcome('openai', false, 'insufficient_quota');
      expect(getQuotaBreakerState('openai').open).toBe(true);
    });

    it('is the teacher\'s alone, and only for providers the breaker knows', async () => {
      const student = await createCaller(studentUser);
      await expect(student.resumeProvider({ provider: 'openai' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const caller = await createAdminCaller();
      await expect(caller.resumeProvider({ provider: 'nope' as 'openai' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });
});
