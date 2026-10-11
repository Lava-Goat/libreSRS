// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { buildMnemonicPrompt } from './aiTemplates.js';
import type { MnemonicContext } from './types.js';

const TENGO: MnemonicContext = { front: 'tengo', back: 'I have', sourceLanguage: 'es', targetLanguage: 'en' };
const PERO: MnemonicContext = { front: 'pero', back: 'but', sourceLanguage: 'es', targetLanguage: 'en', style: 'sentence' };

describe('buildMnemonicPrompt (v1.20.0)', () => {
  describe('the keyword style (the default)', () => {
    const prompt = buildMnemonicPrompt(TENGO);

    it('asks for a memory cue for an English-speaking high-school student learning Spanish, with the card', () => {
      expect(prompt.startsWith(
        'Write a memory cue (mnemonic) that helps an English-speaking high-school student learning Spanish remember this flashcard.\n'
        + 'Word: tengo\nMeaning: I have\n',
      )).toBe(true);
    });

    it('gives how the word sounds, respelled for an English reader, stressed syllable in capitals', () => {
      expect(prompt).toContain('\nSounds like: TEHN-goh (English-style respelling; stressed syllable in capitals)\n');
      expect(prompt).not.toContain('Pronunciation:');
    });

    it('asks for one short keyword for the start or the stressed syllable, never a chain of words', () => {
      expect(prompt).toContain('Use the keyword method:');
      expect(prompt).toContain('1. Pick the keyword: one familiar, concrete English word (two short words at most) that sounds like the start or the stressed syllable of the Spanish word. It does not need to cover the whole word; never chain three or more words.');
    });

    it('says how Spanish letters sound, and asks for a fix when the keyword teaches a wrong sound', () => {
      expect(prompt).toContain('2. Match sounds, not spelling: h is silent; j, and g before e or i, sound like English h; ll and y sound like y; qu = k; z, and c before e or i, = s; v = b; ñ = ny; vowels are pure (a = ah, e = eh, i = ee, o = oh, u = oo).');
      expect(prompt).toContain('Prefer a keyword whose sound does not teach a wrong Spanish sound; if the best one does (llama said with an L), add a fix of 3-6 words (ll sounds like y).');
    });

    it('asks for one picture where the keyword and the meaning act on each other', () => {
      expect(prompt).toContain('3. Make one picture in which the keyword and the meaning act on each other, so the meaning is part of the scene.');
      expect(prompt).toContain('Example: tengo = I have: Picture yourself holding TEN GOats on leashes: I have ten goats!');
    });

    it('allows "Like English X" only for a true look-alike, with the one difference that matters', () => {
      expect(prompt).toContain('4. If a 14-year-old would guess the meaning on sight (familia, inteligente), you may instead write: Like English X, then the one difference that matters for saying or spelling the Spanish (inteligente: one l, g said like h).');
      expect(prompt).toContain('Not for words that only share letters (mi is said MEE, not "my") or that mean something else (simpático is nice, not sympathetic).');
      expect(prompt).toContain('Example: rápido = fast: Like English rapid (river rapids = fast water); accent on RÁ.');
      // The bare line the plan rejected.
      expect(prompt).not.toContain('Like English RAPID.');
    });

    it('keeps it short and plain, with the keyword in capitals, and names slang and double meanings', () => {
      expect(prompt).toContain('Write one or two short sentences, under 35 words, with the keyword in CAPITALS.');
      expect(prompt).toContain('School-appropriate: no word that could be read as rude slang or a double meaning in English or Spanish (for example, hoe). Never invent a wrong pronunciation or spelling.');
      expect(prompt.endsWith('Respond with only the cue text: plain text, no markdown, no asterisks.')).toBe(true);
    });

    it('says nothing about two forms on a card with one', () => {
      expect(prompt).not.toContain('two forms');
    });

    it('no longer asks for weird: interaction helps recall, bizarreness does not', () => {
      expect(prompt).toContain('It does not need to be weird or silly; it needs the keyword and the meaning together in one clear picture.');
      expect(prompt).not.toMatch(/weirder|absurd|the more memorable/i);
    });

    it('says nothing about cognates or shared roots (the cognate system is gone)', () => {
      expect(prompt).not.toMatch(/cognate|etymolog|shared root/i);
    });

    it('is what a context with no style or an unknown one gets', () => {
      expect(buildMnemonicPrompt({ ...TENGO, style: 'keyword' })).toBe(prompt);
      expect(buildMnemonicPrompt({ ...TENGO, style: 'rhyme' as never })).toBe(prompt);
    });
  });

  describe('the sentence style', () => {
    const prompt = buildMnemonicPrompt(PERO);

    it('asks for one very short beginner sentence with the word in capitals and its translation', () => {
      expect(prompt).toContain('Teach the Spanish word through one very short, natural Spanish example sentence that a Spanish 1 student can understand, using only common beginner vocabulary.');
      expect(prompt).toContain('Write the word in CAPITALS in the sentence, then " = " and its English translation (example: Voy PORQUE quiero = I go because I want to).');
      expect(prompt).toContain('Under 25 words in total, at most two lines.');
    });

    it('adds a sound hook only when a strong one fits this word alone (not pero and perro)', () => {
      expect(prompt).toContain('Add a sound hook after it (under 10 words) only if a strong one exists, matches how the word sounds, and does not also fit a similar-looking word (pero / perro). Otherwise add none.');
      expect(prompt).not.toContain('You may add one short sound hook');
    });

    it('names slang and double meanings in its safety line too', () => {
      expect(prompt).toContain('School-appropriate: no word that could be read as rude slang or a double meaning in English or Spanish (for example, hoe). Spell the word exactly as on the card');
    });

    it('keeps the card, how it sounds and the plain-text rule, but not the keyword method', () => {
      expect(prompt).toContain('Word: pero\nMeaning: but\nSounds like: PEH-roh (English-style respelling; stressed syllable in capitals)');
      expect(prompt).toContain('never invent a wrong pronunciation or spelling');
      expect(prompt.endsWith('Respond with only the cue text: plain text, no markdown, no asterisks.')).toBe(true);
      expect(prompt).not.toContain('keyword method');
      expect(prompt).not.toMatch(/weird/i);
    });
  });

  describe('how the word sounds', () => {
    it('is there for a Spanish deck, in both styles, whatever form the language code takes', () => {
      for (const sourceLanguage of ['es', 'es-MX', 'Spanish']) {
        for (const style of ['keyword', 'sentence'] as const) {
          expect(buildMnemonicPrompt({ ...TENGO, sourceLanguage, style })).toContain('Sounds like: TEHN-goh (English-style respelling; stressed syllable in capitals)');
        }
      }
    });

    it('says each form of a slash card and each word of a phrase as it sounds, not as it is spelled', () => {
      expect(buildMnemonicPrompt({ ...TENGO, front: 'hijo / hija', back: 'son / daughter' }))
        .toContain('Sounds like: EE-hoh / EE-hah (English-style respelling; stressed syllable in capitals)');
      expect(buildMnemonicPrompt({ ...TENGO, front: '¿Cómo se llama?', back: 'What is his/her name?' }))
        .toContain('Sounds like: KOH-moh seh YAH-mah (English-style respelling; stressed syllable in capitals)');
    });

    it.each([
      ['hay', 'there is, there are', 'EYE'],
      ['gente', 'people', 'HEHN-teh'],
      ['joven', 'young', 'HOH-behn'],
      ['hermano / hermana', 'brother / sister', 'ehr-MAH-noh / ehr-MAH-nah'],
      ['vive', 'lives', 'BEE-beh'],
      ['y', 'and', 'EE'],
    ])('never shows %s as spelled, which reads as the wrong English sound', (front, back, sounds) => {
      const prompt = buildMnemonicPrompt({ ...TENGO, front, back });
      expect(prompt).toContain(`Sounds like: ${sounds} (`);
    });

    it('is left out for a deck in another language, or with no language, with the Spanish sound rules', () => {
      for (const context of [
        { ...TENGO, sourceLanguage: 'he' },
        { ...TENGO, sourceLanguage: 'pt' },
        { ...TENGO, sourceLanguage: undefined, targetLanguage: undefined },
      ]) {
        for (const style of ['keyword', 'sentence'] as const) {
          const prompt = buildMnemonicPrompt({ ...context, style });
          expect(prompt).not.toContain('Sounds like:');
          expect(prompt).not.toContain('Match sounds, not spelling');
        }
      }
    });

    it('is left out when the front has no word to say', () => {
      expect(buildMnemonicPrompt({ ...TENGO, front: '¿?' })).not.toContain('Sounds like:');
    });
  });

  describe('a card with two forms', () => {
    it('asks for the shared sound and both meanings in a picture, and no -o / -a lesson', () => {
      for (const front of ['hermano / hermana', 'profesor(a)']) {
        expect(buildMnemonicPrompt({ ...TENGO, front, back: 'brother / sister' }))
          .toContain('\nThe card shows two forms: use their shared sound, show both meanings where natural, and do not explain the -o / -a ending.\n');
      }
    });

    it('asks for one of the forms in a sentence, so the slash never goes into it', () => {
      expect(buildMnemonicPrompt({ ...PERO, front: 'hermano / hermana', back: 'brother / sister' }))
        .toContain('\nThe card shows two forms: use one of them in the sentence, and do not explain the -o / -a ending.\n');
    });
  });

  describe('decks in other languages', () => {
    it('names the deck’s languages and gives the examples as Spanish ones', () => {
      const hebrew = buildMnemonicPrompt({ front: 'שלום', back: 'hello', sourceLanguage: 'he', targetLanguage: 'en' });
      expect(hebrew).toContain('helps an English-speaking high-school student learning Hebrew remember this flashcard.');
      expect(hebrew).toContain('that sounds like the start or the stressed syllable of the Hebrew word.');
      expect(hebrew).toContain('Example from Spanish: tengo = I have');
      expect(hebrew).toContain('3. If a 14-year-old would guess the meaning on sight, you may instead write: Like English X, then the one difference that matters for saying or spelling the Hebrew word.');
      expect(hebrew).toContain('a double meaning in English or Hebrew (for example, hoe).');

      const sentence = buildMnemonicPrompt({ front: 'שלום', back: 'hello', sourceLanguage: 'he', targetLanguage: 'en', style: 'sentence' });
      expect(sentence).toContain('one very short, natural Hebrew example sentence that a first-year Hebrew student can understand');
      expect(sentence).toContain('(example from Spanish: Voy PORQUE quiero = I go because I want to)');
      expect(sentence).not.toContain('Spanish 1');
      expect(sentence).toContain('does not also fit a similar-looking word (Spanish pero / perro)');
    });

    it('uses the deck’s back language for the learner and the keyword', () => {
      const prompt = buildMnemonicPrompt({ front: 'dog', back: 'perro', sourceLanguage: 'en', targetLanguage: 'es' });
      expect(prompt).toContain('helps a Spanish-speaking high-school student learning English remember');
      expect(prompt).toContain('Pick the keyword: one familiar, concrete Spanish word (two short words at most)');
      expect(prompt).not.toContain('Sounds like:');
    });

    it('still works with no languages set', () => {
      const prompt = buildMnemonicPrompt({ front: 'dog', back: 'perro' });
      expect(prompt).toContain('helps an English-speaking high-school student learning a new language remember this flashcard.');
      expect(prompt).toContain('that sounds like the start or the stressed syllable of the word.');
      expect(prompt).not.toMatch(/undefined|null/);
    });

    it('never prints an unknown language code as a language', () => {
      const prompt = buildMnemonicPrompt({ front: 'x', back: 'y', sourceLanguage: 'zz', targetLanguage: 'en' });
      expect(prompt).toContain('learning a new language');
      expect(prompt).not.toContain('zz');
    });
  });

  describe('what was already suggested', () => {
    it('lists every earlier suggestion in this style and asks for a different keyword', () => {
      const prompt = buildMnemonicPrompt({ ...TENGO, alreadySuggested: ['TANGO: I have a tango lesson', 'TEN GOats on leashes'] });
      expect(prompt).toContain(
        '\n\nAlready suggested for this card in this style (write a different one, with a different keyword):\n'
        + '- TANGO: I have a tango lesson\n- TEN GOats on leashes\n\nRespond with only the cue text',
      );
    });

    it('asks for a different sentence in the sentence style', () => {
      expect(buildMnemonicPrompt({ ...PERO, alreadySuggested: ['Quiero, PERO no puedo = I want to, but I can’t'] }))
        .toContain('Already suggested for this card in this style (write a different one, with a different sentence):\n- Quiero, PERO no puedo');
    });

    it('lists the other style for reference only, so a keyword from a sentence (or a picture) may come back', () => {
      const prompt = buildMnemonicPrompt({
        ...TENGO,
        alreadySuggested: ['TANGO: I have a tango lesson'],
        suggestedInOtherStyle: ['TENGO quince años = I’m 15 (I have 15 years)', 'Picture yourself holding TEN GOats'],
      });
      expect(prompt).toContain(
        '- TANGO: I have a tango lesson\n\n'
        + 'Suggested for this card in the other style (for reference only; you may reuse a keyword from these):\n'
        + '- TENGO quince años = I’m 15 (I have 15 years)\n- Picture yourself holding TEN GOats\n\nRespond',
      );
      // Only this style's suggestions are to be avoided.
      expect(prompt.split('write a different one')).toHaveLength(2);
    });

    it('keeps a two-line suggestion on its own bullet', () => {
      const prompt = buildMnemonicPrompt({
        ...TENGO,
        alreadySuggested: ['TENGO quince años = I’m 15\nThink TEN GOats.', 'second'],
        suggestedInOtherStyle: ['line one\r\n  line two'],
      });
      expect(prompt).toContain('\n- TENGO quince años = I’m 15 / Think TEN GOats.\n- second\n');
      expect(prompt).toContain('\n- line one / line two\n');
      expect(prompt).not.toContain('\nThink TEN GOats.');
    });

    it('never calls them rejected: the list holds waiting and approved ones too', () => {
      expect(buildMnemonicPrompt({ ...TENGO, alreadySuggested: ['a'], suggestedInOtherStyle: ['b'] })).not.toMatch(/rejected/i);
    });

    it('lists each text once and skips blanks', () => {
      const prompt = buildMnemonicPrompt({ ...TENGO, alreadySuggested: [' TANGO ', 'TANGO', '', '   '] });
      expect(prompt).toContain('different keyword):\n- TANGO\n\nRespond');
    });

    it('is left out when nothing was suggested before', () => {
      expect(buildMnemonicPrompt({ ...TENGO, alreadySuggested: [], suggestedInOtherStyle: [] })).not.toContain('suggested');
      expect(buildMnemonicPrompt(TENGO)).not.toContain('suggested');
    });
  });

  describe('the deck’s other cards', () => {
    it('lists their approved mnemonics, so one keyword does not serve two words (pero / perro)', () => {
      for (const context of [TENGO, PERO]) {
        const prompt = buildMnemonicPrompt({ ...context, otherCards: ['perro = dog: Picture a PEAR walking a dog', 'gato = cat: a GATE\nwith a cat'] });
        expect(prompt).toContain(
          '\n\nChosen for other cards in this deck (do not reuse their keywords, so the cards are not mixed up):\n'
          + '- perro = dog: Picture a PEAR walking a dog\n- gato = cat: a GATE / with a cat\n\nRespond',
        );
      }
    });

    it('is left out when no other card has one', () => {
      expect(buildMnemonicPrompt({ ...TENGO, otherCards: [] })).not.toContain('other cards');
    });
  });
});
