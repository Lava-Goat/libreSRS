// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useI18n } from '../../i18n';
import { TablePager, TableSearch } from '../admin/TablePager';
import { PAGE_SIZES, textMatches, useTableView } from '../admin/useTableView';

/** Where this device remembers the Google Classroom and Clever previews' page sizes. */
export const CLASSROOM_IMPORT_STORAGE_KEY = 'libresrs.admin.classroomImport';
export const CLEVER_IMPORT_STORAGE_KEY = 'libresrs.admin.cleverImport';

export interface ImportStudent {
  email: string;
  fullName: string;
}

/** A roster this long or shorter fits on the smallest page: no search box and no pager. */
const SHORT_ROSTER = PAGE_SIZES[0];

const studentMatches = (student: ImportStudent, needle: string) => textMatches(needle, student.fullName, student.email);

/**
 * The students of a Google Classroom course or a Clever section, all ticked
 * at first, to untick the ones not to import. A long roster gets a search and
 * ten at a time (it sits in the narrow column, above the Import button); the
 * ticks outlast both, and the button says how many it ticks ("Select all 32",
 * or "Select all 5 matching" while a search is typed), never only the page on
 * screen.
 */
export default function ImportStudentPicker({
  idPrefix,
  storageKey,
  students,
  selected,
  onSelectedChange,
}: {
  /** Makes the ids unique on the page ("classroom", "clever"). */
  idPrefix: string;
  storageKey: string;
  students: ImportStudent[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const { t } = useI18n();
  const titleId = `${idPrefix}-import-title`;
  // The roster keeps the provider's order (by name): no sort.
  const view = useTableView<ImportStudent>({ storageKey, defaultPageSize: 10, rows: students, matches: studentMatches });
  const long = students.length > SHORT_ROSTER;
  const searching = view.search.trim() !== '';
  const allMatchingSelected = view.matched > 0 && view.matchedRows.every((student) => selected.has(student.email));

  const toggle = (email: string) => {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email); else next.add(email);
    onSelectedChange(next);
  };
  const setMatching = (on: boolean) => {
    const next = new Set(selected);
    for (const student of view.matchedRows) {
      if (on) next.add(student.email); else next.delete(student.email);
    }
    onSelectedChange(next);
  };

  return (
    <>
      {long && (
        <TableSearch
          id={`${idPrefix}-import-search`}
          label={t('Search students to import')}
          placeholder={t('Name or email')}
          value={view.search}
          onChange={view.setSearch}
          className="w-full"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400" aria-live="polite">
          <span id={titleId}>{t('Students to import')}</span> ({t('{{count}} of {{total}} selected', { count: selected.size, total: students.length })})
        </p>
        {view.matched > 0 && (
          <button
            type="button"
            onClick={() => setMatching(!allMatchingSelected)}
            className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
          >
            {allMatchingSelected
              ? (searching ? t('Deselect all {{count}} matching', { count: view.matched }) : t('Deselect all {{count}}', { count: view.matched }))
              : (searching ? t('Select all {{count}} matching', { count: view.matched }) : t('Select all {{count}}', { count: view.matched }))}
          </button>
        )}
      </div>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {view.matched === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{t('No students match')}</p>
          )}
          {view.rows.map((student) => (
            <label key={student.email} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(student.email)}
                onChange={() => toggle(student.email)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 truncate">{student.fullName}</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{student.email}</span>
            </label>
          ))}
        </div>
        {long && (
          <TablePager view={view} emptyText={t('No students match')} announce labelledBy={titleId} className="border-t border-gray-200 dark:border-gray-700" />
        )}
      </div>
    </>
  );
}
