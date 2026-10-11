// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { scoreElicitedImitation, eiTokens, DEFAULT_EI_SENTENCES } from './vocabEi.js';

describe('elicited-imitation scoring', () => {
  it('scores a perfect repetition at 1', () => {
    const s = scoreElicitedImitation('El perro corre por el parque.', 'El perro corre por el parque.');
    expect(s.score).toBe(1);
  });

  it('is robust to punctuation, casing, and accents', () => {
    const s = scoreElicitedImitation('¿Cómo estás hoy?', 'como estas hoy');
    expect(s.score).toBe(1);
  });

  it('penalizes omissions (recall) and insertions (precision) symmetrically', () => {
    // one of four target words missing
    const omit = scoreElicitedImitation('me gusta el café', 'me gusta el');
    expect(omit.score).toBeGreaterThan(0.7);
    expect(omit.score).toBeLessThan(1);
    // one extra word inserted
    const insert = scoreElicitedImitation('me gusta el café', 'me gusta el café mucho');
    expect(insert.score).toBeGreaterThan(0.7);
    expect(insert.score).toBeLessThan(1);
  });

  it('rewards correct order via LCS', () => {
    const inOrder = scoreElicitedImitation('uno dos tres cuatro', 'uno dos tres cuatro');
    const scrambled = scoreElicitedImitation('uno dos tres cuatro', 'cuatro tres dos uno');
    expect(inOrder.score).toBeGreaterThan(scrambled.score);
  });

  it('scores an empty or unintelligible transcript at 0', () => {
    expect(scoreElicitedImitation('hola mundo', '').score).toBe(0);
    expect(scoreElicitedImitation('hola mundo', '   ').score).toBe(0);
  });

  it('tokenizes on words only', () => {
    expect(eiTokens('¡Hola, señor! ¿Qué tal?')).toEqual(['hola', 'senor', 'que', 'tal']);
  });
});

describe('default EI sentence bank (Spanish 1)', () => {
  const bank = DEFAULT_EI_SENTENCES;
  const words = (t: string) => eiTokens(t).length;

  it('has 16 sentences covering difficulties 1–6 in ascending order', () => {
    expect(bank).toHaveLength(16);
    expect(new Set(bank.map((s) => s.difficulty))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    for (let i = 1; i < bank.length; i++) {
      expect(bank[i].difficulty).toBeGreaterThanOrEqual(bank[i - 1].difficulty);
    }
    // no level dominates: a 10-sentence spread still reaches the easy end
    for (let d = 1; d <= 6; d++) {
      const n = bank.filter((s) => s.difficulty === d).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it('keeps sentence length within each Spanish 1 band', () => {
    for (const s of bank) {
      const n = words(s.text);
      if (s.difficulty <= 2) { expect(n, s.text).toBeGreaterThanOrEqual(4); expect(n, s.text).toBeLessThanOrEqual(7); }
      else if (s.difficulty <= 4) { expect(n, s.text).toBeGreaterThanOrEqual(8); expect(n, s.text).toBeLessThanOrEqual(12); }
      else { expect(n, s.text).toBeGreaterThanOrEqual(12); expect(n, s.text).toBeLessThanOrEqual(16); }
    }
  });

  it('uses no subjunctive, conditional, future or compound tenses', () => {
    for (const s of bank) expect(bannedTenses(s.text), s.text).toEqual([]);
  });

  it('confines the past tense to one top-level sentence', () => {
    const past = bank.filter((s) => pastTenseWords(s.text).length > 0);
    expect(past.map((s) => s.text)).toHaveLength(1);
    expect(past[0].difficulty).toBe(6);
  });

  it('uses only plain Spanish letters and sentence punctuation (no quotes, parentheses, slashes or digits)', () => {
    for (const s of bank) {
      expect(s.text, s.text).toMatch(/^[¡¿]?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ¡¿ ,]*[.?!]$/);
      expect(s.text, s.text).not.toMatch(/\s{2,}/);
    }
  });

  it('avoids number words that speech-to-text writes as digits', () => {
    const numbers = /(?<!\p{L})(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil)(?!\p{L})/iu;
    for (const s of bank) expect(numbers.test(s.text), s.text).toBe(false);
  });

  it('has no duplicate sentences', () => {
    const keys = bank.map((s) => eiTokens(s.text).join(' '));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Tense guards for the default bank. Token-level (accents kept) with explicit
// allow-lists, so ordinary Spanish 1 words that merely end like a verb form
// (clase, María, librería, queremos, día, café, triste…) are not flagged.
// ---------------------------------------------------------------------------
const spanishWords = (t: string): string[] => t.toLowerCase().match(/\p{L}+/gu) ?? [];

/** Nouns and present-tense forms ending in -ía/-ías/-ían that are not verbs in the past or conditional. */
const IA_WORDS = new Set([
  'día', 'días', 'tía', 'tías', 'mía', 'mías', 'maría', 'todavía', 'policía', 'sandía', 'sandías',
  'alegría', 'guía', 'guías', 'envía', 'envían', 'compañía', 'lejía', 'librería', 'cafetería',
  'panadería', 'pizzería', 'pastelería', 'heladería', 'zapatería', 'papelería', 'frutería',
  'carnicería', 'galería', 'lotería', 'batería', 'joyería', 'peluquería', 'lavandería',
]);
const IA_NOUN_SUFFIX = /(?:logía|grafía|nomía|ergía)s?$/u;
/** Present-tense forms that end like a synthetic future. */
const FUTURE_LOOKALIKES = new Set(['queremos', 'corremos', 'recorremos']);
/** Nouns/pronouns that end like an imperfect subjunctive. */
const SUBJ_LOOKALIKES = new Set(['clase', 'clases', 'base', 'bases', 'frase', 'frases', 'fase', 'fases', 'pase', 'pases', 'cualquiera']);

/** Returns a label for every banned-tense word in `text` (empty when clean). */
function bannedTenses(text: string): string[] {
  const hits: string[] = [];
  for (const w of spanishWords(text)) {
    if (/(?:[aei]r|dr|br|rr)í(?:a|as|amos|an)$/u.test(w) && !IA_WORDS.has(w)) hits.push(`conditional: ${w}`);
    if (/(?:[aei]r|dr|br|rr)(?:é|ás|á|emos|éis|án)$/u.test(w) && !FUTURE_LOOKALIKES.has(w)) hits.push(`future: ${w}`);
    if (/^(?:he|has|ha|hemos|han|hab(?:ía|ías|íamos|ían|ido|iendo|er|ré|rás|rá|remos|rán|ría|rías|ríamos|rían)|hub\p{L}*|hay\p{L}+)$/u.test(w)) {
      hits.push(`compound tense: ${w}`);
    }
    if (/(?:iera|ieras|iéramos|ieran|iese|ieses|iésemos|iesen|áramos|ase|ases|ásemos|asen)$/u.test(w) && !SUBJ_LOOKALIKES.has(w)) {
      hits.push(`imperfect subjunctive: ${w}`);
    }
    if (/^(?:sea|seas|sean|esté|estés|estén|tenga|tengas|tengan|vaya|vayas|vayan|haga|hagas|termine|pueda|puedas|quiera)$/u.test(w)) {
      hits.push(`subjunctive form: ${w}`);
    }
    if (/^(?:ojalá|aunque|cuando|si)$/u.test(w)) hits.push(`subjunctive trigger: ${w}`);
  }
  if (/(?<!\p{L})(?:quiero que|para que|antes de que)(?!\p{L})/iu.test(text)) hits.push('subjunctive trigger phrase');
  return hits;
}

const PAST_FORMS = new Set([
  'ayer', 'anoche', 'fue', 'fueron', 'fui', 'fuiste', 'fuimos', 'era', 'eras', 'éramos', 'eran',
  'iba', 'ibas', 'íbamos', 'iban', 'tuve', 'tuvo', 'tuvimos', 'tuvieron', 'hice', 'hizo', 'hicimos',
  'hicieron', 'estuve', 'estuvo', 'estuvimos', 'estuvieron', 'pude', 'pudo', 'pudieron', 'puse', 'puso',
  'quise', 'quiso', 'dije', 'dijo', 'dijeron', 'vine', 'vinieron', 'dio', 'dieron', 'vi', 'vio', 'vieron',
  'supe', 'supo', 'trajo', 'había', 'hubo',
]);
/** Present-tense words, nouns and adverbs that end like a preterite/imperfect form. */
const PAST_LOOKALIKES = new Set([
  'café', 'bebé', 'qué', 'sé', 'té', 'puré', 'josé', 'aquí', 'allí', 'ahí', 'así', 'sí', 'mí', 'esquí',
  'acaba', 'triste', 'chiste', 'existe', 'insiste', 'consiste', 'resiste', 'viste',
]);

/** Returns every preterite/imperfect word in `text` (empty when it is all present tense). */
function pastTenseWords(text: string): string[] {
  return spanishWords(text).filter((w) => {
    if (PAST_FORMS.has(w)) return true;
    if (PAST_LOOKALIKES.has(w) || IA_WORDS.has(w) || IA_NOUN_SUFFIX.test(w)) return false;
    return (
      /(?:aron|ieron|aste|iste|asteis|isteis|aba|abas|ábamos|aban|íamos)$/u.test(w) ||
      /\p{L}(?:ó|é|í)$/u.test(w) ||
      /\p{L}í(?:a|as|an)$/u.test(w)
    );
  });
}

describe('EI bank tense guards', () => {
  it('does not flag ordinary Spanish 1 words that end like a banned tense', () => {
    for (const ok of [
      'Leo va a la clase de español.',
      'Las clases son fáciles.',
      'María trabaja en la librería.',
      'Queremos comer pizza y corremos en el parque.',
      'Hugo habla con su profesora.',
    ]) {
      expect(bannedTenses(ok), ok).toEqual([]);
    }
  });

  it('flags subjunctive, conditional, future and compound tenses', () => {
    for (const bad of [
      'Mi hermano compraría un coche.',
      'Mañana hablaremos con la profesora.',
      'Ella tendrá un perro.',
      'Leo había comido la pizza.',
      'Hemos visto la película.',
      'Si tuviera dinero, viajo.',
      'Espero que tengas un buen día.',
      'Quería que hablase más.',
    ]) {
      expect(bannedTenses(bad).length, bad).toBeGreaterThan(0);
    }
  });

  it('finds past tense without ayer or anoche', () => {
    for (const past of [
      'El perro comió la pizza.',
      'La película era larga.',
      'Los chicos jugaban en el parque.',
      'Mi hermana tenía un gato.',
      'Fuimos a la playa.',
      'Hablé con mi abuela.',
      'Los estudiantes salieron temprano.',
    ]) {
      expect(pastTenseWords(past).length, past).toBeGreaterThan(0);
    }
  });

  it('does not treat present-tense sentences as past', () => {
    for (const present of [
      'Mi mamá está en casa todos los días.',
      'María come en la cafetería con su tía.',
      'Me gusta el café pero estoy triste.',
      'Aquí hay una clase de biología.',
      '¿Qué comes en el desayuno?',
    ]) {
      expect(pastTenseWords(present), present).toEqual([]);
    }
  });
});
