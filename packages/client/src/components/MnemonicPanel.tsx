// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useState, useEffect, useCallback, useRef } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';
import { aiErrorMessage } from '../utils/aiErrors';

/** 'manual': a teacher asks for a suggestion on any card. 'disabled': no new suggestions. */
type MnemonicMode = 'manual' | 'disabled';

/**
 * The two kinds of suggestion since v1.20.0, and the teacher picks: 'keyword', a sound-alike
 * keyword in one scene with the meaning; 'sentence', a short example sentence, for words that are
 * hard to picture (pero, porque, también, verb forms). Suggestions from before v1.20.0 are keywords.
 */
export type MnemonicStyle = 'keyword' | 'sentence';

interface Suggestion {
  id: number;
  text: string;
  style: MnemonicStyle;
}

/** A suggestion row as the server sends it; a row with no style (older ones) is a keyword. */
function toSuggestion(row: { id: number; text: string; style?: string | null }, fallback: MnemonicStyle = 'keyword'): Suggestion {
  const style = row.style === 'keyword' || row.style === 'sentence' ? row.style : fallback;
  return { id: row.id, text: row.text, style };
}

const otherStyle = (style: MnemonicStyle): MnemonicStyle => (style === 'sentence' ? 'keyword' : 'sentence');

interface Props {
  cardId: number;
  allowGenerate?: boolean;
  mnemonicMode?: MnemonicMode;
}

/**
 * A card's mnemonic. Students read the one their teacher approved — a plain
 * database read; they never cause a generation (before v1.8.0 every student
 * card view generated one). Teachers see
 * suggestions, approve one for everyone, or ask for another. Nothing is
 * suggested on its own: since v1.20.0 (the cognate system's removal) the
 * teacher asks for a suggestion on any card, as a keyword picture or, for a
 * word that is hard to picture, an example sentence, and can go back and forth
 * between the two before choosing.
 *
 * FlashcardReview keeps one panel for the whole session, so a teacher's action
 * belongs to the card it was pressed on: a suggestion still being written for
 * one card locks nothing on the next.
 */
export default function MnemonicPanel({
  cardId,
  allowGenerate = true,
  mnemonicMode = 'manual',
}: Props) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const utils = trpc.useUtils();
  // Suggestions written during this visit to the card, the newest of each style, and the style
  // on screen (null: the newest one the server keeps).
  const [drafts, setDrafts] = useState<Partial<Record<MnemonicStyle, Suggestion>>>({});
  const [shownStyle, setShownStyle] = useState<MnemonicStyle | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Why the last suggestion failed (out of credit, a rejected key, a busy provider…); the
  // teacher's only, since students never generate. Before v1.20.0 a failure showed nothing.
  const [generateError, setGenerateError] = useState<unknown>(null);
  // One teacher action at a time on a card, from the press to the last request it makes: "Try
  // another" is a reject and then a generation, and a second press (or a re-render) in between
  // must not pay for a second suggestion. The ref answers at once; the state disables the buttons.
  // Both are per card, so moving on to the next card while one is written locks nothing there.
  const inFlight = useRef(new Set<number>());
  const [workingOn, setWorkingOn] = useState<number[]>([]);
  const [generatingFor, setGeneratingFor] = useState<number[]>([]);
  // The card on screen, so an answer for a card the teacher already left is not shown on this one.
  const shownCard = useRef(cardId);

  const aiStateQuery = trpc.ai.getCardAiState.useQuery({ cardId });
  const generateMutation = trpc.ai.generateMnemonic.useMutation();
  const acceptMutation = trpc.ai.acceptMnemonic.useMutation();
  const rejectMutation = trpc.ai.rejectMnemonic.useMutation();
  const deleteMutation = trpc.ai.deleteMnemonic.useMutation();

  const acceptedMnemonic = aiStateQuery.data?.acceptedMnemonic ?? null;
  // A suggestion the teacher has not reviewed yet: generated just now, or
  // stored from an earlier visit (shown again rather than paid for again).
  const storedPending = aiStateQuery.data?.pendingMnemonic;
  const storedByStyle = aiStateQuery.data?.pendingByStyle;
  /** The suggestion of a style that waits for the teacher, if any: this visit's, else the stored one. */
  const waiting = (style: MnemonicStyle): Suggestion | null => {
    const stored = storedByStyle?.[style];
    return drafts[style] ?? (stored ? toSuggestion(stored, style) : null);
  };
  const shown = shownStyle ? waiting(shownStyle) : null;
  const suggestion = shown ?? (storedPending ? toSuggestion(storedPending) : null);
  const canGenerate = isAdmin && allowGenerate && mnemonicMode !== 'disabled';
  const busy = workingOn.includes(cardId);
  const generating = generatingFor.includes(cardId);

  /** Runs one teacher action on this card; a press while another runs on it does nothing. */
  const run = useCallback(async (task: () => Promise<unknown>) => {
    const forCard = cardId;
    if (inFlight.current.has(forCard)) return;
    inFlight.current.add(forCard);
    setWorkingOn((ids) => [...ids, forCard]);
    try {
      await task();
    } finally {
      inFlight.current.delete(forCard);
      setWorkingOn((ids) => ids.filter((id) => id !== forCard));
    }
  }, [cardId]);

  const generate = useCallback(async (style: MnemonicStyle) => {
    const forCard = cardId;
    setGenerateError(null);
    setGeneratingFor((ids) => [...ids, forCard]);
    try {
      const result = await generateMutation.mutateAsync({ cardId: forCard, style });
      const next = toSuggestion(result, style);
      // Remember it in the cache too: if this card comes round again, the stored
      // suggestion is shown instead of paying for another.
      utils.ai.getCardAiState.setData({ cardId: forCard }, (d) => (d ? {
        ...d,
        pendingMnemonic: next,
        pendingByStyle: { ...d.pendingByStyle, [style]: next },
      } : d));
      if (shownCard.current === forCard) {
        setDrafts((current) => ({ ...current, [style]: next }));
        setShownStyle(style);
      }
    } catch (err) {
      if (shownCard.current === forCard) setGenerateError(err);
    } finally {
      setGeneratingFor((ids) => ids.filter((id) => id !== forCard));
    }
  }, [cardId, generateMutation, utils]);

  /**
   * Runs a teacher's action on a suggestion; whatever happens, show the server's truth afterwards.
   * `done` forgets what the action used up. True when the action went through.
   */
  const act = useCallback(async (action: () => Promise<unknown>, done: () => void): Promise<boolean> => {
    setActionError(null);
    let ok = false;
    try {
      await action();
      ok = true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('Something went wrong. Try again.'));
    } finally {
      done();
      await utils.ai.getCardAiState.invalidate({ cardId });
    }
    return ok;
  }, [cardId, t, utils]);

  /** Forgets one suggestion written this visit (it was turned down). */
  const forget = (gone: Suggestion) => () => setDrafts((current) => (
    current[gone.style]?.id === gone.id ? { ...current, [gone.style]: undefined } : current
  ));
  /** Forgets every suggestion written this visit (one was approved, or the mnemonic deleted). */
  const forgetAll = () => {
    setDrafts({});
    setShownStyle(null);
  };

  /**
   * "Try another": the shown suggestion is turned down, then another of the same style is asked
   * for. A rejected suggestion is kept, so the next one is told it was already suggested; if the
   * reject fails, nothing new is paid for.
   */
  const another = (current: Suggestion) => run(async () => {
    if (!(await act(() => rejectMutation.mutateAsync({ mnemonicId: current.id }), forget(current)))) return;
    await generate(current.style);
  });

  /**
   * "Try a sentence" / "Try a keyword": the other style, turning nothing down, so the teacher can
   * compare the two and choose. One already waiting in that style is shown again for free.
   */
  const switchTo = (style: MnemonicStyle) => {
    if (waiting(style)) {
      setGenerateError(null);
      setShownStyle(style);
      return Promise.resolve();
    }
    return run(() => generate(style));
  };

  /** Without generation (the Disabled mode, or suggestions off) a suggestion can only be turned down. */
  const dismiss = (current: Suggestion) => run(() => act(() => rejectMutation.mutateAsync({ mnemonicId: current.id }), forget(current)));

  const accept = (current: Suggestion) => run(() => act(() => acceptMutation.mutateAsync({ mnemonicId: current.id }), forgetAll));

  // Forget this visit's suggestions (and why one failed) when the card changes; stored ones come back from the query.
  useEffect(() => {
    shownCard.current = cardId;
    setDrafts({});
    setShownStyle(null);
    setGenerateError(null);
  }, [cardId]);

  const generateAlert = generateError !== null && (
    <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{aiErrorMessage(generateError, t)}</p>
  );

  // No mode hides an approved mnemonic: 'disabled' only stops generation
  // ("Existing saved mnemonics still appear"), and students never generate.

  if (acceptedMnemonic) {
    const fromTeacher = acceptedMnemonic.source === 'teacher';
    // Only a suggestion asked for on this visit shows under an approved mnemonic.
    const extra = shown && drafts[shown.style]?.id === shown.id ? shown : null;
    return (
      <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm">
        <div className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">{t('Mnemonic')}</div>
        <div className="text-yellow-700 dark:text-yellow-400 whitespace-pre-line">{acceptedMnemonic.text}</div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-yellow-700 dark:text-yellow-400">
            {fromTeacher ? t('Chosen by your teacher') : t('AI-generated')}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              {canGenerate && !extra && (
                <button
                  // Another of the same kind: a sentence for a card whose approved mnemonic is one.
                  onClick={() => void run(() => generate(acceptedMnemonic.style === 'sentence' ? 'sentence' : 'keyword'))}
                  disabled={busy}
                  className="text-xs text-yellow-700 dark:text-yellow-400 hover:text-yellow-900 disabled:opacity-50"
                >
                  {generating ? t('Generating...') : t('Regenerate')}
                </button>
              )}
              <button
                onClick={() => void run(() => act(() => deleteMutation.mutateAsync({ cardId }), forgetAll))}
                disabled={busy}
                className="text-xs text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
              >
                {t('Delete')}
              </button>
            </div>
          )}
        </div>
        {isAdmin && extra && (
          <SuggestionActions
            suggestion={extra}
            canGenerate={canGenerate}
            busy={busy}
            generating={generating}
            onAccept={() => accept(extra)}
            onAnother={() => another(extra)}
            onSwitch={() => switchTo(otherStyle(extra.style))}
            onDismiss={() => dismiss(extra)}
          />
        )}
        {isAdmin && generateAlert}
        {actionError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
      </div>
    );
  }

  // Everything below is the teacher's; a student with no approved mnemonic sees nothing.
  if (!isAdmin) return null;

  if (suggestion) {
    return (
      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
        <div className="font-medium text-blue-800 dark:text-blue-300 mb-1">{t('Mnemonic suggestion')}</div>
        <SuggestionActions
          suggestion={suggestion}
          canGenerate={canGenerate}
          busy={busy}
          generating={generating}
          onAccept={() => accept(suggestion)}
          onAnother={() => another(suggestion)}
          onSwitch={() => switchTo(otherStyle(suggestion.style))}
          onDismiss={() => dismiss(suggestion)}
        />
        {generateAlert}
        {actionError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
      </div>
    );
  }

  if (!canGenerate) return null;

  const suggestButton = 'text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 disabled:opacity-50';
  return (
    <div className="mt-3">
      {generating ? (
        <button disabled className={suggestButton}>{t('Generating...')}</button>
      ) : (
        // Both kinds from the start: a word that is hard to picture (pero, porque) needs no keyword first.
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button onClick={() => void run(() => generate('keyword'))} disabled={busy} className={suggestButton}>
            {t('Suggest a mnemonic')}
          </button>
          <button onClick={() => void run(() => generate('sentence'))} disabled={busy} className={suggestButton}>
            {t('Suggest a sentence')}
          </button>
        </div>
      )}
      {generateAlert}
      {actionError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
    </div>
  );
}

/**
 * A suggestion as students would see it, its style, and the teacher's choices: use it, another
 * of the same style, or the other style. Without generation, only use it or dismiss it.
 */
function SuggestionActions({ suggestion, canGenerate, busy, generating, onAccept, onAnother, onSwitch, onDismiss }: {
  suggestion: Suggestion;
  canGenerate: boolean;
  busy: boolean;
  generating: boolean;
  onAccept: () => Promise<void>;
  onAnother: () => Promise<void>;
  onSwitch: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const { t } = useI18n();
  const isSentence = suggestion.style === 'sentence';
  const secondary = 'px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50';
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {isSentence ? t('Example sentence') : t('Keyword picture')}
      </div>
      <div className="text-blue-700 dark:text-blue-400 mb-2 whitespace-pre-line">{suggestion.text}</div>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{t('Use it and every student sees it on this card.')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void onAccept()}
          disabled={busy}
          className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
        >
          {t('Use for everyone')}
        </button>
        {canGenerate ? (
          <>
            <button onClick={() => void onAnother()} disabled={busy} className={secondary}>
              {t('Try another')}
            </button>
            {/* The keyword style is text, not a picture: the card's own picture is the control above. */}
            <button onClick={() => void onSwitch()} disabled={busy} className={secondary}>
              {isSentence ? t('Try a keyword') : t('Try a sentence')}
            </button>
          </>
        ) : (
          <button onClick={() => void onDismiss()} disabled={busy} className={secondary}>
            {t('Dismiss')}
          </button>
        )}
      </div>
      {generating && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 animate-pulse">{t('Generating...')}</p>
      )}
    </div>
  );
}
