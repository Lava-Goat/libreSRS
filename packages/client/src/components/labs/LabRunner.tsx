// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * One lab session. The course labs are pause-and-respond — the narrator
 * prompts, the student answers aloud in the pause, the model voice confirms.
 *
 * The microphone is on for the whole session but nothing is recorded: it
 * drives a live level bar and, in each answer pause the teacher's scan found,
 * measures how long a voice was heard. A voice is a sound that stands out
 * from the room and is pitched (utils/voiceMeter.ts): taps, noise, whispers
 * and the class talking around a silent student do not count. Per pause the
 * page reports two integers, `[pauseStartMs, voicedMs]`, riding on the
 * listening reports it already sends; the server checks them against its own
 * log and decides whether the lab counts. Recordings a teacher listens to are
 * speaking tasks, a separate page. The count only runs while the lab audio is
 * actually playing (or the student has paused inside a pause to answer), and
 * no stretch of the lab plays with the microphone off unless the student
 * chose to do it without one.
 *
 * Two clicks to begin, on purpose: the first turns the microphone on and shows
 * the level, and "Start the lab" waits until the page has heard the student
 * say something (or, in a room too loud to pick a voice out, at least a second
 * of sound), so a wrong or muted mic is caught before fifteen minutes are
 * spent; the second starts the audio inside the click, which is what iPhones
 * require before they will play sound.
 *
 * With the answers go the meter's own stats (`micStats`): the room level, the
 * old −45 dBFS meter's count for comparison, sound that was not a voice, time
 * played in the background, and the browser's microphone processing. The page
 * reports them, so they are information for the teacher, never evidence.
 *
 * An exam lab (v1.19.0: the session's `exam` names its set, "U3") is test
 * audio. The answers go on paper, so there is no microphone at all; the file
 * (which already says the text twice) plays once, straight through: no Pause,
 * no Back, no Start over or Do it again, and headset, lock-screen and key
 * presses cannot pause or move it. Each student gets one start per set, across
 * its forms: "Start the test" claims it on the server (labs.startExam), and
 * only that claim hands the page the audio, so nothing plays without a start
 * the server confirmed. A lost connection still pauses the test, and Resume
 * carries on from where it stopped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONNECTION_WAIT_MS,
  DEFAULT_GATE_MARGIN_DB,
  DEFAULT_VOICE_PER_PAUSE_MS,
  EXAM_APP_CODES,
  LAB_CLIENT,
  LAB_MIC_STATS_LIMITS,
  MAX_ANSWERS_PER_REPORT,
  MAX_SUBMIT_ANSWERS,
  MAX_SUBMIT_REPORTS,
  MIC_CHECK_VOICE_MS,
  clampLabMicStats,
  neededPauses,
  type LabMicStatsInput,
  type PauseAnswer,
} from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { useLeaveGuard } from '../../hooks/useLeaveGuard';
import { ListeningCoverage, formatClock } from '../../utils/labAudio';
import { PauseTracker, type SampleMode } from '../../utils/pauseTracker';
import { DbMedian, LEVEL_ONLY_DB, VoiceMeter, analyserSize, type MeterFrame } from '../../utils/voiceMeter';
import { Bilingual, EXAM_INSTRUCTIONS, appCodeOf } from './ExamText';

type Phase =
  | 'loading' | 'failed' | 'setup' | 'ready' | 'running' | 'paused'
  | 'finished' | 'submitting' | 'done';

/** Phases with work that leaving the page would throw away. */
const BUSY: Phase[] = ['running', 'paused', 'finished', 'submitting'];
/**
 * A test's start is used from "Start the test" on: leaving after it costs the one start. So does
 * leaving while the start is on its way, or after it failed (it may have reached the server); see `busy`.
 */
const EXAM_BUSY: Phase[] = ['ready', 'running', 'paused', 'finished', 'submitting'];
/** How long "Start the test" waits for the server's answer before offering Try again. */
const EXAM_START_TIMEOUT_MS = 15_000;
/** Why a test cannot start: its one start is used, or the teacher changed it since the page opened it. */
type ExamRefusal = 'used' | 'changed';

/** A frame's voice never counts for more than this, however late the timer fired. */
const MAX_FRAME_MS = 200;
/**
 * The mic check also passes on this much sound over the old −45 dBFS level:
 * in a loud room a voice under the room's margin never counts, and the check
 * is there to catch a wrong or muted microphone, not to judge the student.
 */
const MIC_CHECK_LEVEL_MS = 1000;
/** Time in the background counts at most this much per check, however late the timer fired. */
const MAX_FOCUS_STEP_MS = 1000;
/** Matches the server's allowance for timer jitter. */
const FINISH_TOLERANCE_MS = 1500;
const BACK_SECONDS = 10;
/** How often the page reports its position to the server's listening log while playing. */
const TICK_MS = 5000;
/** Reports waiting to be resent; a whole fifteen-minute session is ~200. A submit carries up to as many. */
const MAX_PENDING_REPORTS = MAX_SUBMIT_REPORTS;
/** A session opened longer ago than this is renewed before the student starts. */
const SESSION_REFRESH_MS = 6 * 60 * 60 * 1000;
/** How long turning in waits for the listening log to catch up before going anyway. */
const FLUSH_BEFORE_SUBMIT_MS = 8000;
/** How long turning in may take before the page gives up and offers Try again. */
const SUBMIT_TIMEOUT_MS = 60_000;
/** A listening report with no answer by then is given up on for now and stays queued: a hung request must not block the rest. */
const REPORT_TIMEOUT_MS = 15_000;
/** Audio may run this far ahead of the page's own clock between two ticks and still count as heard. */
const CONTINUITY_SLACK_MS = 750;
/**
 * A tick waits this long at most for a position that reads stale (just after
 * the page froze) to catch up, checking this often: sent with the stale
 * position, the catch-up after it would look like a skip to the server.
 */
const TICK_HOLD_MAX_MS = 1250;
const TICK_HOLD_STEP_MS = 250;

/** 'nomic': where the student went on without a microphone, sent once; no pause result ever follows it. */
type ReportKind = 'play' | 'tick' | 'pause' | 'seek' | 'end' | 'nomic';

/** A listening report waiting to reach the server. Each keeps its session, so a late retry lands in the right one. */
interface PendingReport {
  labId: number;
  startToken: string;
  kind: ReportKind;
  positionMs: number;
  clientMs: number;
  /** Pause results finished since the last report (tick, pause, end and nomic only). */
  answers?: PauseAnswer[];
  /** performance.now() when it was queued: the page stops the lab when one waits too long. */
  queuedAt: number;
}

/** What the server decided when the lab was turned in (labs.submit). */
interface LabResult {
  submissionId: number;
  credit: boolean;
  status: 'done' | 'redo' | 'check';
  scored: boolean;
  pausesAnswered: number | null;
  pausesCounted: number | null;
  needed: number | null;
  mic: 'on' | 'off';
}

class Stopwatch {
  private total = 0;
  private since: number | null = null;
  start() { if (this.since === null) this.since = performance.now(); }
  stop() { if (this.since !== null) { this.total += performance.now() - this.since; this.since = null; } }
  get running() { return this.since !== null; }
  elapsed() { return this.total + (this.since !== null ? performance.now() - this.since : 0); }
  reset() { this.total = 0; this.since = null; }
}

/**
 * One attempt's measurements beside its pause results, for the teacher's
 * Review page: the old meter's count and the levels the new one judged by.
 */
interface LabMeasures {
  /** The pauses as the old meter (any sound over −45 dBFS) would have heard them. */
  levelOnly: PauseTracker;
  ambient: DbMedian;
  gate: DbMedian;
  /** How far over the gate the frames counted as voice were. */
  overGate: DbMedian;
  /** Frames measured in the lab (none: no microphone at all). */
  frames: number;
}

/** What the page knew about a microphone frame when it took it; the meter hands it back once it has decided the frame. */
interface FrameContext {
  frameMs: number;
  /** The lab audio was playing: voice counts toward the time spoken. */
  listening: boolean;
  /** The check before Start was on. */
  checking: boolean;
  /** Where the audio stood, for the pause trackers; null when the frame is not for them. */
  sample: { positionMs: number; wallMs: number; mode: SampleMode } | null;
  /** The attempt in progress when the frame was taken. */
  tracker: PauseTracker | null;
  measures: LabMeasures | null;
}

interface Meter {
  context: AudioContext;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  timer: ReturnType<typeof setInterval>;
  lastAt: number;
  voice: VoiceMeter<FrameContext>;
}

/**
 * The microphone processing the browser says it applies (never a device id),
 * and the rate the voice meter ran at: the audio context's, which Chrome takes
 * from the output device, not the microphone's own.
 */
function readProcessing(track: MediaStreamTrack | undefined, context: AudioContext): LabMicStatsInput['processing'] {
  let settings: (MediaTrackSettings & { voiceIsolation?: unknown }) | undefined;
  try {
    settings = track?.getSettings?.();
  } catch {
    settings = undefined;
  }
  if (!settings) return null;
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    voiceIsolation: settings.voiceIsolation,
    sampleRate: context.sampleRate || settings.sampleRate,
  };
}

export default function LabRunner({ labId, fromTests = false, onExit, onBusyChange }: {
  labId: number;
  /** Opened from the Tests page (v1.21.0): its way back says Back to tests. */
  fromTests?: boolean;
  /** Leaving: `test` when the lab is known to be a test (it opened as one, or was refused as one), so it goes back to the Tests page. */
  onExit: (test: boolean) => void;
  /** Told when the session holds work that leaving would lose. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const begin = trpc.labs.begin.useMutation();
  const askTeacher = trpc.labs.askTeacher.useMutation();
  // Kept here rather than read from the mutation: renewing the session resets
  // the mutation's data, and the page must not blank out while it does.
  const [session, setSession] = useState<NonNullable<typeof begin.data> | null>(null);

  const [phase, setPhaseState] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  const setPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhaseState(next); }, []);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [micLost, setMicLost] = useState(false);
  const [noMic, setNoMic] = useState(false);
  const [sessionDead, setSessionDead] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [result, setResult] = useState<LabResult | null>(null);
  const [askedTeacher, setAskedTeacher] = useState(false);
  /** Where the lab was when the student went on without a microphone that stopped mid-lab (null: it did not). */
  const [micStoppedAt, setMicStoppedAt] = useState<number | null>(null);
  /** A test's audio, from the server's confirmed start (never before it: no start, nothing to play). */
  const [examAudioUrl, setExamAudioUrl] = useState<string | null>(null);
  const [examStarting, setExamStarting] = useState(false);
  /** Why the test cannot start (or open); no retry helps. */
  const [examRefusal, setExamRefusal] = useState<ExamRefusal | null>(null);
  /** The start did not reach the server (or its answer did not come back): Try again, with the same session. */
  const [examStartFailed, setExamStartFailed] = useState(false);
  const [, setTick] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<Meter | null>(null);
  const levelRef = useRef(0);
  /** The room's gate for the level bar's tick (dBFS); null with the microphone off. */
  const gateRef = useRef<number | null>(null);
  /** Whether the last frame the meter decided was a voice: the level bar turns green. */
  const lastVoicedRef = useRef(false);
  /** Voice heard while the lab audio played. */
  const voicedRef = useRef(0);
  /** Voice heard while the student had paused it: an answer given while paused. The server weighs pause results against both. */
  const pausedVoicedRef = useRef(0);
  /** Voice heard before Start; "Start the lab" waits for MIC_CHECK_VOICE_MS of it... */
  const micCheckRef = useRef(0);
  /** ...or MIC_CHECK_LEVEL_MS of sound over the old −45 dBFS level. */
  const micLevelRef = useRef(0);
  /** How the check passed when the student pressed Start (for the teacher's stats). */
  const micCheckKindRef = useRef<'voice' | 'level' | null>(null);
  /** The room margin the session's rules give the voice meter (dB). */
  const gateMarginRef = useRef(DEFAULT_GATE_MARGIN_DB);
  /** The browser's microphone processing, read when the microphone opened. */
  const processingRef = useRef<LabMicStatsInput['processing']>(null);
  /** Time the lab played while the page did not have focus (split screen, a window on top). */
  const unfocusedRef = useRef(0);
  const coverageRef = useRef(new ListeningCoverage());
  /** The voice in each counted pause of this session (scored labs), and outside them. */
  const trackerRef = useRef<PauseTracker | null>(null);
  const measuresRef = useRef<LabMeasures | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  /** performance.now() at lastTimeRef, to judge continuity against real time. */
  const lastWallRef = useRef<number | null>(null);
  const positionRef = useRef(0);
  /**
   * Where playback was before any seek in flight. Browsers fire a timeupdate at
   * the new position before 'seeked', so the seek's own target must never be
   * mistaken for where the student had got to.
   */
  const settledPositionRef = useRef(0);
  const seekingRef = useRef(false);
  /**
   * Set while the page stops audio that something outside it (a headset button, the lock screen) started
   * during a pause: the 'pause' that follows is not the student's and stays out of the listening log.
   */
  const outsidePlayRef = useRef(false);
  /** Time the lab audio has actually played this session; speech only counts while it runs. */
  const listenClock = useRef(new Stopwatch()).current;
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const micLostRef = useRef(false);
  /** The student chose to do the lab without a microphone. */
  const noMicRef = useRef(false);
  const sessionDeadRef = useRef(false);
  /** The lab paused itself because its reports stopped reaching the server. */
  const waitingRef = useRef(false);
  const enablingRef = useRef(false);
  const submittingRef = useRef(false);
  const unmountedRef = useRef(false);
  /** The lab this component already opened a session for: React's development double mount must not open two. */
  const openedForRef = useRef<number | null>(null);
  /** Which opening is current, so a slow answer to an earlier one is ignored. */
  const openSeqRef = useRef(0);
  /** performance.now() when the server signed the session's start; reports carry time since then. */
  const sessionClockRef = useRef(0);
  const sessionTokenRef = useRef<string | null>(null);
  const pendingReportsRef = useRef<PendingReport[]>([]);
  const flushingRef = useRef<Promise<void> | null>(null);
  /** The pause results the submit carries itself, kept so "Try again" sends the same set. */
  const submitAnswersRef = useRef<PauseAnswer[] | null>(null);
  /** The session is a test (an exam lab): read by handlers that outlive a render. */
  const examRef = useRef(false);
  const examAudioUrlRef = useRef<string | null>(null);
  const examStartingRef = useRef(false);

  // --- session --------------------------------------------------------------

  const { mutateAsync: beginAsync } = begin;
  const onSessionStarted = useCallback((token: string) => {
    sessionClockRef.current = performance.now();
    sessionTokenRef.current = token;
    sessionDeadRef.current = false;
    setSessionDead(false);
  }, []);

  const openSession = useCallback(() => {
    const seq = ++openSeqRef.current;
    setPhase('loading');
    // Awaited rather than given callbacks: React Query drops a mutation's callbacks when its component
    // unmounts, and development's rehearsal unmount would leave this page loading for good.
    beginAsync({ labId, client: LAB_CLIENT }).then(
      (s) => {
        if (unmountedRef.current || seq !== openSeqRef.current) return;
        examRef.current = !!s.exam;
        setSession(s);
        gateMarginRef.current = s.gateMarginDb ?? DEFAULT_GATE_MARGIN_DB;
        onSessionStarted(s.startToken);
        setPhase('setup');
      },
      (err: unknown) => {
        if (unmountedRef.current || seq !== openSeqRef.current) return;
        // A test whose one start is used: said in both languages, with no way round it but the teacher.
        if (appCodeOf(err) === EXAM_APP_CODES.used) setExamRefusal('used');
        setError(err instanceof Error ? err.message : t('This lab could not be opened.'));
        setPhase('failed');
      },
    );
  }, [beginAsync, labId, onSessionStarted, setPhase, t]);

  useEffect(() => {
    // Once per lab: development mode runs this twice, and each run would open (and log) a session.
    if (openedForRef.current === labId) return;
    openedForRef.current = labId;
    openSession();
  }, [labId, openSession]);

  /** Renews a session opened hours ago, before any work depends on it. */
  const renewIfOld = useCallback(async () => {
    // Never a test's: a renewed session would have no start.
    if (examRef.current || performance.now() - sessionClockRef.current <= SESSION_REFRESH_MS) return;
    const renewed = await beginAsync({ labId, client: LAB_CLIENT });
    // The teacher made the lab a test since this page opened it: only a fresh page plays it as one
    // (this page has no start for it, and no audio would come).
    if (renewed.exam) throw new Error(t('This test was changed. Reload the page.'));
    setSession(renewed);
    gateMarginRef.current = renewed.gateMarginDb ?? DEFAULT_GATE_MARGIN_DB;
    onSessionStarted(renewed.startToken);
  }, [beginAsync, labId, onSessionStarted, t]);

  // --- lifecycle helpers ----------------------------------------------------

  const acquireWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Unsupported or refused; the page still works, the screen may just dim.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  /**
   * A frame the voice meter has decided (a few frames after it was taken),
   * with what the page knew when it took it: it counts where it belonged then.
   */
  const takeFrame = useCallback(({ db, ambientDb, gateDb, loud, voiced, data: frame }: MeterFrame<FrameContext>) => {
    lastVoicedRef.current = voiced;
    if (frame.listening && voiced) voicedRef.current += frame.frameMs;
    // Every frame the pause tracker can count while paused (in a window, or carried into one).
    if (voiced && frame.sample?.mode === 'paused') pausedVoicedRef.current += frame.frameMs;
    if (frame.checking) {
      if (voiced) micCheckRef.current += frame.frameMs;
      if (db > LEVEL_ONLY_DB) micLevelRef.current += frame.frameMs;
    }
    if (frame.sample) {
      frame.tracker?.sample({ ...frame.sample, frameMs: frame.frameMs, voiced, loud });
      frame.measures?.levelOnly.sample({ ...frame.sample, frameMs: frame.frameMs, voiced: db > LEVEL_ONLY_DB });
    }
    const measures = frame.measures;
    if (measures) {
      measures.frames += 1;
      if (ambientDb !== null) measures.ambient.add(ambientDb);
      measures.gate.add(gateDb);
      if (voiced) measures.overGate.add(db - gateDb);
    }
  }, []);

  /** Decides the frames the meter still holds (its look-ahead): before the trackers settle, and before the microphone stops. */
  const flushMeter = useCallback(() => {
    const meter = meterRef.current;
    if (meter) for (const frame of meter.voice.flush()) takeFrame(frame);
  }, [takeFrame]);

  const stopMeter = useCallback(() => {
    const meter = meterRef.current;
    if (meter) {
      flushMeter();
      clearInterval(meter.timer);
      meter.context.close().catch(() => {});
      meterRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    levelRef.current = 0;
    gateRef.current = null;
    lastVoicedRef.current = false;
  }, [flushMeter]);

  /**
   * Brings the pause trackers to where the audio is before the page changes
   * it (a jump back, the end), with every frame heard until now decided
   * first: a pass the meter still held would otherwise be settled without its
   * last 200 ms.
   */
  const flushAndSettle = useCallback((positionMs: number) => {
    flushMeter();
    const now = performance.now();
    trackerRef.current?.settle(positionMs, now);
    measuresRef.current?.levelOnly.settle(positionMs, now);
  }, [flushMeter]);

  const sampleMeter = useCallback(() => {
    const meter = meterRef.current;
    if (!meter) return;
    meter.analyser.getFloatTimeDomainData(meter.samples);
    const now = performance.now();
    const frameMs = Math.min(MAX_FRAME_MS, now - meter.lastAt);
    meter.lastAt = now;
    const tracker = trackerRef.current;
    const audio = audioRef.current;
    // Paused by the student with the page in view: an answer given while paused still counts.
    // Mid-seek the audio is nowhere yet: the trackers wait for it to land, so the last place
    // they sampled stays where playback had got to (reportBeforeSeek sends from there).
    const mode: SampleMode | null = !tracker || !audio || audio.seeking ? null
      : listenClock.running ? 'playing'
        : phaseRef.current === 'paused' && !micLostRef.current && document.visibilityState === 'visible' ? 'paused'
          : null;
    // With how long the tick took: after a late one (a busy Chromebook) the meter judges the frame before the newest too.
    const decided = meter.voice.push(meter.samples, {
      frameMs,
      listening: listenClock.running,
      // The check before Start: any voice, whatever the lab audio is doing.
      checking: phaseRef.current === 'ready' && !noMicRef.current,
      sample: mode && audio ? { positionMs: audio.currentTime * 1000, wallMs: now, mode } : null,
      tracker,
      measures: measuresRef.current,
    }, frameMs);
    levelRef.current = Math.min(1, Math.max(0, (meter.voice.levelDb + 60) / 50));
    gateRef.current = meter.voice.gateDb;
    for (const frame of decided) takeFrame(frame);
  }, [listenClock, takeFrame]);

  const pause = useCallback((reason: string | null = null) => {
    if (phaseRef.current !== 'running') return;
    // Phase first, so the audio's own 'pause' event knows this pause was ours.
    setPhase('paused');
    audioRef.current?.pause();
    listenClock.stop();
    releaseWakeLock();
    setNotice(reason);
  }, [listenClock, releaseWakeLock, setPhase]);

  const stopWaiting = useCallback(() => {
    waitingRef.current = false;
    setWaiting(false);
  }, []);

  // --- listening log --------------------------------------------------------
  //
  // Reports go one at a time, in order; one that fails stays queued and is
  // resent with its original time, so a Wi-Fi drop leaves no hole in the log.

  const sendReport = useCallback(async (report: PendingReport) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        utils.client.labs.heartbeat.mutate({
          labId: report.labId,
          startToken: report.startToken,
          kind: report.kind,
          positionMs: report.positionMs,
          clientMs: report.clientMs,
          ...(report.answers ? { answers: report.answers } : {}),
        }, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
          }, REPORT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, [utils]);

  const flushReports = useCallback((): Promise<void> => {
    if (flushingRef.current) return flushingRef.current;
    const run = (async () => {
      while (pendingReportsRef.current.length > 0 && !unmountedRef.current) {
        const next = pendingReportsRef.current[0];
        try {
          await sendReport(next);
          // By identity: a submit may have carried reports off the queue meanwhile.
          pendingReportsRef.current = pendingReportsRef.current.filter((r) => r !== next);
        } catch (err) {
          const code = (err as { data?: { code?: string } }).data?.code;
          if (code === 'BAD_REQUEST' || code === 'NOT_FOUND' || code === 'FORBIDDEN') {
            // This session will never be accepted: drop its reports, and if it
            // is the one in progress, say so now rather than after fifteen minutes.
            pendingReportsRef.current = pendingReportsRef.current.filter((r) => r.startToken !== next.startToken);
            if (next.startToken === sessionTokenRef.current) {
              sessionDeadRef.current = true;
              setSessionDead(true);
              stopWaiting();
              // A test cannot be started over: only the teacher can give another start.
              const message = examRef.current
                ? t('This test can no longer be saved. Ask your teacher.')
                : t('This session can no longer be saved (it may have expired, or the lab was closed). Start over to try again.');
              if (phaseRef.current === 'running') pause(message);
              else if (phaseRef.current === 'paused') setNotice(message);
            }
            continue;
          }
          break;
        }
      }
    })();
    flushingRef.current = run.finally(() => { flushingRef.current = null; });
    return flushingRef.current;
  }, [pause, sendReport, stopWaiting, t]);

  /**
   * Queues a report of where the audio is. Tick, pause and end reports carry
   * the pause results finished since the last one; with the queue full they
   * stay with the tracker for a later report.
   */
  const report = useCallback((kind: ReportKind, options: { positionMs?: number } = {}) => {
    const queue = pendingReportsRef.current;
    if (!session || !sessionTokenRef.current || queue.length >= MAX_PENDING_REPORTS) return;
    const now = performance.now();
    const item: PendingReport = {
      labId: session.id,
      startToken: sessionTokenRef.current,
      kind,
      positionMs: Math.round(options.positionMs ?? (audioRef.current?.currentTime ?? 0) * 1000),
      clientMs: Math.round(now - sessionClockRef.current),
      queuedAt: now,
    };
    if (kind === 'tick' || kind === 'pause' || kind === 'end' || kind === 'nomic') {
      const answers = trackerRef.current?.takeResults(MAX_ANSWERS_PER_REPORT) ?? [];
      if (answers.length > 0) item.answers = answers;
    }
    queue.push(item);
    void flushReports();
  }, [flushReports, session]);

  /** Whether this session's oldest unsent report has waited too long: the audio would run ahead of what the server has seen. */
  const connectionLost = useCallback(() => {
    const oldest = pendingReportsRef.current.find((r) => r.startToken === sessionTokenRef.current);
    return oldest !== undefined && performance.now() - oldest.queuedAt > CONNECTION_WAIT_MS;
  }, []);

  // --- microphone -----------------------------------------------------------

  const onMicLost = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'ready') {
      stopMeter();
      setError(t('The microphone disconnected. Reconnect it and turn it on again.'));
      setPhase('setup');
      return;
    }
    if (current !== 'running' && current !== 'paused') return;
    if (!micLostRef.current) {
      micLostRef.current = true;
      setMicLost(true);
      // Stopping decides the frames the meter still held: what was heard before the loss counts.
      // No settle: a pass open now carries on if the microphone comes back.
      stopMeter();
    }
    const message = t('Your microphone disconnected at {{time}}. Reconnect it and press “Turn the microphone back on” to carry on from where you stopped.', { time: formatClock(positionRef.current) });
    if (current === 'running') pause(message);
    else setNotice(message);
  }, [pause, setPhase, stopMeter, t]);

  /** Opens the microphone and its level meter; closes any it had first. */
  const openMic = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('This browser cannot use the microphone. Use Chrome, or Safari on an iPhone or iPad.'));
      return false;
    }
    stopMeter();
    // Created inside the click: browsers start an AudioContext suspended otherwise.
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Context();
    try {
      // Whatever stream this returns feeds the meter. A console script that
      // replaces getUserMedia with a made-up stream (a tone switched on in the
      // pauses) answers them, and neither the page nor the server can tell: a
      // documented limit, like a fetch override. Blocking Developer tools on
      // student Chromebooks is what stops it.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (unmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        context.close().catch(() => {});
        return false;
      }
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      track?.addEventListener('ended', () => onMicLost());
      processingRef.current = readProcessing(track, context);

      // Not awaited: a context that never starts must not hang the page.
      context.resume().catch(() => {});
      const analyser = context.createAnalyser();
      // Sized by time, not samples: the meter judges 42.7 ms frames at whatever
      // rate the browser runs the context (the output device's: 16 kHz on a
      // Bluetooth headset, 192 kHz on some sound cards), and keeps the frame
      // before for a late tick.
      const rate = context.sampleRate || 48_000;
      analyser.fftSize = analyserSize(rate);
      const silent = context.createGain();
      silent.gain.value = 0;
      context.createMediaStreamSource(stream).connect(analyser);
      // Some browsers only run an analyser that reaches the output; send it there silently.
      analyser.connect(silent).connect(context.destination);
      meterRef.current = {
        context,
        analyser,
        samples: new Float32Array(analyser.fftSize),
        timer: setInterval(sampleMeter, 50),
        lastAt: performance.now(),
        // A new room level for each opening: it carries over from the mic check into the lab, not across a reconnect.
        voice: new VoiceMeter<FrameContext>({ sampleRate: rate, marginDb: gateMarginRef.current }),
      };
      return true;
    } catch {
      context.close().catch(() => {});
      setError(t('Could not use the microphone. Allow microphone access for this site (the icon in the address bar), then try again.'));
      return false;
    }
  }, [onMicLost, sampleMeter, stopMeter, t]);

  const enableMic = useCallback(async () => {
    if (enablingRef.current || phaseRef.current !== 'setup') return;
    enablingRef.current = true;
    setEnabling(true);
    setError(null);
    try {
      // A tab left open for hours: renew the session before any work depends on it.
      await renewIfOld();
      if (await openMic()) {
        micCheckRef.current = 0;
        micLevelRef.current = 0;
        setPhase('ready');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('This lab could not be opened.'));
    } finally {
      enablingRef.current = false;
      setEnabling(false);
    }
  }, [openMic, renewIfOld, setPhase, t]);

  const reconnectMic = useCallback(async () => {
    if (enablingRef.current || !micLostRef.current) return;
    enablingRef.current = true;
    setEnabling(true);
    setError(null);
    try {
      if (await openMic()) {
        micLostRef.current = false;
        setMicLost(false);
        setNotice(t('Microphone back on. Press Resume to carry on.'));
      }
    } finally {
      enablingRef.current = false;
      setEnabling(false);
    }
  }, [openMic, t]);

  /** Asks before doing the lab without a microphone; what it costs depends on the teacher's rule. */
  const confirmNoMic = useCallback(() => window.confirm((session?.minAnsweredPct ?? 0) > 0
    ? t("Do the lab without a microphone? It won't count until your teacher checks it.")
    : t('Do the lab without a microphone? Your teacher will see that you did.')), [session, t]);

  /**
   * Asks before going on without a microphone that stopped mid-lab. The pauses
   * answered before still count, so it says where they leave the lab: with
   * enough of them it counts without the teacher (the page's count; the
   * server's is the one that decides).
   */
  const confirmGoOnWithoutMic = useCallback(() => {
    const pct = session?.minAnsweredPct ?? 0;
    const counted = session?.pauses?.length ?? 0;
    if (pct <= 0) return window.confirm(t('Go on without the microphone? Your teacher will see that you did.'));
    // A lab without a pause list has no pauses to count: it waits for the teacher.
    if (counted === 0) return confirmNoMic();
    const needed = session?.needed ?? neededPauses(counted, pct);
    const answered = trackerRef.current?.answeredCount() ?? 0;
    // A rule can need a single pause, so "1 pauses" needs its own texts.
    if (answered >= needed) {
      return window.confirm(answered === 1
        ? t('Go on without the microphone? You already answered 1 pause. That should be enough for the lab to count.')
        : t('Go on without the microphone? You already answered {{answered}} pauses. That should be enough for the lab to count.', { answered }));
    }
    return window.confirm(needed === 1
      ? t("Go on without the microphone? You answered {{answered}} of the 1 pause needed, so the lab won't count until your teacher checks it.", { answered })
      : t("Go on without the microphone? You answered {{answered}} of the {{needed}} pauses needed, so the lab won't count until your teacher checks it.", { answered, needed }));
  }, [confirmNoMic, session, t]);

  /** "My mic doesn't work", before the lab starts: it plays without one, and the teacher is told. */
  const startWithoutMic = useCallback(async () => {
    const current = phaseRef.current;
    if (enablingRef.current || (current !== 'setup' && current !== 'ready') || !confirmNoMic()) return;
    enablingRef.current = true;
    setEnabling(true);
    setError(null);
    try {
      await renewIfOld();
      stopMeter();
      noMicRef.current = true;
      setNoMic(true);
      // The server's log marks it: no pause result can come after this (a script's would).
      report('nomic');
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('This lab could not be opened.'));
    } finally {
      enablingRef.current = false;
      setEnabling(false);
    }
  }, [confirmNoMic, renewIfOld, report, setPhase, stopMeter, t]);

  /** "Go on without the microphone", after it disconnected mid-lab. Pauses answered before still count. */
  const continueWithoutMic = useCallback(() => {
    if (!micLostRef.current || !confirmGoOnWithoutMic()) return;
    // The last results go with the server's mark, and none after it: a pass playback has passed
    // finishes now, and one still open (the microphone went mid-pause) is dropped.
    flushAndSettle(positionRef.current);
    report('nomic');
    noMicRef.current = true;
    setNoMic(true);
    // The pauses played from here on go unheard, and the page says so.
    setMicStoppedAt(positionRef.current);
    // Resume waits on this, so it must be cleared, not only the state.
    micLostRef.current = false;
    setMicLost(false);
    setNotice(t('No microphone from here on. Press Resume to carry on.'));
  }, [confirmGoOnWithoutMic, flushAndSettle, report, t]);

  // --- start / resume / finish ---------------------------------------------

  const onPlayRejected = useCallback((err: unknown) => {
    pause((err as { name?: string }).name === 'NotAllowedError'
      ? t('Your browser blocked the audio. Press Resume to start it.')
      : t('The lab audio stopped loading. Check your connection and press Resume.'));
  }, [pause, t]);

  const start = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !session || phaseRef.current !== 'ready') return;
    const exam = examRef.current;
    // A test plays only the audio its confirmed start handed over; it has no microphone check.
    if (exam && !examAudioUrlRef.current) return;
    // Only once the page has heard the student, unless they chose to go without a microphone.
    const heardVoice = micCheckRef.current >= MIC_CHECK_VOICE_MS;
    if (!exam && !noMicRef.current && (!streamRef.current || (!heardVoice && micLevelRef.current < MIC_CHECK_LEVEL_MS))) return;
    setError(null);
    setNotice(null);
    micCheckKindRef.current = exam || noMicRef.current ? null : heardVoice ? 'voice' : 'level';

    coverageRef.current.reset();
    voicedRef.current = 0;
    pausedVoicedRef.current = 0;
    micLostRef.current = false;
    listenClock.reset();
    lastTimeRef.current = null;
    lastWallRef.current = null;
    positionRef.current = 0;
    settledPositionRef.current = 0;
    seekingRef.current = false;
    if (exam) {
      // Nothing listens on a test: no pauses to count, no voice to measure.
      trackerRef.current = null;
      measuresRef.current = null;
    } else {
      // An unscanned lab has no counted pauses: everything played is "outside" them.
      const trackerOptions = { floorMs: session.voicePerPauseMs ?? DEFAULT_VOICE_PER_PAUSE_MS, slackMs: CONTINUITY_SLACK_MS };
      trackerRef.current = new PauseTracker(session.pauses ?? [], trackerOptions);
      measuresRef.current = {
        levelOnly: new PauseTracker(session.pauses ?? [], trackerOptions),
        ambient: new DbMedian(...LAB_MIC_STATS_LIMITS.ambientDbP50),
        gate: new DbMedian(...LAB_MIC_STATS_LIMITS.gateDbP50),
        overGate: new DbMedian(...LAB_MIC_STATS_LIMITS.voiceOverGateDbP50),
        frames: 0,
      };
    }
    unfocusedRef.current = 0;
    setMicStoppedAt(null);
    submitAnswersRef.current = null;
    setResult(null);
    setAskedTeacher(false);
    stopWaiting();

    // Only when needed: a seek to where it already is still logs a jump.
    if (audio.currentTime !== 0) audio.currentTime = 0;
    audio.playbackRate = 1;
    setPhase('running');
    void acquireWakeLock();
    // Within the click, so iOS allows it. The speaking count starts when the audio does.
    audio.play().catch(onPlayRejected);
  }, [acquireWakeLock, listenClock, onPlayRejected, session, setPhase, stopWaiting]);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || phaseRef.current !== 'paused' || micLostRef.current || sessionDead || waitingRef.current) return;
    setNotice(null);
    setPhase('running');
    void acquireWakeLock();
    if (audio.error) {
      // The audio failed to load: fetch it again and carry on from where it stopped.
      audio.load();
      const at = positionRef.current / 1000;
      audio.currentTime = at;
      if (examRef.current) {
        // A test never starts again from the top: once the reloaded file knows its length, the
        // position is set again if the browser dropped it.
        audio.addEventListener('loadedmetadata', () => {
          if (Math.abs(audio.currentTime - at) > 0.5) audio.currentTime = at;
        }, { once: true });
      }
    }
    audio.play().catch(onPlayRejected);
  }, [acquireWakeLock, onPlayRejected, sessionDead, setPhase]);

  const back = useCallback(() => {
    const audio = audioRef.current;
    const current = phaseRef.current;
    if (!audio || (current !== 'running' && current !== 'paused') || seekingRef.current) return;
    // Before the jump: a pause just finished rides on a report of where playback reached,
    // so the server's log shows it played through in the same run.
    flushAndSettle(audio.currentTime * 1000);
    report('tick');
    audio.currentTime = Math.max(0, audio.currentTime - BACK_SECONDS);
  }, [flushAndSettle, report]);

  /**
   * Any other seek (a console `audio.currentTime = …`): the results the
   * tracker holds go first, on a tick of where it last sampled the audio, so
   * the server finds each in the playback its pass was in. Sent after the
   * jump, a pass's result would sit in the next playback beside the replay's
   * own, and both would be rejected. Not positionRef: it lags the tracker by
   * up to one timeupdate, and a report short of the window's end cannot carry
   * its result.
   */
  const reportBeforeSeek = useCallback(() => {
    const current = phaseRef.current;
    if (current !== 'running' && current !== 'paused') return;
    flushMeter();
    const tracker = trackerRef.current;
    if (!tracker || tracker.unsent === 0) return;
    report('tick', { positionMs: tracker.lastPositionMs ?? settledPositionRef.current });
  }, [flushMeter, report]);

  // --- turning in ------------------------------------------------------------

  const submit = useCallback(async () => {
    if (!session || !sessionTokenRef.current || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setPhase('submitting');
    // A connection that dies without a word would leave "Turning it in…" up for
    // good. A hand-made timer, not AbortSignal.timeout: older iPads lack it.
    // Retrying is safe; the server takes a resubmitted session as a duplicate.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, SUBMIT_TIMEOUT_MS);
    });
    try {
      // Anything the log is still missing goes first; the server judges from
      // it. A stuck connection must not hold the student hostage, though: what
      // is still queued travels with the submission, whole.
      await Promise.race([flushReports(), new Promise((resolve) => setTimeout(resolve, FLUSH_BEFORE_SUBMIT_MS))]);
      const token = sessionTokenRef.current;
      const carried = pendingReportsRef.current.filter((r) => r.startToken === token).slice(0, MAX_SUBMIT_REPORTS);
      const reports = carried.map((r) => ({
        kind: r.kind,
        positionMs: r.positionMs,
        clientMs: r.clientMs,
        ...(r.answers ? { answers: r.answers } : {}),
      }));
      const common = {
        labId: session.id,
        startToken: token,
        positionMs: Math.round(positionRef.current),
        clientMs: Math.round(performance.now() - sessionClockRef.current),
        listenWallMs: Math.round(listenClock.elapsed()),
      };
      let input;
      if (examRef.current) {
        // A test: no microphone, no pauses, nothing outside them. Only the time played in the background is measured.
        submitAnswersRef.current ??= [];
        input = {
          ...common,
          voicedMs: 0,
          pausedVoicedMs: 0,
          mic: 'off' as const,
          answers: submitAnswersRef.current,
          reports,
          micStats: clampLabMicStats({
            ambientDbP50: null,
            gateDbP50: null,
            voiceOverGateDbP50: null,
            levelOnlyAnswered: null,
            loudNotVoiceInPausesMs: 0,
            unfocusedPlayedMs: unfocusedRef.current,
            micCheck: null,
            processing: null,
          }),
        };
      } else {
        submitAnswersRef.current ??= trackerRef.current?.takeResults(MAX_SUBMIT_ANSWERS) ?? [];
        const outside = trackerRef.current?.outside() ?? { voicedMs: 0, playedMs: 0 };
        const measures = measuresRef.current;
        const micStats = clampLabMicStats({
          ambientDbP50: measures?.ambient.median() ?? null,
          gateDbP50: measures?.gate.median() ?? null,
          voiceOverGateDbP50: measures?.overGate.median() ?? null,
          // Null when the old meter had nothing to answer: no pause list, or no microphone at all.
          levelOnlyAnswered: measures && measures.frames > 0 && (session.pauses?.length ?? 0) > 0 ? measures.levelOnly.answeredCount() : null,
          loudNotVoiceInPausesMs: trackerRef.current?.soundInPausesMs() ?? 0,
          unfocusedPlayedMs: unfocusedRef.current,
          micCheck: micCheckKindRef.current,
          processing: processingRef.current,
        });
        input = {
          ...common,
          voicedMs: Math.round(voicedRef.current),
          pausedVoicedMs: Math.round(pausedVoicedRef.current),
          mic: noMicRef.current ? 'off' as const : 'on' as const,
          answers: submitAnswersRef.current,
          reports,
          outsideVoicedMs: Math.round(outside.voicedMs),
          outsidePlayedMs: Math.round(outside.playedMs),
          micStats,
        };
      }
      // Raced as well as aborted: a batched request only aborts once every call in it has.
      const response = await Promise.race([
        utils.client.labs.submit.mutate(input, { signal: controller.signal }),
        timedOut,
      ]);
      // They went with the submission: nothing of them is left to resend.
      pendingReportsRef.current = pendingReportsRef.current.filter((r) => !carried.includes(r));
      if (!unmountedRef.current) {
        // A server from before the pause rule sends no result: the plain "Turned in" then.
        setResult(response.result ?? null);
        setPhase('done');
      }
      void utils.labs.list.invalidate();
    } catch (err) {
      // Keep the session: a lost connection must never cost the student the lab.
      if (unmountedRef.current) return;
      setError(controller.signal.aborted
        ? t('Turning it in took too long. Check your connection and press Try again.')
        : err instanceof Error ? err.message : t('Could not turn it in. Try again.'));
      setPhase('finished');
    } finally {
      clearTimeout(timer);
      submittingRef.current = false;
    }
  }, [flushReports, listenClock, session, setPhase, t, utils]);

  const finish = useCallback(() => {
    if (phaseRef.current !== 'running' && phaseRef.current !== 'paused') return;
    // Phase first, so the audio's own 'pause' event knows this stop was ours.
    setPhase('finished');
    audioRef.current?.pause();
    listenClock.stop();
    releaseWakeLock();
    // A pause playback has just passed is finished; one still open is not an answer.
    flushAndSettle(positionRef.current);
    stopMeter();
    stopWaiting();
    void submit();
  }, [flushAndSettle, listenClock, releaseWakeLock, setPhase, stopMeter, stopWaiting, submit]);

  /** "The mic didn't hear me": the lab waits for the teacher to check it instead of needing a redo. */
  const sendToTeacher = useCallback(async () => {
    if (!result || askTeacher.isPending) return;
    setError(null);
    try {
      await askTeacher.mutateAsync({ submissionId: result.submissionId });
      if (unmountedRef.current) return;
      setAskedTeacher(true);
      void utils.labs.list.invalidate();
    } catch (err) {
      if (!unmountedRef.current) setError(err instanceof Error ? err.message : t('Could not turn it in. Try again.'));
    }
  }, [askTeacher, result, t, utils]);

  // --- a test's one start ----------------------------------------------------

  /**
   * "Start the test": the server records the student's one start in the set
   * and only then hands over the audio. Fail closed: without its answer there
   * is no audio to play. Try again sends the same session, which the server
   * answers with the same start.
   */
  const startExam = useCallback(async (confirmed = false) => {
    if (!session || !examRef.current || examStartingRef.current || phaseRef.current !== 'setup') return;
    const token = sessionTokenRef.current;
    if (!token) return;
    if (!confirmed && !window.confirm(t('Start {{title}}? You can start one form of this test, once. Check that it is the form on your paper.', { title: session.title }))) return;
    examStartingRef.current = true;
    setExamStarting(true);
    setExamStartFailed(false);
    setError(null);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Raced as well as aborted, as the submit is: a batched request only aborts once every call in it has.
      const started = await Promise.race([
        utils.client.labs.startExam.mutate({ labId: session.id, startToken: token }, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
          }, EXAM_START_TIMEOUT_MS);
        }),
      ]);
      if (unmountedRef.current) return;
      if (!started?.audioUrl) throw new Error('no audio');
      examAudioUrlRef.current = started.audioUrl;
      setExamAudioUrl(started.audioUrl);
      setPhase('ready');
    } catch (err) {
      if (unmountedRef.current) return;
      const code = appCodeOf(err);
      if (code === EXAM_APP_CODES.used) setExamRefusal('used');
      else if (code === EXAM_APP_CODES.changed) setExamRefusal('changed');
      else setExamStartFailed(true);
    } finally {
      clearTimeout(timer);
      examStartingRef.current = false;
      setExamStarting(false);
    }
  }, [session, setPhase, t, utils]);

  // --- lab audio events -----------------------------------------------------

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !session) return;
    const nowMs = () => audio.currentTime * 1000;

    const onPlaying = () => {
      if (phaseRef.current !== 'running') {
        // Something outside the page (headset button, lock screen) started the
        // audio. Nothing may play while the microphone is off. Marked only when
        // a 'pause' event will follow, so the mark cannot outlive it.
        if (!audio.paused) {
          outsidePlayRef.current = true;
          audio.pause();
        }
        return;
      }
      listenClock.start();
      lastTimeRef.current = nowMs();
      lastWallRef.current = performance.now();
      report('play');
    };
    const onTimeUpdate = () => {
      if (seekingRef.current || phaseRef.current !== 'running' || audio.paused || audio.seeking) return;
      const now = nowMs();
      const wall = performance.now();
      positionRef.current = now;
      settledPositionRef.current = now;
      const last = lastTimeRef.current;
      const lastWall = lastWallRef.current;
      // Continuous playback counts, however long between ticks (a dialog or a
      // slow machine can hold events up while the audio plays on); a jump the
      // clock cannot account for is a seek, not listening. Same rule as the server.
      if (last !== null && lastWall !== null && now > last && now - last <= wall - lastWall + CONTINUITY_SLACK_MS) {
        coverageRef.current.add(last, now);
      }
      lastTimeRef.current = now;
      lastWallRef.current = wall;
    };
    const onPause = () => {
      const stoppedOutsidePlay = outsidePlayRef.current;
      outsidePlayRef.current = false;
      listenClock.stop();
      lastTimeRef.current = nowMs();
      lastWallRef.current = performance.now();
      if (!audio.error) positionRef.current = nowMs();
      if (audio.ended) return;
      // Finish stops the audio itself, and this event lands while the lab is
      // being turned in: reported, it would sit after the submission in the log.
      const current = phaseRef.current;
      if (current !== 'running' && current !== 'paused') return;
      // The page's own stop of audio started from outside: the lab was paused already, and the log says so once.
      if (stoppedOutsidePlay) return;
      report('pause');
      // Not our pause (headphones unplugged, OS media controls): follow it.
      if (current === 'running') {
        pause(session.exam ? t('The audio stopped. Press Resume to carry on from where it stopped.') : t('Paused.'));
      }
    };
    const onWaiting = () => {
      // Buffering: the lab is not playing, so neither listening nor speaking counts.
      if (phaseRef.current === 'running') listenClock.stop();
      lastTimeRef.current = null;
      lastWallRef.current = null;
    };
    const onSeeking = () => {
      // Back 10 s has reported already; any other seek has not.
      reportBeforeSeek();
      seekingRef.current = true;
      lastTimeRef.current = null;
      lastWallRef.current = null;
    };
    const onSeeked = () => {
      seekingRef.current = false;
      if (session.exam) {
        // A test plays straight through: any move, back or forward, goes back to where it was.
        // The page's own seeks (the start, a reload after an audio error) land on that point.
        if (Math.abs(nowMs() - settledPositionRef.current) > FINISH_TOLERANCE_MS) {
          audio.currentTime = settledPositionRef.current / 1000;
          return;
        }
      } else {
        // Forward past everything heard and past where it was: not allowed. Put it back.
        // Going back is always fine.
        const allowed = Math.max(coverageRef.current.heardThroughMs(), settledPositionRef.current);
        if (nowMs() > allowed + FINISH_TOLERANCE_MS) {
          audio.currentTime = allowed / 1000;
          return;
        }
      }
      lastTimeRef.current = nowMs();
      lastWallRef.current = performance.now();
      positionRef.current = nowMs();
      settledPositionRef.current = nowMs();
      report('seek');
    };
    const onRateChange = () => { if (audio.playbackRate !== 1) audio.playbackRate = 1; };
    const onEnded = () => {
      const endMs = audio.duration * 1000;
      // The last tick before "ended" can be a few hundred ms short of the end.
      if (lastTimeRef.current !== null) coverageRef.current.add(lastTimeRef.current, endMs);
      positionRef.current = endMs;
      // A pause finished in those last moments rides on the end report.
      flushAndSettle(endMs);
      report('end', { positionMs: endMs });
      finish();
    };
    const onError = () => {
      if (phaseRef.current === 'running') pause(t('The lab audio stopped loading. Check your connection and press Resume.'));
    };

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('seeking', onSeeking);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('ratechange', onRateChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('seeking', onSeeking);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('ratechange', onRateChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [finish, flushAndSettle, listenClock, pause, report, reportBeforeSeek, session, t]);

  // Headset buttons, the lock screen and the browser's media controls go
  // through the same doors as the on-page buttons — and cannot skip ahead.
  const inSession = phase === 'running' || phase === 'paused';
  useEffect(() => {
    const media = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    // Only during the session: outside it the page has nothing playing.
    if (!media || !session || !inSession) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { media.setActionHandler(action, handler); } catch { /* not supported here */ }
    };
    try {
      if (typeof MediaMetadata !== 'undefined') media.metadata = new MediaMetadata({ title: session.title, artist: 'libreSRS' });
    } catch { /* metadata is decoration */ }
    if (session.exam) {
      // A test: play only resumes what stopped by itself (resume refuses anything else); nothing
      // from a headset or the lock screen pauses, stops or moves it.
      const blockedInTest: MediaSessionAction[] = ['pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];
      set('play', () => resume());
      for (const action of blockedInTest) set(action, () => {});
      return () => {
        for (const action of ['play', ...blockedInTest] as MediaSessionAction[]) set(action, null);
        media.metadata = null;
      };
    }
    // Not while the page is hidden: the lab pauses when the student leaves it.
    set('play', () => { if (document.visibilityState === 'visible') resume(); });
    set('pause', () => pause(t('Paused.')));
    set('seekbackward', () => back());
    const blocked: MediaSessionAction[] = ['seekforward', 'seekto', 'nexttrack', 'previoustrack'];
    for (const action of blocked) set(action, () => {});
    return () => {
      for (const action of ['play', 'pause', 'seekbackward', ...blocked] as MediaSessionAction[]) set(action, null);
      media.metadata = null;
    };
  }, [back, inSession, pause, resume, session, t]);

  // --- page-level guards ----------------------------------------------------

  const examMode = !!session?.exam;
  // Once the server stops accepting a test's session, staying cannot help: only the teacher can give another start.
  const busy = examMode
    ? (EXAM_BUSY.includes(phase) && !sessionDead) || examStarting || examStartFailed
    : BUSY.includes(phase);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const { leave: leavePage } = useLeaveGuard(busy, examMode
    ? t('Leave this test? You can start it only once.')
    : t('Leave this lab? It has not been turned in, and you would have to do it again.'));
  // A test goes back to the Tests page, where it is listed (v1.21.0): one that opened as a test, or was refused as one.
  const testKnown = examMode || examRefusal !== null;
  const exit = useCallback(() => onExit(testKnown), [onExit, testKnown]);
  const backLabel = fromTests || testKnown ? t('Back to tests') : t('Back to labs');

  useEffect(() => {
    const onVisibility = () => {
      // A test plays on while the student looks away (its time in the background is still measured).
      if (examRef.current) return;
      if (document.visibilityState === 'hidden') pause(t('Paused because you left the page. Press Resume to carry on.'));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause, t]);

  useEffect(() => {
    if (!['ready', 'running', 'paused'].includes(phase)) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      // Split screen or a window on top: the lab plays on (honest students type the
      // dictation there), and the teacher sees for how long.
      if (listenClock.running && !document.hasFocus()) unfocusedRef.current += Math.min(MAX_FOCUS_STEP_MS, now - last);
      last = now;
      setTick((n) => n + 1);
    }, 200);
    return () => clearInterval(timer);
  }, [listenClock, phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    let held: ReturnType<typeof setTimeout> | undefined;
    /**
     * A tick, unless the audio's position reads stale (the page just froze, and
     * Firefox gives the old position for a moment): then it waits for the
     * position to catch up, so the server sees the same unbroken playback the
     * page counted.
     */
    const tick = (heldMs: number) => {
      if (phaseRef.current !== 'running') return;
      const audio = audioRef.current;
      const tracker = trackerRef.current;
      if (audio && tracker && meterRef.current && listenClock.running && heldMs < TICK_HOLD_MAX_MS
        && tracker.positionSuspect(audio.currentTime * 1000, performance.now())) {
        held = setTimeout(() => tick(heldMs + TICK_HOLD_STEP_MS), TICK_HOLD_STEP_MS);
        return;
      }
      report('tick');
    };
    const timer = setInterval(() => {
      // Reports stuck for 90 s: the audio must not run on ahead of what the server has seen,
      // or the pauses in it would arrive too late to count. Wait for the connection instead.
      if (connectionLost()) {
        waitingRef.current = true;
        setWaiting(true);
        pause(t('Lost the connection. The lab is paused until it comes back.'));
        return;
      }
      clearTimeout(held);
      tick(0);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(held);
    };
  }, [connectionLost, listenClock, pause, phase, report, t]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void flushReports().then(() => {
        if (!waitingRef.current || unmountedRef.current) return;
        if (pendingReportsRef.current.some((r) => r.startToken === sessionTokenRef.current)) return;
        stopWaiting();
        if (phaseRef.current === 'paused') setNotice(t('The connection is back. Press Resume to carry on.'));
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [flushReports, stopWaiting, t, waiting]);

  useEffect(() => {
    // Set here, not only in the initializer: React's development mode mounts,
    // unmounts and remounts every component once, and a flag left true by that
    // rehearsal would make every later step think the page had gone.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      // Read at cleanup: the element only renders once the session has loaded.
      audioRef.current?.pause();
      stopMeter();
      releaseWakeLock();
    };
  }, [releaseWakeLock, stopMeter]);

  /** A new attempt is a new session: a fresh signed start and a fresh log, so nothing carries over. */
  const startOver = useCallback(() => {
    audioRef.current?.pause();
    stopMeter();
    releaseWakeLock();
    setNotice(null);
    setError(null);
    micLostRef.current = false;
    setMicLost(false);
    noMicRef.current = false;
    setNoMic(false);
    setMicStoppedAt(null);
    micCheckRef.current = 0;
    micLevelRef.current = 0;
    micCheckKindRef.current = null;
    stopWaiting();
    trackerRef.current = null;
    measuresRef.current = null;
    submitAnswersRef.current = null;
    setResult(null);
    setAskedTeacher(false);
    coverageRef.current.reset();
    openSession();
  }, [openSession, releaseWakeLock, stopMeter, stopWaiting]);

  const confirmStartOver = useCallback(() => {
    if (window.confirm(t('Give up on this session and start the lab again?'))) startOver();
  }, [startOver, t]);

  const leave = useCallback(() => {
    if (examRef.current) {
      // The start is used already, or may be (a start that failed may have reached the server): leaving now
      // costs it. Not once the server stopped accepting the session: staying cannot help then.
      const atStake = !sessionDeadRef.current
        && (examStartingRef.current || examStartFailed || phaseRef.current === 'ready' || phaseRef.current === 'finished');
      if (atStake && !window.confirm(t('Leave this test? You can start it only once.'))) return;
    } else if (phaseRef.current === 'finished'
      && !window.confirm(t('Leave without turning this in? You would have to do the lab again.'))) return;
    leavePage(exit);
  }, [examStartFailed, exit, leavePage, t]);

  // --- render ---------------------------------------------------------------

  const card = 'bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6';
  const primary = 'px-5 py-2.5 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
  const secondary = 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
  const linkButton = 'text-sm font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300 disabled:opacity-50';
  const amberText = 'text-amber-800 dark:text-amber-300';
  const greenText = 'text-green-700 dark:text-green-400';

  if (phase === 'loading') {
    return <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>;
  }
  if (phase === 'failed' || !session) {
    return (
      <div className={card}>
        {examRefusal === 'used' ? (
          // A test this student already started (this form or another of its set).
          <p role="alert" className="font-medium text-red-700 dark:text-red-400">
            <Bilingual text="You already started this test. Ask your teacher." />
          </p>
        ) : (
          <p className="text-red-700 dark:text-red-400">{error ?? t('This lab could not be opened.')}</p>
        )}
        <button onClick={exit} className={`${secondary} mt-4`}>{backLabel}</button>
      </div>
    );
  }

  // A lab is scored when the session began with a non-empty pause list; an older server sends none.
  const counted = session.pauses ?? [];
  const countedStarts = counted.map(([s]) => s);
  const scored = countedStarts.length > 0;
  const rulePct = session.minAnsweredPct ?? 0;
  const needed = scored ? session.needed ?? neededPauses(countedStarts.length, rulePct) : 0;
  const tracker = trackerRef.current;
  const answered = tracker?.answeredCount() ?? 0;
  const finishedPauses = tracker?.finishedCount() ?? 0;
  // Pauses still to be played (or passed without a result, as the "can't count" banner reckons them).
  const pausesLeft = countedStarts.length - finishedPauses;
  const enough = rulePct > 0 && answered >= needed;
  // Pauses already missed leave too few to reach the share: this attempt cannot count any more.
  const cannotCount = scored && rulePct > 0 && finishedPauses - answered > countedStarts.length - needed;
  const hearing = !noMic && !micLost;
  const nudge = scored && hearing ? tracker?.nudge() ?? null : null;
  // In a pause, nothing while paused; after one, the missed line stays until the next pause opens.
  const shownNudge = phase === 'paused' && nudge !== 'missed' ? null : nudge;
  const pauseStates = tracker?.states() ?? [];

  const heardThrough = coverageRef.current.heardThroughMs();
  const canFinish = heardThrough + FINISH_TOLERANCE_MS >= session.requiredThroughMs;
  const positionMs = (audioRef.current?.currentTime ?? 0) * 1000;
  const pct = (ms: number) => `${Math.min(100, (ms / session.durationMs) * 100)}%`;
  const level = levelRef.current;
  const speaking = lastVoicedRef.current;
  const gate = gateRef.current === null ? null : Math.min(1, Math.max(0, (gateRef.current + 60) / 50));
  const micHeard = micCheckRef.current >= MIC_CHECK_VOICE_MS;
  // Sound, but no voice picked out of it: the microphone works; the student is told to speak up.
  const micLevelOnly = !micHeard && micLevelRef.current >= MIC_CHECK_LEVEL_MS;
  const canStart = noMic || micHeard || micLevelOnly;
  const stoppedMidLab = noMic && micStoppedAt !== null;

  /** How a counted pause shows on the progress bar. */
  const pauseMark = (i: number) => {
    const state = pauseStates[i];
    if (state) return state;
    // Played after the microphone stopped: nothing heard it.
    const [start, end] = counted[i];
    if (noMic && micStoppedAt !== null && start >= micStoppedAt && end <= heardThrough) return 'unheard';
    return 'ahead';
  };

  const levelMeter = (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-20">{t('Microphone')}</span>
      <div className="relative flex-1 h-3 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full transition-[width] duration-100 ${speaking ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'}`}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
        {/* The level a voice must reach in this room. */}
        {gate !== null && (
          <div data-gate-tick className="absolute inset-y-0 w-0.5 bg-gray-700 dark:bg-gray-200" style={{ left: `${Math.round(gate * 100)}%` }} />
        )}
      </div>
    </div>
  );

  const noMicButton = (
    <button type="button" onClick={() => void startWithoutMic()} disabled={enabling} className={linkButton}>
      {t("My mic doesn't work")}
    </button>
  );

  // Unscored labs keep the old account of speaking: how long the microphone heard the student.
  const spokeLines = !scored && !noMic && (
    <>
      <p className="text-gray-700 dark:text-gray-300">
        {t('You spoke for about {{voiced}}.', { voiced: formatClock(voicedRef.current) })}
      </p>
      {voicedRef.current < session.minimumVoicedMs && (
        <p className={`${amberText} text-sm`}>
          {t('We heard very little speaking. The lab only works if you answer out loud in the pauses. Your teacher will see this.')}
        </p>
      )}
    </>
  );

  const answeredLine = (className: string) => result && (
    <p className={className}>
      {t('You answered {{answered}} of {{total}} pauses.', { answered: result.pausesAnswered ?? 0, total: result.pausesCounted ?? 0 })}
    </p>
  );
  // Told with the server's numbers, not the page's.
  const stoppedLine = (className: string) => result && (
    <p className={className}>
      {t('You answered {{answered}} of {{total}} pauses before the microphone stopped.', { answered: result.pausesAnswered ?? 0, total: result.pausesCounted ?? 0 })}
    </p>
  );
  const stoppedAndScored = micStoppedAt !== null && !!result?.scored;
  const needsRedo = !!result && !result.credit && result.scored && result.mic === 'on';
  // Scored, enough answered, and still not counted: the server held it for the teacher. A redo cannot help.
  const heldWithEnough = !!result && !result.credit && result.scored && (result.pausesAnswered ?? 0) >= (result.needed ?? 0);
  // Without a microphone it waits for the teacher, unless the student does it again with one that works.
  const noMicRedo = !!result && !result.credit && result.mic === 'off' && !heldWithEnough;
  const waitsForTeacher = askedTeacher || result?.status === 'check';

  return (
    <div className="space-y-6">
      {/* The lab audio; controls are ours so it cannot be skipped or sped up. A test's comes only with its confirmed start. */}
      <audio ref={audioRef} src={(examMode ? examAudioUrl : session.audioUrl) ?? undefined} preload="auto" />

      <div className="flex items-start justify-between gap-4">
        <div>
          {examMode && (
            <span className="inline-block mb-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {/* Not the vocabulary tests' "Test" (Prueba): a listening test is an examen. */}
              {t('Test · {{set}}', { set: session.exam ?? '' })}
            </span>
          )}
          <h2 className={examMode ? 'text-2xl font-bold text-gray-900 dark:text-gray-100' : 'text-xl font-semibold text-gray-900 dark:text-gray-100'}>{session.title}</h2>
          {session.description && <p className="text-gray-600 dark:text-gray-400 mt-1">{session.description}</p>}
        </div>
        {/* Not while a test's start is on its way: it may be recorded, and the page must stay to hear the answer. */}
        {!['running', 'paused', 'submitting'].includes(phase) && !examStarting && (
          <button onClick={leave} className={secondary}>{backLabel}</button>
        )}
      </div>

      {examMode && session.examPreview && (
        <p className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-900 dark:text-blue-200">
          {t('Teacher preview: your starts are not limited or recorded.')}
        </p>
      )}

      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200">
          {notice}
        </div>
      )}

      {examMode && phase === 'setup' && (
        <div className={`${card} space-y-5`}>
          <ol className="list-decimal pl-5 space-y-3 text-gray-800 dark:text-gray-200">
            {EXAM_INSTRUCTIONS.map((text) => <li key={text}><Bilingual text={text} /></li>)}
          </ol>
          {examRefusal ? (
            <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 font-medium text-red-800 dark:text-red-300">
              <Bilingual text={examRefusal === 'used' ? 'You already started this test. Ask your teacher.' : 'This test was changed. Reload the page.'} />
            </div>
          ) : (
            <div className="space-y-3">
              {examStartFailed && (
                <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
                  {t('The test could not start. Check your connection and try again.')}
                </div>
              )}
              {/* Try again sends the same session: the server answers it with the same start. */}
              <button onClick={() => void startExam(examStartFailed)} disabled={examStarting} className={primary}>
                {examStarting ? t('Starting…') : examStartFailed ? t('Try again') : t('Start the test')}
              </button>
            </div>
          )}
        </div>
      )}

      {examMode && phase === 'ready' && (
        <div className={`${card} space-y-4`}>
          <p className="text-gray-800 dark:text-gray-200">{t('When you are ready, press Play. The audio plays once, straight through.')}</p>
          <button onClick={start} className={primary}>{t('Play')}</button>
        </div>
      )}

      {!examMode && (phase === 'setup' || phase === 'ready') && (
        <div className={`${card} space-y-5`}>
          <ol className="list-decimal pl-5 space-y-2 text-gray-800 dark:text-gray-200">
            <li>{t('Put on headphones, so the microphone hears only you and not the lab.')}</li>
            <li>{t('Answer out loud in every pause, before the model answer. Guessing out loud is the exercise.')}</li>
            <li>
              {scored
                ? t('Do it in one sitting: about {{minutes}} minutes. The microphone checks for your voice in each pause; nothing is recorded.', { minutes: Math.ceil(session.durationMs / 60000) })
                : t('Do it in one sitting: about {{minutes}} minutes. The microphone counts how long you speak; nothing is recorded.', { minutes: Math.ceil(session.durationMs / 60000) })}
            </li>
            {scored && rulePct > 0 && (
              <li>{t('Answer out loud in at least {{needed}} of the {{total}} pauses for this lab to count.', { needed, total: countedStarts.length })}</li>
            )}
          </ol>

          {phase === 'setup' ? (
            <div className="flex flex-wrap items-center gap-4">
              <button onClick={() => void enableMic()} disabled={enabling} className={primary}>{t('Turn on the microphone')}</button>
              {noMicButton}
            </div>
          ) : (
            <div className="space-y-4">
              {noMic ? (
                <p className="text-sm text-gray-700 dark:text-gray-300">{t('No microphone. The lab will play without it.')}</p>
              ) : (
                <>
                  {levelMeter}
                  <p className={`text-sm ${micHeard ? `${greenText} font-medium` : micLevelOnly ? amberText : 'text-gray-600 dark:text-gray-400'}`} aria-live="polite">
                    {micHeard
                      ? t('We hear you. You can start.')
                      : micLevelOnly
                        ? t('We hear the room more than you. Speak up, or move closer to the microphone.')
                        : t('Say “hola”. “Start the lab” turns on once we hear you.')}
                  </p>
                </>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <button onClick={start} disabled={!canStart} className={primary}>{t('Start the lab')}</button>
                {!noMic && noMicButton}
              </div>
            </div>
          )}
        </div>
      )}

      {(phase === 'running' || phase === 'paused') && (
        <div className={`${card} space-y-5`}>
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center gap-2 font-medium ${phase === 'running' ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
              <span className={`w-3 h-3 rounded-full ${phase === 'running' ? 'bg-green-600 animate-pulse' : 'bg-gray-400'}`} />
              {phase === 'running' ? t('Playing') : t('Paused')}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
              {formatClock(positionMs)} / {formatClock(session.durationMs)}
            </span>
          </div>

          <div
            className="relative h-4 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden"
            role="progressbar"
            aria-label={t('Lab progress')}
            aria-valuemin={0}
            aria-valuemax={Math.round(session.requiredThroughMs / 1000)}
            aria-valuenow={Math.round(Math.min(heardThrough, session.requiredThroughMs) / 1000)}
          >
            <div className="absolute inset-y-0 left-0 bg-blue-200 dark:bg-blue-900" style={{ width: pct(heardThrough) }} />
            <div className="absolute inset-y-0 left-0 bg-blue-600" style={{ width: pct(positionMs) }} />
            {scored && countedStarts.map((start, i) => {
              const mark = pauseMark(i);
              return (
                <div
                  key={start}
                  aria-hidden="true"
                  data-pause-mark={mark}
                  className={`absolute inset-y-0 w-0.5 ${mark === 'answered'
                    ? 'bg-green-600 dark:bg-green-400'
                    : mark === 'missed' ? 'bg-amber-500 dark:bg-amber-400'
                      : mark === 'unheard' ? 'bg-white dark:bg-gray-200' : 'bg-gray-400 dark:bg-gray-500'}`}
                  style={{ left: pct(start) }}
                />
              );
            })}
            <div
              className="absolute inset-y-0 w-0.5 bg-gray-900 dark:bg-gray-100"
              style={{ left: pct(session.requiredThroughMs) }}
              title={t('End of the last prompt')}
            />
          </div>

          {!examMode && !micLost && !noMic && levelMeter}
          {/* A test hears nothing: no tally, no nudges. */}
          {examMode ? null : scored ? (
            stoppedMidLab ? (
              // What was heard before the microphone stopped still counts; the rest waits for the teacher.
              <p className={`text-sm ${rulePct <= 0 ? 'text-gray-600 dark:text-gray-400' : enough ? greenText : amberText}`}>
                {rulePct <= 0
                  ? t('Pauses answered before the microphone stopped: {{answered}} of {{done}}', { answered, done: finishedPauses })
                  : enough
                    ? t('Pauses answered before the microphone stopped: {{answered}}. That should be enough for the lab to count.', { answered })
                    : t('Pauses answered before the microphone stopped: {{answered}} of the {{needed}} needed. Your teacher will check this lab.', { answered, needed })}
              </p>
            ) : !noMic && (
              <>
                {/* Seen, not announced: a screen reader must not talk over the lab. */}
                <p className={`text-sm ${enough ? greenText : 'text-gray-600 dark:text-gray-400'}`}>
                  {rulePct <= 0
                    ? t('Pauses answered: {{answered}} of {{done}}', { answered, done: finishedPauses })
                    : enough
                      ? t('Pauses answered: {{answered}} · That should be enough for the lab to count. Keep answering to the end.', { answered })
                      : pausesLeft === 1
                        // What a student still short reads through every lab's last pause: its own singular text.
                        ? t('Pauses answered: {{answered}} of the {{needed}} needed · 1 pause left', { answered, needed })
                        : pausesLeft > 0
                          ? t('Pauses answered: {{answered}} of the {{needed}} needed · {{left}} pauses left', { answered, needed, left: pausesLeft })
                          : t('Pauses answered: {{answered}} of the {{needed}} needed', { answered, needed })}
                </p>
                {shownNudge && (
                  <p className={`text-sm font-medium ${shownNudge === 'heard' ? greenText : amberText}`}>
                    {shownNudge === 'heard'
                      ? t('Heard you.')
                      : shownNudge === 'quiet'
                        ? t("We can't hear you. Answer out loud.")
                        : shownNudge === 'sound'
                          ? t('We hear sound, but not a voice. Answer out loud.')
                          : t('Missed that pause. Answer out loud in the next one.')}
                  </p>
                )}
                {cannotCount && !sessionDead && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className={`text-sm ${amberText}`}>{t("This lab can't count now. You can start over.")}</p>
                    <button onClick={confirmStartOver} className={secondary}>{t('Start over')}</button>
                  </div>
                )}
              </>
            )
          ) : !noMic && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('You have spoken for {{time}}.', { time: formatClock(voicedRef.current) })}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {examMode ? (
              sessionDead ? (
                // The server no longer takes this session, and a test cannot be started over: back to the tests.
                <button onClick={() => leavePage(exit)} className={primary}>{backLabel}</button>
              ) : (
                // A test pauses only by itself (a lost connection, the audio stopping): Resume, and nothing else.
                phase === 'paused' && (
                  <button onClick={resume} disabled={waiting} className={primary}>{t('Resume')}</button>
                )
              )
            ) : sessionDead ? (
              <button onClick={startOver} className={primary}>{t('Start over')}</button>
            ) : micLost ? (
              <>
                <button onClick={() => void reconnectMic()} disabled={enabling} className={primary}>
                  {t('Turn the microphone back on')}
                </button>
                <button onClick={continueWithoutMic} disabled={enabling} className={secondary}>
                  {t('Go on without the microphone')}
                </button>
              </>
            ) : phase === 'running' ? (
              <button onClick={() => pause()} className={secondary}>{t('Pause')}</button>
            ) : (
              <button onClick={resume} disabled={waiting} className={primary}>{t('Resume')}</button>
            )}
            {!examMode && (
              <button onClick={back} disabled={micLost} className={secondary}>
                {t('Back {{seconds}} s', { seconds: BACK_SECONDS })}
              </button>
            )}
            <button
              onClick={finish}
              disabled={!canFinish || sessionDead}
              className={secondary}
              title={canFinish ? undefined : t('Available once you reach the end of the last prompt')}
            >
              {t('Finish')}
            </button>
          </div>
        </div>
      )}

      {(phase === 'finished' || phase === 'submitting') && (
        <div className={`${card} space-y-4`}>
          {!examMode && spokeLines}
          {phase === 'submitting' && (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('Turning it in…')}</p>
          )}
          {phase === 'finished' && (
            <div className="flex flex-wrap gap-3">
              <button onClick={() => void submit()} className={primary}>{t('Try again')}</button>
              {!examMode && <button onClick={confirmStartOver} className={secondary}>{t('Start over')}</button>}
            </div>
          )}
        </div>
      )}

      {phase === 'done' && examMode && (
        <div className={`${card} space-y-4`}>
          <p role="status" className={`${greenText} font-medium`}>{t('Turned in. Your answers go on your paper.')}</p>
          <button onClick={() => leavePage(exit)} className={primary}>{backLabel}</button>
        </div>
      )}

      {phase === 'done' && !examMode && (
        <div className={`${card} space-y-4`}>
          {/* What the server decided, not what the page counted. */}
          <div role="status" className="space-y-3">
            {!result || result.credit ? (
              <>
                {result?.scored
                  ? stoppedAndScored ? stoppedLine('text-gray-700 dark:text-gray-300') : answeredLine('text-gray-700 dark:text-gray-300')
                  : spokeLines}
                <p className={`${greenText} font-medium`}>{t('Turned in. Your teacher will see that you finished it.')}</p>
              </>
            ) : result.mic === 'off' ? (
              <>
                {stoppedAndScored && stoppedLine(amberText)}
                {heldWithEnough ? (
                  // Enough answered before the microphone stopped, and held: nothing more to answer.
                  <p className={`${amberText} font-medium`}>
                    {stoppedAndScored ? t('Your teacher will check it.') : t('Turned in without a microphone. Your teacher will check it.')}
                  </p>
                ) : (
                  <>
                    {stoppedAndScored && (result.needed ?? 0) > 0 && (
                      <p className={amberText}>{t('It needs {{needed}} to count.', { needed: result.needed ?? 0 })}</p>
                    )}
                    <p className={`${amberText} font-medium`}>{t('Turned in without a microphone. Your teacher will check it.')}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t('If your microphone works again, you can do the lab again instead of waiting.')}
                    </p>
                  </>
                )}
              </>
            ) : result.scored ? (
              <>
                {answeredLine(`${amberText} font-medium`)}
                {waitsForTeacher ? (
                  <p className="text-gray-700 dark:text-gray-300">{t('Your teacher will check it.')}</p>
                ) : (
                  <>
                    <p className={amberText}>{t('It needs {{needed}} to count. Do it again.', { needed: result.needed ?? 0 })}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t('Did you answer out loud? Press “The mic didn\'t hear me” and your teacher will check it.')}
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                {spokeLines}
                {waitsForTeacher && <p className="text-gray-700 dark:text-gray-300">{t('Your teacher will check it.')}</p>}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {needsRedo && !waitsForTeacher ? (
              <>
                <button onClick={startOver} className={primary}>{t('Do it again')}</button>
                <button onClick={() => void sendToTeacher()} disabled={askTeacher.isPending} className={secondary}>
                  {t("The mic didn't hear me")}
                </button>
                <button onClick={() => leavePage(exit)} className={secondary}>{backLabel}</button>
              </>
            ) : (
              <>
                <button onClick={() => leavePage(exit)} className={primary}>{backLabel}</button>
                {(needsRedo || noMicRedo) && <button onClick={startOver} className={secondary}>{t('Do it again')}</button>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
