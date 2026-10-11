// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// On-screen special-character row for every typed student surface of the Vocabulómetro.
// Many students sit at US keyboards. norm() forgives the accents, but it PRESERVES ñ — "manana"
// is not a correct production of "mañana" in Activo 500, dictado or the C-test — so without a way
// to enter these characters the stricter tiers are unreachable by keyboard alone.
//
// The keys are plain <button type="button"> chips: tabbable, activated by Enter/Space natively,
// and they only edit the target input. They never touch answer logic, the 250ms lockout, or the
// document keydown shortcuts (which are inert on every surface that shows this row).

/** The seven characters a US layout cannot produce. */
export const CHAR_KEYS = ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'] as const;

export interface Insertion { value: string; caret: number }

/**
 * Splices `ch` into `value` over `[start, end)`, returning the new value and the caret position
 * immediately after the inserted character. A missing or nonsensical range (some IMEs and
 * non-text inputs report `null`) degrades to appending rather than throwing.
 */
export function insertCharAt(value: string, start: unknown, end: unknown, ch: string): Insertion {
  const v = value ?? '';
  const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= v.length;
  let a = inRange(start) ? start : v.length;
  let b = inRange(end) ? end : a;
  if (b < a) b = a;
  return { value: v.slice(0, a) + ch + v.slice(b), caret: a + ch.length };
}

/** Same, reading the live caret off a (possibly absent) input element. */
export function insertIntoInput(el: HTMLInputElement | null | undefined, value: string, ch: string): Insertion {
  return insertCharAt(value, el?.selectionStart, el?.selectionEnd, ch);
}

/**
 * Restores focus and puts the caret back after a controlled re-render. Call from a layout effect
 * keyed on the value, so the DOM already carries the spliced text.
 */
export function restoreCaret(el: HTMLInputElement | null | undefined, caret: number): void {
  if (!el) return;
  el.focus();
  el.setSelectionRange?.(caret, caret);
}

export default function CharKeys({ onInsert, disabled = false, sticky = false }: {
  onInsert: (ch: string) => void;
  disabled?: boolean;
  /** C-test only: the row follows the student down a long passage. */
  sticky?: boolean;
}) {
  return (
    <div className={sticky ? 'vocab-charkeys sticky' : 'vocab-charkeys'} role="group" aria-label="Caracteres especiales">
      {CHAR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          className="ck"
          aria-label={`insertar ${c}`}
          disabled={disabled}
          // The default mousedown action moves focus to the button, which drops the caret in the
          // input before click fires. Preventing it keeps both; click still fires normally.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
