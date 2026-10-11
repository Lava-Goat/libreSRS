// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import VocabTestRunner from '../vocab/VocabTestRunner';
import { ProfileView, recordsFromResults } from '../vocab/VocabProfile';
import { AURAL_BANK_MODES, MODE_LABELS, auralBankReadiness, estRecord, fmt, pct, type VocabMode, type VocabSummary, type VocabTestSettings } from '../vocab/logic';

interface ActiveTest {
  id: number;
  mode: VocabMode;
  settings: VocabTestSettings;
  occasion: string | null;
  name: string;
  excludeWords?: string[];
  audioWords?: string[];
  texts?: { id: number; title: string; content: string }[];
}

export default function Vocabulometro() {
  const { user, logout } = useAuth();
  const { t, formatDate } = useI18n();
  usePageTitle('Vocabulómetro');
  const [active, setActive] = useState<ActiveTest | null>(null);
  const utils = trpc.useUtils();

  const { data: tests, isLoading } = trpc.vocab.listOpenTests.useQuery(undefined, {
    enabled: !active,
  });
  const { data: myResults } = trpc.vocab.getMyResults.useQuery(undefined, {
    enabled: !active,
  });
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const startTokenRef = useRef(0);

  const startTest = async (test: {
    id: number; mode: string; settings: unknown; occasion: string | null; name: string;
  }) => {
    // Re-entry guard: while one start is in flight (or a test is running),
    // ignore further clicks — otherwise a slow seen-words fetch could resolve
    // late and swap the runner's props mid-session.
    if (starting !== null || active) return;
    setStartError(null);
    const token = ++startTokenRef.current;
    const settings = (test.settings ?? {}) as VocabTestSettings;
    let excludeWords: string[] | undefined;
    let audioWords: string[] | undefined;
    let texts: { id: number; title: string; content: string }[] | undefined;
    if (test.mode === 'size') {
      setStarting(test.id);
      try {
        // Prefer unseen items on repeat administrations (avoids practice effects)
        const seen = await utils.vocab.getMySeenWords.fetch();
        excludeWords = seen.words;
      } catch {
        excludeWords = undefined; // fall back to unrestricted sampling
      } finally {
        setStarting(null);
      }
      if (token !== startTokenRef.current) return; // superseded while awaiting
    }
    if (AURAL_BANK_MODES.includes(test.mode as VocabMode)) {
      setStarting(test.id);
      try {
        const bank = await utils.vocab.getAudioBankWords.fetch({ accent: settings.accent ?? '' });
        audioWords = bank.words;
      } catch {
        audioWords = [];
      } finally {
        setStarting(null);
      }
      if (token !== startTokenRef.current) return;
      // Mode-aware readiness: listen2 needs at least one fully-covered band
      // plus a pseudoword dose; dictado needs real band words (pseudo clips
      // alone must not open the gate).
      const readiness = auralBankReadiness(audioWords ?? []);
      const ready = test.mode === 'listen2'
        ? readiness.coveredBands.length > 0 && readiness.pseudoReady >= 8
        : readiness.bandWordsReady >= 15;
      if (!ready) {
        setStartError(t('The audio bank for this test is not ready yet. Ask your teacher to generate it.'));
        return;
      }
    }
    if (test.mode === 'ctest') {
      setStarting(test.id);
      try {
        const res = await utils.vocab.getTestTexts.fetch({ testId: test.id });
        texts = res.texts;
      } catch {
        texts = [];
      } finally {
        setStarting(null);
      }
      if (token !== startTokenRef.current) return;
      if (!texts || texts.length === 0) {
        setStartError(t('This test has no source texts configured yet. Ask your teacher.'));
        return;
      }
    }
    setActive({
      id: test.id,
      mode: test.mode as VocabMode,
      settings,
      occasion: test.occasion,
      name: test.name,
      excludeWords,
      audioWords,
      texts,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-blue-600 dark:text-blue-400 hover:text-blue-800">
              ← {t('Back to Study')}
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Vocabu<span className="text-red-800 dark:text-red-400">lómetro</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-700 dark:text-gray-300">{user?.name}</span>
            <button
              onClick={logout}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              {t('Sign out')}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {active ? (
          <VocabTestRunner
            key={active.id}
            testId={active.id}
            mode={active.mode}
            settings={active.settings}
            occasion={active.occasion}
            excludeWords={active.excludeWords}
            audioWords={active.audioWords}
            texts={active.texts}
            onExit={() => {
              setActive(null);
              utils.vocab.listOpenTests.invalidate();
              utils.vocab.getMyResults.invalidate();
            }}
          />
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t('Available tests')}
              </h2>
              {startError && (
                <div className="mb-4 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 text-sm text-orange-800 dark:text-orange-300">
                  {startError}
                </div>
              )}
              {isLoading ? (
                <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
              ) : !tests || tests.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6 text-gray-500 dark:text-gray-400">
                  {t('No vocabulary tests are open for your groups right now.')}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tests.map((test) => (
                    <div key={test.id} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 border-t-4 border-red-800 dark:border-red-500">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-sm">
                        {test.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {MODE_LABELS[test.mode as VocabMode]}
                        {test.occasion ? ` · ${test.occasion}` : ''}
                      </p>
                      <div className="flex items-center justify-between mt-4">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {test.myAttempts > 0
                            ? t('{{count}} previous attempt(s)', { count: test.myAttempts })
                            : t('Not attempted yet')}
                          {test.closesAt ? ` · ${t('closes')} ${formatDate(test.closesAt)}` : ''}
                        </span>
                        <button
                          onClick={() => startTest(test)}
                          disabled={starting !== null}
                          className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                        >
                          {starting === test.id ? t('Loading...') : t('Start')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {myResults && myResults.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  {t('My progress')}
                </h2>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 mb-8 vm-root">
                  <ProfileView records={recordsFromResults(myResults, user?.name ?? '')} compact />
                </div>
              </section>
            )}

            {myResults && myResults.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  {t('My results')}
                </h2>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('Date')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('Test')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('Summary')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {myResults.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {formatDate(r.completedAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                            {r.testName}
                            {r.occasion ? <span className="text-gray-400"> · {r.occasion}</span> : null}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {resultSummaryLabel(r.mode as VocabMode, r.summaryJson, r.blk, r.form)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function resultSummaryLabel(mode: VocabMode, summaryJson: string, blk: string | null, form: string | null): string {
  try {
    const summary = JSON.parse(summaryJson) as VocabSummary;
    if (summary.v === 2) {
      return `${mode} · bloque ${blk ?? '?'}${form ?? ''} · ${summary.res.length} palabras`;
    }
    const e = estRecord(summary);
    // estRecord returns the unclamped corrected score (class means need it raw);
    // a single student's own row clamps so a below-chance draw is not shown negative.
    if (e.mast !== undefined) return `${pct(Math.max(0, e.mast), 0)} dominio`;
    if (e.size !== undefined) return `${fmt(e.size)} pal · ${pct(e.cov ?? 0, 0)}`;
    return mode;
  } catch {
    return mode;
  }
}
