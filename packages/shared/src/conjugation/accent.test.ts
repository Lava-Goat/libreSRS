// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  accentuate,
  attachEnclitic,
  foldAccents,
  monosyllableVariants,
  prefixForm,
  stressIndex,
  syllabify,
  syllableText,
} from './accent.js';

const syl = (w: string): string => syllabify(w).map(syllableText).join('-');

describe('syllabify', () => {
  it.each([
    ['hablar', 'ha-blar'],
    ['levantándome', 'le-van-tán-do-me'],
    ['construyendo', 'cons-tru-yen-do'],
    ['instrucción', 'ins-truc-ción'],
    ['chaqueta', 'cha-que-ta'],
    ['perro', 'pe-rro'],
    ['calle', 'ca-lle'],
    ['atleta', 'at-le-ta'],
    ['otro', 'o-tro'],
    ['creer', 'cre-er'],
    ['leíste', 'le-ís-te'],
    ['país', 'pa-ís'],
    ['ciudad', 'ciu-dad'],
    ['averigüe', 'a-ve-ri-güe'],
    ['guitarra', 'gui-ta-rra'],
    ['prohíbe', 'pro-hí-be'],
    ['deshacer', 'des-ha-cer'],
    ['estoy', 'es-toy'],
    ['huía', 'huí-a'],
    ['reímos', 're-í-mos'],
    ['preocúpate', 'pre-o-cú-pa-te'],
    ['péinate', 'péi-na-te'],
  ])('%s → %s', (word, expected) => {
    expect(syl(word)).toBe(expected);
  });

  it('treats the RAE 2010 orthographic diphthongs as one syllable', () => {
    for (const w of ['rio', 'fie', 'guion', 'hui', 'huis', 'fiais', 'riais', 'guie', 'lio']) {
      expect(syllabify(w)).toHaveLength(1);
    }
    for (const w of ['río', 'reí', 'oí', 'fío', 'ríe']) {
      expect(syllabify(w)).toHaveLength(2);
    }
  });
});

describe('stress', () => {
  it.each([
    ['hablo', 0],
    ['hablar', 1],
    ['habló', 1],
    ['hablaron', 1],
    ['hablábamos', 1],
    ['estoy', 1],
    ['árbol', 0],
    ['levantándome', 2],
  ])('%s is stressed on syllable %i', (word, idx) => {
    expect(stressIndex(syllabify(word))).toBe(idx);
  });

  it('writes the accent from the position and the last letter', () => {
    expect(accentuate(syllabify('cancion'), 1)).toBe('canción');
    expect(accentuate(syllabify('arbol'), 0)).toBe('árbol');
    expect(accentuate(syllabify('mesa'), 0)).toBe('mesa');
    expect(accentuate(syllabify('reloj'), 1)).toBe('reloj');
    expect(accentuate(syllabify('medico'), 0)).toBe('médico');
  });
});

describe('attachEnclitic', () => {
  it.each([
    ['levanta', 'te', undefined, 'levántate'],
    ['siente', 'se', undefined, 'siéntese'],
    ['vistan', 'se', undefined, 'vístanse'],
    ['despierten', 'se', undefined, 'despiértense'],
    ['divierte', 'te', undefined, 'diviértete'],
    ['levantando', 'me', undefined, 'levantándome'],
    ['yendo', 'me', undefined, 'yéndome'],
    ['riendo', 'nos', undefined, 'riéndonos'],
    ['pon', 'te', undefined, 'ponte'],
    ['ve', 'te', undefined, 'vete'],
    ['haz', 'lo', undefined, 'hazlo'],
    ['dé', 'se', undefined, 'dese'],
    ['ríe', 'te', undefined, 'ríete'],
    ['caiga', 'se', undefined, 'cáigase'],
    ['está', 'te', undefined, 'estate'],
    ['llamemos', 'nos', 's', 'llamémonos'],
    ['vamos', 'nos', 's', 'vámonos'],
    ['riamos', 'nos', 's', 'riámonos'],
    ['llamad', 'os', 'd', 'llamaos'],
    ['vestid', 'os', 'd', 'vestíos'],
    ['reíd', 'os', 'd', 'reíos'],
    ['poned', 'os', 'd', 'poneos'],
    ['caed', 'os', 'd', 'caeos'],
    ['reunid', 'os', 'd', 'reuníos'],
    ['gradúa', 'te', undefined, 'gradúate'],
    ['peina', 'te', undefined, 'péinate'],
  ] as const)('%s + %s → %s', (form, pron, drop, expected) => {
    expect(attachEnclitic(form, pron, drop)).toBe(expected);
  });

  it('refuses to drop a letter that is not there', () => {
    expect(() => attachEnclitic('llama', 'os', 'd')).toThrow();
  });
});

describe('prefixForm', () => {
  it.each([
    ['ob', 'ten', 'obtén'],
    ['com', 'pon', 'compón'],
    ['pre', 'ves', 'prevés'],
    ['pre', 've', 'prevé'],
    ['pre', 'vio', 'previó'],
    ['son', 'rio', 'sonrió'],
    ['son', 'riais', 'sonriáis'],
    ['re', 'huyo', 'rehúyo'],
    ['re', 'hui', 'rehuí'],
    ['re', 'huía', 'rehuía'],
    ['re', 'hice', 'rehíce'],
    ['des', 'hice', 'deshice'],
    ['sobre', 'sal', 'sobresal'],
    ['des', 'haz', 'deshaz'],
    ['ob', 'tuviera', 'obtuviera'],
    ['f', 'río', 'frío'],
    ['f', 'rio', 'frio'],
    ['f', 'rió', 'frió'],
  ])('%s + %s → %s', (prefix, form, expected) => {
    expect(prefixForm(prefix, form)).toBe(expected);
  });
});

describe('monosyllableVariants', () => {
  it('drops the accent of monosyllables, keeping the old spelling as an alternative', () => {
    expect(monosyllableVariants('rió')).toEqual(['rio', 'rió']);
    expect(monosyllableVariants('huí')).toEqual(['hui', 'huí']);
    expect(monosyllableVariants('fiáis')).toEqual(['fiais', 'fiáis']);
    expect(monosyllableVariants('guió')).toEqual(['guio', 'guió']);
  });
  it('keeps diacritic accents and polysyllables', () => {
    expect(monosyllableVariants('dé')).toEqual(['dé']);
    expect(monosyllableVariants('sé')).toEqual(['sé']);
    expect(monosyllableVariants('río')).toEqual(['río']);
    expect(monosyllableVariants('reí')).toEqual(['reí']);
    expect(monosyllableVariants('fue')).toEqual(['fue']);
  });
});

describe('foldAccents', () => {
  it('folds acute accents and diaeresis but never ñ', () => {
    expect(foldAccents('ÁÉÍÓÚáéíóú')).toBe('AEIOUaeiou');
    expect(foldAccents('averigüé')).toBe('averigue');
    expect(foldAccents('mañana')).toBe('mañana');
    expect(foldAccents('Ñandú')).toBe('Ñandu');
  });
});
