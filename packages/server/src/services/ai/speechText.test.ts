// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { normalizeForSpeech, speechLanguagePrime } from './speechText.js';

describe('normalizeForSpeech — real cards from Unit 1 / Unit 2', () => {
  it('reads both gender forms instead of saying "slash"', () => {
    expect(normalizeForSpeech('el / la')).toBe('el, la');
    expect(normalizeForSpeech('un / una')).toBe('un, una');
    expect(normalizeForSpeech('hermano / hermana')).toBe('hermano, hermana');
    expect(normalizeForSpeech('madre / mamá')).toBe('madre, mamá');
  });

  it('handles slashes with no surrounding spaces', () => {
    expect(normalizeForSpeech('he/she/it is')).toBe('he, she, it is');
    expect(normalizeForSpeech('how much/many')).toBe('how much, many');
  });

  it('expands an attached inflection so both forms are spoken', () => {
    // Appended after a consonant — both cards that exist in Unit 1 / Unit 2.
    expect(normalizeForSpeech('profesor(a)')).toBe('profesor, profesora');
    expect(normalizeForSpeech('trabajador(a)')).toBe('trabajador, trabajadora');
    // Replacing a final vowel, the other Spanish convention.
    expect(normalizeForSpeech('amigo(a)')).toBe('amigo, amiga');
    expect(normalizeForSpeech('niño(a)')).toBe('niño, niña');
    // English plural marker still appends.
    expect(normalizeForSpeech('friend(s)')).toBe('friend, friends');
  });

  it('drops a detached gloss meant for the reader', () => {
    expect(normalizeForSpeech('he/she/it is (ser)')).toBe('he, she, it is');
    expect(normalizeForSpeech('is (location/feeling)')).toBe('is');
    expect(normalizeForSpeech('you (formal)')).toBe('you');
    expect(normalizeForSpeech('years (age)')).toBe('years');
  });

  it('leaves clean vocabulary untouched, so existing audio still matches', () => {
    for (const word of ['anaranjado', 'gente', 'color', 'la casa', 'buenos días']) {
      expect(normalizeForSpeech(word)).toBe(word);
    }
  });

  it('survives an unclosed parenthesis instead of reading the bracket', () => {
    expect(normalizeForSpeech('bien (well')).toBe('bien');
  });

  it('never returns empty — a card that is only a gloss still says something', () => {
    expect(normalizeForSpeech('(ser)')).toBe('(ser)');
  });

  it('turns line breaks into a pause rather than fusing words', () => {
    expect(normalizeForSpeech('<i>okhel</i><br>Food')).toBe('okhel Food');
    expect(normalizeForSpeech('Ata&nbsp;<br>You')).toBe('Ata You');
  });

  it('collapses the punctuation its own rewrites can leave behind', () => {
    expect(normalizeForSpeech('el / la (the)')).toBe('el, la');
    expect(normalizeForSpeech('  spaced   out  ')).toBe('spaced out');
  });
});

describe('speechLanguagePrime', () => {
  it('primes Spanish so cross-language homographs are not read in another language', () => {
    // "color" is spelled the same in English; "gente" in Italian and Portuguese.
    const prime = speechLanguagePrime('es');
    expect(prime).toBeDefined();
    expect(prime).toMatch(/español/);
  });

  it('primes English for the answer side', () => {
    expect(speechLanguagePrime('en')).toMatch(/English/);
  });

  it('tolerates regional tags and casing', () => {
    expect(speechLanguagePrime('ES-MX')).toBe(speechLanguagePrime('es'));
  });

  it('returns nothing for an unknown or missing language rather than guessing', () => {
    expect(speechLanguagePrime('he')).toBeUndefined();
    expect(speechLanguagePrime(undefined)).toBeUndefined();
    expect(speechLanguagePrime(null)).toBeUndefined();
  });
});

describe('per-side audio switches', () => {
  it('are documented as deck columns with an on-by-default contract', async () => {
    const { decks } = await import('../../db/schema.js');
    // Existing decks must keep audio on both sides when the columns appear.
    expect(decks.audioFrontEnabled.notNull).toBe(true);
    expect(decks.audioBackEnabled.notNull).toBe(true);
    expect(decks.audioFrontEnabled.default).toBe(true);
    expect(decks.audioBackEnabled.default).toBe(true);
  });
});
