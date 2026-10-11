// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The student's tests (v1.21.0): their own tab, apart from labs and speaking, one
 * set per exam set name: its listening forms (exam labs) and its speaking
 * tests. Pure, so the Tests page and the front page's Tests notice group and
 * count them the same way, and the teacher's "Exam set" fields offer the same
 * names.
 */

/** An exam lab as labs.list({ exams: true }) gives it: `exam` only on a test. */
interface ExamLabLike {
  id: number;
  title: string;
  exam?: { set: string; preview: boolean; start: unknown } | null;
}

/** A speaking task as speaking.list gives it: `examSet` only on a test (none on a list cached before v1.21.0). */
interface SpeakingLike {
  id: number;
  title: string;
  examSet?: string | null;
  submittedAt: unknown;
}

/** Natural order of set names (U2, U3 … U10), whatever the case. */
const bySetName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export interface TestSet<L, S> {
  /** The set's name, as the first item met spells it (a lab's first). */
  name: string;
  /** Its listening forms, in the server's order (by title). */
  labs: L[];
  /** Its speaking tests, in the server's order (by title). */
  speaking: S[];
}

/**
 * The test items by exam set. Practice labs and tasks are left out. Names
 * match whatever their case (the server stores one spelling, but a list
 * cached across a rename may not), and the sets come in natural order
 * (U2, U3 … U10), as Admin › Labs › Tests lists them.
 */
export function testSets<L extends ExamLabLike, S extends SpeakingLike>(
  labs: readonly L[] | undefined,
  tasks: readonly S[] | undefined,
): TestSet<L, S>[] {
  const sets = new Map<string, TestSet<L, S>>();
  const setFor = (name: string) => {
    const key = name.toLowerCase();
    let set = sets.get(key);
    if (!set) {
      set = { name, labs: [], speaking: [] };
      sets.set(key, set);
    }
    return set;
  };
  for (const lab of labs ?? []) {
    if (lab.exam) setFor(lab.exam.set).labs.push(lab);
  }
  for (const task of tasks ?? []) {
    if (task.examSet) setFor(task.examSet).speaking.push(task);
  }
  return [...sets.values()].sort((a, b) => bySetName(a.name, b.name));
}

/**
 * Every exam set name in use, for the teacher's "Exam set" suggestions: in
 * Admin › Speaking the labs' sets too (a speaking test joins its listening
 * forms' set), in Admin › Labs the speaking tests' too. Each name once
 * whatever its case, in the spelling met first (so pass the labs' names
 * first, as the server keeps a lab's spelling), in natural order.
 */
export function examSetNames(...lists: readonly (readonly (string | null | undefined)[] | undefined)[]): string[] {
  const names = new Map<string, string>();
  for (const name of lists.flatMap((list) => list ?? [])) {
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort(bySetName);
}

/**
 * Tests left to take: one per set whose listening part is not started (one
 * start covers every form; the teacher's preview has none, so it counts, as
 * in v1.19.0), plus each speaking test not turned in.
 */
export function testsToDo(sets: readonly TestSet<ExamLabLike, SpeakingLike>[]): number {
  let toDo = 0;
  for (const set of sets) {
    if (set.labs.length > 0 && set.labs[0].exam?.start === null) toDo += 1;
    toDo += set.speaking.filter((task) => !task.submittedAt).length;
  }
  return toDo;
}
