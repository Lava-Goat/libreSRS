// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// The on-screen special-character row: caret-aware insertion and a keyboard-operable row of
// chips. Mirrors tests/m6 of the standalone build in tools/vocabulometro-offline.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CharKeys, { CHAR_KEYS, insertCharAt, insertIntoInput, restoreCaret } from './CharKeys';

describe('insertCharAt splices at the caret', () => {
  it('inserts in the middle, and reports the caret after the inserted character', () => {
    expect(insertCharAt('maana', 2, 2, 'ñ')).toEqual({ value: 'mañana', caret: 3 });
  });

  it('replaces the selected range', () => {
    // 'manzana' with 'nz' selected becomes 'mañana'
    expect(insertCharAt('manzana', 2, 4, 'ñ')).toEqual({ value: 'mañana', caret: 3 });
  });

  it('handles the empty box and both edges', () => {
    expect(insertCharAt('', 0, 0, 'ñ')).toEqual({ value: 'ñ', caret: 1 });
    expect(insertCharAt('gua', 0, 0, 'a')).toEqual({ value: 'agua', caret: 1 });
    expect(insertCharAt('man', 3, 3, 'í')).toEqual({ value: 'maní', caret: 4 });
  });

  it('degrades to appending on a missing or nonsensical caret instead of throwing', () => {
    // some IMEs and non-text inputs report null; a stale range can also be out of bounds
    expect(insertCharAt('man', null, null, 'ú')).toEqual({ value: 'manú', caret: 4 });
    expect(insertCharAt('man', undefined, undefined, 'ú')).toEqual({ value: 'manú', caret: 4 });
    expect(insertCharAt('man', 99, 99, 'ú')).toEqual({ value: 'manú', caret: 4 });
    expect(insertCharAt('man', -1, -1, 'ú')).toEqual({ value: 'manú', caret: 4 });
    expect(insertCharAt('man', 2, 1, 'ú')).toEqual({ value: 'maún', caret: 3 }); // end < start ⇒ no deletion
  });
});

describe('insertIntoInput and restoreCaret talk to a live element', () => {
  it('reads the caret off the element', () => {
    const el = document.createElement('input');
    el.value = 'maana';
    document.body.appendChild(el);
    el.setSelectionRange(2, 2);
    expect(insertIntoInput(el, el.value, 'ñ')).toEqual({ value: 'mañana', caret: 3 });
    el.remove();
  });

  it('appends when there is no element at all', () => {
    expect(insertIntoInput(null, 'man', 'ú')).toEqual({ value: 'manú', caret: 4 });
  });

  it('restoreCaret focuses the input and parks the caret', () => {
    const el = document.createElement('input');
    el.value = 'mañana';
    document.body.appendChild(el);
    restoreCaret(el, 3);
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(3);
    expect(el.selectionEnd).toBe(3);
    el.remove();
  });
});

describe('the CharKeys row', () => {
  it('renders the seven characters a US layout cannot type, each labelled', () => {
    render(<CharKeys onInsert={() => {}} />);
    expect(CHAR_KEYS).toEqual(['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ']);
    for (const c of CHAR_KEYS) {
      const b = screen.getByRole('button', { name: `insertar ${c}` });
      expect(b).toHaveTextContent(c);
      // never a submit button, and a real <button> so Enter/Space activate it natively
      expect(b).toHaveAttribute('type', 'button');
    }
    expect(screen.getByRole('group', { name: 'Caracteres especiales' })).toBeInTheDocument();
  });

  it('reports the clicked character', () => {
    const onInsert = vi.fn();
    render(<CharKeys onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'insertar ñ' }));
    expect(onInsert).toHaveBeenCalledWith('ñ');
  });

  it('cancels mousedown so the target input keeps focus and caret', () => {
    render(<CharKeys onInsert={() => {}} />);
    // fireEvent returns false when the event was canceled by preventDefault
    const notCanceled = fireEvent.mouseDown(screen.getByRole('button', { name: 'insertar ñ' }));
    expect(notCanceled).toBe(false);
  });

  it('disables every key when the surface is not answerable yet', () => {
    render(<CharKeys onInsert={() => {}} disabled />);
    for (const c of CHAR_KEYS) expect(screen.getByRole('button', { name: `insertar ${c}` })).toBeDisabled();
  });

  it('takes the sticky variant for the long C-test form', () => {
    const { container } = render(<CharKeys onInsert={() => {}} sticky />);
    expect(container.querySelector('.vocab-charkeys.sticky')).not.toBeNull();
  });
});
