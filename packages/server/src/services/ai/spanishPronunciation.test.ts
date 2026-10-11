// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { isSpanishLanguage, spanishPronunciation, spanishSyllables, syllabifySpanishWord } from './spanishPronunciation.js';

/**
 * Every front of the sample Unit 1-2 decks (130 cards), with its
 * syllables as spelled, the stressed one in capitals, little words in a phrase in lower case.
 */
const UNIT_1_2_FRONTS: [front: string, said: string][] = [
  ['el / la', 'EL / LA'],
  ['un / una', 'UN / U-na'],
  ['y', 'Y'],
  ['de', 'DE'],
  ['a', 'A'],
  ['en', 'EN'],
  ['que', 'QUE'],
  ['no', 'NO'],
  ['sí', 'SÍ'],
  ['es', 'ES'],
  ['soy', 'SOY'],
  ['eres', 'E-res'],
  ['son', 'SON'],
  ['hay', 'HAY'],
  ['está', 'es-TÁ'],
  ['estoy', 'es-TOY'],
  ['tiene', 'TIE-ne'],
  ['tengo', 'TEN-go'],
  ['tienes', 'TIE-nes'],
  ['se llama', 'se LLA-ma'],
  ['me llamo', 'me LLA-mo'],
  ['quiere', 'QUIE-re'],
  ['quiero', 'QUIE-ro'],
  ['va', 'VA'],
  ['voy', 'VOY'],
  ['le gusta', 'le GUS-ta'],
  ['me gusta', 'me GUS-ta'],
  ['te gusta', 'te GUS-ta'],
  ['yo', 'YO'],
  ['tú', 'TÚ'],
  ['él', 'ÉL'],
  ['ella', 'E-lla'],
  ['nosotros', 'no-SO-tros'],
  ['ellos / ellas', 'E-llos / E-llas'],
  ['usted', 'us-TED'],
  ['mi', 'MI'],
  ['tu', 'TU'],
  ['años', 'A-ños'],
  ['muy', 'MUY'],
  ['mucho', 'MU-cho'],
  ['poco', 'PO-co'],
  ['también', 'tam-BIÉN'],
  ['pero', 'PE-ro'],
  ['o', 'O'],
  ['con', 'CON'],
  ['sin', 'SIN'],
  ['por', 'POR'],
  ['escuela', 'es-CUE-la'],
  ['qué', 'QUÉ'],
  ['quién', 'QUIÉN'],
  ['cómo', 'CÓ-mo'],
  ['dónde', 'DÓN-de'],
  ['cuándo', 'CUÁN-do'],
  ['por qué', 'por QUÉ'],
  ['porque', 'POR-que'],
  ['cuánto', 'CUÁN-to'],
  ['hola', 'HO-la'],
  ['adiós', 'a-DIÓS'],
  ['gracias', 'GRA-cias'],
  ['por favor', 'por fa-VOR'],
  ['chico / chica', 'CHI-co / CHI-ca'],
  ['amigo / amiga', 'a-MI-go / a-MI-ga'],
  ['clase', 'CLA-se'],
  ['profesor / profesora', 'pro-fe-SOR / pro-fe-SO-ra'],
  ['uno, dos, tres…', 'U-no, DOS, TRES'],
  ['familia', 'fa-MI-lia'],
  ['madre / mamá', 'MA-dre / ma-MÁ'],
  ['padre / papá', 'PA-dre / pa-PÁ'],
  ['hermano / hermana', 'her-MA-no / her-MA-na'],
  ['abuelo / abuela', 'a-BUE-lo / a-BUE-la'],
  ['tío / tía', 'TÍ-o / TÍ-a'],
  ['primo / prima', 'PRI-mo / PRI-ma'],
  ['hijo / hija', 'HI-jo / HI-ja'],
  ['hombre', 'HOM-bre'],
  ['mujer', 'mu-JER'],
  ['persona', 'per-SO-na'],
  ['gente', 'GEN-te'],
  ['niño / niña', 'NI-ño / NI-ña'],
  ['bebé', 'be-BÉ'],
  ['perro', 'PE-rro'],
  ['gato', 'GA-to'],
  ['se ve', 'se VE'],
  ['vive', 'VI-ve'],
  ['vivo', 'VI-vo'],
  ['alto / alta', 'AL-to / AL-ta'],
  ['bajo / baja', 'BA-jo / BA-ja'],
  ['grande', 'GRAN-de'],
  ['pequeño / pequeña', 'pe-QUE-ño / pe-QUE-ña'],
  ['joven', 'JO-ven'],
  ['viejo / vieja', 'VIE-jo / VIE-ja'],
  ['nuevo / nueva', 'NUE-vo / NUE-va'],
  ['bueno / buena', 'BUE-no / BUE-na'],
  ['malo / mala', 'MA-lo / MA-la'],
  ['bonito / bonita', 'bo-NI-to / bo-NI-ta'],
  ['feo / fea', 'FE-o / FE-a'],
  ['guapo / guapa', 'GUA-po / GUA-pa'],
  ['simpático / simpática', 'sim-PÁ-ti-co / sim-PÁ-ti-ca'],
  ['antipático / antipática', 'an-ti-PÁ-ti-co / an-ti-PÁ-ti-ca'],
  ['inteligente', 'in-te-li-GEN-te'],
  ['tonto / tonta', 'TON-to / TON-ta'],
  ['divertido / divertida', 'di-ver-TI-do / di-ver-TI-da'],
  ['serio / seria', 'SE-rio / SE-ria'],
  ['trabajador / trabajadora', 'tra-ba-ja-DOR / tra-ba-ja-DO-ra'],
  ['perezoso / perezosa', 'pe-re-ZO-so / pe-re-ZO-sa'],
  ['rápido / rápida', 'RÁ-pi-do / RÁ-pi-da'],
  ['lento / lenta', 'LEN-to / LEN-ta'],
  ['fuerte', 'FUER-te'],
  ['pelo', 'PE-lo'],
  ['ojos', 'O-jos'],
  ['rojo', 'RO-jo'],
  ['azul', 'a-ZUL'],
  ['verde', 'VER-de'],
  ['amarillo', 'a-ma-RI-llo'],
  ['negro', 'NE-gro'],
  ['blanco', 'BLAN-co'],
  ['café / marrón', 'ca-FÉ / ma-RRÓN'],
  ['anaranjado', 'a-na-ran-JA-do'],
  ['morado', 'mo-RA-do'],
  ['rosado', 'ro-SA-do'],
  ['color', 'co-LOR'],
  ['nombre', 'NOM-bre'],
  ['su', 'SU'],
  ['cumpleaños', 'cum-ple-A-ños'],
  ['favorito / favorita', 'fa-vo-RI-to / fa-vo-RI-ta'],
  ['otro / otra', 'O-tro / O-tra'],
  ['todo / toda', 'TO-do / TO-da'],
  ['este / esta', 'ES-te / ES-ta'],
  ['ese / esa', 'E-se / E-sa'],
  ['más', 'MÁS'],
  ['menos', 'ME-nos'],
];

describe('spanishSyllables', () => {
  it.each([
    ['tengo', 'TEN-go'],
    ['porque', 'POR-que'],
    ['también', 'tam-BIÉN'],
    ['rápido', 'RÁ-pi-do'],
    ['perezoso', 'pe-re-ZO-so'],
    ['quiero', 'QUIE-ro'],
    ['cumpleaños', 'cum-ple-A-ños'],
    ['día', 'DÍ-a'],
    ['ciudad', 'ciu-DAD'],
    ['perro', 'PE-rro'],
    ['muy', 'MUY'],
  ])('says %s as %s', (word, said) => {
    expect(spanishSyllables(word)).toBe(said);
  });

  it('says all 130 Unit 1-2 fronts', () => {
    expect(UNIT_1_2_FRONTS).toHaveLength(130);
    for (const [front, said] of UNIT_1_2_FRONTS) {
      expect(spanishSyllables(front), front).toBe(said);
    }
  });

  describe('consonants', () => {
    it.each([
      ['mucho', 'MU-cho'], ['ella', 'E-lla'], ['amarillo', 'a-ma-RI-llo'], ['perro', 'PE-rro'], ['guitarra', 'gui-TA-rra'],
      ['chico', 'CHI-co'], ['marrón', 'ma-RRÓN'],
    ])('keeps ch, ll and rr together: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['hablar', 'ha-BLAR'], ['abrir', 'a-BRIR'], ['madre', 'MA-dre'], ['otro', 'O-tro'], ['negro', 'NE-gro'],
      ['iglesia', 'i-GLE-sia'], ['ofrecer', 'o-fre-CER'], ['reflejo', 're-FLE-jo'], ['aprender', 'a-pren-DER'],
      ['aplauso', 'a-PLAU-so'], ['bicicleta', 'bi-ci-CLE-ta'], ['secreto', 'se-CRE-to'], ['kilo', 'KI-lo'],
    ])('keeps a cluster that cannot be split at the start of a syllable: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['alto', 'AL-to'], ['grande', 'GRAN-de'], ['atleta', 'at-LE-ta'], ['examen', 'e-XA-men'], ['excelente', 'ex-ce-LEN-te'],
      ['hombre', 'HOM-bre'], ['instrucción', 'ins-truc-CIÓN'], ['construir', 'cons-TRUIR'], ['abstracto', 'abs-TRAC-to'],
      ['inglés', 'in-GLÉS'], ['psicología', 'psi-co-lo-GÍ-a'],
    ])('splits other consonant runs, the next syllable taking one consonant or a cluster: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['que', 'QUE'], ['porque', 'POR-que'], ['quién', 'QUIÉN'], ['pequeño', 'pe-QUE-ño'], ['quórum', 'QUÓ-rum'],
      ['guerra', 'GUE-rra'], ['guía', 'GUÍ-a'], ['guitarra', 'gui-TA-rra'],
    ])('reads qu, and gu before e or i, as one consonant with a silent u: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['guapo', 'GUA-po'], ['agua', 'A-gua'], ['antiguo', 'an-TI-guo'], ['pingüino', 'pin-GÜI-no'], ['vergüenza', 'ver-GÜEN-za'],
      ['averiguáis', 'a-ve-ri-GUÁIS'],
    ])('says the u of gu before a, o, and of gü: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['ahora', 'a-HO-ra'], ['hola', 'HO-la'], ['prohibir', 'pro-hi-BIR'], ['huevo', 'HUE-vo'], ['búho', 'BÚ-ho'],
    ])('spells the silent h where it is written: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['yo', 'YO'], ['mayo', 'MA-yo'], ['ayer', 'a-YER'], ['reyes', 'RE-yes'],
      ['muy', 'MUY'], ['hay', 'HAY'], ['soy', 'SOY'], ['estoy', 'es-TOY'], ['rey', 'REY'], ['jersey', 'jer-SEY'],
      ['Uruguay', 'u-ru-GUAY'], ['buey', 'BUEY'], ['y', 'Y'],
    ])('treats y as a consonant before a vowel, and as a vowel at the end or alone: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });
  });

  describe('vowels', () => {
    it.each([
      ['tiene', 'TIE-ne'], ['bueno', 'BUE-no'], ['gracias', 'GRA-cias'], ['familia', 'fa-MI-lia'], ['serio', 'SE-rio'],
      ['ciudad', 'ciu-DAD'], ['cuidado', 'cui-DA-do'], ['baile', 'BAI-le'], ['aplauso', 'a-PLAU-so'], ['oigo', 'OI-go'],
      ['fue', 'FUE'], ['bien', 'BIEN'], ['pie', 'PIE'], ['adiós', 'a-DIÓS'], ['estudiáis', 'es-tu-DIÁIS'], ['sabéis', 'sa-BÉIS'],
    ])('joins a weak vowel to its neighbour in one syllable (diphthong, triphthong): %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['día', 'DÍ-a'], ['tío', 'TÍ-o'], ['país', 'pa-ÍS'], ['baúl', 'ba-ÚL'], ['reír', 're-ÍR'], ['oído', 'o-Í-do'],
      ['continúa', 'con-ti-NÚ-a'], ['actúa', 'ac-TÚ-a'],
    ])('splits the vowels when the weak one carries the accent (hiatus): %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['feo', 'FE-o'], ['leer', 'le-ER'], ['poeta', 'po-E-ta'], ['creo', 'CRE-o'], ['caer', 'ca-ER'], ['aéreo', 'a-É-re-o'],
      ['cumpleaños', 'cum-ple-A-ños'], ['chiita', 'chi-I-ta'],
    ])('splits two strong vowels, and the same weak vowel twice: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });
  });

  describe('stress', () => {
    it.each([
      ['está', 'es-TÁ'], ['rápido', 'RÁ-pi-do'], ['simpático', 'sim-PÁ-ti-co'], ['mamá', 'ma-MÁ'], ['bebé', 'be-BÉ'],
      ['café', 'ca-FÉ'], ['adiós', 'a-DIÓS'], ['México', 'MÉ-xi-co'],
    ])('follows the written accent: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['casa', 'CA-sa'], ['tienes', 'TIE-nes'], ['joven', 'JO-ven'], ['examen', 'e-XA-men'], ['menos', 'ME-nos'],
    ])('falls on the next-to-last syllable when the word ends in a vowel, n or s: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['color', 'co-LOR'], ['azul', 'a-ZUL'], ['usted', 'us-TED'], ['ciudad', 'ciu-DAD'], ['mujer', 'mu-JER'],
      ['estoy', 'es-TOY'], ['Paraguay', 'pa-ra-GUAY'],
    ])('falls on the last syllable otherwise, final y included: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });

    it.each([
      ['sí', 'SÍ'], ['más', 'MÁS'], ['qué', 'QUÉ'], ['tú', 'TÚ'], ['él', 'ÉL'], ['no', 'NO'], ['va', 'VA'], ['voy', 'VOY'],
      ['muy', 'MUY'], ['quién', 'QUIÉN'], ['fui', 'FUI'], ['dio', 'DIO'],
    ])('keeps a word of one syllable whole and stressed: %s → %s', (word, said) => {
      expect(spanishSyllables(word)).toBe(said);
    });
  });

  describe('card text', () => {
    it('keeps the forms of a slash card apart', () => {
      expect(spanishSyllables('hijo / hija')).toBe('HI-jo / HI-ja');
      expect(spanishSyllables('profesor/profesora')).toBe('pro-fe-SOR / pro-fe-SO-ra');
      expect(spanishSyllables('café / marrón')).toBe('ca-FÉ / ma-RRÓN');
    });

    it('leaves the unstressed little words of a phrase in lower case, but stresses a word on its own', () => {
      expect(spanishSyllables('me llamo')).toBe('me LLA-mo');
      expect(spanishSyllables('se llama')).toBe('se LLA-ma');
      expect(spanishSyllables('por favor')).toBe('por fa-VOR');
      expect(spanishSyllables('por qué')).toBe('por QUÉ');
      expect(spanishSyllables('la biblioteca')).toBe('la bi-blio-TE-ca');
      expect(spanishSyllables('el / la')).toBe('EL / LA');
      expect(spanishSyllables('por')).toBe('POR');
      // A phrase of little words only keeps their stress rather than showing none.
      expect(spanishSyllables('de la')).toBe('DE LA');
    });

    it('drops ¿ ? ¡ ! and other punctuation, keeping the commas of a list', () => {
      expect(spanishSyllables('¿Cómo se llama?')).toBe('CÓ-mo se LLA-ma');
      expect(spanishSyllables('¡Hola!')).toBe('HO-la');
      expect(spanishSyllables('uno, dos, tres…')).toBe('U-no, DOS, TRES');
      expect(spanishSyllables('"perro".')).toBe('PE-rro');
      expect(spanishSyllables('hispano-hablante')).toBe('his-PA-no ha-BLAN-te');
    });

    it('reads accents and capitals in either Unicode form', () => {
      expect(spanishSyllables('Tambie\u0301n')).toBe('tam-BIÉN');
      expect(spanishSyllables('JOSÉ')).toBe('jo-SÉ');
      expect(spanishSyllables('PEQUEÑO')).toBe('pe-QUE-ño');
      expect(spanishSyllables('pingu\u0308ino')).toBe('pin-GÜI-no');
    });

    it('ignores HTML tags and entities left in the text', () => {
      expect(spanishSyllables('<b>tengo</b>')).toBe('TEN-go');
      expect(spanishSyllables('me&nbsp;llamo')).toBe('me LLA-mo');
      expect(spanishSyllables('pan &amp; agua')).toBe('PAN A-gua');
      expect(spanishSyllables('perro&#8203;')).toBe('PE-rro');
    });

    it('says both forms of an attached ending, and drops a gloss in parentheses', () => {
      expect(spanishSyllables('profesor(a)')).toBe('pro-fe-SOR / pro-fe-SO-ra');
      expect(spanishSyllables('amigo(a)')).toBe('a-MI-go / a-MI-ga');
      expect(spanishSyllables('es (ser)')).toBe('ES');
      expect(spanishSyllables('usted (formal)')).toBe('us-TED');
      expect(spanishSyllables('está (location')).toBe('es-TÁ');
    });

    it('gives nothing for text with no word to say', () => {
      expect(spanishSyllables('')).toBe('');
      expect(spanishSyllables('¿?')).toBe('');
      expect(spanishSyllables(' / ')).toBe('');
      expect(spanishSyllables('…')).toBe('');
    });

    it('keeps a number as written', () => {
      expect(spanishSyllables('1 de enero')).toBe('1 de e-NE-ro');
    });
  });

  describe('syllabifySpanishWord', () => {
    it('can leave a word unstressed, all in lower case', () => {
      expect(syllabifySpanishWord('para', true)).toBe('pa-ra');
      expect(syllabifySpanishWord('para')).toBe('PA-ra');
    });

    it('gives a word with no vowel back as it is', () => {
      expect(syllabifySpanishWord('Sr')).toBe('sr');
    });
  });
});

/**
 * The same 130 fronts as an English reader should say them (Latin American Spanish): the
 * mnemonic prompt's "Sounds like" line. Spelled syllables misled the model: HI-jo read as
 * "hi, Joe", GEN-te as "gentle", se LLA-ma as an English llama, HAY as English hay.
 */
const UNIT_1_2_SOUNDS: [front: string, sounds: string][] = [
  ['el / la', 'EHL / LAH'],
  ['un / una', 'OON / OO-nah'],
  ['y', 'EE'],
  ['de', 'DEH'],
  ['a', 'AH'],
  ['en', 'EHN'],
  ['que', 'KEH'],
  ['no', 'NOH'],
  ['sí', 'SEE'],
  ['es', 'EHS'],
  ['soy', 'SOY'],
  ['eres', 'EH-rehs'],
  ['son', 'SOHN'],
  ['hay', 'EYE'],
  ['está', 'ehs-TAH'],
  ['estoy', 'ehs-TOY'],
  ['tiene', 'TYEH-neh'],
  ['tengo', 'TEHN-goh'],
  ['tienes', 'TYEH-nehs'],
  ['se llama', 'seh YAH-mah'],
  ['me llamo', 'meh YAH-moh'],
  ['quiere', 'KYEH-reh'],
  ['quiero', 'KYEH-roh'],
  ['va', 'BAH'],
  ['voy', 'BOY'],
  ['le gusta', 'leh GOOS-tah'],
  ['me gusta', 'meh GOOS-tah'],
  ['te gusta', 'teh GOOS-tah'],
  ['yo', 'YOH'],
  ['tú', 'TOO'],
  ['él', 'EHL'],
  ['ella', 'EH-yah'],
  ['nosotros', 'noh-SOH-trohs'],
  ['ellos / ellas', 'EH-yohs / EH-yahs'],
  ['usted', 'oos-TEHD'],
  ['mi', 'MEE'],
  ['tu', 'TOO'],
  ['años', 'AH-nyohs'],
  ['muy', 'MWEE'],
  ['mucho', 'MOO-choh'],
  ['poco', 'POH-koh'],
  ['también', 'tahm-BYEHN'],
  ['pero', 'PEH-roh'],
  ['o', 'OH'],
  ['con', 'KOHN'],
  ['sin', 'SEEN'],
  ['por', 'POHR'],
  ['escuela', 'ehs-KWEH-lah'],
  ['qué', 'KEH'],
  ['quién', 'KYEHN'],
  ['cómo', 'KOH-moh'],
  ['dónde', 'DOHN-deh'],
  ['cuándo', 'KWAHN-doh'],
  ['por qué', 'pohr KEH'],
  ['porque', 'POHR-keh'],
  ['cuánto', 'KWAHN-toh'],
  ['hola', 'OH-lah'],
  ['adiós', 'ah-DYOHS'],
  ['gracias', 'GRAH-syahs'],
  ['por favor', 'pohr fah-BOHR'],
  ['chico / chica', 'CHEE-koh / CHEE-kah'],
  ['amigo / amiga', 'ah-MEE-goh / ah-MEE-gah'],
  ['clase', 'KLAH-seh'],
  ['profesor / profesora', 'proh-feh-SOHR / proh-feh-SOH-rah'],
  ['uno, dos, tres…', 'OO-noh, DOHS, TREHS'],
  ['familia', 'fah-MEE-lyah'],
  ['madre / mamá', 'MAH-dreh / mah-MAH'],
  ['padre / papá', 'PAH-dreh / pah-PAH'],
  ['hermano / hermana', 'ehr-MAH-noh / ehr-MAH-nah'],
  ['abuelo / abuela', 'ah-BWEH-loh / ah-BWEH-lah'],
  ['tío / tía', 'TEE-oh / TEE-ah'],
  ['primo / prima', 'PREE-moh / PREE-mah'],
  ['hijo / hija', 'EE-hoh / EE-hah'],
  ['hombre', 'OHM-breh'],
  ['mujer', 'moo-HEHR'],
  ['persona', 'pehr-SOH-nah'],
  ['gente', 'HEHN-teh'],
  ['niño / niña', 'NEE-nyoh / NEE-nyah'],
  ['bebé', 'beh-BEH'],
  ['perro', 'PEH-rroh'],
  ['gato', 'GAH-toh'],
  ['se ve', 'seh BEH'],
  ['vive', 'BEE-beh'],
  ['vivo', 'BEE-boh'],
  ['alto / alta', 'AHL-toh / AHL-tah'],
  ['bajo / baja', 'BAH-hoh / BAH-hah'],
  ['grande', 'GRAHN-deh'],
  ['pequeño / pequeña', 'peh-KEH-nyoh / peh-KEH-nyah'],
  ['joven', 'HOH-behn'],
  ['viejo / vieja', 'BYEH-hoh / BYEH-hah'],
  ['nuevo / nueva', 'NWEH-boh / NWEH-bah'],
  ['bueno / buena', 'BWEH-noh / BWEH-nah'],
  ['malo / mala', 'MAH-loh / MAH-lah'],
  ['bonito / bonita', 'boh-NEE-toh / boh-NEE-tah'],
  ['feo / fea', 'FEH-oh / FEH-ah'],
  ['guapo / guapa', 'GWAH-poh / GWAH-pah'],
  ['simpático / simpática', 'seem-PAH-tee-koh / seem-PAH-tee-kah'],
  ['antipático / antipática', 'ahn-tee-PAH-tee-koh / ahn-tee-PAH-tee-kah'],
  ['inteligente', 'een-teh-lee-HEHN-teh'],
  ['tonto / tonta', 'TOHN-toh / TOHN-tah'],
  ['divertido / divertida', 'dee-behr-TEE-doh / dee-behr-TEE-dah'],
  ['serio / seria', 'SEH-ryoh / SEH-ryah'],
  ['trabajador / trabajadora', 'trah-bah-hah-DOHR / trah-bah-hah-DOH-rah'],
  ['perezoso / perezosa', 'peh-reh-SOH-soh / peh-reh-SOH-sah'],
  ['rápido / rápida', 'RRAH-pee-doh / RRAH-pee-dah'],
  ['lento / lenta', 'LEHN-toh / LEHN-tah'],
  ['fuerte', 'FWEHR-teh'],
  ['pelo', 'PEH-loh'],
  ['ojos', 'OH-hohs'],
  ['rojo', 'RROH-hoh'],
  ['azul', 'ah-SOOL'],
  ['verde', 'BEHR-deh'],
  ['amarillo', 'ah-mah-REE-yoh'],
  ['negro', 'NEH-groh'],
  ['blanco', 'BLAHN-koh'],
  ['café / marrón', 'kah-FEH / mah-RROHN'],
  ['anaranjado', 'ah-nah-rahn-HAH-doh'],
  ['morado', 'moh-RAH-doh'],
  ['rosado', 'rroh-SAH-doh'],
  ['color', 'koh-LOHR'],
  ['nombre', 'NOHM-breh'],
  ['su', 'SOO'],
  ['cumpleaños', 'koom-pleh-AH-nyohs'],
  ['favorito / favorita', 'fah-boh-REE-toh / fah-boh-REE-tah'],
  ['otro / otra', 'OH-troh / OH-trah'],
  ['todo / toda', 'TOH-doh / TOH-dah'],
  ['este / esta', 'EHS-teh / EHS-tah'],
  ['ese / esa', 'EH-seh / EH-sah'],
  ['más', 'MAHS'],
  ['menos', 'MEH-nohs'],
];

describe('spanishPronunciation (how it sounds)', () => {
  it('says all 130 Unit 1-2 fronts as an English reader should', () => {
    expect(UNIT_1_2_SOUNDS).toHaveLength(130);
    expect(UNIT_1_2_SOUNDS.map(([front]) => front)).toEqual(UNIT_1_2_FRONTS.map(([front]) => front));
    for (const [front, sounds] of UNIT_1_2_SOUNDS) {
      expect(spanishPronunciation(front), front).toBe(sounds);
    }
  });

  it('keeps the syllables and the stress of the spelling', () => {
    for (const [front] of UNIT_1_2_FRONTS) {
      const spelled = spanishSyllables(front);
      const sounds = spanishPronunciation(front);
      const shape = (text: string) => text.replace(/[^\s/,-]+/g, (s) => (s === s.toLowerCase() ? 'x' : 'X'));
      expect(shape(sounds), front).toBe(shape(spelled));
    }
  });

  it.each([
    ['hola', 'OH-lah'], ['hijo', 'EE-hoh'], ['ahora', 'ah-OH-rah'], ['huevo', 'WEH-boh'], ['hielo', 'YEH-loh'],
  ])('h is silent: %s → %s', (word, sounds) => {
    expect(spanishPronunciation(word)).toBe(sounds);
  });

  it.each([
    ['joven', 'HOH-behn'], ['gente', 'HEHN-teh'], ['girar', 'hee-RAHR'], ['gato', 'GAH-toh'], ['grande', 'GRAHN-deh'],
    ['guerra', 'GHEH-rrah'], ['guitarra', 'ghee-TAH-rrah'], ['pingüino', 'peen-GWEE-noh'], ['agua', 'AH-gwah'],
  ])('j, and g before e or i, sound like h; g is hard elsewhere: %s → %s', (word, sounds) => {
    expect(spanishPronunciation(word)).toBe(sounds);
  });

  it.each([
    ['llamo', 'YAH-moh'], ['yo', 'YOH'], ['mayo', 'MAH-yoh'], ['niño', 'NEE-nyoh'],
  ])('ll and consonant y sound like y, ñ like ny: %s → %s', (word, sounds) => {
    expect(spanishPronunciation(word)).toBe(sounds);
  });

  it.each([
    ['que', 'KEH'], ['casa', 'KAH-sah'], ['cinco', 'SEEN-koh'], ['cena', 'SEH-nah'], ['zapato', 'sah-PAH-toh'],
    ['acción', 'ahk-SYOHN'], ['vaca', 'BAH-kah'], ['examen', 'eh-KSAH-mehn'], ['México', 'MEH-hee-koh'],
  ])('qu is k; z, and c before e or i, are s; v is b; x is ks (but h in México): %s → %s', (word, sounds) => {
    expect(spanishPronunciation(word)).toBe(sounds);
  });

  it.each([
    ['pero', 'PEH-roh'], ['perro', 'PEH-rroh'], ['rojo', 'RROH-hoh'], ['Enrique', 'ehn-RREE-keh'], ['alrededor', 'ahl-rreh-deh-DOHR'],
  ])('rr, and r at the start or after n, l or s, is trilled: %s → %s', (word, sounds) => {
    expect(spanishPronunciation(word)).toBe(sounds);
  });

  it.each([
    ['hay', 'EYE'], ['baile', 'BYE-leh'], ['seis', 'SAYS'], ['rey', 'RRAY'], ['hoy', 'OY'], ['auto', 'OW-toh'],
    ['muy', 'MWEE'], ['ciudad', 'syoo-DAHD'], ['buey', 'BWAY'], ['Uruguay', 'oo-roo-GWYE'], ['día', 'DEE-ah'],
    ['país', 'pah-EES'], ['feo', 'FEH-oh'],
  ])('vowels are pure, and a weak one joined to another is a glide: %s → %s', (word, sounds) => {
    expect(spanishPronunciation(word)).toBe(sounds);
  });

  it('reads card text as spanishSyllables does: slash forms, phrases, punctuation, glosses', () => {
    expect(spanishPronunciation('¿Cómo se llama?')).toBe('KOH-moh seh YAH-mah');
    expect(spanishPronunciation('profesor(a)')).toBe('proh-feh-SOHR / proh-feh-SOH-rah');
    expect(spanishPronunciation('es (ser)')).toBe('EHS');
    expect(spanishPronunciation('<b>tengo</b>')).toBe('TEHN-goh');
    expect(spanishPronunciation('1 de enero')).toBe('1 deh eh-NEH-roh');
    expect(spanishPronunciation('¿?')).toBe('');
  });
});

describe('isSpanishLanguage', () => {
  it.each(['es', 'ES', ' es ', 'es-MX', 'es_419', 'Spanish', 'español'])('%s is Spanish', (code) => {
    expect(isSpanishLanguage(code)).toBe(true);
  });

  it.each(['en', 'he', 'pt', 'est', 'esperanto', '', null, undefined])('%s is not', (code) => {
    expect(isSpanishLanguage(code)).toBe(false);
  });
});
