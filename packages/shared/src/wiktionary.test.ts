// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { TTS_LANGUAGES } from './ttsOptions.js';
import { wiktionaryHeading, wiktionaryUrl } from './wiktionary.js';
import * as shared from './index.js';

describe('wiktionaryHeading', () => {
  it('gives every deck language a heading', () => {
    for (const { value } of TTS_LANGUAGES) {
      expect(wiktionaryHeading(value), value).toMatch(/\S/);
    }
  });

  it('uses the language label where Wiktionary uses the same name', () => {
    expect(wiktionaryHeading('es')).toBe('Spanish');
    expect(wiktionaryHeading('en')).toBe('English');
    expect(wiktionaryHeading('he')).toBe('Hebrew');
    expect(wiktionaryHeading('zh')).toBe('Chinese');
    expect(wiktionaryHeading('fa')).toBe('Persian');
  });

  it("uses Wiktionary's own heading where it differs from the label", () => {
    expect(wiktionaryHeading('bs')).toBe('Serbo-Croatian');
    expect(wiktionaryHeading('hr')).toBe('Serbo-Croatian');
    expect(wiktionaryHeading('sr')).toBe('Serbo-Croatian');
    expect(wiktionaryHeading('sh')).toBe('Serbo-Croatian');
    expect(wiktionaryHeading('sl')).toBe('Slovene');
    expect(wiktionaryHeading('mi')).toBe('Māori');
    expect(wiktionaryHeading('no')).toBe('Norwegian Bokmål');
    expect(wiktionaryHeading('nb')).toBe('Norwegian Bokmål');
    expect(wiktionaryHeading('nn')).toBe('Norwegian Nynorsk');
  });

  it('reads the legacy code iw as Hebrew', () => {
    expect(wiktionaryHeading('iw')).toBe('Hebrew');
  });

  it('reads a region or script variant by its language, in any case and with spaces around it', () => {
    expect(wiktionaryHeading('es-MX')).toBe('Spanish');
    expect(wiktionaryHeading('es_419')).toBe('Spanish');
    expect(wiktionaryHeading(' ES ')).toBe('Spanish');
    expect(wiktionaryHeading('pt-BR')).toBe('Portuguese');
    expect(wiktionaryHeading('zh-Hant')).toBe('Chinese');
    expect(wiktionaryHeading('sr-Latn')).toBe('Serbo-Croatian');
    expect(wiktionaryHeading('nb-NO')).toBe('Norwegian Bokmål');
  });

  it('has no heading for an empty or unknown code', () => {
    expect(wiktionaryHeading(null)).toBeNull();
    expect(wiktionaryHeading(undefined)).toBeNull();
    expect(wiktionaryHeading('')).toBeNull();
    expect(wiktionaryHeading('   ')).toBeNull();
    expect(wiktionaryHeading('-MX')).toBeNull();
    expect(wiktionaryHeading('xx')).toBeNull();
    expect(wiktionaryHeading('klingon')).toBeNull();
  });
});

describe('wiktionaryUrl', () => {
  it('opens the page at the language section', () => {
    expect(wiktionaryUrl('casa', 'es')).toBe('https://en.wiktionary.org/wiki/casa#Spanish');
    expect(wiktionaryUrl('house', 'en-US')).toBe('https://en.wiktionary.org/wiki/house#English');
    expect(wiktionaryUrl('kuća', 'hr')).toBe('https://en.wiktionary.org/wiki/ku%C4%87a#Serbo-Croatian');
  });

  it('writes spaces in the heading as underscores and percent-encodes the rest', () => {
    expect(wiktionaryUrl('hus', 'nb')).toBe('https://en.wiktionary.org/wiki/hus#Norwegian_Bokm%C3%A5l');
    expect(wiktionaryUrl('hus', 'nn')).toBe('https://en.wiktionary.org/wiki/hus#Norwegian_Nynorsk');
    expect(wiktionaryUrl('whare', 'mi')).toBe('https://en.wiktionary.org/wiki/whare#M%C4%81ori');
    expect(decodeURIComponent(new URL(wiktionaryUrl('hus', 'no')).hash.slice(1))).toBe('Norwegian_Bokmål');
  });

  it('encodes the word as before', () => {
    expect(wiktionaryUrl('¿qué tal?', 'es')).toBe('https://en.wiktionary.org/wiki/%C2%BFqu%C3%A9%20tal%3F#Spanish');
  });

  it('opens the top of the page when the language is unknown', () => {
    expect(wiktionaryUrl('casa')).toBe('https://en.wiktionary.org/wiki/casa');
    expect(wiktionaryUrl('casa', null)).toBe('https://en.wiktionary.org/wiki/casa');
    expect(wiktionaryUrl('casa', '')).toBe('https://en.wiktionary.org/wiki/casa');
    expect(wiktionaryUrl('casa', 'xx')).toBe('https://en.wiktionary.org/wiki/casa');
  });

  it('is exported from the package index', () => {
    expect(shared.wiktionaryUrl).toBe(wiktionaryUrl);
    expect(shared.wiktionaryHeading).toBe(wiktionaryHeading);
  });
});
