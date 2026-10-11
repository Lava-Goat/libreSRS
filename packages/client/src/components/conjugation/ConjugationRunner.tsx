// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * "[Deck] conjugation" for a student: where they stand, then rounds of
 * prompts. Every answer is graded on the server, which keeps the round's
 * answers; this page only ever sees the prompt it is showing, and after an
 * answer the verdict and the next prompt.
 *
 * Keyboard: 1-4 pick an option, Enter checks a typed answer and moves on.
 * Progress is saved with every answer, so leaving mid-round loses nothing:
 * the round waits (overview.openRound) and `current` picks it up again. An
 * answer whose response was lost is sent again as it was, for the same
 * prompt; the server answers a repeat with the response it already gave.
 *
 * Each answer also carries how long the question took (responseTimer.ts),
 * for the teacher's numbers; nothing on this page shows a clock.
 *
 * `scope="all"` (v1.18.0) runs "Study all": rounds mixing forms of every quiz
 * the student may play (conjugation.startAll), each prompt naming its deck,
 * with the Study all overview between rounds and every deck's mastery in the
 * summary. Answers, retries and resuming work the same.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/src/routers/index.ts';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import CharKeys, { insertIntoInput, restoreCaret } from '../../vocab/CharKeys';
import type { GuideTarget } from './guide/ConjugationGuide';
import { BookIcon } from './guide/GuideCard';
import { chapterForTense } from './guide/types';
import { guideSectionFor, mistakeLine } from './mistakeText';
import { useResponseTimer } from './responseTimer';
import { subjectGloss, subjectPerson, type SubjectGloss } from '@libresrs/shared/conjugation';
import { ExtensionSlot } from '../../extensions';

type Outputs = inferRouterOutputs<AppRouter>['conjugation'];
export type ConjugationOverview = Outputs['overview'];
/** "Study all" before a round (v1.18.0). */
export type StudyAllOverview = Outputs['studyAllOverview'];
type Prompt = Outputs['start']['prompt'];
type AnswerResult = Outputs['answer'];
/** A sentence's subject after the answer (v1.25.0): "mis primos", the pronoun "ellos", the person and the form. */
export type SentenceSubject = NonNullable<NonNullable<AnswerResult['sentence']>['subject']>;
type PromptSentence = NonNullable<Prompt['sentence']>;
type RoundSummary = Outputs['finish'];
type RoundState = Outputs['start'] | Outputs['startAll'];
type OpenRound = ConjugationOverview['openRound'];
type AnswerInput = { choice?: string; text?: string; person?: string; tense?: string };
type LevelKind = Prompt['level'];
type Translate = ReturnType<typeof useI18n>['t'];
type OpenGuide = (target?: GuideTarget) => void;

const primary = 'px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800';
const secondary = 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const card = 'bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20';
const alertBox = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300';
// CharKeys is styled for the Vocabulómetro; these give its chips this page's look. Seven 38 px keys with
// 5 px gaps are 296 px: one row on a 375 px phone (303 px of card), where 40 px and 6 px put ñ on a row of its own.
const charKeysLook = '[&_.vocab-charkeys]:flex [&_.vocab-charkeys]:flex-wrap [&_.vocab-charkeys]:gap-[5px] '
  + '[&_button.ck]:min-w-[38px] [&_button.ck]:px-2 [&_button.ck]:py-2 [&_button.ck]:rounded-md [&_button.ck]:border '
  + '[&_button.ck]:border-gray-300 dark:[&_button.ck]:border-gray-600 [&_button.ck]:bg-white dark:[&_button.ck]:bg-gray-700 '
  + '[&_button.ck]:text-gray-900 dark:[&_button.ck]:text-gray-100 [&_button.ck]:text-lg [&_button.ck]:leading-none '
  + '[&_button.ck:hover]:border-blue-500 [&_button.ck:focus-visible]:outline-2 [&_button.ck:focus-visible]:outline-blue-500 '
  + '[&_button.ck:disabled]:opacity-50';

const percent = (score: number) => `${Math.round(score * 100)}%`;

/** The error a failed call reports, by tRPC code and the server's appCode. */
function errorCodes(err: unknown): { code?: string; appCode?: string } {
  const data = (err as { data?: { code?: string; appCode?: string } } | null)?.data;
  return { code: data?.code, appCode: data?.appCode };
}

interface RunnerError {
  message: string;
  /** The round cannot go on: offer a new one. */
  restart: boolean;
  /** The answer may not have arrived: offer to send the same one again. */
  retry?: boolean;
  /** This round could not be reached, but may still be open: offer to load it again. */
  resume?: number;
  /** The deck cannot be played now (quiz off, or no access): the round is left, with nothing to retry. */
  closed?: boolean;
}

/** An answer sent for a prompt whose response never came back. */
interface PendingAnswer {
  roundId: number;
  index: number;
  answer: AnswerInput;
  given: string;
  /** How long the question took, sent again unchanged with a retry. */
  ms?: number;
}

/** What a submit hands up: the answer as sent and as shown, and how long it took (undefined: not measured). */
type Submit = (answer: AnswerInput, given: string, ms?: number) => void;

/** A verdict, with the answer it is for: as shown ("given") and as sent. */
type Feedback = AnswerResult & { given: string; answer: AnswerInput };

/**
 * The deck can no longer be played: the quiz was turned off (or the deck is gone), or the student is no
 * longer in one of its groups. Nothing to send again or pick up: the round is left. A round that is
 * missing (ROUND_NOT_FOUND, also NOT_FOUND) is the caller's to report.
 */
function closedError(err: unknown, t: Translate): RunnerError | null {
  const { code, appCode } = errorCodes(err);
  // "Study all" with no quiz left to play (none turned on for the student's decks, or none of theirs).
  if (appCode === 'CONJUGATION_NONE') return { message: t('You have no conjugation practice right now.'), restart: false, closed: true };
  if (appCode === 'CONJUGATION_OFF' || (code === 'NOT_FOUND' && !appCode)) {
    return { message: t('This deck has no conjugation practice right now.'), restart: false, closed: true };
  }
  if (appCode === 'DECK_ACCESS_DENIED' || code === 'FORBIDDEN') {
    return { message: t('You do not have access to this deck.'), restart: false, closed: true };
  }
  return null;
}

function startError(err: unknown, t: Translate, all = false): RunnerError {
  const { appCode } = errorCodes(err);
  if (appCode === 'CONJUGATION_EMPTY') {
    return { message: all ? t('You have no conjugation practice right now.') : t('This deck has no verbs to practice yet.'), restart: false };
  }
  return closedError(err, t) ?? { message: t('Could not start a round. Check your connection and try again.'), restart: false };
}

function answerError(err: unknown, t: Translate): RunnerError {
  const { code, appCode } = errorCodes(err);
  if (appCode === 'ROUND_EXPIRED') return { message: t('This round expired. Start a new round.'), restart: true };
  if (appCode === 'ROUND_FINISHED' || appCode === 'ROUND_NOT_FOUND') {
    return { message: t('This round is over. Start a new round.'), restart: true };
  }
  const closed = closedError(err, t);
  if (closed) return closed;
  if (code === 'BAD_REQUEST') return { message: t('That answer could not be checked. Try again.'), restart: false };
  // Lost on the way there or back: the same answer goes again, and a repeat of one that arrived gets its first response.
  return { message: t('Could not send your answer. Check your connection and try again.'), restart: false, retry: true };
}

function resumeError(err: unknown, t: Translate, roundId: number): RunnerError {
  const { appCode } = errorCodes(err);
  if (appCode === 'ROUND_EXPIRED') return { message: t('This round expired. Start a new round.'), restart: true };
  if (appCode === 'ROUND_FINISHED' || appCode === 'ROUND_NOT_FOUND') {
    return { message: t('This round is over. Start a new round.'), restart: true };
  }
  const closed = closedError(err, t);
  if (closed) return closed;
  // Not heard back: the round is most likely still open, so it stays on offer.
  return { message: t('Could not load your round. Check your connection and try again.'), restart: false, resume: roundId };
}

/**
 * The green bar, with what is on its way: mastery needs the top rung on two
 * school days, so a first perfect round masters nothing, and "100 % · 0 / 50
 * mastered" alone reads as if it counted for nothing. `almost` and `climbing`
 * are v1.16's (an answer stored before it and replayed has neither).
 */
export function MasteryBar({ mastered, total, almost = 0, climbing = 0 }: {
  mastered: number;
  total: number;
  /** Right at the top once: mastered by a right answer on another day. */
  almost?: number;
  /** Past the first rung, not mastered yet. */
  climbing?: number;
}) {
  const { t } = useI18n();
  const parts = [
    t('{{mastered}} / {{total}} mastered', { mastered, total }),
    ...(almost > 0 ? [almost === 1 ? t('1 needs one more day') : t('{{count}} need one more day', { count: almost })] : []),
    ...(climbing > 0 ? [climbing === 1 ? t('1 on the way up') : t('{{count}} on the way up', { count: climbing })] : []),
  ];
  return (
    <div>
      <div
        role="progressbar"
        aria-label={t('Mastered')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={mastered}
        aria-valuetext={parts.join(' · ')}
        className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5"
      >
        <div
          className="bg-green-500 h-2.5 rounded-full transition-all"
          style={{ width: `${total > 0 ? (mastered / total) * 100 : 0}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {parts.map((part, i) => (
          <Fragment key={i}>{i > 0 && ' · '}<span>{part}</span></Fragment>
        ))}
      </p>
      {/* Only once something is on its way: that is when "not mastered yet" needs saying. */}
      {almost + climbing > 0 && mastered < total && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {t('A form is mastered when you get it right at the last step on two different days.')}
        </p>
      )}
    </div>
  );
}

/** "3 forms due": mastered forms waiting for review. */
function formsDue(count: number, t: Translate): string {
  return count === 1 ? t('1 form due') : t('{{count}} forms due', { count });
}

function levelName(level: LevelKind, t: Translate): string {
  if (level === 'choice') return t('Multiple choice');
  if (level === 'typed-lenient') return t('Typed · accents forgiven');
  return t('Typed · accents count');
}

/** A deck's quiz, or (scope "all") "Study all" over every quiz the student may play. */
type RunnerTarget =
  | { scope?: 'deck'; deckId: number; overview: ConjugationOverview }
  | { scope: 'all'; deckId?: undefined; overview: StudyAllOverview };

export default function ConjugationRunner(props: RunnerTarget & {
  /** A round ended: mastery shown elsewhere is stale. */
  onRoundOver?: () => void;
  /** The overview is being fetched again: until it is, it may not know of a round left open. */
  refreshing?: boolean;
  /** The guide's card, for the screens between rounds. */
  guideCard?: ReactNode;
  /** Opens the guide (at a chapter or section). */
  onOpenGuide?: OpenGuide;
  /** The guide is open over the page: the prompt's keys (1–4, Enter) wait. */
  paused?: boolean;
  /** A rung the student has answered at or climbed to, for the parts of the guide it opens. */
  onRung?: (rung: LevelKind) => void;
  /**
   * Whether a question is waiting for its answer. The guide opens only between questions (so a score is
   * the student's own): the page holds it back meanwhile.
   */
  onWaiting?: (waiting: boolean) => void;
  /** Counts the times the guide was asked for; asked while a question waits, the page says when it opens. */
  guideAsked?: number;
  /** The guide sections this deck's guide shows now: a named mistake links the first of its sections found here. */
  openSections?: ReadonlySet<string>;
  /**
   * An answer finished conjugation sets (every item mastered at least once), for the page to tell the
   * student (only the page knows what to say of it).
   */
  onSetsFinished?: (sets: { deckId: number; deckName: string }[]) => void;
  /**
   * Every round summary the runner shows (a round played to its end, or one replayed), for the page
   * to read what it needs from it. A "Study all" round passes its lead deck's id.
   */
  onRoundFinished?: (summary: RoundSummary, deckId: number) => void;
  /** Shown between rounds (the Intro and the summary), under the guide's card: the page's way to "Study all". */
  between?: ReactNode;
  /**
   * A question shown as a sentence was answered (v1.25.0), with its subject: the guide's "Who is the subject?"
   * opens, and its table gains the subject.
   */
  onSentence?: (subject: SentenceSubject | null) => void;
}) {
  const {
    overview, onRoundOver, refreshing = false, guideCard, onOpenGuide, paused = false, onRung, onWaiting, guideAsked = 0,
    openSections, onSetsFinished, onRoundFinished, between, onSentence,
  } = props;
  const all = props.scope === 'all';
  // A Study all round keeps its lead deck's id; the overview names it.
  const deckId = props.scope === 'all' ? props.overview.deckId ?? 0 : props.deckId;
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const startRound = trpc.conjugation.start.useMutation();
  const startAllRound = trpc.conjugation.startAll.useMutation();
  const sendAnswer = trpc.conjugation.answer.useMutation();
  const finishRound = trpc.conjugation.finish.useMutation();
  const reportSentence = trpc.conjugation.reportSentence.useMutation();

  const [roundId, setRoundId] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // The round's last graded answer, kept after Next (the header's extension slot reads it).
  const [lastAnswer, setLastAnswer] = useState<AnswerResult | null>(null);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [error, setError] = useState<RunnerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [sending, setSending] = useState(false);
  // Which of the Intro's calls is out, for its button's label (both buttons are held while either runs).
  const [running, setRunning] = useState<'start' | 'resume' | null>(null);
  // One call at a time: a double click or a held key must not answer twice.
  const busyRef = useRef(false);
  // The round the overview says was left open is offered until the student moves on (continues it, or starts another).
  const [movedOn, setMovedOn] = useState(false);
  const offered: OpenRound = movedOn ? null : overview.openRound ?? null;

  const show = useCallback((round: RoundState) => {
    setRoundId(round.roundId);
    setReview(round.review);
    setPrompt(round.prompt);
    setTotal(round.total);
    setFeedback(null);
    setLastAnswer(null);
    setSummary(null);
    setPending(null);
    setMovedOn(true);
  }, []);

  const showSummary = useCallback((done: RoundSummary) => {
    setSummary(done);
    setPrompt(null);
    setFeedback(null);
    setLastAnswer(null);
    setPending(null);
    setMovedOn(true);
    onRoundOver?.();
    onRoundFinished?.(done, deckId);
  }, [onRoundOver, onRoundFinished, deckId]);

  /** Back to the Intro with a failure; `movedOn` also stops offering the round left open. */
  const leave = useCallback((failure: RunnerError, movedOn: boolean) => {
    setPrompt(null);
    setRoundId(null);
    setFeedback(null);
    setPending(null);
    if (movedOn) setMovedOn(true);
    setError(failure);
  }, []);

  /** Picks an open round up where the server has it; false if it could not. The caller holds busyRef. */
  const load = useCallback(async (id: number): Promise<boolean> => {
    try {
      show(await utils.client.conjugation.current.query({ roundId: id }));
      return true;
    } catch (err) {
      // Ended elsewhere (its last answer from another tab): its score, unless it was left rather than finished.
      if (errorCodes(err).appCode === 'ROUND_FINISHED') {
        try {
          const done = await finishRound.mutateAsync({ roundId: id });
          if (!done.abandoned) {
            showSummary(done);
            return false;
          }
        } catch {
          // Reported below as the round being over.
        }
      }
      const failure = resumeError(err, t, id);
      // Only a round that is gone (or a deck that cannot be played) is left behind; one the network lost
      // stays on offer (Continue, or Try again).
      leave(failure, failure.restart || failure.closed === true);
      return false;
    }
    // Not on finishRound: a mutation result has a new identity every render.
  }, [utils, show, showSummary, leave, t]);

  const begin = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    setRunning('start');
    setError(null);
    setNotice(null);
    try {
      show(all ? await startAllRound.mutateAsync() : await startRound.mutateAsync({ deckId }));
    } catch (err) {
      const failure = startError(err, t, all);
      // A quiz switched off (or a deck taken away) also ends the open round
      // on offer: Continue could never succeed either.
      leave(failure, failure.closed === true);
    } finally {
      busyRef.current = false;
      setSending(false);
      setRunning(null);
    }
    // Not on startRound: a mutation result has a new identity every render.
  }, [all, deckId, leave, show, t]);

  const resume = useCallback(async (id: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    setRunning('resume');
    setError(null);
    setNotice(null);
    try {
      await load(id);
    } finally {
      busyRef.current = false;
      setSending(false);
      setRunning(null);
    }
  }, [load]);

  const send = useCallback(async (sent: PendingAnswer) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendAnswer.mutateAsync({
        roundId: sent.roundId,
        index: sent.index,
        answer: sent.answer,
        ...(sent.ms !== undefined ? { ms: sent.ms } : {}),
      });
      setPending(null);
      setFeedback({ ...result, given: sent.given, answer: sent.answer });
      setLastAnswer(result);
      setTotal(result.total);
      // A replay of an answer taken before v1.13 has no finishedSets.
      if (result.finishedSets?.length) onSetsFinished?.(result.finishedSets);
    } catch (err) {
      if (errorCodes(err).appCode === 'ROUND_OUT_OF_SYNC') {
        // Answered from another tab or window: carry on from where the round is now.
        setPending(null);
        if (await load(sent.roundId)) {
          setNotice(t('This round moved on in another tab or window. Here is where it is now.'));
        }
        return;
      }
      const failure = answerError(err, t);
      if (failure.closed) {
        // Nothing this round can do now: no Try again, and no prompt left to answer.
        leave(failure, true);
        return;
      }
      setPending(failure.retry ? sent : null);
      setError(failure);
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }, [load, leave, t, onSetsFinished]);

  const submit = useCallback<Submit>((answer, given, ms) => {
    if (roundId === null || !prompt || feedback || pending) return;
    void send({ roundId, index: prompt.index, answer, given, ...(ms !== undefined ? { ms } : {}) });
  }, [roundId, prompt, feedback, pending, send]);

  const next = useCallback(async () => {
    if (busyRef.current || !feedback) return;
    if (!feedback.finished) {
      setPrompt(feedback.next);
      setFeedback(null);
      return;
    }
    let done = feedback.summary;
    if (!done && roundId !== null) {
      busyRef.current = true;
      setSending(true);
      try {
        done = await finishRound.mutateAsync({ roundId });
      } catch (err) {
        const closed = closedError(err, t);
        if (closed) leave(closed, true);
        else setError({ message: t('Could not load your score. Check your connection and try again.'), restart: false });
        return;
      } finally {
        busyRef.current = false;
        setSending(false);
      }
    }
    if (!done) return;
    setNotice(null);
    showSummary(done);
  }, [feedback, roundId, showSummary, leave, t]);

  // A question waiting for its answer (or for its answer to arrive), or on its way (a round starting or
  // resuming: `running` clears in the same batch as show() puts the question up): the guide waits too.
  const waiting = (prompt !== null && feedback === null) || running !== null;
  useEffect(() => {
    onWaiting?.(waiting);
  }, [waiting, onWaiting]);
  useEffect(() => () => onWaiting?.(false), [onWaiting]);
  // The guide asked for mid-question: say when it opens, until this question is answered.
  const [guideHeld, setGuideHeld] = useState(false);
  const askedRef = useRef(guideAsked);
  useEffect(() => {
    if (guideAsked === askedRef.current) return;
    askedRef.current = guideAsked;
    if (waiting) setGuideHeld(true);
  }, [guideAsked, waiting]);
  useEffect(() => {
    if (!waiting) setGuideHeld(false);
  }, [waiting]);

  // A sentence answered (v1.25.0): the guide's part on subjects opens, with this one in its table.
  const sentenceAnswered = feedback?.sentence ?? null;
  useEffect(() => {
    if (sentenceAnswered) onSentence?.(sentenceAnswered.subject ?? null);
  }, [sentenceAnswered, onSentence]);

  // Answered at a rung, and maybe climbed to the next: the guide's parts about typing and accents open.
  const answeredAt = feedback && prompt ? prompt.level : null;
  const climbedTo = feedback?.levelKindAfter ?? null;
  useEffect(() => {
    if (answeredAt) onRung?.(answeredAt);
    if (climbedTo) onRung?.(climbedTo);
  }, [answeredAt, climbedTo, onRung]);

  const errorBox = error && (
    <div role="alert" className={`${alertBox} flex flex-wrap items-center justify-between gap-3`}>
      <span>{error.message}</span>
      {error.restart && (
        <button type="button" onClick={() => void begin()} disabled={sending} className={primary}>
          {t('Start a new round')}
        </button>
      )}
      {error.retry && pending && <RetryButton onRetry={() => void send(pending)} sending={sending} busyLabel={t('Checking…')} />}
      {/* The Intro's Continue already does this when it offers the same round. */}
      {error.resume !== undefined && offered?.roundId !== error.resume && (
        <RetryButton onRetry={() => void resume(error.resume as number)} sending={sending} busyLabel={t('Loading...')} />
      )}
    </div>
  );
  const noticeBox = notice && (
    <p role="status" className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-900 dark:text-blue-200">
      {notice}
    </p>
  );

  if (summary) {
    return (
      <div className="space-y-4">
        {errorBox}
        <Summary summary={summary} onAgain={() => void begin()} starting={sending} />
        {guideCard}
        {between}
      </div>
    );
  }

  if (prompt) {
    const shown = Math.min(prompt.index + 1, total);
    return (
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-400 mb-1">
            <span className="flex items-center gap-2 min-w-0">
              <span>{review ? t('Review round') : t('Round')}</span>
              {roundId !== null && (
                <ExtensionSlot
                  name="conjugation.header"
                  round={{ roundId, scope: all ? 'all' : 'deck', position: shown, prompts: total }}
                  lastAnswer={lastAnswer}
                />
              )}
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {onOpenGuide && (
                <button
                  type="button"
                  onClick={() => onOpenGuide(guideTargetFor(prompt))}
                  // Held, not disabled: it can still be reached, and says when the guide opens.
                  aria-disabled={waiting || undefined}
                  // py-1 -my-1: a taller tap target on a phone, the row's height unchanged.
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-1 -my-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${waiting
                    ? 'text-gray-400 dark:text-gray-500 cursor-default'
                    : 'text-violet-700 dark:text-violet-300 hover:underline'}`}
                >
                  <BookIcon className="w-4 h-4" />
                  {t('Guide')}
                </button>
              )}
              <span>{t('{{n}} / {{total}}', { n: shown, total })}</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={t('Round progress')}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={prompt.index + (feedback ? 1 : 0)}
            className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2"
          >
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${total > 0 ? ((prompt.index + (feedback ? 1 : 0)) / total) * 100 : 0}%` }}
            />
          </div>
        </div>
        {review && prompt.index === 0 && !feedback && (
          <p className="text-sm text-green-700 dark:text-green-400">
            {t('You have mastered every item. This round is review.')}
          </p>
        )}
        {noticeBox}
        {/* Always there, so the note is announced when it appears (a live region added with its text often is not). */}
        <div aria-live="polite">
          {guideHeld && (
            <p className="bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3 text-sm text-violet-900 dark:text-violet-200">
              {t('You can open the guide once you answer this question.')}
            </p>
          )}
        </div>
        {/* Keyed by prompt: typed text, picked chips and the chosen option start fresh with each one. */}
        <PromptCard
          key={prompt.itemKey}
          prompt={prompt}
          feedback={feedback}
          sending={sending}
          held={pending !== null}
          onSubmit={submit}
          onNext={() => void next()}
          paused={paused}
          onOpenGuide={onOpenGuide}
          tenseChapter={prompt.tense ? chapterForTense(prompt.tense) : undefined}
          openSections={openSections}
          mixed={all}
          onReport={roundId !== null ? () => reportSentence.mutateAsync({ roundId, index: prompt.index }).then(() => undefined) : undefined}
        />
        {errorBox}
      </div>
    );
  }

  const buttons = { open: offered, onStart: () => void begin(), onContinue: (id: number) => void resume(id), busy: sending, running, refreshing };
  return (
    <div className="space-y-4">
      {errorBox}
      {guideCard}
      {props.scope === 'all'
        ? <StudyAllIntro overview={props.overview} {...buttons} />
        : <Intro overview={props.overview} {...buttons} />}
      {between}
    </div>
  );
}

/**
 * The guide's chapter for a prompt: hay and the weather verbs have their own; else the chapter on its
 * tense, when the prompt shows it (a "name the verb" prompt that asks the tense does not say it).
 */
function guideTargetFor(prompt: Prompt): GuideTarget | undefined {
  if (prompt.entryHint === 'impersonal') return { chapter: 'impersonal' };
  return prompt.tense ? { chapter: chapterForTense(prompt.tense) } : undefined;
}

/** Sends the lost call again; it takes focus, so Enter does it. */
function RetryButton({ onRetry, sending, busyLabel }: { onRetry: () => void; sending: boolean; busyLabel: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <button ref={ref} type="button" onClick={onRetry} disabled={sending} className={primary}>
      {sending ? busyLabel : t('Try again')}
    </button>
  );
}

function Intro({ overview, open, onStart, onContinue, busy, running, refreshing }: StartProps & { overview: ConjugationOverview }) {
  const { t } = useI18n();
  if (overview.total === 0) {
    return <div className={`${card} p-6 text-gray-600 dark:text-gray-400`}>{t('This deck has no verbs to practice yet.')}</div>;
  }
  return (
    <div className={`${card} p-5 sm:p-6 space-y-5`}>
      <div className="space-y-1">
        <MasteryBar mastered={overview.mastered} total={overview.total} almost={overview.almost} climbing={overview.climbing} />
        {/* An overview from before v1.13 has no count. */}
        {(overview.due ?? 0) > 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-violet-800 dark:text-violet-300">{formsDue(overview.due, t)}</span>
            {' · '}
            {t('Mastered forms come back for review, to stay mastered.')}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500 dark:text-gray-400">{t('Tenses')}</dt>
          <dd lang="es" className="text-gray-900 dark:text-gray-100">{overview.tenses.map((tense) => tense.label).join(', ')}</dd>
        </div>
        {(overview.lastScore !== null || overview.bestScore !== null) && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400">{t('Scores')}</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {overview.lastScore !== null && t('Last round: {{score}}', { score: percent(overview.lastScore) })}
              {overview.lastScore !== null && overview.bestScore !== null && ' · '}
              {overview.bestScore !== null && t('Best: {{score}}', { score: percent(overview.bestScore) })}
            </dd>
          </div>
        )}
      </dl>
      <div>
        <h2 className="text-sm text-gray-500 dark:text-gray-400 mb-2">{t('Verbs')}</h2>
        <ul className="flex flex-wrap gap-2">
          {overview.verbs.map((verb) => (
            <li
              key={verb.entry}
              className={`px-2.5 py-1 rounded-full text-sm border ${verb.total > 0 && verb.mastered === verb.total
                ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                : 'border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200'}`}
            >
              <span lang="es">{verb.label}</span>
              {/* "hacer" and "hacer" (hace frío) would read alike: the impersonal one says so. */}
              {verb.kind === 'impersonal' && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {t('impersonal')}
                </span>
              )}
              <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">{verb.mastered}/{verb.total}</span>
            </li>
          ))}
        </ul>
      </div>
      <StartButtons open={open} onStart={onStart} onContinue={onContinue} busy={busy} running={running} refreshing={refreshing} />
    </div>
  );
}

interface StartProps {
  /** A round the student left open: continue it, or start over. */
  open: OpenRound;
  onStart: () => void;
  onContinue: (roundId: number) => void;
  /** A call is out: every button waits. */
  busy: boolean;
  /** Which call it is: only its own button says so. */
  running: 'start' | 'resume' | null;
  refreshing: boolean;
}

/** Start a round, or continue the one left open (or start over). */
function StartButtons({ open, onStart, onContinue, busy, running, refreshing }: StartProps) {
  const { t } = useI18n();
  if (open) {
    return (
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          {t('You have a round in progress: question {{n}} of {{total}}.', { n: Math.min(open.index + 1, open.total), total: open.total })}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={() => onContinue(open.roundId)} disabled={busy} className={primary}>
            {running === 'resume' ? t('Loading...') : t('Continue the round')}
          </button>
          <button type="button" onClick={onStart} disabled={busy} className={secondary}>
            {running === 'start' ? t('Starting…') : t('Start a new round')}
          </button>
        </div>
      </div>
    );
  }
  return (
    // Held while the overview is fetched again: starting now would end a round it has not heard of yet.
    <button type="button" onClick={onStart} disabled={busy || refreshing} className={`${primary} w-full sm:w-auto`}>
      {running === 'start' ? t('Starting…') : t('Start a round')}
    </button>
  );
}

/**
 * "Study all" before a round: what a round asks, what extensions say of it, and each quiz's mastery and
 * forms due, newest first. With no quiz to play, says so.
 */
function StudyAllIntro({ overview, ...buttons }: StartProps & { overview: StudyAllOverview }) {
  const { t } = useI18n();
  if (overview.decks.length === 0) {
    return <div className={`${card} p-6 text-gray-600 dark:text-gray-400`}>{t('You have no conjugation practice right now.')}</div>;
  }
  return (
    <div className={`${card} p-5 sm:p-6 space-y-5`}>
      <div className="space-y-1">
        <p className="text-gray-700 dark:text-gray-300">
          {t('Questions from all your conjugation quizzes: forms due for review first, then forms you are learning, then new ones.')}
        </p>
        <ExtensionSlot name="conjugation.studyAllStatus" overview={overview} />
        {overview.due > 0 && (
          <p className="text-sm">
            <span className="font-medium text-violet-800 dark:text-violet-300">{formsDue(overview.due, t)}</span>
          </p>
        )}
      </div>
      <DeckMasteryList decks={overview.decks} />
      {(overview.lastScore !== null || overview.bestScore !== null) && (
        <dl className="text-sm">
          <dt className="text-gray-500 dark:text-gray-400">{t('Scores')}</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {overview.lastScore !== null && t('Last round: {{score}}', { score: percent(overview.lastScore) })}
            {overview.lastScore !== null && overview.bestScore !== null && ' · '}
            {overview.bestScore !== null && t('Best: {{score}}', { score: percent(overview.bestScore) })}
          </dd>
        </dl>
      )}
      <StartButtons {...buttons} />
    </div>
  );
}

/** Each quiz of a Study all round or overview, with its own mastery (and forms due, when the list has them). */
function DeckMasteryList({ decks }: {
  decks: readonly { deckId: number; deckName: string; mastered: number; almost?: number; climbing?: number; total: number; due?: number }[];
}) {
  const { t } = useI18n();
  return (
    <ul className="space-y-4">
      {decks.map((deck) => (
        <li key={deck.deckId}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">{t('{{deck}} conjugation', { deck: deck.deckName })}</h3>
            {(deck.due ?? 0) > 0 && (
              <span className="text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium px-2 py-0.5 rounded">
                {formsDue(deck.due ?? 0, t)}
              </span>
            )}
          </div>
          <MasteryBar mastered={deck.mastered} total={deck.total} almost={deck.almost} climbing={deck.climbing} />
        </li>
      ))}
    </ul>
  );
}

function Summary({ summary, onAgain, starting }: { summary: RoundSummary; onAgain: () => void; starting: boolean }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <div className={`${card} p-5 sm:p-6 space-y-5`}>
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-gray-900 dark:text-gray-100 focus:outline-none">
        {t('Round complete')}
      </h2>
      <div>
        <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{percent(summary.score)}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('{{right}} of {{total}} right the first time', { right: summary.firstTryCorrect, total: summary.prompts })}
        </p>
      </div>
      {/* Study all: each quiz the round asked forms of, with its own mastery. A summary from before v1.18 has no decks. */}
      {summary.decks ? <DeckMasteryList decks={summary.decks} /> : (
        <>
          <MasteryBar mastered={summary.mastered} total={summary.total} almost={summary.almost} climbing={summary.climbing} />
          {summary.total > 0 && summary.mastered === summary.total && (
            <p className="text-green-700 dark:text-green-400 font-medium">{t('You have mastered every item in this deck!')}</p>
          )}
        </>
      )}
      <ExtensionSlot name="conjugation.summaryNote" summary={summary} />
      <div className="flex flex-col sm:flex-row gap-3">
        <button type="button" onClick={onAgain} disabled={starting} className={primary}>
          {starting ? t('Starting…') : t('Another round')}
        </button>
        <Link to="/" className={`${secondary} text-center`}>{t('Back to Study')}</Link>
      </div>
    </div>
  );
}

/** A fromForm reading as the prompt's options (and a typed answer) name it: the tense only when it is asked. */
function asOffered(prompt: Prompt, reading: string): string {
  if (prompt.direction === 'toForm' || prompt.askTense || !prompt.tenseLabel) return reading;
  const suffix = ` · ${prompt.tenseLabel}`;
  return reading.endsWith(suffix) ? reading.slice(0, -suffix.length) : reading;
}

/**
 * The options a feedback marks right: as the server names them (v1.24.0); in a response stored before,
 * from the answers, which name the tense where options do only when it is asked.
 */
function rightOptions(prompt: Prompt, feedback: AnswerResult): string[] {
  if (feedback.rightOptions && feedback.rightOptions.length > 0) return feedback.rightOptions;
  return [feedback.correctAnswer, ...feedback.alsoCorrect].map((a) => asOffered(prompt, a));
}

/** The grey line under usted, ustedes and vosotros at multiple choice (v1.24.0): what the subject means. */
function glossText(gloss: SubjectGloss | null, t: Translate): string | null {
  if (gloss === 'youFormal') return t('you (formal)');
  if (gloss === 'youAll') return t('you all');
  if (gloss === 'youAllSpain') return t('you all (Spain)');
  return null;
}

/** The grey line under a "give the form" prompt's subject at multiple choice ("ustedes" → you all), or null. */
function promptGloss(prompt: Prompt, t: Translate): string | null {
  if (prompt.direction !== 'toForm' || prompt.kind !== 'choice') return null;
  return glossText(subjectGloss(prompt.personLabel), t);
}

/** A stand-in the verb's place in a translated question is found by (the verb then goes in a lang="es" span). */
const VERB_SLOT = '\u0000';

/** The gloss of a "name the verb" option ("ustedes · presente" → you all), or null. */
function optionGloss(option: string): SubjectGloss | null {
  for (const part of option.split(' · ')) {
    const gloss = subjectGloss(part);
    if (gloss) return gloss;
  }
  return null;
}

/** "(they / you all)": what a person's subjects mean, in the page's language. */
function personMeaning(person: string, t: Translate): string | null {
  if (person === 'yo') return t('I');
  if (person === 'tu' || person === 'vos') return t('you');
  if (person === 'el') return t('he / she / you, formal');
  if (person === 'ellos') return t('they / you all');
  if (person === 'nosotros') return t('we');
  if (person === 'vosotros') return t('you all, in Spain');
  return null;
}

/**
 * "(they / you all)", "(I / he / she / you, formal)": the persons a shared form is for. A response stored
 * before `persons` names only the item's own; one person alone (yo, tú) needs no meaning.
 */
function groupMeaning(shared: { person: string; persons?: string[] }, t: Translate): string | null {
  const persons = shared.persons && shared.persons.length > 0 ? shared.persons : [shared.person];
  if (persons.length === 1 && (persons[0] === 'yo' || persons[0] === 'tu' || persons[0] === 'vos')) return null;
  const meanings = persons.map((p) => personMeaning(p, t));
  if (meanings.some((m) => m === null)) return null;
  return [...new Set(meanings)].join(' / ');
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * The person option a reading's label names: commands name "usted" alone, one of "él / ella / usted"; since
 * v1.24.0 an answer may name one subject ("ustedes").
 */
function personIdOf(prompt: Prompt, label: string): string | undefined {
  const options = prompt.personOptions ?? [];
  return (options.find((o) => o.label === label) ?? options.find((o) => o.label.split(' / ').includes(label)))?.id
    ?? subjectPerson(label);
}

/**
 * Whether a fromForm reading ("tener · yo · imperfecto", always with its tense) is the one the student's
 * answer matched, as the server matches it: a picked option is that reading; a typed one is the verb as
 * typed (accents aside, "gustar" for "gustarle"), the same person (none for an impersonal verb) and, when
 * asked, the same tense. Compared by ids, not labels: a command's reading says "usted" where the chip
 * the student picked says "él / ella / usted".
 */
function isGivenReading(prompt: Prompt, reading: string, answer: AnswerInput): boolean {
  if (answer.choice !== undefined) return asOffered(prompt, reading) === answer.choice;
  const parts = reading.split(' · ');
  const verb = parts[0];
  const text = answer.text ?? '';
  if (fold(verb) !== fold(text) && fold(verb) !== `${fold(text)}le`) return false;
  const person = parts.length > 2 ? parts.slice(1, -1).join(' · ') : null;
  // A reading with a person is never the student's when they gave none (the prompt did not ask who).
  if (person !== null && (answer.person === undefined || personIdOf(prompt, person) !== answer.person)) return false;
  if (prompt.askTense) {
    const tense = parts.length > 1 ? parts[parts.length - 1] : null;
    if ((prompt.tenseOptions ?? []).find((o) => o.label === tense)?.id !== answer.tense) return false;
  }
  return true;
}

/**
 * The other right answers to list. A form can have several readings ("tenía" is yo or él); when the student
 * gave one that is not the item's own, the item's own is the one to show, not theirs back as "also correct".
 */
function otherAnswers(prompt: Prompt, feedback: Feedback): string[] {
  if (!feedback.counted || prompt.direction === 'toForm') return feedback.alsoCorrect;
  // A counted accent slip names the item's own reading in its headline: list the rest, less the student's.
  if (feedback.nearMiss) return feedback.alsoCorrect.filter((a) => !isGivenReading(prompt, a, feedback.answer));
  const all = [feedback.correctAnswer, ...feedback.alsoCorrect];
  const others = all.filter((a) => !isGivenReading(prompt, a, feedback.answer));
  return others.length < all.length ? others : feedback.alsoCorrect;
}

/** Enter/1-4 from anywhere on the page, but not while a control that owns the key has focus. */
function ownsKey(target: EventTarget | null, except: Element | null): boolean {
  if (!(target instanceof Element) || target === except) return false;
  return !!target.closest('a, button, input, select, textarea, [contenteditable="true"]');
}

function PromptCard({ prompt, feedback, sending, held, onSubmit, onNext, paused, onOpenGuide, tenseChapter, openSections, mixed = false, onReport }: {
  prompt: Prompt;
  feedback: Feedback | null;
  sending: boolean;
  /** An answer is out whose response was lost: it stays as sent, to be sent again. */
  held: boolean;
  onSubmit: Submit;
  onNext: () => void;
  /** Something is open over the page: its keys are not the prompt's. */
  paused: boolean;
  onOpenGuide?: OpenGuide;
  /** The guide's chapter on the prompt's tense. */
  tenseChapter?: GuideTarget['chapter'];
  /** The sections the deck's guide shows, for the verdict's link on a named mistake. */
  openSections?: ReadonlySet<string>;
  /** A "Study all" round: every prompt names the quiz it counts in. */
  mixed?: boolean;
  /** Reports the answered prompt's sentence to the teacher (v1.25.0). */
  onReport?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  // What the student is typing, shown in the sentence's blank as they type (v1.25.0).
  const [typing, setTyping] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const answered = feedback !== null;
  const locked = answered || sending || held;
  // Keyed by prompt, this card mounts when its question shows: the time an answer took runs from here.
  const timer = useResponseTimer();
  const submitTimed = useCallback((answer: AnswerInput, given: string) => {
    onSubmit(answer, given, timer.elapsed());
  }, [onSubmit, timer]);

  // A new choice prompt takes focus itself (not an option: a second Enter would pick it).
  useEffect(() => {
    if (prompt.kind === 'choice') cardRef.current?.focus();
  }, [prompt.kind]);
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);
  // The guide closed over a verdict: back to Next, so Enter goes on with the round (not back into the
  // guide through the tense that opened it, which is where the dialog returns focus).
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (wasPaused.current && !paused && answered) nextRef.current?.focus();
    wasPaused.current = paused;
  }, [paused, answered]);

  const choose = useCallback((option: string) => {
    if (locked) return;
    setPicked(option);
    submitTimed({ choice: option }, option);
  }, [locked, submitTimed]);

  // The latest handlers, for one document listener.
  const keys = useRef({ choose, onNext });
  useEffect(() => { keys.current = { choose, onNext }; });
  const optionCount = prompt.options?.length ?? 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || e.altKey || e.ctrlKey || e.metaKey) return;
      // A key meant for a dialog over the page (the guide) is never an answer.
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
      if (answered) {
        // The answer box, read-only now, is the prompt's own: Enter there moves on like Next (a click back
        // into it, say to look at the accent, must not leave the key dead: its form no longer submits).
        const ownAnswer = e.target instanceof HTMLInputElement && !!e.target.form && !!cardRef.current?.contains(e.target);
        if (e.key !== 'Enter' || (!ownAnswer && ownsKey(e.target, nextRef.current))) return;
        // Handled here, with the button's own Enter prevented, repeats too: a held Enter must not skip prompts
        // (a repeat left to the focused Next button would click it).
        e.preventDefault();
        if (!e.repeat) keys.current.onNext();
        return;
      }
      if (e.repeat) return;
      if (prompt.kind !== 'choice' || !prompt.options) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > optionCount) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      keys.current.choose(prompt.options[n - 1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [answered, prompt.kind, prompt.options, optionCount, paused]);

  const right = feedback ? rightOptions(prompt, feedback) : [];
  // "nosotras · presente progresivo" fits one line of a 375 px phone at text-base, not at text-lg.
  const optionText = prompt.direction === 'fromForm' && prompt.askTense ? 'text-base sm:text-lg' : 'text-lg';
  const titleId = `conj-prompt-${prompt.index}`;
  // The subject's gloss ("you all") is read after the card's name when focus lands on it, not in the name.
  const hasGloss = !!promptGloss(prompt, t);

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={hasGloss ? `conj-gloss-${prompt.index}` : undefined}
      className={`${card} p-5 sm:p-6 space-y-5 focus:outline-none`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">{levelName(prompt.level, t)}</span>
        {prompt.retry && (
          <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">{t('Second try')}</span>
        )}
        {mixed ? (
          <>
            {/* Study all: the quiz the form counts in, and whether it is a mastered form back for review. */}
            {prompt.fromDeck && (
              <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 break-words">
                {t('{{deck}} conjugation', { deck: prompt.fromDeck.deckName })}
              </span>
            )}
            {prompt.scheduledReview && (
              <span className="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300">{t('Back for review')}</span>
            )}
          </>
        ) : (prompt.scheduledReview || prompt.fromDeck) && (
          // A mastered form back for review, maybe from an earlier unit's quiz (it counts there).
          <span className="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 break-words">
            {prompt.fromDeck ? t('Back for review · {{deck}}', { deck: prompt.fromDeck.deckName }) : t('Back for review')}
          </span>
        )}
      </div>

      {/* The tense and the impersonal tag lead to the guide once the question is answered. */}
      <PromptText
        prompt={prompt}
        titleId={titleId}
        onOpenGuide={answered ? onOpenGuide : undefined}
        tenseChapter={tenseChapter}
        // Once answered, the blank holds the right form (never a wrong one in a big Spanish sentence).
        typing={feedback ? feedback.correctAnswer.split(' / ')[0] : prompt.kind === 'typed' ? typing : (picked ?? '')}
        answered={!!feedback}
      />

      {prompt.kind === 'choice' && prompt.options ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="group" aria-label={t('Options')}>
          {prompt.options.map((option, i) => {
            const isRight = answered && right.includes(option);
            const isWrongPick = answered && picked === option && !isRight;
            const tone = isRight
              ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-200'
              : isWrongPick
                ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-200'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-700';
            return (
              <button
                key={option}
                type="button"
                onClick={() => choose(option)}
                disabled={locked}
                aria-keyshortcuts={String(i + 1)}
                aria-pressed={picked === option}
                className={`flex items-center gap-3 text-left px-4 py-3 rounded-lg border-2 ${optionText} transition-colors disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tone}`}
              >
                <span aria-hidden="true" className="shrink-0 w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300 flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span lang="es" className="block break-words">{option}</span>
                  {/* usted / ustedes differ by two letters: side by side, the meaning goes under them (v1.24.0). */}
                  {prompt.direction === 'fromForm' && glossText(optionGloss(option), t) && (
                    <span className="block text-sm text-gray-600 dark:text-gray-300">{glossText(optionGloss(option), t)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : prompt.direction === 'toForm' ? (
        <TypedForm prompt={prompt} locked={locked} sending={sending} onSubmit={submitTimed} onTyping={setTyping} titleId={titleId} />
      ) : (
        // A "name the verb" question typed: only a round from before v1.13 still has one (it is multiple choice now).
        <IdentifyForm prompt={prompt} locked={locked} sending={sending} onSubmit={submitTimed} />
      )}

      {feedback && (
        <div className="space-y-4">
          <Verdict prompt={prompt} feedback={feedback} onOpenGuide={onOpenGuide} openSections={openSections} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button ref={nextRef} type="button" onClick={onNext} disabled={sending} className={`${primary} w-full sm:w-auto`}>
              {feedback.finished ? t('See results') : t('Next')}
            </button>
            {prompt.sentence && onReport && <ReportSentence onReport={onReport} onDone={() => nextRef.current?.focus()} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** The prompt's tense, in blue capitals; with the guide, a way to its chapter on that tense. */
function TenseLabel({ label, onOpen }: { label: string; onOpen?: () => void }) {
  const { t } = useI18n();
  const look = 'text-sm font-medium uppercase tracking-wide text-blue-700 dark:text-blue-400';
  if (!onOpen) return <p lang="es" className={`mt-3 ${look}`}>{label}</p>;
  return (
    <p className="mt-3">
      <button
        type="button"
        onClick={onOpen}
        // py-1 -my-1: a taller tap target on a phone, the line's height unchanged.
        className={`${look} inline-flex items-center gap-1.5 rounded py-1 -my-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        <span lang="es">{label}</span>
        <span aria-hidden="true" className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-current text-[10px] leading-none normal-case">?</span>
        <span className="sr-only">{t('(about this tense, in the guide)')}</span>
      </button>
    </p>
  );
}

/** A word as the echo check compares it: no case, accents or punctuation. */
const echoWord = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¡!¿?.,;:"“”«»]/g, '');

/**
 * What a sentence's blank shows while the student types (v1.25.0): the typed text without the parts of the
 * sentence it repeats, so "Mi prima se llama Ana." shows "se llama" in the blank, not the whole sentence again.
 * The echo is the end of the text before the blank and the start of the text after it, as the server trims it
 * before grading; this is only what the page shows (the server still grades what was typed). Anything that is
 * all echo is shown as typed.
 */
export function blankFill(typing: string, sentence: Pick<PromptSentence, 'before' | 'after'>): string {
  const typed = typing.trim().split(/\s+/).filter(Boolean);
  const n = typed.length;
  if (n < 2) return typing.trim();
  const t = typed.map(echoWord);
  const before = sentence.before.split(/\s+/).map(echoWord).filter(Boolean);
  const after = sentence.after.split(/\s+/).map(echoWord).filter(Boolean);
  let lead = 0;
  for (let k = Math.min(before.length, n - 1); k > 0; k--) {
    if (t.slice(0, k).every((w, i) => w === before[before.length - k + i])) { lead = k; break; }
  }
  let trail = 0;
  for (let j = Math.min(after.length, n - lead - 1); j > 0; j--) {
    if (t.slice(n - j).every((w, i) => w === after[i])) { trail = j; break; }
  }
  return typed.slice(lead, n - trail).join(' ');
}

/**
 * A sentence with its blank (v1.25.0): "Mis primos (ellos) ______ (vivir) en Lima." The blank is a visually
 * hidden "blank" and underscores screen readers skip; what the student types (or picks) shows in it as they go,
 * hidden from screen readers too, so the sentence reads the same with every key (and names the answer box). The
 * pronoun hint shows at multiple choice only, in grey.
 */
export function SentenceText({ sentence, id, typing = '', answered = false }: {
  sentence: PromptSentence;
  id?: string;
  typing?: string;
  /** After the answer: `typing` is the right form, shown in green. */
  answered?: boolean;
}) {
  const { t, locale } = useI18n();
  const shown = answered ? typing : blankFill(typing, sentence);
  const tone = !shown
    ? 'border-transparent text-gray-500 dark:text-gray-400'
    : answered
      ? 'border-green-600 text-green-800 dark:border-green-500 dark:text-green-300'
      : 'border-blue-500 text-blue-700 dark:text-blue-300';
  return (
    <p id={id} lang="es" className="mt-1 text-xl sm:text-2xl font-semibold leading-relaxed text-gray-900 dark:text-gray-100 break-words">
      {sentence.before}
      {sentence.hint && <>{' '}<span className="font-normal text-gray-600 dark:text-gray-400">({sentence.hint})</span></>}
      {sentence.before && ' '}
      <span className="sr-only" lang={locale}>{t('blank')}</span>
      <span
        aria-hidden="true"
        className={`inline-block min-w-[5ch] px-1 border-b-2 text-center ${tone}`}
      >
        {shown || '______'}
      </span>
      {' '}
      <span className="font-normal text-gray-600 dark:text-gray-300">({sentence.cue})</span>
      {sentence.after && ' '}
      {sentence.after}
    </p>
  );
}

/** "Word help" (v1.25.0): one button for the meanings of the sentence's words, from the deck's cards. */
function WordHelp({ glosses }: { glosses: PromptSentence['glosses'] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (glosses.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center min-h-[24px] px-2 py-1 -mx-2 rounded text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {open ? t('Hide word help') : t('Word help')}
      </button>
      <dl id={id} hidden={!open} className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {glosses.map((g) => (
          <Fragment key={g.es}>
            <dt lang="es" className="font-medium text-gray-900 dark:text-gray-100">{g.es}</dt>
            <dd lang="en" className="text-gray-700 dark:text-gray-300">{g.en}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

export function PromptText({ prompt, titleId, onOpenGuide, tenseChapter, typing, answered }: {
  prompt: Prompt;
  titleId: string;
  onOpenGuide?: OpenGuide;
  tenseChapter?: GuideTarget['chapter'];
  /** What the student has typed (or picked), for a sentence's blank; after the answer, the right form. */
  typing?: string;
  answered?: boolean;
}) {
  const { t, locale: lang } = useI18n();
  const openTense = onOpenGuide && tenseChapter ? () => onOpenGuide({ chapter: tenseChapter }) : undefined;
  if (prompt.direction === 'toForm' && prompt.sentence) {
    const instruction = prompt.kind === 'choice' ? t('Pick the verb that fills the blank.') : t('Type the verb that fills the blank.');
    return (
      <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{instruction}</p>
        {prompt.tenseLabel && <TenseLabel label={prompt.tenseLabel} onOpen={openTense} />}
        <SentenceText sentence={prompt.sentence} id={titleId} typing={typing} answered={answered} />
        <WordHelp glosses={prompt.sentence.glosses} />
      </div>
    );
  }
  if (prompt.direction === 'toForm') {
    const instruction = prompt.kind === 'choice' ? t('Pick the right form.') : t('Type the right form.');
    const gloss = promptGloss(prompt, t);
    return (
      <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{instruction}</p>
        {prompt.tenseLabel && <TenseLabel label={prompt.tenseLabel} onOpen={openTense} />}
        <p id={titleId} lang="es" className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 break-words">
          {prompt.personLabel && <span>{prompt.personLabel} </span>}
          <span className={prompt.personLabel ? 'text-gray-600 dark:text-gray-300 font-semibold' : undefined}>
            {prompt.personLabel ? `(${prompt.entryLabel})` : prompt.entryLabel}
          </span>
          {/* "haber", "llover": the verb used impersonally (hay, hubo, llueve). */}
          {prompt.entryHint === 'impersonal' && (onOpenGuide ? (
            <button
              type="button"
              lang={lang}
              onClick={() => onOpenGuide({ chapter: 'impersonal' })}
              className="ml-2 align-middle text-sm font-medium px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {t('impersonal')}
              <span className="sr-only"> {t('(what this means, in the guide)')}</span>
            </button>
          ) : (
            <span lang={lang} className="ml-2 align-middle text-sm font-medium px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              {t('impersonal')}
            </span>
          ))}
        </p>
        {/* What usted / ustedes / vosotros mean, at multiple choice only: the typed rungs drop it (v1.24.0). */}
        {gloss && <p id={`conj-gloss-${prompt.index}`} className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{gloss}</p>}
        {prompt.cue && (
          <p lang="es" className="mt-1 text-xl text-gray-800 dark:text-gray-200 break-words">+ {prompt.cue}</p>
        )}
      </div>
    );
  }
  // Every option is a form of one verb: it is named here, not in each option (v1.24.0), in a Spanish voice.
  let instruction: ReactNode;
  if (prompt.kind !== 'choice') {
    instruction = t('Which verb is this? Type its dictionary form (infinitive).');
  } else if (prompt.optionsVerb) {
    const [before, after = ''] = t('Which form of {{verb}} is this?', { verb: VERB_SLOT }).split(VERB_SLOT);
    instruction = <>{before}<span lang="es">{prompt.optionsVerb}</span>{after}</>;
  } else {
    instruction = t('Which verb form is this?');
  }
  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{instruction}</p>
      {prompt.tenseLabel && <TenseLabel label={prompt.tenseLabel} onOpen={openTense} />}
      <p id={titleId} lang="es" className="mt-1 text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 break-words">{prompt.form}</p>
    </div>
  );
}

/**
 * An Enter held on the last prompt's Next repeats into this one's focused input: a repeat must not submit
 * the form (an empty answer, and a "Type your answer first." for nothing).
 */
function ignoreHeldEnter(e: ReactKeyboardEvent<HTMLFormElement>) {
  if (e.key === 'Enter' && e.repeat) e.preventDefault();
}

/** A text input with the accent keys; the caret survives an inserted character. */
function AccentInput({ id, label, value, onChange, disabled, autoFocus, alsoNamedBy }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoFocus: boolean;
  /** An element whose text completes the box's name (v1.25.0: the sentence, with "blank" for its blank). */
  alsoNamedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The value is controlled, so the spliced text reaches the DOM on the next render: the caret waits here.
  const caretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const c = caretRef.current;
    if (c === null) return;
    caretRef.current = null;
    restoreCaret(inputRef.current, c);
  }, [value]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  return (
    <div className="space-y-2">
      <label id={`${id}-label`} htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <input
        ref={inputRef}
        id={id}
        aria-labelledby={alsoNamedBy ? `${id}-label ${alsoNamedBy}` : undefined}
        type="text"
        lang="es"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={200}
        value={value}
        readOnly={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-lg rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 read-only:bg-gray-50 dark:read-only:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className={charKeysLook}>
        <CharKeys
          disabled={disabled}
          onInsert={(ch) => {
            const next = insertIntoInput(inputRef.current, value, ch);
            caretRef.current = next.caret;
            onChange(next.value);
          }}
        />
      </div>
    </div>
  );
}

function TypedForm({ prompt, locked, sending, onSubmit, onTyping, titleId }: {
  prompt: Prompt;
  locked: boolean;
  sending: boolean;
  onSubmit: (answer: AnswerInput, given: string) => void;
  /** Each change of the text, for the sentence's blank (v1.25.0). */
  onTyping?: (text: string) => void;
  /** The prompt's sentence (its id), which completes the box's name. */
  titleId?: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
    const answer = text.trim();
    if (!answer) {
      setMissing(t('Type your answer first.'));
      return;
    }
    setMissing(null);
    onSubmit({ text: answer }, answer);
  };
  return (
    <form onSubmit={submit} onKeyDown={ignoreHeldEnter} className="space-y-3" noValidate>
      <AccentInput
        id={`conj-answer-${prompt.index}`}
        label={prompt.strictAccents ? t('Your answer (accents count)') : t('Your answer')}
        value={text}
        onChange={(v) => { setText(v); setMissing(null); onTyping?.(v); }}
        disabled={locked}
        autoFocus
        alsoNamedBy={prompt.sentence ? titleId : undefined}
      />
      {missing && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{missing}</p>}
      {!locked || sending ? (
        <button type="submit" disabled={locked} className={`${primary} w-full sm:w-auto`}>
          {sending ? t('Checking…') : t('Check')}
        </button>
      ) : null}
    </form>
  );
}

/** Radio chips: one choice, arrow keys move between them. */
function Chips<T extends string>({ legend, name, options, value, onChange, disabled }: {
  legend: string;
  name: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.id} className="relative">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              disabled={disabled}
              className="peer sr-only"
            />
            <span
              lang="es"
              className="inline-block px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:border-blue-500 peer-checked:bg-blue-600 peer-checked:border-blue-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-gray-800 peer-disabled:cursor-default"
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function IdentifyForm({ prompt, locked, sending, onSubmit }: {
  prompt: Prompt;
  locked: boolean;
  sending: boolean;
  onSubmit: (answer: AnswerInput, given: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const [tense, setTense] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const persons = prompt.askPerson ? prompt.personOptions ?? [] : [];
  const tenses = prompt.askTense ? prompt.tenseOptions ?? [] : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
    const verb = text.trim();
    if (!verb) return setMissing(t('Type the verb first.'));
    if (persons.length > 0 && !person) return setMissing(t('Pick who.'));
    if (tenses.length > 0 && !tense) return setMissing(t('Pick the tense.'));
    setMissing(null);
    const given = [
      verb,
      persons.find((p) => p.id === person)?.label,
      tenses.find((x) => x.id === tense)?.label,
    ].filter(Boolean).join(' · ');
    onSubmit({
      text: verb,
      ...(persons.length > 0 && person ? { person } : {}),
      ...(tenses.length > 0 && tense ? { tense } : {}),
    }, given);
  };

  return (
    <form onSubmit={submit} onKeyDown={ignoreHeldEnter} className="space-y-4" noValidate>
      <AccentInput
        id={`conj-verb-${prompt.index}`}
        label={prompt.strictAccents ? t('The verb, in its dictionary form (infinitive; accents count)') : t('The verb, in its dictionary form (infinitive)')}
        value={text}
        onChange={(v) => { setText(v); setMissing(null); }}
        disabled={locked}
        autoFocus
      />
      {persons.length > 0 && (
        <Chips
          legend={t('Who?')}
          name={`conj-person-${prompt.index}`}
          options={persons}
          value={person}
          onChange={(id) => { setPerson(id); setMissing(null); }}
          disabled={locked}
        />
      )}
      {tenses.length > 0 && (
        <Chips
          legend={t('Which tense?')}
          name={`conj-tense-${prompt.index}`}
          options={tenses}
          value={tense}
          onChange={(id) => { setTense(id); setMissing(null); }}
          disabled={locked}
        />
      )}
      {missing && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{missing}</p>}
      {!locked || sending ? (
        <button type="submit" disabled={locked} className={`${primary} w-full sm:w-auto`}>
          {sending ? t('Checking…') : t('Check')}
        </button>
      ) : null}
    </form>
  );
}

/**
 * "Something's wrong with this sentence" (v1.25.0), after the answer: it only queues the sentence for the
 * teacher. Said once; a failure can be tried again.
 */
/**
 * "Something's wrong with this sentence" after the answer (v1.25.0): it only queues the sentence for the
 * teacher. The thank-you goes into a live region that is there from the start (one inserted with its text is
 * often not read out), and the button's focus moves on to Next (`onDone`) rather than falling to the page.
 */
function ReportSentence({ onReport, onDone }: { onReport: () => Promise<void>; onDone: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state !== 'done' && (
        <button
          type="button"
          disabled={state === 'sending'}
          onClick={() => {
            setState('sending');
            onReport().then(() => {
              setState('done');
              onDone();
            }, () => setState('failed'));
          }}
          className="inline-flex items-center min-h-[24px] px-1 text-sm text-gray-600 dark:text-gray-400 underline hover:no-underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          {t('Something’s wrong with this sentence')}
        </button>
      )}
      <span role="status" className="text-sm text-gray-600 dark:text-gray-400">
        {state === 'done' ? t('Thank you. Your teacher will look at this sentence.') : ''}
      </span>
      {state === 'failed' && <span role="alert" className="text-sm text-red-700 dark:text-red-400">{t('Could not send it. Try again.')}</span>}
    </span>
  );
}

/** When a mastered form comes back for review, in words: "tomorrow", "in 3 days", "in a week", "in 8 weeks". */
function comesBack(days: number, t: Translate): string {
  if (days <= 1) return t('It comes back for review tomorrow.');
  if (days < 7) return t('It comes back for review in {{n}} days.', { n: days });
  const weeks = Math.round(days / 7);
  return weeks === 1 ? t('It comes back for review in a week.') : t('It comes back for review in {{n}} weeks.', { n: weeks });
}

/** A link in a verdict to a part of the guide. Next keeps the focus, so Enter still moves on. */
function GuideLink({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="underline font-medium hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
    >
      {label}
    </button>
  );
}

function Verdict({ prompt, feedback, onOpenGuide, openSections }: {
  prompt: Prompt;
  feedback: Feedback;
  onOpenGuide?: OpenGuide;
  openSections?: ReadonlySet<string>;
}) {
  const { t } = useI18n();
  const { counted, nearMiss } = feedback;
  const tone = counted
    ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-200'
    : nearMiss
      ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200'
      : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-200';
  const form = <span lang="es" className="font-semibold">{feedback.correctAnswer}</span>;
  const leveledUp = counted && !feedback.mastered && feedback.levelKindAfter !== prompt.level;
  const others = otherAnswers(prompt, feedback);
  let levelUpNote: string | null = null;
  if (leveledUp && prompt.level === 'choice' && feedback.levelKindAfter === 'typed-strict') {
    // A ladder without the lenient rung: typing and accents both start next time.
    levelUpNote = t('Next time, you type it, and the accents count.');
  } else if (leveledUp && feedback.levelKindAfter === 'typed-lenient') {
    levelUpNote = t('Next time, you type it.');
  } else if (leveledUp && feedback.levelKindAfter === 'typed-strict') {
    levelUpNote = t('Next time, the accents count.');
  }

  // What the answer did to the item. A replay of an answer taken before v1.13 has no outcome: "Mastered!" as it said then.
  const outcome = feedback.outcome as AnswerResult['outcome'] | undefined;
  const masteredNow = outcome ? outcome === 'mastered' : counted && feedback.mastered;
  const days = feedback.nextReviewDays ?? null;
  let outcomeNote: string | null = null;
  if (outcome === 'pending') outcomeNote = t('Right on the top rung! Get it right again on another day to master it.');
  else if (outcome === 'reviewed' || outcome === 'early') outcomeNote = t('Still mastered.');
  else if (outcome === 'lapse') outcomeNote = t('No longer mastered: it goes back to practice.');
  const reviewNote = (masteredNow || outcome === 'reviewed') && days !== null ? comesBack(days, t) : null;

  // A named mistake: one line, and the part of this deck's guide that explains it. A sentence's subject
  // stands in for the label (v1.25.0), and a mistake about who points to "Who is the subject?" first.
  const sentence = feedback.sentence ?? null;
  const subject = sentence?.subject ?? null;
  // The prompt's own label and cue are for pages older than v1.25.0 (the sentence names its own thing liked).
  const asked = sentence
    ? { ...prompt, cue: null, ...(subject ? { personId: subject.person, personLabel: subject.es, subjectPronoun: subject.pronoun } : { personLabel: null }) }
    : prompt;
  const line = mistakeLine(feedback.mistake, asked, feedback.correctAnswer, t);
  const whoSections = sentence && feedback.mistake && ['person', 'dativeSubject', 'dativeNumber'].includes(feedback.mistake.kind)
    ? (prompt.entryLabel === 'gustarle' || feedback.mistake.kind !== 'person' ? ['persons-who-subject-gustar', 'persons-who-subject'] : ['persons-who-subject'])
    : [];
  const section = line ? guideSectionFor([...whoSections, ...(feedback.mistake?.guideSections ?? [])], openSections) : undefined;

  let headline;
  if (counted && nearMiss) {
    headline = <>✓ {t('Correct, but watch the accent:')} {form}</>;
  } else if (counted) {
    headline = <>✓ {t('Correct!')}</>;
  } else if (nearMiss) {
    headline = <>{t('Almost — check the accent:')} {form}</>;
  } else {
    headline = <>✗ {t('Not quite. The answer:')} {form}</>;
  }

  // Who shares the form (v1.24.0): the prompt named one subject; ellos, ellas and ustedes all take "tienen".
  const shared = feedback.sharedBy ?? null;
  const meaning = shared ? groupMeaning(shared, t) : null;

  return (
    <div role="status" className={`rounded-lg border p-4 space-y-1.5 ${tone}`}>
      <p className="text-lg font-medium break-words">{headline}</p>
      <ExtensionSlot name="conjugation.verdictNote" answer={feedback} />
      {/* The sentence filled in, what it means, and who the subject is (v1.25.0): the English only now. */}
      {sentence && (
        <div className="space-y-0.5">
          <p lang="es" className="font-medium break-words">{sentence.filled}</p>
          {sentence.english && <p lang="en" className="text-sm break-words">{sentence.english}</p>}
          {subject?.pronoun && (
            <p lang="es" className="text-sm break-words">
              {subject.es} = {subject.pronoun} → <span className="font-semibold">{subject.form}</span>
            </p>
          )}
        </div>
      )}
      {shared && (
        <p className="text-sm break-words">
          <span lang="es"><span className="font-semibold">{shared.form}</span> = {shared.subjects.join(' · ')}</span>
          {meaning && <> ({meaning})</>}
        </p>
      )}
      {!counted && feedback.given && (
        <p className="text-sm break-words">
          {t('You answered:')} <span lang="es">{feedback.given}</span>
        </p>
      )}
      {line && (
        <p className="text-sm break-words">
          {line}
          {onOpenGuide && section && (
            <>
              {' '}
              <GuideLink label={t('Why? See the guide.')} onOpen={() => onOpenGuide({ section })} />
            </>
          )}
        </p>
      )}
      {others.length > 0 && (
        <p className="text-sm break-words">
          {t('Also correct:')} <span lang="es">{others.join('; ')}</span>
        </p>
      )}
      {masteredNow && <p className="text-sm font-medium">{t('Mastered!')}</p>}
      {outcomeNote && <p className="text-sm font-medium">{outcomeNote}</p>}
      {reviewNote && <p className="text-sm">{reviewNote}</p>}
      {levelUpNote && (
        <p className="text-sm">
          {levelUpNote}
          {onOpenGuide && (
            <>
              {' '}
              <GuideLink
                label={t('What changes? See the guide.')}
                onOpen={() => onOpenGuide({ section: feedback.levelKindAfter === 'typed-strict' && prompt.level !== 'choice' ? 'quiz-accents' : 'quiz-typing' })}
              />
            </>
          )}
        </p>
      )}
      {feedback.requeued && <p className="text-sm">{t('This one comes back at the end of the round.')}</p>}
    </div>
  );
}
