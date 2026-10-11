// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Test-taking engine for the Vocabulómetro, ported from the standalone single-file build
// (an earlier version of tools/vocabulometro-offline/vocabulometro.html).
// The session object is held in a ref and mutated exactly like the original's
// global S; a tick counter drives re-renders after each answer.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { trpc } from '../api/trpc';
import {
  AURAL_BANK_MODES, DATA, LDT_DEFAULT_DEADLINE_MS, MODE_LABELS,
  type CtestGap, type CtestPassage, type DictadoItem, type DictadoResponse, type McItem,
  type McResponse, type ProtocolItem, type SimpleItem, type VocabMode, type VocabSummary,
  type VocabTestSettings, type YnItem, type YnResponse,
  acceptActive, acceptDictado, bandOfIdx, bandsCovered, buildCtestForm, buildDictadoItems,
  buildListen2Items, buildListenItems, buildMasteryItems, buildProtocolQueue, buildSizeItems,
  ctestExact, ctestLenient, cueOf, glossOf, mcFor, mulberry32, randomSeed, summaryFromCtest,
  summaryFromDictado, summaryFromLdt, summaryFromMc, summaryFromProtocol, summaryFromYn,
  withinLockout, ynEstimates, ALLWORDS,
} from './logic';
import CharKeys, { insertIntoInput, restoreCaret } from './CharKeys';
import { CtestResultView, VocabResultView, VocabProtocolResultView } from './VocabResults';
import VocabEiRunner from './VocabEiRunner';
import './vocab.css';

interface SimpleSession {
  kind: 'simple';
  mode: 'size' | 'mastery' | 'listen' | 'listen2' | 'ldt';
  seed: number;
  items: SimpleItem[];
  i: number;
  resp: (YnResponse | McResponse)[];
  t0: number;
  plays: number;
  stopped?: number;
  /** ldt only: items that hit the response deadline (not scored as errors) */
  timeouts?: number;
}

interface ProtocolSession {
  kind: 'protocol';
  mode: 'c500' | 'a500' | 's5000';
  seed: number;
  blk: number | 'P';
  form: string;
  rnd: () => number;
  queue: ProtocolItem[];
  i: number;
  state: Record<number, number>;
  ps: [number, number];
  retest: string[];
  resp: Record<string, unknown>[];
  t0: number;
}

interface DictadoSession {
  kind: 'dictado';
  mode: 'dictado';
  seed: number;
  items: DictadoItem[];
  i: number;
  resp: DictadoResponse[];
  t0: number;
  plays: number;
}

/**
 * Modes whose stimulus is audio only. Their answer controls stay disabled
 * until the clip has played at least once — otherwise a student can click
 * through the whole test without ever hearing a word, and the resulting
 * "scores" look like data.
 */
const AURAL_MODES: string[] = ['listen', 'listen2', 'dictado'];

interface CtestSession {
  kind: 'ctest';
  mode: 'ctest';
  seed: number;
  passages: CtestPassage[];
  entries: { gap: CtestGap; typed: string; exact: boolean; lenient: boolean }[];
  i: number;   // unused (single-screen form); kept for the shared t0/index plumbing
  t0: number;
}

type Session = SimpleSession | ProtocolSession | DictadoSession | CtestSession;

export interface VocabTestRunnerProps {
  testId: number;
  mode: VocabMode;
  settings: VocabTestSettings;
  occasion?: string | null;
  /** Words already shown to this student in prior attempts — sampled last. */
  excludeWords?: string[];
  /** Ready audio-bank words for the test's accent (aural modes only). */
  audioWords?: string[];
  /** Source passages (ctest mode only). */
  texts?: { id: number; title: string; content: string }[];
  onExit: () => void;
}

function createSession(
  mode: VocabMode,
  settings: VocabTestSettings,
  excludeWords?: string[],
  audioWords?: string[],
  texts?: { id: number; title: string; content: string }[]
): Session {
  const seed = settings.seed ?? randomSeed();
  const rnd = mulberry32(seed);
  if (mode === 'ctest') {
    const passages = buildCtestForm(texts ?? [], settings.ngaps ?? 25);
    return { kind: 'ctest', mode, seed, passages, entries: [], i: 0, t0: 0 };
  }
  if (mode === 'ldt') {
    // Speeded LDT: repeat exposures prime RT, so exclude prior-seen words when
    // the draw is unseeded, same rule as the size test.
    const exclude = settings.seed == null && excludeWords?.length ? new Set(excludeWords) : undefined;
    return { kind: 'simple', mode, seed, items: buildSizeItems(settings, rnd, exclude), i: 0, resp: [], t0: 0, plays: 0, timeouts: 0 };
  }
  if (mode === 'listen2') {
    const audio = new Set(audioWords ?? []);
    return { kind: 'simple', mode, seed, items: buildListen2Items(settings, rnd, audio), i: 0, resp: [], t0: 0, plays: 0 };
  }
  if (mode === 'dictado') {
    const audio = new Set(audioWords ?? []);
    return { kind: 'dictado', mode, seed, items: buildDictadoItems(settings, rnd, audio), i: 0, resp: [], t0: 0, plays: 0 };
  }
  if (mode === 'size') {
    // Seen-word exclusion only applies to unseeded draws: a fixed seed means
    // the teacher wants the identical common form for every student.
    const exclude = settings.seed == null && excludeWords?.length ? new Set(excludeWords) : undefined;
    return { kind: 'simple', mode, seed, items: buildSizeItems(settings, rnd, exclude), i: 0, resp: [], t0: 0, plays: 0 };
  }
  if (mode === 'mastery') {
    return { kind: 'simple', mode, seed, items: buildMasteryItems(settings, rnd), i: 0, resp: [], t0: 0, plays: 0 };
  }
  if (mode === 'listen') {
    return { kind: 'simple', mode, seed, items: buildListenItems(), i: 0, resp: [], t0: 0, plays: 0 };
  }
  // 'ei' is handled by VocabEiRunner before this function is reached.
  const protoMode = mode as 'c500' | 'a500' | 's5000';
  const { queue, blk, form } = buildProtocolQueue(protoMode, settings, rnd);
  return { kind: 'protocol', mode: protoMode, seed, blk, form, rnd, queue, i: 0, state: {}, ps: [0, 0], retest: [], resp: [], t0: 0 };
}

export default function VocabTestRunner({ testId, mode, settings, occasion, excludeWords, audioWords, texts, onExit }: VocabTestRunnerProps) {
  // Elicited imitation is a fully async record→upload→transcribe flow — it runs
  // in its own component rather than the synchronous session machinery.
  if (mode === 'ei') {
    return <VocabEiRunner testId={testId} occasion={occasion} onExit={onExit} />;
  }
  return <VocabTestRunnerInner testId={testId} mode={mode} settings={settings} occasion={occasion} excludeWords={excludeWords} audioWords={audioWords} texts={texts} onExit={onExit} />;
}

function VocabTestRunnerInner({ testId, mode, settings, occasion, excludeWords, audioWords, texts, onExit }: VocabTestRunnerProps) {
  const sessionRef = useRef<Session | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createSession(mode, settings, excludeWords, audioWords, texts);
  }
  const S = sessionRef.current;
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [finished, setFinished] = useState(false);
  const startedAtRef = useRef(new Date().toISOString());
  const typedRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<Record<string, string> | null>(null);
  const submittedRef = useRef(false);
  // Guards the LDT deadline-vs-answer race so an item is scored exactly once.
  const ldtGuardRef = useRef(-1);
  // One retained <audio> element + its current object URL, plus a surfaced
  // error so a failed playback can never be silent.
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  // Plays of the CURRENT aural item. Mirrored into the session so the count is
  // recorded on the response row; reset when the item changes, never on an
  // incidental re-render.
  const [plays, setPlays] = useState(0);
  const notePlay = useCallback(() => {
    const s = sessionRef.current as Session;
    if (s.kind === 'simple' || s.kind === 'dictado') s.plays += 1;
    setPlays((n) => n + 1);
  }, []);

  const submitMutation = trpc.vocab.submitResult.useMutation();

  // Resolves true once playback actually starts, false (and surfaces an error)
  // if it can't — so a failed play never silently costs the student a listen.
  const playSrc = useCallback((src: string): Promise<boolean> => {
    setAudioError(null);
    let el = playerRef.current;
    if (!el) { el = new Audio(); playerRef.current = el; }
    el.src = src;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      return p.then(() => true).catch((err: unknown) => {
        setAudioError(
          `No se pudo reproducir el audio${err instanceof Error && err.message ? `: ${err.message}` : ''}.`);
        return false;
      });
    }
    // Older browsers where HTMLMediaElement.play() returns undefined.
    return Promise.resolve(true);
  }, []);

  // Base64 MP3 → Blob URL (far more reliable across browsers than a data: URI,
  // especially Safari, for the embedded Forma A clips).
  const playBase64Mp3 = useCallback((b64: string): Promise<boolean> => {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      objectUrlRef.current = url;
      return playSrc(url);
    } catch {
      setAudioError('No se pudo decodificar el audio.');
      return Promise.resolve(false);
    }
  }, [playSrc]);

  useEffect(() => () => {
    playerRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  // Listening clips are 570KB of base64 — only fetch them for listen tests.
  useEffect(() => {
    if (mode === 'listen') {
      import('./datasets/listenAudio.json')
        .then((m) => {
          audioRef.current = (m.default ?? m) as Record<string, string>;
          bump();
        })
        .catch(() => setAudioError('No se pudo cargar el audio de la Forma A.'));
    }
  }, [mode, bump]);

  // Aural bank modes stream opus clips by URL; fetch the map for this
  // session's sampled words once.
  const isAuralBank = AURAL_BANK_MODES.includes(mode);
  const sessionWords = useRef<string[] | null>(null);
  if (isAuralBank && sessionWords.current === null) {
    const s = sessionRef.current as SimpleSession | DictadoSession;
    sessionWords.current = s.items.map((it) => it.w);
  }
  const audioUrlsQuery = trpc.vocab.getVocabAudioUrls.useQuery(
    { testId, words: sessionWords.current ?? ['-'] },
    { enabled: isAuralBank && (sessionWords.current?.length ?? 0) > 0 }
  );
  const bankUrls = audioUrlsQuery.data?.urls;
  // Once URLs arrive, drop any item whose clip is missing (e.g. deleted
  // between session build and fetch) so the student is never asked to answer
  // an unplayable item.
  const prunedRef = useRef(false);
  if (isAuralBank && bankUrls && !prunedRef.current) {
    prunedRef.current = true;
    const s = sessionRef.current as SimpleSession | DictadoSession;
    const kept = s.items.filter((it) => bankUrls[it.w]);
    if (kept.length !== s.items.length) {
      (s as { items: unknown[] }).items = kept;
      if (s.i > kept.length) s.i = kept.length;
    }
  }
  const auralBlocked = isAuralBank && !bankUrls;
  const auralEmpty = isAuralBank
    ? (sessionRef.current as SimpleSession | DictadoSession).items.length === 0
    : false;

  // ---- Audio warm-up: make first plays instant --------------------------
  // 1) Whole-session HTTP cache warm. Clips are immutable (/api/assets/* is
  //    served with max-age=1y) and ~15KB each, so warming even a 50-item test
  //    is under a megabyte. Throttled so it never starves the test's own
  //    requests.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!bankUrls || warmedRef.current) return;
    warmedRef.current = true;
    const urls = [...new Set(Object.values(bankUrls))];
    let next = 0;
    let cancelled = false;
    const worker = async () => {
      while (!cancelled && next < urls.length) {
        const url = urls[next++];
        try { await fetch(url, { credentials: 'same-origin' }); } catch { /* best-effort */ }
      }
    };
    for (let k = 0; k < 4 && k < urls.length; k++) void worker();
    return () => { cancelled = true; };
  }, [bankUrls]);

  // 2) Rolling media preload of the next few clips through real audio
  //    elements — Safari fetches media with range requests and does not always
  //    reuse a fetch()-primed cache entry, so warm the media pipeline itself.
  const auralIndex = isAuralBank && (S.kind === 'simple' || S.kind === 'dictado') ? S.i : -1;
  const preloadPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  useEffect(() => {
    if (auralIndex < 0 || !bankUrls) return;
    const s = sessionRef.current as SimpleSession | DictadoSession;
    const want = new Set(
      s.items.slice(auralIndex, auralIndex + 4)
        .map((it) => bankUrls[it.w])
        .filter((u): u is string => Boolean(u))
    );
    const pool = preloadPoolRef.current;
    for (const [url, el] of pool) {
      if (!want.has(url)) { el.src = ''; pool.delete(url); }
    }
    for (const url of want) {
      if (!pool.has(url)) {
        const a = new Audio();
        a.preload = 'auto';
        a.src = url;
        pool.set(url, a);
      }
    }
  }, [auralIndex, bankUrls]);
  useEffect(() => () => {
    for (const [, el] of preloadPoolRef.current) { el.src = ''; }
    preloadPoolRef.current.clear();
  }, []);

  const doSubmit = useCallback(() => {
    const s = sessionRef.current as Session;
    let summary: VocabSummary;
    let blk: string | undefined;
    let form: string | undefined;
    if (s.kind === 'ctest') {
      summary = summaryFromCtest(s.entries);
    } else if (s.kind === 'simple') {
      summary = s.mode === 'mastery'
        ? summaryFromMc(s.resp as McResponse[])
        : s.mode === 'ldt'
          ? summaryFromLdt(s.resp as YnResponse[])
          : summaryFromYn(s.resp as YnResponse[]);
    } else if (s.kind === 'dictado') {
      summary = summaryFromDictado(s.resp);
    } else {
      summary = summaryFromProtocol(s.state, s.ps);
      blk = String(s.blk);
      form = s.form || undefined;
    }
    const responses: Record<string, unknown>[] = s.kind === 'ctest'
      ? s.entries.map((e) => ({ w: e.gap.word, t: 'ct', typed: e.typed, exact: e.exact, lenient: e.lenient }))
      : (s.resp as Record<string, unknown>[]);
    submitMutation.mutate({
      testId,
      seed: s.seed,
      blk,
      form,
      summary,
      responses,
      startedAt: startedAtRef.current,
      durationMs: Date.now() - new Date(startedAtRef.current).getTime(),
    });
  }, [submitMutation, testId]);

  const finish = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setFinished(true);
    doSubmit();
  }, [doSubmit]);

  // ---------- input lockout ----------

  /**
   * Drops answers that arrive within ANSWER_LOCKOUT_MS of the item appearing.
   * The runner keeps the same DOM buttons across items, so a double-click, a
   * held Enter, or key auto-repeat would otherwise answer the next item too.
   * The speeded LDT is exempt (it is timed by construction and already
   * single-answer-guarded by ldtGuardRef).
   */
  const locked = useCallback(() => {
    const s = sessionRef.current as Session;
    if (s.kind === 'simple' && s.mode === 'ldt') return false;
    return withinLockout(s.t0, performance.now());
  }, []);

  // ---------- simple-mode answers ----------

  const answerYN = useCallback((yes: boolean) => {
    const s = sessionRef.current as SimpleSession;
    if (locked()) return;
    // Aural items may not be judged before the clip has actually played once.
    if (AURAL_MODES.includes(s.mode) && s.plays < 1) return;
    if (s.mode === 'ldt') {
      if (ldtGuardRef.current === s.i) return; // deadline already claimed this item
      ldtGuardRef.current = s.i;
    }
    const it = s.items[s.i] as YnItem;
    const row: YnResponse = { ...it, yes, ms: Math.round(performance.now() - s.t0) };
    // The play count qualifies an aural judgement (one listen vs. two) and is
    // meaningless elsewhere, so it is only recorded for aural rows.
    if (AURAL_MODES.includes(s.mode)) row.plays = s.plays;
    s.resp.push(row);
    s.i++;
    const tgt = settings.stopSE ?? 0;
    if (s.mode === 'size' && tgt >= 150 && s.resp.length >= 30
      && (s.resp as YnResponse[]).filter((r) => r.t === 'pseudo').length >= 8
      && bandsCovered(s.items as YnItem[], s.resp as YnResponse[])) {
      const E = ynEstimates(s.resp as YnResponse[]);
      if (1.96 * E.seSize <= tgt) { s.stopped = s.resp.length; s.i = s.items.length; }
    }
    if (s.i >= s.items.length) finish(); else bump();
  }, [settings.stopSE, finish, bump, locked]);

  const answerMC = useCallback((k: number) => {
    const s = sessionRef.current as SimpleSession;
    if (locked()) return;
    const it = s.items[s.i] as McItem;
    s.resp.push({
      w: it.w, b: 0, t: 'mc', pick: k,
      correct: k >= 0 && it.opts[k] === it.correct,
      omit: k < 0,
      ms: Math.round(performance.now() - s.t0),
    });
    s.i++;
    if (s.i >= s.items.length) finish(); else bump();
  }, [finish, bump, locked]);

  // ---------- protocol-mode answers ----------

  const setWordState = useCallback((it: ProtocolItem, v: number) => {
    const s = sessionRef.current as ProtocolSession;
    if (it.idx != null) s.state[it.idx] = Math.max(s.state[it.idx] || 0, v);
  }, []);

  const logResp = useCallback((it: ProtocolItem, extra: Record<string, unknown>) => {
    const s = sessionRef.current as ProtocolSession;
    s.resp.push({ w: it.w, ph: it.ph, ms: Math.round(performance.now() - s.t0), ...extra });
  }, []);

  const advanceProtocol = useCallback(() => {
    const s = sessionRef.current as ProtocolSession;
    if (s.i >= s.queue.length) {
      if (s.retest.length) { // typed error-retest round
        s.queue = s.retest.map((w) => ({ w, idx: ALLWORDS.indexOf(w), ph: 'typed' as const, retest: true }));
        s.retest = [];
        s.i = 0;
      } else {
        finish();
        return;
      }
    }
    bump();
  }, [finish, bump]);

  const protoScreen = useCallback((yes: boolean) => {
    const s = sessionRef.current as ProtocolSession;
    if (locked()) return;
    const it = s.queue[s.i];
    logResp(it, { yes });
    if (it.pseudo) {
      s.ps[0]++;
      if (yes) s.ps[1]++;
      s.i++;
      advanceProtocol();
      return;
    }
    if (yes) {
      setWordState(it, 1);
      if (it.verify) {
        const dom = bandOfIdx(it.idx as number) === 0 ? DATA.masteryDomain : DATA.bands[1].words;
        s.queue.splice(s.i + 1, 0, { w: it.w, idx: it.idx, ph: 'mc', mc: mcFor(it.w, dom, s.rnd), fromYes: true });
      }
    } else {
      setWordState(it, 0); // record the tested-and-failed word so denominators see it
      if (it.verify && s.mode === 'c500') { // recovery probe on 'no' (two gates: MC then typed)
        s.queue.splice(s.i + 1, 0, { w: it.w, idx: it.idx, ph: 'mc', mc: mcFor(it.w, DATA.masteryDomain, s.rnd), fromNo: true });
      }
    }
    s.i++;
    advanceProtocol();
  }, [logResp, setWordState, advanceProtocol, locked]);

  const protoMC = useCallback((k: number) => {
    const s = sessionRef.current as ProtocolSession;
    if (locked()) return;
    const it = s.queue[s.i];
    const ok = it.mc!.opts[k] === it.mc!.correct;
    logResp(it, { ok });
    if (it.fromYes) {
      // A failed meaning check leaves the word at 1 (claimed-unverified) by
      // design: the student did claim it, the claim is simply unconfirmed.
      if (ok) setWordState(it, 2);
      else if (s.mode === 'c500') s.retest.push(it.w);
    } else if (it.fromNo) {
      if (ok) s.retest.push(it.w); // needs typed confirmation (second gate)
      else setWordState(it, 0);    // failed the recovery probe: tested and unknown
    }
    s.i++;
    advanceProtocol();
  }, [logResp, setWordState, advanceProtocol, locked]);

  const protoTyped = useCallback((v: string) => {
    const s = sessionRef.current as ProtocolSession;
    if (locked()) return;
    const it = s.queue[s.i];
    const ok = acceptActive(v, it.w);
    logResp(it, { typed: v, ok });
    if (ok) setWordState(it, s.mode === 'a500' ? 3 : 2);
    else {
      setWordState(it, 0); // tested and not produced
      if (s.mode === 'a500' && !it.retest) s.retest.push(it.w);
    }
    s.i++;
    advanceProtocol();
  }, [logResp, setWordState, advanceProtocol, locked]);

  const answerDictado = useCallback((v: string) => {
    const s = sessionRef.current as DictadoSession;
    if (locked() || s.plays < 1) return; // must hear the word before transcribing it
    const it = s.items[s.i];
    s.resp.push({ w: it.w, b: it.b, t: 'dict', typed: v, ok: acceptDictado(v, it.w), ms: Math.round(performance.now() - s.t0), plays: s.plays });
    s.i++;
    if (s.i >= s.items.length) finish(); else bump();
  }, [finish, bump, locked]);

  // ---------- speeded LDT deadline ----------

  const deadlineMs = settings.deadlineMs ?? LDT_DEFAULT_DEADLINE_MS;
  const ldtIndex = !finished && S.kind === 'simple' && S.mode === 'ldt' ? S.i : -1;
  useEffect(() => {
    if (ldtIndex < 0) return;
    const timer = setTimeout(() => {
      const s = sessionRef.current as SimpleSession;
      if (s.i !== ldtIndex || ldtGuardRef.current === ldtIndex) return; // already answered
      ldtGuardRef.current = ldtIndex;
      const it = s.items[s.i] as YnItem;
      // a timeout is "not recognized within the deadline" — a "no" for the
      // speeded construct, so it counts in the band totals (not censored)
      (s.resp as YnResponse[]).push({ w: it.w, b: it.b, t: it.t, yes: false, ms: deadlineMs, timedOut: true });
      s.timeouts = (s.timeouts ?? 0) + 1;
      s.i++;
      if (s.i >= s.items.length) finish(); else bump();
    }, deadlineMs);
    return () => clearTimeout(timer);
  }, [ldtIndex, deadlineMs, finish, bump]);

  // ---------- keyboard shortcuts ----------

  useEffect(() => {
    if (finished) return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;                                 // holding a key must not answer a run of items
      if (e.ctrlKey || e.metaKey || e.altKey) return;       // Cmd+S is "save", not "sí"
      if (e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement
        || e.target instanceof HTMLSelectElement) return;   // typing into the a500/ctest boxes
      const s = sessionRef.current as Session;
      const k = e.key.toLowerCase();
      if (s.kind === 'simple' && s.mode === 'mastery') {
        const it = s.items[s.i] as McItem | undefined;
        if ('abcd'.includes(k)) {
          const idx = 'abcd'.indexOf(k);
          if (it && idx < it.opts.length) answerMC(idx);
        }
        if (k === '0' || k === 'x') answerMC(-1);
      } else if (s.kind === 'simple') {
        if (k === 's') answerYN(true);
        if (k === 'n') answerYN(false);
      } else if (s.kind === 'protocol') {
        const it = s.queue[s.i];
        if (it?.ph === 'screen') {
          if (k === 's') protoScreen(true);
          if (k === 'n') protoScreen(false);
        } else if (it?.ph === 'mc') {
          if ('abcd'.includes(k)) protoMC('abcd'.indexOf(k));
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [finished, answerMC, answerYN, protoScreen, protoMC]);

  // ---------- current item timing ----------

  const total = S.kind === 'protocol' ? S.queue.length : S.kind === 'ctest' ? 1 : S.items.length;
  const index = S.i;
  // Item onset is scoped to the ITEM (and to the moment its stimulus actually
  // becomes answerable), not to every render: a re-render caused by pressing ▶
  // must not restart the response timer — that would understate latency and
  // re-arm the input lockout mid-item.
  const stimulusReady = !auralBlocked && (mode !== 'listen' || audioRef.current !== null);
  useEffect(() => {
    if (!stimulusReady) return;
    const s = sessionRef.current as Session;
    s.t0 = performance.now();
    setPlays(0);
    if (s.kind === 'simple' || s.kind === 'dictado') s.plays = 0;
    typedRef.current?.focus();
  }, [index, stimulusReady]);

  // ---------- render ----------

  if (finished) {
    const s = sessionRef.current as Session;
    return (
      <div className="vm-root">
        {s.kind === 'ctest' ? (
          <CtestResultView entries={s.entries} occasion={occasion ?? undefined} />
        ) : s.kind === 'simple' ? (
          <VocabResultView
            mode={s.mode}
            resp={s.resp as (YnResponse | McResponse)[]}
            occasion={occasion ?? undefined}
            stopped={s.stopped}
            totalItems={s.items.length}
            timeouts={s.timeouts}
          />
        ) : s.kind === 'dictado' ? (
          <VocabResultView
            mode="dictado"
            resp={s.resp}
            occasion={occasion ?? undefined}
            totalItems={s.items.length}
          />
        ) : (
          <VocabProtocolResultView
            mode={s.mode}
            state={s.state}
            ps={s.ps}
            blk={s.blk}
            form={s.form}
            occasion={occasion ?? undefined}
          />
        )}
        <div className="mt-6 flex items-center gap-3">
          {submitMutation.isPending && (
            <span className="text-sm text-gray-500 dark:text-gray-400">Guardando resultado…</span>
          )}
          {submitMutation.isSuccess && (
            <span className="text-sm text-green-700 dark:text-green-400">Resultado guardado en tu cuenta ✓</span>
          )}
          {submitMutation.isError && (
            <span className="text-sm text-red-600 dark:text-red-400">
              No se pudo guardar: {submitMutation.error.message}{' '}
              <button className="underline" onClick={doSubmit}>Reintentar</button>
            </span>
          )}
          <button
            onClick={onExit}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  const hudLabel = S.kind === 'protocol'
    ? (S.mode === 'c500' ? `Censo 500 · bloque ${S.blk}`
      : S.mode === 'a500' ? `Activo 500 · forma ${S.form} · bloque ${S.blk}`
        : S.blk === 'P' ? 'Sondeo · plan adaptativo' : `Sondeo 5.000 · semana ${S.blk}`)
    : MODE_LABELS[S.mode];

  const ynButtons = (onAnswer: (yes: boolean) => void, disabled = false) => (
    <div className="answers">
      <button className="ans yes" disabled={disabled} onClick={() => onAnswer(true)}>
        Sí, la conozco<span className="key">tecla S</span>
      </button>
      <button className="ans" disabled={disabled} onClick={() => onAnswer(false)}>
        No<span className="key">tecla N</span>
      </button>
    </div>
  );

  let stimulus: React.ReactNode = null;
  let answers: React.ReactNode = null;

  if (S.kind === 'ctest') {
    if (S.passages.length === 0 || S.passages.every((p) => p.gaps.length === 0)) {
      return (
        <div className="vm-root">
          <div className="stimulus">
            <p className="prompt">Esta prueba no tiene textos configurados. Avisa a tu profesor.</p>
            <div className="answers"><button className="ans" onClick={onExit}>Volver</button></div>
          </div>
        </div>
      );
    }
    return (
      <div className="vm-root">
        <div className="hud"><span>{hudLabel}</span><span className="rail"><i /></span><span /></div>
        <CtestForm
          passages={S.passages}
          onSubmit={(answers) => {
            const s = sessionRef.current as CtestSession;
            s.entries = s.passages.flatMap((p, pi) => p.gaps.map((gap, gi) => {
              const typed = answers[pi]?.[gi] ?? '';
              return { gap, typed, exact: ctestExact(typed, gap), lenient: ctestLenient(typed, gap) };
            }));
            finish();
          }}
        />
      </div>
    );
  }

  // Aural sessions cannot proceed without the clip map: block answers while
  // loading, surface errors with a retry, and exit cleanly when the bank
  // cannot serve this test at all.
  if (isAuralBank && (auralBlocked || auralEmpty)) {
    return (
      <div className="vm-root">
        <div className="hud"><span>{hudLabel}</span><span className="rail"><i /></span><span /></div>
        <div className="stimulus">
          {audioUrlsQuery.isError ? (
            <>
              <p className="prompt">No se pudo cargar el audio: {audioUrlsQuery.error.message}</p>
              <div className="answers">
                <button className="ans yes" onClick={() => audioUrlsQuery.refetch()}>Reintentar</button>
                <button className="ans" onClick={onExit}>Volver</button>
              </div>
            </>
          ) : auralEmpty ? (
            <>
              <p className="prompt">
                El banco de audio aún no cubre esta prueba (faltan clips de las bandas o pseudopalabras necesarias).
                Avisa a tu profesor.
              </p>
              <div className="answers">
                <button className="ans" onClick={onExit}>Volver</button>
              </div>
            </>
          ) : (
            <p className="prompt">Cargando audio…</p>
          )}
        </div>
      </div>
    );
  }

  if (S.kind === 'dictado') {
    const it = S.items[S.i];
    if (!it) {
      stimulus = <p className="prompt">El banco de audio no tiene palabras para esta prueba.</p>;
    } else {
      const url = bankUrls?.[it.w];
      stimulus = (
        <ListenStimulus
          key={S.i}
          ready={Boolean(url)}
          error={audioError}
          plays={plays}
          onPlayed={notePlay}
          play={() => {
            if (!url) { setAudioError('El clip de audio no está disponible.'); return Promise.resolve(false); }
            return playSrc(url);
          }}
          prompt="Escucha la palabra y escríbela."
        />
      );
      answers = <TypedAnswer key={S.i} inputRef={typedRef} onSubmit={answerDictado} disabled={plays < 1} />;
    }
  } else if (S.kind === 'simple') {
    const it = S.items[S.i];
    if (S.mode === 'listen2') {
      const yn = it as YnItem;
      const url = bankUrls?.[yn.w];
      stimulus = (
        <ListenStimulus
          key={S.i}
          ready={Boolean(url)}
          error={audioError}
          plays={plays}
          onPlayed={notePlay}
          play={() => {
            if (!url) { setAudioError('El clip de audio no está disponible.'); return Promise.resolve(false); }
            return playSrc(url);
          }}
        />
      );
      answers = ynButtons(answerYN, plays < 1);
    } else if (S.mode === 'listen') {
      const yn = it as YnItem;
      const ready = audioRef.current !== null;
      stimulus = (
        <ListenStimulus
          key={S.i}
          ready={ready}
          error={audioError}
          plays={plays}
          onPlayed={notePlay}
          play={() => {
            const clips = audioRef.current;
            const b64 = clips?.[String(yn.clip)];
            if (!b64) { setAudioError('El clip de audio no está disponible.'); return Promise.resolve(false); }
            return playBase64Mp3(b64);
          }}
        />
      );
      answers = ynButtons(answerYN, plays < 1);
    } else if (S.mode === 'mastery') {
      const mc = it as McItem;
      stimulus = (
        <>
          <div className="word">{mc.w}</div>
          <p className="prompt">¿Qué significa? Elige la mejor opción.</p>
        </>
      );
      answers = (
        <div className="opts">
          {mc.opts.map((o, k) => (
            <button key={k} className="opt" onClick={() => answerMC(k)}>
              <span className="k">{'ABCD'[k]}</span>{o}
            </button>
          ))}
          <button className="opt skip" onClick={() => answerMC(-1)}>No lo sé</button>
        </div>
      );
    } else {
      const yn = it as YnItem;
      stimulus = (
        <>
          <div className="word">{yn.w}</div>
          <p className="prompt">
            ¿Conoces esta palabra? Sé honesto — algunas palabras no existen.
            {S.mode === 'ldt' ? ` Responde antes de ${(deadlineMs / 1000).toFixed(1)} s.` : ''}
          </p>
        </>
      );
      answers = ynButtons(answerYN);
    }
  } else {
    const it = S.queue[S.i];
    if (it.ph === 'screen') {
      stimulus = (
        <>
          <div className="word">{it.w}</div>
          <p className="prompt">¿Conoces esta palabra? Sé honesto — algunas no existen.</p>
        </>
      );
      answers = ynButtons(protoScreen);
    } else if (it.ph === 'mc') {
      stimulus = (
        <>
          <div className="word">{it.w}</div>
          <p className="prompt">¿Qué significa?</p>
        </>
      );
      answers = (
        <div className="opts">
          {it.mc!.opts.map((o, k) => (
            <button key={k} className="opt" onClick={() => protoMC(k)}>
              <span className="k">{'ABCD'[k]}</span>{o}
            </button>
          ))}
        </div>
      );
    } else {
      stimulus = (
        <>
          <p className="prompt">Escribe la palabra en español:</p>
          <div className="word gloss">{glossOf(it.w)}</div>
          <p className="cue">{cueOf(it.w)}</p>
        </>
      );
      answers = <TypedAnswer key={S.i} inputRef={typedRef} onSubmit={protoTyped} />;
    }
  }

  return (
    <div className="vm-root">
      <div className="hud">
        <span>{hudLabel}</span>
        <span className="rail"><i style={{ width: `${(100 * index) / total}%` }} /></span>
        <span>{index + 1} / {total}</span>
      </div>
      <div className="stimulus">{stimulus}</div>
      <div>{answers}</div>
    </div>
  );
}

/** Play counter is owned by the runner so the count reaches the response row. */
function ListenStimulus({ ready, play, prompt, error, plays, onPlayed }: {
  ready: boolean;
  play: () => Promise<boolean>;
  prompt?: string;
  error?: string | null;
  plays: number;
  onPlayed: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        className="play"
        disabled={!ready || pending || plays >= 2}
        onClick={async () => {
          if (plays >= 2 || pending) return;
          setPending(true);
          // Only spend a listen if playback actually started — a CSP/decode/
          // network failure must not cost the student one of their two plays.
          const ok = await play();
          setPending(false);
          if (ok) onPlayed();
        }}
      >
        ▶ Escuchar
      </button>
      <span className="plays">
        {!ready ? 'Cargando audio…'
          : (2 - plays) + ((2 - plays) === 1 ? ' reproducción disponible' : ' reproducciones disponibles')}
      </span>
      <p className="prompt">{prompt ?? '¿Conoces esta palabra? Escúchala y decide.'}</p>
      {plays < 1 && ready && (
        <p className="prompt" style={{ fontSize: 13 }}>Escucha el clip antes de responder.</p>
      )}
      {error && <div className="flag" style={{ marginTop: 6 }}>{error}</div>}
    </>
  );
}

function TypedAnswer({ inputRef, onSubmit, disabled = false }: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onSubmit: (v: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  // The value is controlled, so the spliced text only reaches the DOM on the next render:
  // the caret is parked here and restored in the layout effect below.
  const caretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const c = caretRef.current;
    if (c === null) return;
    caretRef.current = null;
    restoreCaret(inputRef.current, c);
  }, [value, inputRef]);
  return (
    <>
      <div className="answers">
        <input
          ref={inputRef}
          type="text"
          className="typed-input"
          autoComplete="off"
          autoCapitalize="none"
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // e.repeat: a held Enter would otherwise submit this item and the next
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat && !disabled) onSubmit(value); }}
        />
        <button className="ans yes" disabled={disabled} onClick={() => onSubmit(value)}>Comprobar</button>
        <button className="ans" disabled={disabled} onClick={() => onSubmit('')}>No lo sé</button>
      </div>
      <CharKeys
        disabled={disabled}
        onInsert={(ch) => {
          const next = insertIntoInput(inputRef.current, value, ch);
          caretRef.current = next.caret;
          setValue(next.value);
        }}
      />
    </>
  );
}

function CtestForm({ passages, onSubmit }: {
  passages: CtestPassage[];
  onSubmit: (answers: string[][]) => void;
}) {
  const [answers, setAnswers] = useState<string[][]>(() => passages.map((p) => p.gaps.map(() => '')));
  const filled = answers.flat().filter((a) => a.trim()).length;
  const total = passages.reduce((a, p) => a + p.gaps.length, 0);
  // A screen full of gaps has no single "the input": the character row edits whichever gap the
  // student was last in. Refs, not state — tracking focus must never re-render the passage.
  const gapRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const firstGap = passages.findIndex((p) => p.gaps.length > 0);
  const focusedRef = useRef<[number, number]>([firstGap < 0 ? 0 : firstGap, 0]);
  const caretRef = useRef<[string, number] | null>(null);
  useLayoutEffect(() => {
    const pending = caretRef.current;
    if (!pending) return;
    caretRef.current = null;
    restoreCaret(gapRefs.current[pending[0]], pending[1]);
  }, [answers]);
  const insert = (ch: string) => {
    const [pi, gi] = focusedRef.current;
    if (!answers[pi] || answers[pi][gi] === undefined) return;
    const key = `${pi}:${gi}`;
    const next = insertIntoInput(gapRefs.current[key], answers[pi][gi], ch);
    caretRef.current = [key, next.caret];
    setAnswers((prev) => {
      const copy = prev.map((row) => [...row]);
      copy[pi][gi] = next.value;
      return copy;
    });
  };
  return (
    <div>
      <p className="prompt" style={{ marginBottom: 12 }}>
        Completa cada palabra cortada. Se borró la segunda mitad de una de cada dos palabras: escribe solo la parte
        que falta.
      </p>
      {passages.map((p, pi) => {
        const gapAt = new Map(p.gaps.map((g, gi) => [g.idx, gi]));
        return (
          <div key={pi} className="stimulus" style={{ display: 'block', textAlign: 'left', marginBottom: 14, minHeight: 0 }}>
            <p className="prompt" style={{ marginBottom: 8 }}><strong>{p.title}</strong></p>
            <p style={{ lineHeight: 2.1 }}>
              {p.tokens.map((token, ti) => {
                const gi = gapAt.get(ti);
                if (gi === undefined) return <span key={ti}>{token}</span>;
                const gap = p.gaps[gi];
                const rest = token.slice(token.indexOf(gap.word) + gap.word.length);
                const lead = token.slice(0, token.indexOf(gap.word));
                return (
                  <span key={ti} style={{ whiteSpace: 'nowrap' }}>
                    {lead}{gap.stem}
                    <input
                      type="text"
                      ref={(el) => { gapRefs.current[`${pi}:${gi}`] = el; }}
                      onFocus={() => { focusedRef.current = [pi, gi]; }}
                      aria-label={`hueco ${gap.stem}…`}
                      value={answers[pi][gi]}
                      onChange={(e) => {
                        const next = answers.map((row) => [...row]);
                        next[pi][gi] = e.target.value;
                        setAnswers(next);
                      }}
                      size={Math.max(3, gap.gapLen)}
                      autoCapitalize="none"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="typed-input"
                      style={{ display: 'inline-block', width: `${Math.max(3, gap.gapLen) + 1}ch`, padding: '2px 6px', fontSize: 16, textAlign: 'left' }}
                    />
                    {rest}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
      <CharKeys sticky onInsert={insert} />
      <div className="answers" style={{ justifyContent: 'flex-start' }}>
        <button
          className="ans yes"
          onClick={() => {
            const blanks = total - filled;
            if (blanks > 0 && !window.confirm(`Quedan ${blanks} hueco(s) sin rellenar; contarán como incorrectos. ¿Enviar de todos modos?`)) return;
            onSubmit(answers);
          }}
        >
          Corregir ({filled} / {total})
        </button>
      </div>
    </div>
  );
}
