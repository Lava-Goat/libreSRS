// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Person, Tense } from '@libresrs/shared/conjugation';
import Paradigm, { shadeForm, tablePersons } from './Paradigm';

/** A form as "plain|ending" pieces: [ending], {changed}, <irregular>. */
function marked(form: string, entry: string, tense: Tense, person: Person): string {
  return shadeForm(form, entry, tense, person).map((p) => (
    p.shade === 'ending' ? `[${p.text}]` : p.shade === 'changed' ? `{${p.text}}` : p.shade === 'irregular' ? `<${p.text}>` : p.text
  )).join('');
}

describe('shadeForm', () => {
  it('shades the ending of a regular form', () => {
    expect(marked('hablo', 'hablar', 'present', 'yo')).toBe('habl[o]');
    expect(marked('vivimos', 'vivir', 'present', 'nosotros')).toBe('viv[imos]');
    expect(marked('hablé', 'hablar', 'preterite', 'yo')).toBe('habl[é]');
    expect(marked('comíamos', 'comer', 'imperfect', 'nosotros')).toBe('com[íamos]');
    expect(marked('hablará', 'hablar', 'future', 'el')).toBe('hablar[á]');
    expect(marked('hablara', 'hablar', 'imperfectSubjunctive', 'yo')).toBe('habl[ara]');
    expect(marked('hablás', 'hablar', 'present', 'vos')).toBe('habl[ás]');
  });

  it('marks a changed stem or spelling, and a form that follows no pattern', () => {
    expect(marked('quiero', 'querer', 'present', 'yo')).toBe('{quier}[o]');
    expect(marked('busqué', 'buscar', 'preterite', 'yo')).toBe('{busqu}[é]');
    expect(marked('tendré', 'tener', 'future', 'yo')).toBe('{tendr}[é]');
    expect(marked('soy', 'ser', 'present', 'yo')).toBe('<soy>');
    expect(marked('estás', 'estar', 'present', 'tu')).toBe('<estás>');
    expect(marked('hay', 'haber-impersonal', 'present', 'el')).toBe('<hay>');
  });

  it('leaves pronouns and "no" alone, and shades the helping verb of a compound tense', () => {
    expect(marked('me llamo', 'llamarse', 'present', 'yo')).toBe('me llam[o]');
    expect(marked('no hables', 'hablar', 'imperativeNegative', 'tu')).toBe('no habl[es]');
    expect(marked('me gustan', 'gustarle', 'present', 'ellos')).toBe('me gust[an]');
    expect(marked('he hablado', 'hablar', 'presentPerfect', 'yo')).toBe('[he] hablado');
    expect(marked('he hecho', 'hacer', 'presentPerfect', 'yo')).toBe('[he] <hecho>');
    expect(marked('estoy leyendo', 'leer', 'presentProgressive', 'yo')).toBe('[estoy] leyendo');
  });

  it('reads pronouns attached to commands and -ndo forms, and the patterns those sections teach', () => {
    expect(marked('levántate', 'levantarse', 'imperativeAffirmative', 'tu')).toBe('levánt[a]te');
    expect(marked('levantémonos', 'levantarse', 'imperativeAffirmative', 'nosotros')).toBe('levant[émo]nos');
    expect(marked('siéntese', 'sentarse', 'imperativeAffirmative', 'el')).toBe('{siént}[e]se');
    expect(marked('estoy levantándome', 'levantarse', 'presentProgressive', 'yo')).toBe('[estoy] levantándome');
    // Taught as patterns (a stem change, a spelling change), not as forms to learn by heart.
    expect(marked('estoy durmiendo', 'dormir', 'presentProgressive', 'yo')).toBe('[estoy] {durm}iendo');
    expect(marked('leyó', 'leer', 'preterite', 'el')).toBe('le[yó]');
    expect(marked('gruñó', 'gruñir', 'preterite', 'el')).toBe('gruñ[ó]');
    expect(marked('estoy yendo', 'ir', 'presentProgressive', 'yo')).toBe('[estoy] <yendo>');
    expect(marked('tuve', 'tener', 'preterite', 'yo')).toBe('<tuve>');
  });
});

describe('Paradigm', () => {
  it('has a row for each person the deck drills: vos and vosotros only when it drills them, no yo in commands', () => {
    expect(tablePersons({ includeVosotros: false, vos: null }, 'present')).toEqual(['yo', 'tu', 'el', 'nosotros', 'ellos']);
    expect(tablePersons({ includeVosotros: true, vos: 'rioplatense' }, 'present')).toEqual(['yo', 'tu', 'vos', 'el', 'nosotros', 'vosotros', 'ellos']);
    expect(tablePersons({ includeVosotros: false, vos: null }, 'imperativeAffirmative')).toEqual(['tu', 'el', 'nosotros', 'ellos']);
  });

  it('draws the engine’s forms, with the quiz’s person labels', () => {
    render(<Paradigm entries={['hablar', 'tener']} tense="present" ctx={{ includeVosotros: false, vos: null }} lang="en" tenseLabel="presente" />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'tener' })).toBeInTheDocument();
    const row = within(table).getByRole('row', { name: /él \/ ella \/ usted/ });
    expect(row).toHaveTextContent('habla');
    expect(row).toHaveTextContent('tiene');
    expect(screen.getByText(/changed stem or spelling/)).toBeInTheDocument();
  });

  it('draws a gustar-type verb by the one thing or the many things liked, with its "a mí" rows', () => {
    render(<Paradigm entries={['gustarle']} tense="present" ctx={{ includeVosotros: false, vos: null }} lang="en" tenseLabel="presente" />);
    const row = screen.getByRole('row', { name: /a mí/ });
    expect(row).toHaveTextContent('me gusta · me gustan');
  });

  it('draws the region’s vos forms', () => {
    render(<Paradigm entries={['hablar']} tense="presentSubjunctive" ctx={{ includeVosotros: false, vos: 'centroamericano' }} lang="en" tenseLabel="presente de subjuntivo" />);
    expect(screen.getByRole('row', { name: /^vos/ })).toHaveTextContent('hablés');
  });
});
