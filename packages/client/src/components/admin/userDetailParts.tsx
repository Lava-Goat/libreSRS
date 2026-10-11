// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The pieces of the user page (UserDetail.tsx) that anything adding to it
 * uses too: its card, chip colours, a section with a heading, and a fact
 * (a label over its value, inside a <dl>).
 */
import type { ReactNode } from 'react';

export const card = 'bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20';
export const amber = 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300';
export const gray = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
export const chip = 'inline-block px-2 py-0.5 rounded-full text-xs font-medium';

/** One section of the user page: a card headed by its title (the section is labelled by it). */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={card}>
      <h3 id={id} className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A label over its value, in a <dl>. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}
