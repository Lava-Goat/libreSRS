// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, expect, it } from 'vitest';
import {
  conjugate,
  entryKind,
  isKnownVerb,
  lexiconInfinitives,
  LEXICON_INFINITIVES,
  REFLEXIVE_VERBS,
  TENSES,
  verbInfo,
  WEATHER_VERBS,
} from './index.js';
import { DEFECTIVE, LEXICON } from './lexicon.js';

describe('lexicon', () => {
  it('holds at least 600 verbs', () => {
    expect(LEXICON_INFINITIVES.length).toBeGreaterThanOrEqual(600);
  });

  it('has a known base for every compound and every pronominal verb', () => {
    for (const [inf, entry] of LEXICON) {
      if (entry.base) {
        expect(LEXICON.has(entry.base), `${inf} → ${entry.base}`).toBe(true);
        if (!entry.swapH) expect(entry.prefix + entry.base).toBe(inf);
      }
    }
    for (const inf of REFLEXIVE_VERBS) {
      expect(inf.endsWith('se'), inf).toBe(true);
      expect(isKnownVerb(inf), inf).toBe(true);
      expect(verbInfo(inf).reflexive).toBe(true);
    }
  });

  it('includes the verbs a Spanish 1-4 course uses', () => {
    const course = `
      hablar comer vivir ser estar ir tener hacer decir poner venir querer poder saber dar ver oír caer traer
      leer construir conducir traducir pedir servir repetir seguir sentir preferir divertir dormir morir jugar
      pensar cerrar empezar comenzar entender perder volver contar encontrar recordar almorzar costar mostrar
      buscar llegar pagar practicar tocar sacar cruzar coger escoger recoger proteger dirigir elegir corregir
      conocer parecer ofrecer nacer crecer producir averiguar enviar continuar esquiar reír sonreír freír
      abrir escribir describir descubrir cubrir romper resolver devolver envolver imprimir obtener mantener
      contener detener componer suponer proponer deshacer satisfacer prevenir convenir predecir bendecir
      maldecir atraer distraer caber haber andar valer salir oler errar adquirir incluir destruir huir
      contribuir distribuir mover llover nevar despertar sentar acostar probar vestir medir despedir reunir
      prohibir graduar actuar criar confiar ayudar necesitar estudiar trabajar escuchar mirar bailar cantar
      nadar caminar cocinar comprar limpiar lavar llevar llamar tomar usar viajar visitar ganar gastar
      aprender beber comprender correr creer deber vender responder asistir compartir decidir recibir subir
      abrir sufrir permitir existir gustar encantar interesar importar doler faltar molestar fascinar
    `
      .trim()
      .split(/\s+/);
    for (const verb of course) expect(isKnownVerb(verb), verb).toBe(true);
  });

  it('conjugates every verb in every tense and person (sanity sweep)', () => {
    let forms = 0;
    for (const verb of lexiconInfinitives()) {
      for (const t of TENSES) {
        for (const person of t.persons) {
          const cell = conjugate(verb, t.id, person);
          const missing = DEFECTIVE[verb];
          if (missing && (missing.tenses?.includes(t.id) || (missing.persons && !missing.persons.includes(person)))) {
            expect(cell, `${verb} ${t.id} ${person} is defective`).toBeNull();
            continue;
          }
          // Weather verbs are impersonal: third person singular only, no commands.
          if (entryKind(verb) === 'impersonal' && (person !== 'el' || t.id.startsWith('imperative'))) {
            expect(cell, `${verb} ${t.id} ${person} is impersonal`).toBeNull();
            continue;
          }
          expect(cell, `${verb} ${t.id} ${person}`).not.toBeNull();
          expect(cell!.length, `${verb} ${t.id} ${person}`).toBeGreaterThan(0);
          expect(new Set(cell).size, `${verb} ${t.id} ${person} duplicates`).toBe(cell!.length);
          for (const form of cell!) {
            forms++;
            expect(typeof form).toBe('string');
            expect(form, `${verb} ${t.id} ${person}`).toMatch(/^[a-zñáéíóúü]+( [a-zñáéíóúü]+)*$/);
            for (const word of form.split(' ')) {
              expect((word.match(/[áéíóú]/g) ?? []).length, `${verb}: ${form}`).toBeLessThanOrEqual(1);
              // Spelling: z never before e/i, qu only before e/i, no "gu" + a/o where the u is silent.
              expect(word, `${verb}: ${form}`).not.toMatch(/z[eéií]|qu[aáoóu]|q[^u]/);
            }
          }
        }
      }
    }
    expect(forms).toBeGreaterThan(60000);
    for (const verb of WEATHER_VERBS) expect(entryKind(verb), verb).toBe('impersonal');
  }, 60_000); // full sweep: seconds of CPU, and more on a loaded CI runner
});

describe('weather verbs, usage audit regressions', () => {
  it('knows every weather verb, so their forms can be analyzed', () => {
    for (const verb of WEATHER_VERBS) {
      expect(isKnownVerb(verb), verb).toBe(true);
      expect(entryKind(verb), verb).toBe('impersonal');
    }
    expect(conjugate('garuar', 'present', 'el')).toEqual(['garúa']);
    expect(conjugate('relampaguear', 'preterite', 'el')).toEqual(['relampagueó']);
  });
});
