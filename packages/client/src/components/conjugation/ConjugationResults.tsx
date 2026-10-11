// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Admin: the scores of one deck's conjugation quiz — per student, and the
 * items students miss most. Teachers' rounds ("Try it") are listed last and
 * marked (the viewer's own as "your test run"), and never count toward
 * "Most missed" or "Common mistakes".
 *
 * Next to the round scores, the numbers that predict a test (research report
 * improvement 7): days practised, accuracy on forms not seen for a week, and
 * the median time to answer. Round scores and mastery reward cramming; these
 * do not (Lindsey et al. 2014).
 *
 * Since v1.16 a time is the page's, never more than the time the server saw
 * pass between answers, and answers whose page time was longer are counted in
 * red; Rounds are rounds played to their end.
 *
 * Since v1.18.0 a "Study all" round mixes every quiz of the student's: its
 * answers count under each form's deck (mastery, days, accuracy, times,
 * mistakes), and under Rounds it is counted apart, never in a deck's scores.
 */
import { Fragment } from 'react';
import { trpc } from '../../api/trpc';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import { mistakeLabel } from './mistakeText';

const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';
const hint = 'text-xs text-gray-500 dark:text-gray-400';

/** A round's score (0..1) as a whole percentage; a dash when there is none. */
/** The answers a Most missed row's split by subject covers: those since v1.24.0, which recorded the subject. */
const subjectTagged = (m: { bySubject?: { attempts: number }[] }) => (m.bySubject ?? []).reduce((n, x) => n + x.attempts, 0);

type T = (key: string, params?: Record<string, string | number>) => string;

/** A kind of subject a "give the form" question showed (v1.25.0), for the person-mistakes split. */
function subjectTypeLabel(type: string, t: T): string {
  switch (type) {
    case 'label': return t('Person label');
    case 'pronoun': return t('Pronoun (yo, ellas…)');
    case 'usted': return t('usted');
    case 'ustedes': return t('ustedes (or someone and tú)');
    case 'name': return t('A name (Ana)');
    case 'np_sg': return t('One person or thing (mi abuela)');
    case 'np_pl': return t('More than one (mis primos)');
    case 'coord_yo': return t('Someone and yo (mi hermano y yo)');
    case 'coord': return t('Two joined by y (Ana y Luis)');
    case 'experiencer': return t('gustar: a + person');
    case 'thing': return t('A thing');
    default: return t('No subject (hay)');
  }
}

const percent = (score: number | null | undefined) => (score === null || score === undefined ? '—' : `${Math.round(score * 100)}%`);

/** Milliseconds as seconds with one decimal, in the page's language ("4.2", "4,2"). */
function seconds(ms: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);
}

/**
 * Under a student's median time: a red count of answers whose time the page
 * could not have measured (it said more time than passed between answers,
 * which only an edited request does), and an amber "Very fast". Both are for
 * the teacher to look at; neither changes a score.
 */
function TimeNotes({ mismatches, veryFast }: { mismatches: number; veryFast: boolean }) {
  const { t } = useI18n();
  if (mismatches === 0 && !veryFast) return null;
  return (
    <div className="mt-1 space-y-1 whitespace-normal max-w-xs">
      {mismatches > 0 && (
        <div className="text-xs font-medium text-red-700 dark:text-red-400">
          {mismatches === 1
            ? t('1 answer time didn’t match the time that passed')
            : t('{{count}} answer times didn’t match the time that passed', { count: mismatches })}
        </div>
      )}
      {veryFast && (
        <span className="inline-block rounded px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">
          {t('Very fast')}
        </span>
      )}
    </div>
  );
}

export default function ConjugationResults({ deckId }: { deckId: number }) {
  const { t, formatDate, locale } = useI18n();
  const { user } = useAuth();
  const { data, isLoading, error } = trpc.conjugation.results.useQuery({ deckId });

  if (error) return <div role="alert" className={alertBox}>{error.message}</div>;
  if (!data) {
    return isLoading ? <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div> : null;
  }

  return (
    <div className="space-y-6">
      {!data.enabled && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{t('The quiz is off: students cannot play it right now.')}</p>
      )}
      {/* v1.25.0: a change of format shows up as a short dip in delayed accuracy, not forgetting. */}
      {data.sentences && data.sentences !== 'off' && data.sentencesSince && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('Sentences on since {{date}}. Expect a short dip in delayed accuracy after that: the questions look new, the forms are not.', { date: formatDate(data.sentencesSince) })}
        </p>
      )}

      <div>
        <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('Students')}</h4>
        {data.students.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('No students have this deck yet. Assign it to a group to see their scores here.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-gray-400">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Student')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Rounds')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Last score')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Best score')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Quiz mastery')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Days practised')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Delayed accuracy')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Median time')}</th>
                  <th scope="col" className="py-2 font-medium">{t('Last played')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.students.map((s) => {
                  // The server marks every admin; only the viewer's own row is "yours".
                  const mine = s.isTeacher && user?.id === s.userId;
                  return (
                    <tr key={s.userId} className={s.isTeacher ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'}>
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <div className={s.isTeacher ? '' : 'text-gray-900 dark:text-gray-100'}>{s.name}</div>
                        {mine
                          ? <span className="text-xs italic">{t('your test run')}</span>
                          : (
                            <>
                              {s.isTeacher && <div className="text-xs italic">{t('teacher')}</div>}
                              <div className={hint}>{s.email}</div>
                            </>
                          )}
                      </th>
                      <td className="py-2 pr-3 tabular-nums">
                        <div>{s.rounds}</div>
                        {(s.studyAllRounds ?? 0) > 0 && <div className={hint}>{t('+{{n}} in Study all', { n: s.studyAllRounds })}</div>}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{percent(s.lastScore)}</td>
                      <td className="py-2 pr-3 tabular-nums">{percent(s.bestScore)}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        <div>{s.mastered} / {s.total}</div>
                        {s.due > 0 && <div className={hint}>{t('{{count}} due', { count: s.due })}</div>}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        <div>{s.daysPractised14 ?? 0}</div>
                        <div className={hint}>{t('{{n}} in all', { n: s.daysPractised ?? 0 })}</div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        <div>{percent(s.delayedAccuracy)}</div>
                        {(s.delayedAnswers ?? 0) > 0 && <div className={hint}>{t('of {{n}} answers', { n: s.delayedAnswers })}</div>}
                      </td>
                      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                        {s.medianTypedMs == null && s.medianChoiceMs == null ? '—' : (
                          <>
                            {s.medianTypedMs != null && <div>{t('{{s}} s typed', { s: seconds(s.medianTypedMs, locale) })}</div>}
                            {s.medianChoiceMs != null && <div className={s.medianTypedMs != null ? hint : undefined}>{t('{{s}} s choice', { s: seconds(s.medianChoiceMs, locale) })}</div>}
                          </>
                        )}
                        <TimeNotes mismatches={s.timeMismatches ?? 0} veryFast={s.veryFast ?? false} />
                      </td>
                      <td className="py-2">
                        {s.lastPlayed ? formatDate(s.lastPlayed) : <span className="text-gray-400">{t('not played')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ul className={`${hint} mt-2 space-y-0.5`}>
          <li>{t('Rounds: rounds played to the end. A round’s score is the share of its questions answered right the first time.')}</li>
          {data.students.some((s) => (s.studyAllRounds ?? 0) > 0) && (
            <li>{t('In Study all: rounds mixing all of the student’s quizzes that asked forms of this deck. Their answers count in the other columns; their scores are not this deck’s.')}</li>
          )}
          <li>{t('Quiz mastery: forms the student can produce in the quiz, each right at the top on two different days. Mastered forms come due for review, so this number can go down.')}</li>
          <li>{t('Days practised: school days with a round played to the end, in any conjugation quiz: the last 14 days, and in all.')}</li>
          <li>{t('Delayed accuracy: answers right on forms the student had not seen for a week or more. It predicts a test better than round scores.')}</li>
          <li>{t('Median time: seconds to answer on a first try, typed and multiple choice, never more than the time that passed between answers. Students never see a clock.')}</li>
          {data.students.some((s) => (s.timeMismatches ?? 0) > 0) && (
            <li>{t('Answer times that didn’t match: the page said an answer took longer than the time that passed, which only an edited request can do.')}</li>
          )}
          {data.veryFastLine && data.students.some((s) => s.veryFast) && (
            <li>
              {t('Very fast: a median under {{typed}} s typed or {{choice}} s multiple choice, over {{tries}} or more first tries.', {
                typed: seconds(data.veryFastLine.typedMs, locale),
                choice: seconds(data.veryFastLine.choiceMs, locale),
                tries: data.veryFastLine.minTries,
              })}
            </li>
          )}
        </ul>
      </div>

      <div>
        <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('Common mistakes')}</h4>
        {(data.topMistakes ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('No named mistakes yet.')}</p>
        ) : (
          <ol aria-label={t('Common mistakes')} className="space-y-1 text-sm">
            {(data.topMistakes ?? []).map((m) => (
              <li key={m.key} className="flex flex-wrap items-baseline gap-x-2 text-gray-800 dark:text-gray-200">
                <span className="font-medium text-gray-900 dark:text-gray-100">{mistakeLabel(m, t)}</span>
                {m.example && (
                  <span className={hint}>
                    {t('e.g.')}{' '}
                    <span lang="es" className="text-gray-700 dark:text-gray-300">{m.example.given}</span>
                    {' → '}
                    <span lang="es" className="text-gray-700 dark:text-gray-300">{m.example.expected}</span>
                    {' ('}<span lang="es">{m.example.prompt}</span>{')'}
                  </span>
                )}
                <span className="ml-auto tabular-nums text-red-700 dark:text-red-400">{t('{{count}}×', { count: m.count })}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {(data.personBySubject ?? []).length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('Person mistakes by subject')}</h4>
          <table className="text-sm">
            <thead className="text-left text-gray-500 dark:text-gray-400">
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">{t('The question showed')}</th>
                <th scope="col" className="py-1 pr-4 font-medium">{t('Answers')}</th>
                <th scope="col" className="py-1 font-medium">{t('Another person’s form')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-800 dark:text-gray-200">
              {(data.personBySubject ?? []).map((row) => (
                <tr key={row.type}>
                  <th scope="row" className="py-1 pr-4 text-left font-normal">{subjectTypeLabel(row.type, t)}</th>
                  <td className="py-1 pr-4 tabular-nums">{row.answers}</td>
                  <td className="py-1 tabular-nums">
                    {row.personMistakes} <span className={hint}>({percent(row.answers > 0 ? row.personMistakes / row.answers : null)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`${hint} mt-1`}>{t('“Give the form” answers in this deck, by the kind of subject the question showed, and how many gave another person’s form.')}</p>
        </div>
      )}

      <div>
        <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{t('Most missed')}</h4>
        {data.mostMissed.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('No misses yet.')}</p>
        ) : (
          <ol aria-label={t('Most missed')} className="space-y-1 text-sm">
            {data.mostMissed.map((m) => (
              <li key={m.itemKey} className="flex flex-wrap items-baseline gap-x-2 text-gray-800 dark:text-gray-200">
                <span lang="es" className="font-medium text-gray-900 dark:text-gray-100">{m.form || '—'}</span>
                <span lang="es" className="text-gray-600 dark:text-gray-400">
                  {[m.entryLabel, m.personLabel, m.tenseLabel].filter(Boolean).join(' · ')}
                </span>
                <span className={hint}>
                  {m.direction === 'toForm' ? t('infinitive → form') : t('form → verb')}
                </span>
                <span className="ml-auto tabular-nums text-red-700 dark:text-red-400">
                  {t('missed {{misses}} of {{attempts}}', { misses: m.misses, attempts: m.attempts })}
                </span>
                {/* v1.24.0: the prompt names one subject at a time; is one of them the weak one (ustedes)? */}
                {/* v1.25.0: the sentences it was missed in, filled in. */}
                {(m.bySentence ?? []).map((x) => (
                  <span key={x.ref} className={`basis-full pl-4 ${hint}`}>
                    {x.sentence ? <span lang="es" className="text-gray-700 dark:text-gray-300">{x.sentence}</span> : t('a sentence no longer in the deck')}
                    {' '}{t('missed {{misses}} of {{attempts}}', { misses: x.misses, attempts: x.attempts })}
                  </span>
                ))}
                {(m.bySubject ?? []).length > 0 && (
                  <span className={`basis-full pl-4 ${hint}`}>
                    {/* Answers from before v1.24.0 recorded no subject: say the split covers fewer than the headline. */}
                    {subjectTagged(m) < m.attempts
                      ? t('since the quiz began naming one subject ({{n}} of {{attempts}} answers), shown as', { n: subjectTagged(m), attempts: m.attempts })
                      : t('shown as')}{' '}
                    {(m.bySubject ?? []).map((x, i) => (
                      <Fragment key={x.subject}>
                        {i > 0 && ' · '}
                        <span lang="es" className="text-gray-700 dark:text-gray-300">{x.subject}</span>
                        {' '}{t('missed {{misses}} of {{attempts}}', { misses: x.misses, attempts: x.attempts })}
                      </Fragment>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
