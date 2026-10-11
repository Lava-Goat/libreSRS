// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * One speaking task: the student records it (reciting this week's cuento, a
 * rung of the escalera oral), listens back, and turns it in. The teacher hears
 * it, and a grader may later score it against the task's text.
 *
 * Because it may be graded on pronunciation, the microphone is opened raw:
 * the browser's echo cancellation, noise suppression and automatic gain all
 * reshape vowels, so they are asked to stay off. What the browser really
 * applied goes with the upload, for the teacher.
 *
 * "You spoke for" is measured against the take's own room (shared
 * speechLevels.ts): a moment counts when it is 10 dB over the take's quiet
 * level. A very quiet take is only a nudge: Record it again comes first, and
 * Turn it in anyway is still there (by design).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_LEVEL_SAMPLE_MS,
  isLittleSpeech,
  levelFloorDb,
  pickMicSettings,
  speechGateDb,
  voicedMsFromLevels,
  type LevelSample,
} from '@libresrs/shared';
import { trpc } from '../../api/trpc';
import { UploadError, uploadRaw } from '../../api/rawUpload';
import { useI18n } from '../../i18n';
import { useLeaveGuard } from '../../hooks/useLeaveGuard';
import { formatClock } from '../../utils/labAudio';
import { pickRecordingMimeType, withWebmDuration } from '../../utils/recording';

type Phase = 'setup' | 'ready' | 'recording' | 'review' | 'uploading' | 'done';

/** Phases holding a recording that leaving the page would throw away. */
const BUSY: Phase[] = ['recording', 'review', 'uploading'];

/**
 * Readings kept from the microphone check (the last 10 s at one every 50 ms).
 * Their median stands in for the room while recording, so the live "You have
 * spoken for" is close to what Stop finds with the take's own quiet level.
 */
const MIC_CHECK_READINGS = 200;
/** The recorder stops itself here; the server's limit assumes it. */
const MAX_RECORDING_MS = 15 * 60 * 1000;
/** The server's limit for a recording (routers/audioUploads.ts RECORDING_BYTES). */
const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;
/** Plenty for speech; what a grader listening for vowels would want. */
const RECORDING_BITRATE = 128_000;
/**
 * A take under this share of the task's target length gets a warning (60%).
 * Only a warning: the target is promised as not enforced.
 */
const SHORT_TAKE_RATIO = 0.6;

/** As the teacher's review shows it: whole numbers plain, otherwise one decimal. */
const formatScore = (score: number) => (Number.isInteger(score) ? String(score) : score.toFixed(1));

interface Take {
  blob: Blob;
  url: string;
  durationMs: number;
  voicedMs: number;
  /** Sent with every attempt to upload this take, so a retry is not stored twice. */
  key: string;
  /** The microphone processing the browser reported, as the header's JSON; null when it said nothing. */
  micSettings: string | null;
}

interface Meter {
  context: AudioContext;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  timer: ReturnType<typeof setInterval>;
  lastAt: number;
}

function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function SpeakingRunner({ taskId, fromTests = false, onExit, onBusyChange }: {
  taskId: number;
  /** Opened from the Tests page (v1.21.0): its way back says Back to tests. */
  fromTests?: boolean;
  /** Leaving: `test` when the task is a speaking test, so it goes back to the Tests page. */
  onExit: (test: boolean) => void;
  /** Told when the page holds a recording that leaving would lose. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const mimeType = useMemo(pickRecordingMimeType, []);

  const [phase, setPhaseState] = useState<Phase>('setup');
  const phaseRef = useRef<Phase>('setup');
  const setPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhaseState(next); }, []);
  const busy = BUSY.includes(phase);

  // No background refreshes while a take is held: the task must not change under a recording.
  const { data: task, isLoading, error: loadError } = trpc.speaking.get.useQuery(
    { taskId },
    busy ? { refetchOnWindowFocus: false, refetchOnReconnect: false } : undefined,
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  /** The server refused this take at the attempt cap: no retry can succeed. */
  const [capReached, setCapReached] = useState(false);
  const [progress, setProgress] = useState(0);
  const [enabling, setEnabling] = useState(false);
  /** The student asked to record again although a take is turned in; until then the page shows that take. */
  const [wantsNew, setWantsNew] = useState(false);
  const [, setTick] = useState(0);

  const modelRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<Meter | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const levelRef = useRef(0);
  /** The live count of voice while recording, over the gate the mic check gave. */
  const voicedRef = useRef(0);
  /** Every reading of this take, each weighted by the time it stands for; Stop applies the rule to them. */
  const samplesRef = useRef<LevelSample[]>([]);
  /** The mic check's latest readings (dBFS). */
  const checkLevelsRef = useRef<number[]>([]);
  /** The level a reading must pass to count as voice now: the mic check's room plus the margin. */
  const gateRef = useRef(speechGateDb(null));
  /** The last reading was over the gate: the bar is green. */
  const voiceNowRef = useRef(false);
  const micSettingsRef = useRef<string | null>(null);
  /** performance.now() when recording started; null when not recording. */
  const startedAtRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const unmountedRef = useRef(false);

  const elapsed = () => (startedAtRef.current === null ? 0 : performance.now() - startedAtRef.current);

  // --- microphone -----------------------------------------------------------

  const stopMeter = useCallback(() => {
    const meter = meterRef.current;
    if (meter) {
      clearInterval(meter.timer);
      meter.context.close().catch(() => {});
      meterRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    levelRef.current = 0;
    voiceNowRef.current = false;
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const sampleMeter = useCallback(() => {
    const meter = meterRef.current;
    if (!meter) return;
    meter.analyser.getFloatTimeDomainData(meter.samples);
    let sum = 0;
    for (const v of meter.samples) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / meter.samples.length) || 1e-9);
    levelRef.current = Math.min(1, Math.max(0, (db + 60) / 50));
    const now = performance.now();
    // A reading stands for the time since the last one: a hidden tab is read
    // about once a second, and counting that as one 50 ms tick undercounted it.
    const ms = Math.min(MAX_LEVEL_SAMPLE_MS, Math.max(0, now - meter.lastAt));
    meter.lastAt = now;
    if (startedAtRef.current !== null) {
      samplesRef.current.push({ db, ms });
      if (db > gateRef.current) voicedRef.current += ms;
    } else {
      // The mic check: the room so far sets where the bar turns green.
      const check = checkLevelsRef.current;
      check.push(db);
      if (check.length > MIC_CHECK_READINGS) check.shift();
      gateRef.current = speechGateDb(levelFloorDb(check.map((level) => ({ db: level, ms: 1 })), 0.5));
    }
    voiceNowRef.current = db > gateRef.current;
  }, []);

  /** Stops the recorder; its 'stop' turns what it heard into a take. */
  const stopRecording = useCallback((reason: string | null = null) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setNotice(reason);
    recorder.stop();
  }, []);

  const openMic = useCallback(async (): Promise<boolean> => {
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setError(t('This browser cannot record audio. Use Chrome, or Safari on an iPhone or iPad.'));
      return false;
    }
    stopMeter();
    // Created inside the click: browsers start an AudioContext suspended otherwise.
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Context();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      if (unmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        context.close().catch(() => {});
        return false;
      }
      streamRef.current = stream;
      checkLevelsRef.current = [];
      gateRef.current = speechGateDb(null);
      let reported: unknown = null;
      try { reported = stream.getAudioTracks()[0]?.getSettings?.(); } catch { /* a browser that cannot say */ }
      const settings = pickMicSettings(reported);
      micSettingsRef.current = settings ? JSON.stringify(settings) : null;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (phaseRef.current === 'recording') {
          stopRecording(t('The microphone disconnected, so the recording stopped at {{time}}.', { time: formatClock(elapsed()) }));
        } else if (phaseRef.current === 'ready') {
          stopMeter();
          setError(t('The microphone disconnected. Reconnect it and turn it on again.'));
          setPhase('setup');
        }
      });

      // Not awaited: a context that never starts must not hang the page.
      context.resume().catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
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
      };
      return true;
    } catch {
      context.close().catch(() => {});
      setError(t('Could not use the microphone. Allow microphone access for this site (the icon in the address bar), then try again.'));
      return false;
    }
  }, [mimeType, sampleMeter, setPhase, stopMeter, stopRecording, t]);

  const enableMic = useCallback(async () => {
    if (enabling) return;
    setEnabling(true);
    setError(null);
    try {
      if (await openMic()) setPhase('ready');
    } finally {
      setEnabling(false);
    }
  }, [enabling, openMic, setPhase]);

  // --- recording ------------------------------------------------------------

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || phaseRef.current !== 'ready') return;
    setError(null);
    setNotice(null);
    modelRef.current?.pause();

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDING_BITRATE });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const durationMs = Math.round(elapsed());
      // The take's own rule, now that its quiet level is known; the live count only guessed it.
      const voicedMs = Math.round(Math.min(voicedMsFromLevels(samplesRef.current), durationMs));
      const micSettings = micSettingsRef.current;
      startedAtRef.current = null;
      recorderRef.current = null;
      stopMeter();
      releaseWakeLock();
      if (unmountedRef.current) return;
      if (chunks.length === 0) {
        setError(t('Nothing was recorded. Check your microphone and try again.'));
        setPhase('setup');
        return;
      }
      void withWebmDuration(new Blob(chunks, { type: recorder.mimeType || mimeType }), durationMs).then((blob) => {
        if (unmountedRef.current) return;
        setTake({ blob, url: URL.createObjectURL(blob), durationMs, voicedMs, key: newSubmissionKey(), micSettings });
        setPhase('review');
      });
    };
    recorder.onerror = () => stopRecording(t('The recording stopped unexpectedly at {{time}}.', { time: formatClock(elapsed()) }));

    voicedRef.current = 0;
    samplesRef.current = [];
    // Until Stop, the room is the mic check's: its median, so a "hola" in it does not count as room.
    gateRef.current = speechGateDb(levelFloorDb(checkLevelsRef.current.map((level) => ({ db: level, ms: 1 })), 0.5));
    recorderRef.current = recorder;
    recorder.start(1000);
    startedAtRef.current = performance.now();
    setPhase('recording');
    void navigator.wakeLock?.request('screen').then((lock) => { wakeLockRef.current = lock; }).catch(() => {});
  }, [mimeType, releaseWakeLock, setPhase, stopMeter, stopRecording, t]);

  /** Throws the take away and goes back to the microphone check. */
  const recordAgain = useCallback(async () => {
    if (phaseRef.current === 'review' && !window.confirm(t('Throw this recording away and record again?'))) return;
    setWantsNew(true);
    setTake(null);
    setCapReached(false);
    setError(null);
    setNotice(null);
    setPhase('setup');
    await enableMic();
  }, [enableMic, setPhase, t]);

  const submit = useCallback(async () => {
    if (!take || phaseRef.current !== 'review') return;
    if (take.blob.size > MAX_UPLOAD_BYTES) {
      setError(t('This recording is too large to upload ({{mb}} MB). Ask your teacher.', { mb: Math.ceil(take.blob.size / (1024 * 1024)) }));
      return;
    }
    setError(null);
    setProgress(0);
    setPhase('uploading');
    try {
      await uploadRaw(`/api/speaking/${taskId}/submission`, take.blob, {
        'x-submission-key': take.key,
        'x-recording-duration-ms': String(take.durationMs),
        'x-recording-voiced-ms': String(take.voicedMs),
        ...(take.micSettings ? { 'x-mic-settings': take.micSettings } : {}),
      }, setProgress);
      if (unmountedRef.current) return;
      setPhase('done');
      void utils.speaking.get.invalidate({ taskId });
      void utils.speaking.list.invalidate();
    } catch (err) {
      // Keep the take: a failed upload must never cost the student the recording.
      if (unmountedRef.current) return;
      // It may have landed with only the reply lost, and a refusal means the count moved: reload the task.
      const reloaded = utils.speaking.get.invalidate({ taskId });
      if (err instanceof UploadError && err.status === 429) {
        // 429 is also the rate limiter's answer, and the whole school shares
        // one address: only the task's own count says the limit was reached.
        await reloaded.catch(() => {});
        if (unmountedRef.current) return;
        const latest = utils.speaking.get.getData({ taskId });
        if (latest && latest.attempts >= latest.maxAttempts) {
          setCapReached(true);
          setError(t('You have reached the limit of recordings for this task. Ask your teacher.'));
        } else {
          setError(t('Too many uploads at once right now. Wait a minute, then press Try again.'));
        }
      } else {
        setError(err instanceof Error ? err.message : t('Upload failed — try again.'));
      }
      setPhase('review');
    }
  }, [take, taskId, setPhase, t, utils]);

  // --- page-level guards ----------------------------------------------------

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const { leave: leavePage } = useLeaveGuard(busy, t('Leave this page? Your recording has not been turned in and will be lost.'));

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'recording') return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      if (phaseRef.current === 'recording' && elapsed() >= MAX_RECORDING_MS) {
        stopRecording(t('Recordings stop at {{time}}.', { time: formatClock(MAX_RECORDING_MS) }));
      }
    }, 200);
    return () => clearInterval(timer);
  }, [phase, stopRecording, t]);

  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);

  useEffect(() => {
    // Set here, not only in the initializer: React's development mode mounts,
    // unmounts and remounts every component once.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      stopMeter();
      releaseWakeLock();
    };
  }, [releaseWakeLock, stopMeter]);

  // A speaking test (v1.21.0) goes back to the Tests page, where it is listed.
  const testKnown = !!task?.examSet;
  const exit = useCallback(() => onExit(testKnown), [onExit, testKnown]);
  const backLabel = fromTests || testKnown ? t('Back to tests') : t('Back to speaking');

  const leave = useCallback(() => {
    // The page's own exit skips the guard's Back prompt, so an unsent take is asked about here.
    if (phaseRef.current === 'review'
      && !window.confirm(t('Leave this page? Your recording has not been turned in and will be lost.'))) return;
    leavePage(exit);
  }, [exit, leavePage, t]);

  // --- render ---------------------------------------------------------------

  const card = 'bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6';
  const primary = 'px-5 py-2.5 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
  const secondary = 'px-4 py-2 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';

  if (isLoading) return <div className="animate-pulse text-gray-500 dark:text-gray-400">{t('Loading...')}</div>;
  // Only when there is no task to show: a failed background refresh keeps the page (and any take) as it is.
  if (!task) {
    return (
      <div className={card}>
        <p className="text-red-700 dark:text-red-400">{loadError?.message ?? t('This task could not be opened.')}</p>
        <button onClick={leave} className={`${secondary} mt-4`}>{backLabel}</button>
      </div>
    );
  }

  const atCap = task.attempts >= task.maxAttempts && phase !== 'done';
  const level = levelRef.current;
  const speaking = voiceNowRef.current;
  const recordingMs = elapsed();
  const targetMs = task.targetSeconds ? task.targetSeconds * 1000 : null;
  const shortTake = !!take && targetMs !== null && take.durationMs < SHORT_TAKE_RATIO * targetMs;
  const quietTake = !!take && isLittleSpeech(take.voicedMs, take.durationMs);
  // What is turned in comes first, until the student asks to record again.
  const latest = task.mySubmissions[0];
  const showTurnedIn = phase === 'setup' && !wantsNew && !!latest;
  // `=== true`: a page cached before v1.16.0 has no such field.
  const latestQuiet = !!latest && latest.littleSpeech === true && latest.score == null;

  /** From the turned-in take to the microphone check; a graded take asks first, since a new one replaces it. */
  const recordNew = () => {
    if (latest && latest.score != null && !window.confirm(t(
      'Your teacher already graded this recording ({{score}} out of 100). A new recording replaces it and will need a new grade. Record again?',
      { score: formatScore(latest.score) },
    ))) return;
    setError(null);
    setNotice(null);
    setWantsNew(true);
  };

  const levelMeter = (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-20">{t('Microphone')}</span>
      <div className="flex-1 h-3 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full transition-[width] duration-100 ${speaking ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'}`}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {task.examSet && (
            <span className="inline-block mb-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {t('Test · {{set}}', { set: task.examSet })}
            </span>
          )}
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 break-words">{task.title}</h2>
          {task.targetSeconds && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('Aim for about {{time}}.', { time: formatClock(task.targetSeconds * 1000) })}</p>
          )}
        </div>
        {!['recording', 'uploading'].includes(phase) && (
          <button onClick={leave} className={secondary}>{backLabel}</button>
        )}
      </div>

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

      {showTurnedIn && latest && (
        <div className={`${card} space-y-4`}>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {t('You turned this in on {{date}}.', { date: formatDate(latest.submittedAt) })}
          </p>
          {latest.score != null ? (
            <p className="text-gray-800 dark:text-gray-200">
              {t('Your teacher graded it: {{score}} out of 100.', { score: formatScore(latest.score) })}
            </p>
          ) : latestQuiet ? (
            <p className="text-amber-800 dark:text-amber-300">{t('We could hardly hear you. Record it again, closer to the microphone.')}</p>
          ) : (
            <p className="text-green-700 dark:text-green-400">{t('Turned in. Your teacher can listen to it now.')}</p>
          )}
          {atCap ? (
            <p className="text-gray-800 dark:text-gray-200">
              {t('You have already turned this in {{count}} times. Ask your teacher before recording it again.', { count: task.attempts })}
            </p>
          ) : (
            <button onClick={recordNew} className={latestQuiet ? primary : secondary}>{t('Record it again')}</button>
          )}
        </div>
      )}

      {(task.instructions || task.modelAudioUrl || task.recitesFromMemory) && phase !== 'recording' && (
        <div className={`${card} space-y-4`}>
          {task.instructions && <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{task.instructions}</p>}
          {task.modelAudioUrl && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Listen to the model first')}</p>
              <audio ref={modelRef} controls preload="metadata" src={task.modelAudioUrl} className="w-full" />
            </div>
          )}
          {task.recitesFromMemory && (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('Recite this from memory: the text is not shown here.')}</p>
          )}
        </div>
      )}

      {task.referenceText && (
        <div className={card}>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('Read this aloud')}</h3>
          <p className="text-lg leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{task.referenceText}</p>
        </div>
      )}

      {showTurnedIn ? null : atCap ? (
        <div className={card}>
          <p className="text-gray-800 dark:text-gray-200">
            {t('You have already turned this in {{count}} times. Ask your teacher before recording it again.', { count: task.attempts })}
          </p>
        </div>
      ) : (phase === 'setup' || phase === 'ready') && (
        <div className={`${card} space-y-5`}>
          <ol className="list-decimal pl-5 space-y-2 text-gray-800 dark:text-gray-200">
            <li>{t('Find a quiet place. Your teacher will listen to how you pronounce, so background noise gets in the way.')}</li>
            <li>{t('Speak clearly at a normal pace. You can listen back before you turn it in.')}</li>
          </ol>
          {phase === 'setup' ? (
            <button onClick={() => void enableMic()} disabled={enabling} className={primary}>{t('Turn on the microphone')}</button>
          ) : (
            <div className="space-y-4">
              {levelMeter}
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('Say “hola” — the bar should move and turn green. If it does not, check your microphone before you start.')}
              </p>
              <button onClick={startRecording} className={primary}>{t('Start recording')}</button>
            </div>
          )}
        </div>
      )}

      {phase === 'recording' && (
        <div className={`${card} space-y-5`}>
          <span className="inline-flex items-center gap-2 font-medium text-red-600 dark:text-red-400">
            <span className="w-3 h-3 rounded-full bg-red-600 animate-pulse" />
            {t('Recording')} · <span className="tabular-nums">
              {formatClock(recordingMs)}{targetMs !== null && ` / ${formatClock(targetMs)}`}
            </span>
          </span>
          {levelMeter}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('You have spoken for {{time}}.', { time: formatClock(voicedRef.current) })}
          </p>
          <button onClick={() => stopRecording()} className={primary}>{t('Stop')}</button>
        </div>
      )}

      {(phase === 'review' || phase === 'uploading') && take && (
        <div className={`${card} space-y-4`}>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('Your recording')}</h3>
          <p className="text-gray-700 dark:text-gray-300">
            {t('Length {{length}} · you spoke for about {{voiced}}', { length: formatClock(take.durationMs), voiced: formatClock(take.voicedMs) })}
          </p>
          {quietTake && (
            <p className="text-amber-800 dark:text-amber-300 text-sm">
              {t('We could hardly hear you. Listen back, and record it again closer to the microphone if your voice is hard to hear.')}
            </p>
          )}
          {/* No role: a hint to check, not an error, and the page's alerts stay the upload's. */}
          {shortTake && targetMs !== null && (
            <p className="text-amber-800 dark:text-amber-300 text-sm">
              {t('This is much shorter than the {{target}} goal. Check that you did all of it.', { target: formatClock(targetMs) })}
            </p>
          )}
          <audio controls src={take.url} className="w-full" />
          {phase === 'uploading' ? (
            <div className="space-y-2">
              <div className="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full bg-blue-600" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('Uploading… {{percent}}%', { percent: Math.round(progress * 100) })}</p>
            </div>
          ) : !capReached && (
            // A quiet take puts recording again first; once an upload has failed, trying it again comes first.
            quietTake && !error ? (
              <div className="flex flex-wrap gap-3">
                {!atCap && <button onClick={() => void recordAgain()} className={primary}>{t('Record it again')}</button>}
                <button onClick={() => void submit()} className={atCap ? primary : secondary}>{t('Turn it in anyway')}</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button onClick={() => void submit()} className={primary}>{error ? t('Try again') : t('Turn it in')}</button>
                {/* At the limit a new take could never be turned in; this one may still be (a retry of a lost reply). */}
                {!atCap && <button onClick={() => void recordAgain()} className={secondary}>{t('Record again')}</button>}
              </div>
            )
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className={`${card} space-y-4`}>
          <p className="text-green-700 dark:text-green-400 font-medium">{t('Turned in. Your teacher can listen to it now.')}</p>
          <button onClick={leave} className={primary}>{backLabel}</button>
        </div>
      )}

      {task.mySubmissions.length > 0 && phase !== 'recording' && (
        <div className={`${card} space-y-3`}>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t('What you have turned in')}</h3>
          <ul className="space-y-3">
            {task.mySubmissions.map((s, index) => (
              <li key={s.id} className="space-y-1">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {formatDate(s.submittedAt)} · {formatClock(s.durationMs)}
                </p>
                <audio controls preload="none" src={s.audioUrl} className="w-full" />
                {/* The server sends a grade only when the teacher gave it. `!= null`: a page cached before grades has none. */}
                {s.score != null ? (
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t('Grade')}: <span className="tabular-nums">{t('{{score}} out of 100', { score: formatScore(s.score) })}</span>
                  </p>
                ) : index === 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('Not graded yet.')}</p>
                )}
                {s.score != null && s.feedback && (
                  <div className="text-sm">
                    <p className="font-medium text-gray-700 dark:text-gray-300">{t("Your teacher's comment")}</p>
                    <p className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{s.feedback}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
