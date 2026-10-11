// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The loaded extensions, as core reads them: ext(). A plain holder, with no
 * top-level await. It starts empty; loadExtensions() (load.ts) fills it at
 * server boot, and an extension's own tests fill it with setExtensions().
 *
 * The types are the selected extensions' (@libresrs/server-extensions:
 * enabled.ts when it exists, else none.ts), so a response that spreads an
 * extension's fields is typed with them. Only types come from there: at run
 * time this module imports nothing but none.ts.
 */
import type * as Selected from '@libresrs/server-extensions';
import { extensions as none } from './none.js';
import type { Extensions } from './api.js';

type F = Selected.Fields;
type R = Selected.Routers;
export type ExtensionRouters = R;

/** Extension fields as core responses declare them: optional, so every reader handles their absence. */
export interface ExtensionFields {
  review: Partial<F['review']>;
  studyFinish: Partial<F['studyFinish']>;
  answer: Partial<F['answer']>;
  answerGraded: Partial<F['answerGraded']>;
  roundSummary: Partial<F['roundSummary']>;
  studyAllOverview: Partial<F['studyAllOverview']>;
  userDetailUser: Partial<F['userDetail']['user']>;
  userDetail: Partial<F['userDetail']['detail']>;
}

/** The types are the selected extensions'; the values are empty. */
const empty = none as unknown as Extensions<F, R>;
let current: Extensions<F, R> = empty;

/** The loaded extensions: empty until loadExtensions() (server boot) or setExtensions() (an extension's test). */
export const ext = (): Extensions<F, R> => current;

export function setExtensions(next: Extensions<F, R>): void {
  current = next;
}

export function resetExtensions(): void {
  current = empty;
}
