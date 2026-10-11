// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, vi } from 'vitest';

// vocabAudio.ts pulls in the db, AI provider factory, asset storage and logger
// at import time; stub them so we can unit-test the pure accent-choice helper
// without those side effects.
vi.mock('../db/index.js', () => ({ db: {}, schema: {} }));
vi.mock('./ai/config.js', () => ({ getAiRuntimeConfig: vi.fn() }));
vi.mock('./ai/providerFactory.js', () => ({ createAiProvider: vi.fn() }));
vi.mock('./ai/assetStorage.js', () => ({ writeAudioAsset: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { chooseClipAccent, isCurrentVoiceClip, REAL_SPANISH_ACCENTS, RANDOM_ACCENT, vocabVoiceRouting } from './vocabAudio.js';

describe('chooseClipAccent', () => {
  it('returns the fixed accent unchanged when not randomizing', () => {
    expect(chooseClipAccent({ randomize: false, fixedAccent: 'Castilian', existingAccents: [] })).toBe('Castilian');
    // default voice ('') is a valid fixed accent and must pass through untouched
    expect(chooseClipAccent({ randomize: false, fixedAccent: '', existingAccents: ['Mexican'] })).toBe('');
  });

  it('never returns the random sentinel and always picks a real Spanish accent', () => {
    for (let i = 0; i < 300; i++) {
      const a = chooseClipAccent({ randomize: true, fixedAccent: RANDOM_ACCENT, existingAccents: [] });
      expect(a).not.toBe(RANDOM_ACCENT);
      expect(REAL_SPANISH_ACCENTS).toContain(a);
    }
  });

  it('reuses an existing real accent so randomize updates in place', () => {
    expect(chooseClipAccent({ randomize: true, fixedAccent: RANDOM_ACCENT, existingAccents: ['Argentine'] })).toBe('Argentine');
    // empty and sentinel entries are ignored when looking for a reusable accent
    expect(chooseClipAccent({ randomize: true, fixedAccent: RANDOM_ACCENT, existingAccents: ['', 'random', 'Cuban'] })).toBe('Cuban');
  });

  it('pool restricts the random pick and existing-accent reuse', () => {
    // Only pool accents are eligible for the pick…
    for (let i = 0; i < 100; i++) {
      expect(chooseClipAccent({ randomize: true, fixedAccent: RANDOM_ACCENT, existingAccents: [], pool: ['Mexican'] })).toBe('Mexican');
    }
    // …and an existing accent outside the pool is NOT reused.
    expect(chooseClipAccent({ randomize: true, fixedAccent: RANDOM_ACCENT, existingAccents: ['Cuban'], pool: ['Mexican'] })).toBe('Mexican');
    // An empty pool degrades to the default accent ('').
    expect(chooseClipAccent({ randomize: true, fixedAccent: RANDOM_ACCENT, existingAccents: [], pool: [] })).toBe('');
  });

  it('REAL_SPANISH_ACCENTS excludes the default voice and the sentinel', () => {
    expect(REAL_SPANISH_ACCENTS).not.toContain('');
    expect(REAL_SPANISH_ACCENTS).not.toContain(RANDOM_ACCENT);
    expect(REAL_SPANISH_ACCENTS.length).toBeGreaterThan(1);
  });
});

describe('vocabVoiceRouting', () => {
  const MAP = { '': 'voice-me', Mexican: 'voice-mx', Castilian: 'voice-es' };

  it('speaks the default accent with the Vocabulómetro voice, other accents with the voice map', () => {
    const routing = vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: MAP, vocabTtsVoiceId: 'voice-teacher' });
    expect(routing.elevenLabs).toBe(true);
    expect(routing.voiceFor('')).toBe('voice-teacher');
    expect(routing.voiceFor('Mexican')).toBe('voice-mx');
    // An accent with no mapped voice has nothing to serve — never the default voice.
    expect(routing.voiceFor('Cuban')).toBeUndefined();
    expect(routing.voiceFor('constructor')).toBeUndefined();
  });

  it('falls back to the voice map default when no Vocabulómetro voice is set', () => {
    expect(vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: MAP, vocabTtsVoiceId: null }).voiceFor('')).toBe('voice-me');
    expect(vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: {}, vocabTtsVoiceId: null }).voiceFor('')).toBeUndefined();
  });

  it('draws the random mix only from accents that have a voice', () => {
    expect(vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: MAP }).randomPool).toEqual(['Mexican', 'Castilian']);
    // No mapped accents: the mix degrades to the default voice, labeled ''.
    expect(vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: {}, vocabTtsVoiceId: 'voice-teacher' }).randomPool).toEqual(['']);
    expect(vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: {} }).randomPool).toEqual([]);
  });

  it('under OpenAI, serves only voiceless clips in any accent (the old behaviour)', () => {
    const routing = vocabVoiceRouting({ ttsProvider: 'openai', ttsVoiceMap: MAP, vocabTtsVoiceId: 'voice-teacher' });
    expect(routing.elevenLabs).toBe(false);
    expect(routing.voiceFor('')).toBeNull();
    expect(routing.randomPool).toBeNull();
    expect(isCurrentVoiceClip(routing, { accent: 'Cuban', voiceId: null })).toBe(true);
    expect(isCurrentVoiceClip(routing, { accent: '', voiceId: 'voice-teacher' })).toBe(false);
  });

  it('never treats a legacy or other-voice clip as current under ElevenLabs', () => {
    const routing = vocabVoiceRouting({ ttsProvider: 'elevenlabs', ttsVoiceMap: MAP, vocabTtsVoiceId: 'voice-teacher' });
    expect(isCurrentVoiceClip(routing, { accent: '', voiceId: 'voice-teacher' })).toBe(true);
    expect(isCurrentVoiceClip(routing, { accent: '', voiceId: null })).toBe(false); // a clip from before the voice column
    expect(isCurrentVoiceClip(routing, { accent: '', voiceId: 'voice-me' })).toBe(false); // old default voice
    expect(isCurrentVoiceClip(routing, { accent: 'Mexican', voiceId: 'voice-mx' })).toBe(true);
    expect(isCurrentVoiceClip(routing, { accent: 'Cuban', voiceId: 'voice-mx' })).toBe(false);
  });
});
