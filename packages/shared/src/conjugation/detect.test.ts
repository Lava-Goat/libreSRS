// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import { dativeNote, detectVerbs, NOTE_HAY, NOTE_UNKNOWN, NOTE_WEATHER, type DeckCard } from './index.js';

function deck(list: string, firstId = 1): DeckCard[] {
  return list.split('; ').map((pair, i) => {
    const [front, back] = pair.split(' | ');
    return { id: firstId + i, front, back };
  });
}

// The cards of a sample "Unit 1" deck.
const UNIT1_VERBS = deck(
  'es | he/she/it is (ser); soy | I am (ser); eres | you are (ser); son | they are (ser); hay | there is / there are; ' +
    'está | is (location/feeling); estoy | I am (location/feeling); tiene | has; tengo | I have; tienes | you have; ' +
    'se llama | is named; me llamo | my name is; quiere | wants; quiero | I want; va | goes; voy | I go; ' +
    'le gusta | he/she likes; me gusta | I like; te gusta | you like; se ve | looks, appears; vive | lives; vivo | I live',
);

// The non-verb cards of Units 1 and 2 (several are real verb forms: bajo, pelo, nombre, uno, baja).
const UNIT1_OTHER = deck(
  'el / la | the; un / una | a, an; y | and; de | of, from; a | to, at; en | in, on, at; que | that, which; ' +
    'no | no, not; sí | yes; yo | I; tú | you; él | he; ella | she; nosotros | we; ellos / ellas | they; ' +
    'usted | you (formal); mi | my; tu | your; años | years (age); muy | very; mucho | a lot, much; ' +
    'poco | little, few; también | also; pero | but; o | or; con | with; sin | without; por | for, by, through; ' +
    'escuela | school; qué | what; quién | who; cómo | how; dónde | where; cuándo | when; por qué | why; ' +
    'porque | because; cuánto | how much/many; hola | hello; adiós | goodbye; gracias | thank you; ' +
    'por favor | please; chico / chica | boy / girl; amigo / amiga | friend; clase | class; ' +
    'profesor / profesora | teacher; uno, dos, tres… | numbers 1-31; familia | family; madre / mamá | mother / mom; ' +
    'padre / papá | father / dad; hermano / hermana | brother / sister; abuelo / abuela | grandfather / grandmother; ' +
    'tío / tía | uncle / aunt; primo / prima | cousin; hijo / hija | son / daughter; hombre | man; mujer | woman; ' +
    'persona | person; gente | people; niño / niña | child; bebé | baby; perro | dog; gato | cat; alto / alta | tall; ' +
    'bajo / baja | short (height); grande | big; pequeño / pequeña | small; joven | young; viejo / vieja | old; ' +
    'nuevo / nueva | new; bueno / buena | good; malo / mala | bad; bonito / bonita | pretty; feo / fea | ugly; ' +
    'guapo / guapa | good-looking; simpático / simpática | nice, friendly; antipático / antipática | unfriendly; ' +
    'inteligente | intelligent; tonto / tonta | silly; divertido / divertida | fun; serio / seria | serious; ' +
    'trabajador / trabajadora | hard-working; perezoso / perezosa | lazy; rápido / rápida | fast; lento / lenta | slow; ' +
    'fuerte | strong; pelo | hair; ojos | eyes; rojo | red; azul | blue; verde | green; amarillo | yellow; ' +
    'negro | black; blanco | white; café / marrón | brown; anaranjado | orange; morado | purple; rosado | pink; ' +
    'color | color; nombre | name; su | his, her, their; cumpleaños | birthday; favorito / favorita | favorite; ' +
    'otro / otra | other, another; todo / toda | all, every; este / esta | this; ese / esa | that; más | more; menos | less',
  100,
);

const card = (front: string): DeckCard => {
  const found = UNIT1_VERBS.find((c) => c.front === front);
  if (!found) throw new Error(front);
  return found;
};
const cardsOf = (...fronts: string[]): DeckCard[] => fronts.map(card);

describe('detectVerbs on Unit 1', () => {
  it('finds exactly the Unit 1 entries, keyed to how the deck uses each verb, in deck order', () => {
    // Interleave the non-verb cards so order within the deck does not matter.
    const mixed = [...UNIT1_OTHER.slice(0, 40), ...UNIT1_VERBS, ...UNIT1_OTHER.slice(40)];
    expect(detectVerbs(mixed)).toEqual([
      { infinitive: 'ser', cards: cardsOf('es', 'soy', 'eres', 'son'), excludedByDefault: false },
      { infinitive: 'haber-impersonal', cards: cardsOf('hay'), excludedByDefault: false, note: NOTE_HAY },
      { infinitive: 'estar', cards: cardsOf('está', 'estoy'), excludedByDefault: false },
      { infinitive: 'tener', cards: cardsOf('tiene', 'tengo', 'tienes'), excludedByDefault: false },
      { infinitive: 'llamarse', cards: cardsOf('se llama', 'me llamo'), excludedByDefault: false },
      { infinitive: 'querer', cards: cardsOf('quiere', 'quiero'), excludedByDefault: false },
      { infinitive: 'ir', cards: cardsOf('va', 'voy'), excludedByDefault: false },
      {
        infinitive: 'gustarle',
        cards: cardsOf('le gusta', 'me gusta', 'te gusta'),
        excludedByDefault: false,
        note: 'used with me/te/le: practiced as "me gusta(n)"',
      },
      { infinitive: 'verse', cards: cardsOf('se ve'), excludedByDefault: false },
      { infinitive: 'vivir', cards: cardsOf('vive', 'vivo'), excludedByDefault: false },
    ]);
  });

  it('finds nothing among the non-verb cards', () => {
    expect(detectVerbs(UNIT1_OTHER)).toEqual([]);
  });
});

describe('detectVerbs, other decks', () => {
  it('detects plain infinitives, known or not', () => {
    const cards = deck('hablar | to speak; levantarse | to get up; tuitear | to tweet; comer | eat; mujer | woman');
    expect(detectVerbs(cards)).toEqual([
      { infinitive: 'hablar', cards: [cards[0]], excludedByDefault: false },
      { infinitive: 'levantarse', cards: [cards[1]], excludedByDefault: false },
      { infinitive: 'tuitear', cards: [cards[2]], excludedByDefault: false, note: NOTE_UNKNOWN },
      // A dictionary infinitive glossed with a bare English verb (no "to") counts too.
      { infinitive: 'comer', cards: [cards[3]], excludedByDefault: false },
    ]);
  });

  it('keys gustar-type verbs to their dative entry and excludes none of them', () => {
    const cards = deck(
      'encantar | to love (things); me encanta | I love it; nos interesa | we are interested in; ' +
        'le duele | it hurts him/her; parece | seems; parecerse | to look like',
    );
    expect(detectVerbs(cards)).toEqual([
      // A gustar-type infinitive on a card is practiced as the construction the deck teaches.
      { infinitive: 'encantarle', cards: [cards[0], cards[1]], excludedByDefault: false, note: dativeNote('encantarle') },
      { infinitive: 'interesarle', cards: [cards[2]], excludedByDefault: false, note: dativeNote('interesarle') },
      { infinitive: 'dolerle', cards: [cards[3]], excludedByDefault: false, note: dativeNote('dolerle') },
      // No clitic: the plain verb (parezco, pareces, parece).
      { infinitive: 'parecer', cards: [cards[4]], excludedByDefault: false },
      { infinitive: 'parecerse', cards: [cards[5]], excludedByDefault: false },
    ]);
    expect(dativeNote('dolerle')).toBe('used with me/te/le: practiced as "me duele(n)"');
  });

  it('uses the gloss to tell a verb card from a noun card', () => {
    const cards = deck('bajo | I go down; pelo | I peel; nombre | name; bajo | short (height); como | I eat; cómo | how');
    expect(detectVerbs(cards)).toEqual([
      { infinitive: 'bajar', cards: [cards[0]], excludedByDefault: false },
      { infinitive: 'pelar', cards: [cards[1]], excludedByDefault: false },
      { infinitive: 'comer', cards: [cards[4]], excludedByDefault: false },
    ]);
  });

  it('resolves ambiguous forms by a parenthetical infinitive, the gloss person, or the rest of the deck', () => {
    const named = deck('fue | he went (ir); fue | it was (ser)');
    expect(detectVerbs(named).map((v) => [v.infinitive, v.cards.map((c) => c.id)])).toEqual([
      ['ir', [1]],
      ['ser', [2]],
    ]);
    const byDeck = deck('voy | I go; fuimos | we went');
    expect(detectVerbs(byDeck).map((v) => v.infinitive)).toEqual(['ir']);
    const byPerson = deck('ve | sees');
    expect(detectVerbs(byPerson).map((v) => v.infinitive)).toEqual(['ver']);
  });

  it('reads fronts with alternatives and punctuation', () => {
    const cards = deck('tengo / tienes | I have / you have; ¡Ven! | Come!; hago, haces | I do, you do');
    expect(detectVerbs(cards).map((v) => [v.infinitive, v.cards.length])).toEqual([
      ['tener', 1],
      ['venir', 1],
      ['hacer', 1],
    ]);
  });

  it('keeps hay (haber-impersonal) apart from the auxiliary haber', () => {
    const cards = deck('hay | there is; he | I have (done); había | there was; había | I had (done)');
    expect(detectVerbs(cards)).toEqual([
      { infinitive: 'haber-impersonal', cards: [cards[0], cards[2]], excludedByDefault: false, note: NOTE_HAY },
      { infinitive: 'haber', cards: [cards[1], cards[3]], excludedByDefault: false },
    ]);
  });

  it('copes with empty input', () => {
    expect(detectVerbs([])).toEqual([]);
    expect(detectVerbs([{ front: '', back: '' }])).toEqual([]);
  });
});

describe('detectVerbs, audit regressions', () => {
  const found = (list: string): [string, number[], boolean][] =>
    detectVerbs(deck(list)).map((v) => [v.infinitive, v.cards.map((c) => c.id as number), v.excludedByDefault]);
  const infinitives = (list: string): string[] => detectVerbs(deck(list)).map((v) => v.infinitive);

  it('picks between verbs sharing forms by the English gloss', () => {
    expect(found('creo | I believe; crees | you believe; cree | he/she believes; creemos | we believe; creen | they believe'))
      .toEqual([['creer', [1, 2, 3, 4, 5], false]]);
    expect(infinitives('creo | I think, I believe')).toEqual(['creer']);
    expect(infinitives('vendo | I sell; vendes | you sell; vende | he/she sells; vendemos | we sell; venden | they sell'))
      .toEqual(['vender']);
    expect(found('compro | I buy; vendo | I sell; venden | they sell')).toEqual([
      ['comprar', [1], false],
      ['vender', [2, 3], false],
    ]);
    expect(infinitives('fui | I went; fuiste | you went; fue | he/she went; fuimos | we went; fueron | they went'))
      .toEqual(['ir']);
    expect(found('soy | I am; fui | I went')).toEqual([['ser', [1], false], ['ir', [2], false]]);
    // The gloss wins over the rest of the deck.
    expect(found('voy | I go; fue | it was; fui | I was')).toEqual([['ir', [1], false], ['ser', [2, 3], false]]);
    expect(found('siento | I feel; me siento | I feel; miento | I lie; mientes | you lie; miente | he lies; fundo | I melt; ve | see!'))
      .toEqual([
        ['sentir', [1], false],
        ['sentirse', [2], false],
        ['mentir', [3, 4, 5], false],
        ['fundir', [6], false],
        ['ver', [7], false],
      ]);
    expect(infinitives('me siento | I sit down')).toEqual(['sentarse']);
  });

  it('reads fronts that start with a subject pronoun', () => {
    expect(
      found(
        'yo hablo | I speak; tú hablas | you speak; él habla | he speaks; nosotros hablamos | we speak; ' +
          'ellos hablan | they speak; Ud. habla | you (formal) speak; ella habla | she speaks; yo me llamo | my name is; ' +
          'ellos se levantan | they get up',
      ),
    ).toEqual([
      ['hablar', [1, 2, 3, 4, 5, 6, 7], false],
      ['llamarse', [8], false],
      ['levantarse', [9], false],
    ]);
    // The pronoun must agree with the form, and a possessive "tu" before a noun is no verb.
    expect(found('yo habla | I speak; tu casa | your house')).toEqual([]);
  });

  it('takes the leading infinitive of a textbook phrase', () => {
    expect(
      infinitives(
        'escribir cuentos | to write stories; escuchar música | to listen to music; ir a la escuela | to go to school; ' +
          'jugar videojuegos | to play video games; leer revistas | to read magazines; montar en bicicleta | to ride a bicycle; ' +
          'pasar tiempo con amigos | to spend time with friends; practicar deportes | to play sports; ' +
          'tocar la guitarra | to play the guitar; usar la computadora | to use the computer; ver la tele | to watch TV; ' +
          "lavarse los dientes | to brush one's teeth; tener que + inf. | to have to; tener hambre | to be hungry; " +
          'empezar (e→ie) a | to begin',
      ),
    ).toEqual([
      'escribir', 'escuchar', 'ir', 'jugar', 'leer', 'montar', 'pasar', 'practicar', 'tocar', 'usar', 'ver', 'lavarse',
      'tener', 'empezar',
    ]);
    // Without a "to ..." gloss a phrase is not taken for its first word.
    expect(infinitives('mujer joven | young woman; lugar de nacimiento | place of birth')).toEqual([]);
  });

  it('accepts an infinitive glossed without "to"', () => {
    expect(infinitives('comer | eat; vivir | live; hablar | speak, talk; ser | be; ir | go; hacer | do, make; nadar | swim (v.); comer | (to) eat'))
      .toEqual(['comer', 'vivir', 'hablar', 'ser', 'ir', 'hacer', 'nadar']);
    // Nouns spelled like infinitives keep a noun gloss.
    expect(infinitives('poder | power; deber | duty; amanecer | dawn; placer | pleasure')).toEqual([]);
  });

  it('maps infinitives typed without the accent to the -eír / -oír verbs', () => {
    const verbs = detectVerbs(deck('oir | to hear; reir | to laugh; reirse | to laugh; freir | to fry; sonreir | to smile'));
    expect(verbs.map((v) => v.infinitive)).toEqual(['oír', 'reír', 'reírse', 'freír', 'sonreír']);
    expect(verbs.every((v) => v.note === undefined)).toBe(true);
  });

  it('reads "you (formal)", "(pl.)", "you guys", "y\'all", usted and ustedes as subjects', () => {
    expect(
      found(
        "habla | you (formal) speak; hablan | they/you (pl.) speak; hablas | you (sing.) speak; habláis | you guys speak; " +
          "hablan | y'all speak; habla | usted speaks; hablan | ustedes speak",
      ),
    ).toEqual([['hablar', [1, 2, 3, 4, 5, 6, 7], false]]);
  });

  it('takes any English verb after "you"', () => {
    expect(infinitives('planchas | you iron; barres | you sweep; sacudes | you dust; friegas | you scrub; pelas | you peel'))
      .toEqual(['planchar', 'barrer', 'sacudir', 'fregar', 'pelar']);
    expect(infinitives('gracias | thank you very much')).toEqual([]);
  });

  it('reads a bare English verb as a command when the front can only be one', () => {
    expect(found('Levántate | Get up; Escuchen | Listen (pl.); Repitan | Repeat; Siéntense | Sit down (pl.); ¡Ven aquí! | Come here!'))
      .toEqual([
        ['levantarse', [1], false],
        ['escuchar', [2], false],
        ['repetir', [3], false],
        ['sentarse', [4], false],
        ['venir', [5], false],
      ]);
    // Singular usted forms double as nouns: they need "!" or a person in the gloss.
    expect(infinitives('baile | dance; ataque | attack; ayuda | help; visita | visit')).toEqual([]);
  });

  it('recognises any dictionary verb used pronominally', () => {
    expect(
      found(
        'me arreglo | I get ready; te arreglas | you get ready; se arregla | he gets ready; me cuido | I take care of myself; ' +
          'se cuidan | they take care of themselves; nos abrazamos | we hug each other; se besan | they kiss each other',
      ),
    ).toEqual([
      ['arreglarse', [1, 2, 3], false],
      ['cuidarse', [4, 5], false],
      ['abrazarse', [6], false],
      ['besarse', [7], false],
    ]);
  });

  it('keeps "(se)" written onto an infinitive', () => {
    expect(infinitives('levantar(se) | to get up; acostar(se) | to go to bed')).toEqual(['levantarse', 'acostarse']);
  });

  it('does not read a "(regular)" label as the verb regular', () => {
    expect(infinitives('yo hablo | I speak (regular); tuiteo | I tweet (regular)')).toEqual(['hablar']);
  });

  it('includes impersonal haber in every tense as haber-impersonal', () => {
    const cards = deck('hay | there is/are; había | there was/were; hubo | there was; habrá | there will be');
    expect(detectVerbs(cards)).toEqual([{ infinitive: 'haber-impersonal', cards, excludedByDefault: false, note: NOTE_HAY }]);
  });

  it('includes weather verbs as impersonal entries', () => {
    const cards = deck("llueve | it rains; nieva | it snows; está lloviendo | it's raining");
    expect(detectVerbs(cards)).toEqual([
      { infinitive: 'llover', cards: [cards[0], cards[2]], excludedByDefault: false, note: NOTE_WEATHER },
      { infinitive: 'nevar', cards: [cards[1]], excludedByDefault: false, note: NOTE_WEATHER },
    ]);
  });

  it('keys the gustar construction to the dative entry of any verb', () => {
    expect(
      found(
        "me queda | it fits me; me quedan | they fit me; me aburre | it bores me; me preocupa | it worries me; " +
          "le toca | it's his turn; les duele | it hurts them; me chifla | I'm crazy about it; me sirve | it works for me",
      ),
    ).toEqual([
      ['quedarle', [1, 2], false],
      ['aburrirle', [3], false],
      ['preocuparle', [4], false],
      ['tocarle', [5], false],
      ['dolerle', [6], false],
      ['chiflarle', [7], false],
      ['servirle', [8], false],
    ]);
    expect(detectVerbs(deck('me aburre | it bores me'))[0].note).toBe('used with me/te/le: practiced as "me aburre(n)"');
    // An indirect object with a personal subject is an ordinary verb.
    expect(found('le escribe | he writes to him')).toEqual([['escribir', [1], false]]);
  });

  it('does not count "is" inside a relative clause or a note as verb evidence', () => {
    expect(
      infinitives(
        'cuento | a story that is told; baño | bathroom (where the toilet is); camino | road, the way that is walked; ' +
          'trabajo | job (what one is paid for)',
      ),
    ).toEqual([]);
    expect(infinitives('me llamo | my name is; es | he is')).toEqual(['llamarse', 'ser']);
  });

  it('tolerates missing accents when the gloss is plainly a verb', () => {
    expect(found('comi | I ate; comio | he ate; estas | you are; esta | is (location)')).toEqual([
      ['comer', [1, 2], false],
      ['estar', [3, 4], false],
    ]);
    expect(infinitives('hablo | he spoke')).toEqual(['hablar']);
    expect(infinitives('esta | this; mas | but')).toEqual([]);
  });
});

describe('detectVerbs, entries keyed to usage', () => {
  const found = (list: string): [string, number[]][] =>
    detectVerbs(deck(list)).map((v) => [v.infinitive, v.cards.map((c) => c.id as number)]);

  it('tells gustar, gustarse and gustarle apart', () => {
    expect(found('gusto | I please')).toEqual([['gustar', [1]]]);
    expect(found('me gusto | I like myself; nos gustamos | we like each other')).toEqual([['gustarse', [1, 2]]]);
    expect(found('me gusta | I like; te gustan | you like; les gusta | they like')).toEqual([['gustarle', [1, 2, 3]]]);
    expect(found('gusto | I please; me gusto | I like myself; me gusta | I like')).toEqual([
      ['gustar', [1]],
      ['gustarse', [2]],
      ['gustarle', [3]],
    ]);
  });

  it('tells llamar and llamarse apart, and ver and verse', () => {
    expect(found('me llamo | my name is; te llamo | I call you; llamo | I call')).toEqual([
      ['llamarse', [1]],
      ['llamar', [2, 3]],
    ]);
    expect(found('se ve | looks, appears; ve | sees')).toEqual([
      ['verse', [1]],
      ['ver', [2]],
    ]);
  });

  it('keeps object clitics on ordinary verbs as the plain entry', () => {
    expect(
      found('le escribo | I write to him; te llamo | I call you; me llama | he calls me; me toca | he touches me; lo tengo | I have it'),
    ).toEqual([
      ['escribir', [1]],
      ['llamar', [2, 3]],
      ['tocar', [4]],
      ['tener', [5]],
    ]);
  });

  it('reads the dative with an experiencer phrase or a noun after it', () => {
    expect(found('a mí me encanta | I love it; a ellos les gustan | they like them')).toEqual([
      ['encantarle', [1]],
      ['gustarle', [2]],
    ]);
    expect(found('me duele la cabeza | my head hurts; me duelen los pies | my feet hurt')).toEqual([['dolerle', [1, 2]]]);
  });

  it('includes every dative entry with its note, none excluded', () => {
    const verbs = detectVerbs(deck('me queda | it fits me; me falta | I lack; me parece | it seems to me'));
    expect(verbs.map((v) => [v.infinitive, v.excludedByDefault, v.note])).toEqual([
      ['quedarle', false, 'used with me/te/le: practiced as "me queda(n)"'],
      ['faltarle', false, 'used with me/te/le: practiced as "me falta(n)"'],
      ['parecerle', false, 'used with me/te/le: practiced as "me parece(n)"'],
    ]);
  });

  it('reads the daybreak verbs as impersonal only when glossed as the day', () => {
    const verbs = detectVerbs(deck('amanece | dawn breaks; amanezco | I wake up'));
    expect(verbs.map((v) => [v.infinitive, v.note])).toEqual([
      ['amanecer-impersonal', 'impersonal: practiced as amanece / amaneció…'],
      ['amanecer', undefined],
    ]);
  });
});

describe('detectVerbs, usage audit regressions', () => {
  const found = (list: string): [string, number[]][] =>
    detectVerbs(deck(list)).map((v) => [v.infinitive, v.cards.map((c) => c.id as number)]);
  const infinitives = (list: string): string[] => detectVerbs(deck(list)).map((v) => v.infinitive);

  it('keys a form that is both dative and pronominal (yo = third person) to the dative unless the gloss is reflexive', () => {
    expect(infinitives('me gustaría | I would like')).toEqual(['gustarle']);
    expect(infinitives('me gustaría | I would like; me encantaría | I would love')).toEqual(['gustarle', 'encantarle']);
    expect(found('me gusta | I like; me gustaría | I would like; nos gustamos | we like each other')).toEqual([
      ['gustarle', [1, 2]],
      ['gustarse', [3]],
    ]);
    expect(
      infinitives(
        'me había gustado | I had liked it; me parecía | it seemed to me; me quedaba | it fit me; me caía bien | I liked him; ' +
          'me preocupaba | it worried me; me aburría | it bored me; me interesaría | I would be interested',
      ),
    ).toEqual(['gustarle', 'parecerle', 'quedarle', 'caerle', 'preocuparle', 'aburrirle', 'interesarle']);
    // The pronominal sense when the gloss says so.
    expect(
      infinitives(
        'me gustaba | I liked myself; me preocupaba | I was worried; me quedaba | I was staying; me caía | I was falling; ' +
          'me parecía a mi madre | I looked like my mother; me aburría | I got bored',
      ),
    ).toEqual(['gustarse', 'preocuparse', 'quedarse', 'caerse', 'parecerse', 'aburrirse']);
  });

  it('keeps object clitics with a personal or animal subject on the plain entry', () => {
    expect(
      infinitives(
        'me llaman | they call me; te quieren | they love you; me escriben | they write to me; nos ayudan | they help us; ' +
          'me dicen | they tell me; nos ven | they see us; me muerde | it bites me; me mira | it looks at me; ' +
          'me despertó | it woke me up; me tocan | they touch me',
      ),
    ).toEqual(['llamar', 'querer', 'escribir', 'ayudar', 'decir', 'ver', 'morder', 'mirar', 'despertar', 'tocar']);
    // The gustar construction still: a gustar-type English verb, or "it … for me".
    expect(infinitives("me pica | it itches; me sirve | it works for me; me quedan | they fit me; me duelen | they hurt"))
      .toEqual(['picarle', 'servirle', 'quedarle', 'dolerle']);
  });

  it('does not take a clitic for the pronominal verb when the gloss names another subject', () => {
    expect(
      infinitives(
        'me llamaba | he used to call me; me ayudaba | she used to help me; me veía | he used to see me; ' +
          'me llamó | he called me; me lavó | she washed me; me levantó | he picked me up',
      ),
    ).toEqual(['llamar', 'ayudar', 'ver', 'lavar', 'levantar']);
    expect(infinitives('me llamaba | my name was; se llamó | he called himself')).toEqual(['llamarse']);
  });

  it('does not accent-fold a one-syllable function word into a verb', () => {
    expect(infinitives("de nada | you're welcome; se me olvidó | I forgot; se me cayó | I dropped it; se me perdió | I lost it"))
      .toEqual([]);
    // Unit 1 with its greetings is still the same ten entries.
    const greetings = deck("de nada | you're welcome; mucho gusto | nice to meet you; hasta luego | see you later", 500);
    expect(detectVerbs([...UNIT1_VERBS, ...greetings]).map((v) => v.infinitive)).toEqual([
      'ser', 'haber-impersonal', 'estar', 'tener', 'llamarse', 'querer', 'ir', 'gustarle', 'verse', 'vivir',
    ]);
    // With a subject pronoun the slip is still forgiven.
    expect(infinitives('yo se | I know')).toEqual(['saber']);
  });

  it('reads clitic clusters by their first clitic', () => {
    expect(infinitives('se lo doy | I give it to him; se lo da | he gives it to her; me lo das | you give it to me')).toEqual([
      'dar',
    ]);
    expect(infinitives('me lo pongo | I put it on; se lo pone | he puts it on')).toEqual(['ponerse']);
  });

  it('keys weather hacer to hacer-impersonal', () => {
    const cards = deck(
      "hace frío | it's cold; hace calor | it's hot; hace sol | it's sunny; hace viento | it's windy; hizo calor | it was hot; " +
        "hacía frío | it was cold; hace buen tiempo | the weather is nice; ¿Qué tiempo hace? | What's the weather like?; " +
        'hacer frío | to be cold (weather)',
    );
    expect(detectVerbs(cards)).toEqual([
      { infinitive: 'hacer-impersonal', cards, excludedByDefault: false, note: 'impersonal: practiced as hace / hizo…' },
    ]);
    expect(found('hago | I do; hace | he does; hacer | to do, make; hace dos años | two years ago')).toEqual([['hacer', [1, 2, 3]]]);
  });

  it('keys a dawn-glossed daybreak infinitive to its impersonal entry', () => {
    expect(infinitives('amanecer | to dawn; anochecer | to get dark')).toEqual(['amanecer-impersonal', 'anochecer-impersonal']);
    expect(infinitives('amanecer | to wake up (somewhere)')).toEqual(['amanecer']);
  });

  it('analyzes every weather verb', () => {
    expect(infinitives("relampaguea | it's lightning; diluvia | it pours; escarcha | it frosts; garúa | it drizzles")).toEqual([
      'relampaguear', 'diluviar', 'escarchar', 'garuar',
    ]);
  });

  it('reads fronts led by "no" or a question word', () => {
    expect(
      found(
        "no me gusta | I don't like; no le gusta | he doesn't like; no hay | there isn't; ¿Cómo te llamas? | What's your name?; " +
          "¿Qué te duele? | What hurts?; hay que estudiar | one has to study; yo no hablo | I don't speak; no hables | don't talk",
      ),
    ).toEqual([
      ['gustarle', [1, 2]],
      ['haber-impersonal', [3, 6]],
      ['llamarse', [4]],
      ['dolerle', [5]],
      ['hablar', [7, 8]],
    ]);
    expect(infinitives('me gustas | I like you; le gusto | he likes me')).toEqual(['gustarle']);
    expect(infinitives('qué | what; por qué | why; no | no, not; cómo | how')).toEqual([]);
  });

  it('keeps a gustar-type infinitive in its plain sense plain', () => {
    expect(infinitives('faltar a clase | to miss class; falto a clase | I miss class')).toEqual(['faltar']);
    expect(infinitives('faltar | to lack; importar | to import')).toEqual(['faltarle', 'importar']);
  });

  it('writes the note of a dative entry with its real plural', () => {
    expect(dativeNote('serle')).toBe('used with me/te/le: practiced as "me es / me son"');
    expect(detectVerbs(deck("me es difícil | it's difficult for me"))[0].note).toBe(
      'used with me/te/le: practiced as "me es / me son"',
    );
    expect(dativeNote('gustarle')).toBe('used with me/te/le: practiced as "me gusta(n)"');
  });
});
