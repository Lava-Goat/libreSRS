// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Drawings of the quiz screen for the guide's "How this practice works":
 * the same labels, colours and layout as ConjugationRunner, with numbered
 * markers the chapter's text explains. Drawn from the deck itself: its first
 * tense, one of its own verbs, its ladder; the cue only when it has a
 * gustar-type verb, the tense in each "name the verb" option only when it
 * drills more than one tense.
 */
import type { ReactNode } from 'react';
import { TENSES, conjugate, cueFor, personLabel, subjectGloss, subjectsFor, type Person, type Tense } from '@libresrs/shared/conjugation';
import { useI18n } from '../../../i18n';
import type { FigureBlock, GuideContext, Rung } from './types';
import { verbName } from './Paradigm';
import { holds } from './unlock';

const frame = 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3';

/** A numbered marker, as the chapter's list numbers it. */
function Mark({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 mr-1.5 rounded-full bg-violet-600 text-white text-[11px] font-bold align-middle shrink-0" aria-label={`(${n})`}>
      {n}
    </span>
  );
}

const tenseEs = (tense: Tense) => TENSES.find((x) => x.id === tense)?.es ?? tense;

/** A verb of the deck to draw with, and a form of it: a plain one if there is one, else hablar. */
function sample(ctx: GuideContext, kinds: string[]): { entry: string; tense: Tense } {
  const tense = ctx.tenses[0] ?? 'present';
  const verb = ctx.verbs.find((v) => kinds.includes(v.kind) && conjugate(v.entry, tense, 'tu'));
  return { entry: verb?.entry ?? 'hablar', tense };
}

function FormIt({ ctx }: { ctx: GuideContext }) {
  const { t } = useI18n();
  const { entry, tense } = sample(ctx, ['plain', 'pronominal']);
  const person = tense.startsWith('imperative') ? 'tu' : 'yo';
  const answer = conjugate(entry, tense, person)?.[0];
  const dative = ctx.verbs.find((v) => v.kind === 'dative');
  const cue = dative ? cueFor(dative.entry, { tense, person: 'yo', number: 'sg' }) : null;
  const dativeAnswer = dative && cue ? conjugate(dative.entry, tense, 'yo', 'sg')?.[0] : undefined;
  return (
    <div className="space-y-3">
      <div className={frame}>
        <p className="text-sm text-gray-600 dark:text-gray-400">{holds({ reached: 'typed-lenient' }, ctx) ? t('Type the right form.') : t('Pick the right form.')}</p>
        <p lang="es" className="text-sm font-medium uppercase tracking-wide text-blue-700 dark:text-blue-400"><Mark n={1} />{tenseEs(tense)}</p>
        <p lang="es" className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          <Mark n={2} />{personLabel(tense, person)}{' '}
          <span className="text-gray-600 dark:text-gray-300 font-semibold"><Mark n={3} />({verbName(entry)})</span>
        </p>
        {answer && <p className="text-sm text-gray-500 dark:text-gray-400">→ <span lang="es" className="font-semibold text-gray-800 dark:text-gray-200">{answer}</span></p>}
      </div>
      {dative && cue && dativeAnswer && (
        <div className={frame}>
          <p lang="es" className="text-sm font-medium uppercase tracking-wide text-blue-700 dark:text-blue-400"><Mark n={1} />{tenseEs(tense)}</p>
          <p lang="es" className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            <Mark n={2} />a mí <span className="text-gray-600 dark:text-gray-300 font-semibold"><Mark n={3} />({verbName(dative.entry)})</span>
          </p>
          <p lang="es" className="text-xl text-gray-800 dark:text-gray-200"><Mark n={4} />+ {cue}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">→ <span lang="es" className="font-semibold text-gray-800 dark:text-gray-200">{dativeAnswer}</span></p>
        </div>
      )}
    </div>
  );
}

/**
 * A "name the verb" question: always multiple choice (typing is for giving forms), its options the same
 * verb in other persons, so only the form's ending can answer it. As the quiz draws it since v1.24.0: the
 * question names the verb, each option one subject (with the tense when the deck drills several), and a
 * grey line under ustedes says what it means.
 */
function NameIt({ ctx }: { ctx: GuideContext }) {
  const { t } = useI18n();
  const { entry, tense } = sample(ctx, ['plain']);
  const form = conjugate(entry, tense, 'tu')?.[0] ?? '';
  const many = ctx.tenses.length > 1;
  const persons: Person[] = tense.startsWith('imperative') ? ['tu', 'el', 'nosotros', 'ellos'] : ['yo', 'tu', 'el', 'ellos'];
  // One subject per person, as the quiz names them: él for él / ella / usted, ustedes for ellos / ellas / ustedes.
  const subjectOf = (p: Person) => {
    const subjects = subjectsFor(entry, tense, p);
    return (p === 'ellos' ? subjects[subjects.length - 1] : subjects[0]) ?? personLabel(tense, p);
  };
  const gloss = (subject: string) => {
    const g = subjectGloss(subject);
    return g === 'youFormal' ? t('you (formal)') : g === 'youAll' ? t('you all') : g === 'youAllSpain' ? t('you all (Spain)') : null;
  };
  const [before, after = ''] = t('Which form of {{verb}} is this?', { verb: '\u0000' }).split('\u0000');
  return (
    <div className={frame}>
      <p className="text-sm text-gray-600 dark:text-gray-400">{before}<span lang="es">{verbName(entry)}</span>{after}</p>
      {!many && <p lang="es" className="text-sm font-medium uppercase tracking-wide text-blue-700 dark:text-blue-400">{tenseEs(tense)}</p>}
      <p lang="es" className="text-3xl font-bold text-gray-900 dark:text-gray-100"><Mark n={1} />{form}</p>
      <div className="flex items-start gap-1">
        <Mark n={2} />
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 flex-1">
          {persons.map((p, i) => {
            const subject = subjectOf(p);
            const meaning = gloss(subject);
            return (
              <li
                key={p}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 text-sm ${p === 'tu'
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-200'
                  : 'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100'}`}
              >
                <span aria-hidden="true" className="shrink-0 w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 text-[11px] text-gray-600 dark:text-gray-300 flex items-center justify-center">{i + 1}</span>
                <span className="min-w-0">
                  <span lang="es" className="block">
                    {subject}
                    {many && <> · {i === 0 && <Mark n={3} />}{tenseEs(tense)}</>}
                  </span>
                  {meaning && <span className="block text-xs text-gray-600 dark:text-gray-300">{meaning}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Ladder({ ctx }: { ctx: GuideContext }) {
  const { t } = useI18n();
  const name = (rung: Rung) => (rung === 'choice' ? t('Multiple choice') : rung === 'typed-lenient' ? t('Typed · accents forgiven') : t('Typed · accents count'));
  const steps = [...ctx.levels.map(name), t('Mastered!')];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded ${i === steps.length - 1
            ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 font-medium'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            {step}
          </span>
          {i < steps.length - 1 && <span aria-hidden="true" className="text-gray-400">→</span>}
        </li>
      ))}
    </ol>
  );
}

/** A form of the deck with a written accent, to show the accent messages with; está if none. */
function accentSample(ctx: GuideContext): string {
  for (const tense of ctx.tenses) {
    for (const v of ctx.verbs) {
      for (const person of ['el', 'tu', 'yo', 'ellos'] as const) {
        const form = conjugate(v.entry, tense, person, v.kind === 'dative' ? 'sg' : undefined)?.[0];
        if (form && /[áéíóú]/.test(form)) return form;
      }
    }
  }
  return 'está';
}

function Verdicts({ ctx }: { ctx: GuideContext }) {
  const { t } = useI18n();
  const accented = accentSample(ctx);
  const { entry, tense } = sample(ctx, ['plain', 'pronominal']);
  const person = tense.startsWith('imperative') ? 'tu' : 'yo';
  const answer = conjugate(entry, tense, person)?.[0] ?? 'hablo';
  const green = 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-200';
  const amber = 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200';
  const red = 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-200';
  const typed = ctx.levels.some((l) => l !== 'choice');
  const rows: { tone: string; body: ReactNode; show: boolean }[] = [
    { tone: green, body: <>✓ {t('Correct!')}</>, show: true },
    { tone: green, body: <>✓ {t('Correct, but watch the accent:')} <span lang="es" className="font-semibold">{accented}</span></>, show: ctx.levels.includes('typed-lenient') },
    { tone: amber, body: <>{t('Almost — check the accent:')} <span lang="es" className="font-semibold">{accented}</span></>, show: typed && (ctx.levels.includes('typed-strict') || ctx.accentMode === 'required') },
    {
      tone: red,
      body: (
        <>
          ✗ {t('Not quite. The answer:')} <span lang="es" className="font-semibold">{answer}</span>
          {/* The line that names the commonest mistake, the él form for yo, as the quiz words it. */}
          <span className="block font-normal mt-0.5">
            {t('That’s the {{person}} form, not the {{target}} form.', { person: personLabel(tense, 'el'), target: personLabel(tense, person) })}{' '}
            <span className="underline">{t('Why? See the guide.')}</span>
          </span>
        </>
      ),
      show: true,
    },
  ];
  return (
    <div className="space-y-2">
      {rows.filter((r) => r.show).map((r, i) => (
        <p key={i} className={`rounded-lg border px-3 py-2 text-sm font-medium ${r.tone}`}>{r.body}</p>
      ))}
    </div>
  );
}

export default function Figure({ block, ctx }: { block: FigureBlock; ctx: GuideContext }) {
  const { t } = useI18n();
  const body = block.figure === 'formIt' ? <FormIt ctx={ctx} />
    : block.figure === 'nameIt' ? <NameIt ctx={ctx} />
      : block.figure === 'ladder' ? <Ladder ctx={ctx} />
        : <Verdicts ctx={ctx} />;
  return (
    <figure className="my-3 rounded-xl bg-gray-50 dark:bg-gray-900/60 p-3" aria-label={t('Example from the quiz')}>
      {body}
    </figure>
  );
}
