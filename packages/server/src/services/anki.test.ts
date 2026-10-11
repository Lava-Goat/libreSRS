// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { parseAnkiNotes, ANKI_IMPORT_LIMITATION_WARNING } from './anki';

describe('parseAnkiNotes', () => {
  it('parses first two fields as front/back', () => {
    const result = parseAnkiNotes([
      { id: 1, flds: 'Front field\u001fBack field' },
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.cards).toEqual([{ front: 'Front field', back: 'Back field' }]);
    expect(result.warnings).toContain(ANKI_IMPORT_LIMITATION_WARNING);
  });

  it('strips unsupported Anki features and warns', () => {
    const result = parseAnkiNotes([
      {
        id: 2,
        flds: '<img src="cat.png">Front\u001f[sound:clip.mp3]{{c1::Back}}\u001fextra-field',
      },
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.front).toBe('Front');
    expect(result.cards[0]?.back).toBe('Back');
    expect(result.warnings.some((warning) => warning.includes('extra note fields'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('unsupported Anki markup'))).toBe(true);
  });

  it('skips notes missing front/back fields', () => {
    const result = parseAnkiNotes([
      { id: 3, flds: 'Only front field' },
    ]);

    expect(result.cards).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Missing front/back fields at indices');
  });
});

