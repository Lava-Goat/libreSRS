// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Elicited imitation: the student hears a Spanish sentence (a generated clip in
// the Vocabulómetro voice, so every device hears the same stimulus; browser
// speech synthesis only when no clip exists), records a repetition
// (MediaRecorder), and the server transcribes and scores it. The score is
// authoritative from the server; the client only captures audio and accumulates.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '../api/trpc';
import { pct } from './logic';
import './vocab.css';
import { pickRecordingMimeType } from '../utils/recording';
import { playAudio, preloadAudio, stopAudio, subscribe } from '../utils/audioPlayer';

interface EiSentence { id: number; text: string; difficulty: number }

interface EiEntry { sentenceId: number; transcript: string; score: number }

function getSpanishVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang?.toLowerCase().startsWith('es')) ?? null;
}

/** How long the browser voice may take before it is given up on: generous for
 *  the sentence's length (speech runs well under 120 ms a character). */
export function speechSafetyMs(text: string): number {
  return Math.max(8_000, text.length * 120);
}

/** The utterance speakSentence is waiting on, so a stale safety timer never cancels a newer one. */
let currentSpeech: object | null = null;

/**
 * Speak through the browser voice. It now runs after an await (a failed clip),
 * outside the click: a browser that drops such a speak() may fire no event at
 * all (iOS Safari), so a safety timeout cancels it and resolves, and the
 * runner's phase never sticks on "playing".
 */
function speakSentence(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = getSpanishVoice();
    if (voice) u.voice = voice;
    u.lang = 'es-ES';
    u.rate = 0.95;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (currentSpeech === u) currentSpeech = null;
      resolve();
    };
    const timer = setTimeout(() => {
      if (currentSpeech === u) synth.cancel();
      finish();
    }, speechSafetyMs(text));
    currentSpeech = u;
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

/** A sentence clip that has not finished this long after the press is given
 *  up on: the player hears no 'pause' (media key, headset unplugged), and the
 *  runner's phase must never stick on "playing". Sentences run well under 20s. */
const CLIP_SAFETY_MS = 30_000;

/**
 * Play a clip through the app's single player. Resolves 'failed' when playback
 * never started (a 404, a network error, a codec the device cannot decode) so
 * the caller can fall back to the browser voice instead of letting the student
 * record a repetition of a sentence they never heard; 'played' when it ends,
 * is superseded, or hits the safety timeout.
 */
function playClip(url: string): Promise<'played' | 'failed'> {
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handle = playAudio(url);
    const finish = (outcome: 'played' | 'failed') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(outcome);
    };
    timer = setTimeout(() => { handle.stop(); finish('played'); }, CLIP_SAFETY_MS);
    // Before playback starts, a cleared url is the load failing, not the end.
    unsubscribe = subscribe((state) => { if (state.url !== url) finish(started ? 'played' : 'failed'); });
    void handle.started.then((ok) => { started = ok; if (!ok) finish('failed'); });
  });
}

/**
 * The just-in-time notice shown before every recording (an operator's privacy pages may quote it
 * word for word): in English, whatever the runner's Spanish around it.
 */
export const EI_RECORDING_NOTICE = 'Your recording is sent to OpenAI to turn it into text so it can be scored. The recording is not saved; the text and score are.';

/** The server's answers that mean "no transcription on this site now" (its switch, or AI as a whole). */
const TRANSCRIPTION_OFF_CODES: ReadonlySet<string> = new Set(['VOCAB_EI_TRANSCRIPTION_OFF', 'VOCAB_EI_AI_DISABLED']);

/** ~9MB base64 ceiling — under the server's 8MB input and 10mb body limits. */
const MAX_BASE64_LEN = 8_000_000;
/** Auto-stop a recording that runs too long (a single sentence needs seconds). */
const MAX_RECORD_MS = 20_000;

export default function VocabEiRunner({ testId, occasion, onExit }: {
  testId: number;
  occasion?: string | null;
  onExit: () => void;
}) {
  const { data, isLoading, isError } = trpc.vocab.getTestEiSentences.useQuery({ testId });
  const sentences = useMemo<EiSentence[]>(() => data?.sentences ?? [], [data]);
  // A failed clip lookup is not fatal: every sentence then uses the browser voice.
  const audioQuery = trpc.vocab.getTestEiAudio.useQuery({ testId }, { retry: 1 });
  const clipUrls = useMemo<Record<number, string>>(() => audioQuery.data?.urls ?? {}, [audioQuery.data]);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'recording' | 'scoring' | 'result' | 'done'>('idle');
  const [entries, setEntries] = useState<EiEntry[]>([]);
  const [lastScore, setLastScore] = useState<{ score: number; transcript: string } | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  // The server refused a recording because transcription (or AI as a whole) was switched off
  // after the test opened: the runner then says so, as it does when the switch is off at start.
  const [transcriptionOff, setTranscriptionOff] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noVoice, setNoVoice] = useState(false);
  // Sentences whose clip would not play here; they use the browser voice.
  const [failedClips, setFailedClips] = useState<ReadonlySet<number>>(() => new Set());
  const mountedRef = useRef(true);
  const startedAtRef = useRef(new Date().toISOString());
  const mimeType = useMemo(pickRecordingMimeType, []);

  const transcribeMutation = trpc.vocab.transcribeEiRecording.useMutation();
  const submitMutation = trpc.vocab.submitResult.useMutation();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { setNoVoice(true); return; }
    const check = () => setNoVoice(getSpanishVoice() == null);
    check();
    window.speechSynthesis.onvoiceschanged = check;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => () => {
    // cleanup mic and playback on unmount
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    stopAudio();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  // Warm the current and next clips so the first press plays at once.
  useEffect(() => {
    const upcoming = [sentences[idx], sentences[idx + 1]].map((sen) => (sen ? clipUrls[sen.id] : undefined));
    preloadAudio(upcoming.filter((u): u is string => Boolean(u)));
  }, [sentences, idx, clipUrls]);

  const finishAndSubmit = useCallback((all: EiEntry[]) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setPhase('done');
    const sum = all.reduce((a, e) => a + e.score, 0);
    submitMutation.mutate({
      testId,
      seed: 0,
      summary: { v: 1, ei: { n: all.length, sum } },
      responses: all as unknown as Record<string, unknown>[],
      startedAt: startedAtRef.current,
      durationMs: Date.now() - new Date(startedAtRef.current).getTime(),
    });
  }, [submitMutation, testId]);

  const playCurrent = useCallback(async () => {
    setPhase('playing');
    const { id, text } = sentences[idx];
    const url = clipUrls[id];
    // Browser voice only when this sentence has no playable clip in the current
    // voice — never silence, or the student would repeat something unheard.
    const outcome = url ? await playClip(url) : 'failed';
    if (!mountedRef.current) return; // left the test while the clip loaded
    if (outcome === 'failed') {
      if (url) setFailedClips((prev) => new Set(prev).add(id));
      await speakSentence(text);
      if (!mountedRef.current) return;
    }
    setPhase('idle');
  }, [sentences, idx, clipUrls]);

  const startRecording = useCallback(async () => {
    // Re-entrancy guard: only start from idle, and only when no stream is live.
    if (phase !== 'idle' || streamRef.current) return;
    setMicError(null);
    if (!mimeType) { setMicError('Tu navegador no permite grabar audio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // If we were torn down or superseded while awaiting permission, bail.
      if (streamRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setPhase('scoring');
        try {
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const base64 = btoa(bin);
          if (base64.length > MAX_BASE64_LEN) {
            setMicError('La grabación es demasiado larga. Repite la frase de forma más breve.');
            setPhase('idle');
            return;
          }
          const res = await transcribeMutation.mutateAsync({
            testId, sentenceId: sentences[idx].id, audioBase64: base64, mimeType,
          });
          setLastScore({ score: res.score, transcript: res.transcript });
          setEntries((prev) => [...prev, { sentenceId: sentences[idx].id, transcript: res.transcript, score: res.score }]);
          setPhase('result');
        } catch (err) {
          const appCode = (err as { data?: { appCode?: string } | null } | null)?.data?.appCode;
          if (appCode && TRANSCRIPTION_OFF_CODES.has(appCode)) {
            setTranscriptionOff(true);
          } else {
            setMicError(err instanceof Error ? err.message : 'No se pudo transcribir. Inténtalo de nuevo.');
          }
          setPhase('idle');
        }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setPhase('recording');
      stopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      }, MAX_RECORD_MS);
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMicError('No se pudo acceder al micrófono. Concede el permiso e inténtalo de nuevo.');
      setPhase('idle');
    }
  }, [phase, mimeType, transcribeMutation, testId, sentences, idx]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  }, []);

  const next = useCallback(() => {
    setLastScore(null);
    if (idx + 1 >= sentences.length) {
      finishAndSubmit(entries);
    } else {
      setIdx(idx + 1);
      setPhase('idle');
    }
  }, [idx, sentences.length, entries, finishAndSubmit]);

  if (isLoading || audioQuery.isLoading) {
    return <div className="vm-root"><div className="stimulus"><p className="prompt">Cargando frases…</p></div></div>;
  }
  if ((data && data.transcriptionEnabled === false) || transcriptionOff) {
    return (
      <div className="vm-root">
        <div className="stimulus">
          <p className="prompt">La transcripción de voz está desactivada en este sitio, así que esta prueba no se puede hacer ahora. Avisa a tu profesor.</p>
          <div className="answers"><button className="ans" onClick={onExit}>Volver</button></div>
        </div>
      </div>
    );
  }
  if (isError || sentences.length === 0) {
    return (
      <div className="vm-root">
        <div className="stimulus">
          <p className="prompt">Esta prueba no tiene frases configuradas. Avisa a tu profesor.</p>
          <div className="answers"><button className="ans" onClick={onExit}>Volver</button></div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const mean = entries.length ? entries.reduce((a, e) => a + e.score, 0) / entries.length : 0;
    return (
      <div className="vm-root">
        <span className="eyebrow">Resultados{occasion ? ` · ${occasion}` : ''}</span>
        <div className="res-head">
          <div className="stat"><div className="n">{pct(mean, 0)}</div><div className="l">precisión media de repetición</div></div>
          <div className="stat"><div className="n">{entries.length}</div><div className="l">frases</div></div>
        </div>
        <p className="note">
          <strong>Medida experimental (cribado, no calificación).</strong> La imitación provocada es un correlato fuerte
          de la competencia oral, pero esta puntuación automática depende de la transcripción por IA (que puede
          «corregir» errores) y del audio del dispositivo; se puntúa por coincidencia de palabras en orden con la frase
          objetivo. Úsala como indicador orientativo, no como nota, y no entra en el índice compuesto.
        </p>
        <div className="mt-6 flex items-center gap-3">
          {submitMutation.isPending && <span className="text-sm text-gray-500 dark:text-gray-400">Guardando…</span>}
          {submitMutation.isSuccess && <span className="text-sm text-green-700 dark:text-green-400">Resultado guardado ✓</span>}
          {submitMutation.isError && (
            <span className="text-sm text-red-600 dark:text-red-400">
              No se pudo guardar: {submitMutation.error.message}{' '}
              <button className="underline" onClick={() => { submittedRef.current = false; finishAndSubmit(entries); }}>Reintentar</button>
            </span>
          )}
          <button onClick={onExit} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Volver</button>
        </div>
      </div>
    );
  }

  const sentence = sentences[idx];
  return (
    <div className="vm-root">
      <div className="hud">
        <span>Imitación provocada</span>
        <span className="rail"><i style={{ width: `${(100 * idx) / sentences.length}%` }} /></span>
        <span>{idx + 1} / {sentences.length}</span>
      </div>
      <div className="stimulus">
        <p className="prompt">Escucha la frase y repítela en voz alta. No se muestra el texto: escucha con atención.</p>
        {noVoice && (!clipUrls[sentence.id] || failedClips.has(sentence.id)) && <div className="flag" style={{ marginTop: 6 }}>Tu dispositivo no tiene una voz en español instalada, así que la frase podría no reproducirse. Prueba con otro navegador (Chrome/Edge) o dispositivo.</div>}
        <button className="play" disabled={phase !== 'idle'} onClick={playCurrent}>
          ▶ {phase === 'playing' ? 'Reproduciendo…' : 'Escuchar frase'}
        </button>

        {phase === 'result' && lastScore ? (
          <div style={{ marginTop: 8 }}>
            <p className="prompt">Puntuación: <strong>{pct(lastScore.score, 0)}</strong></p>
            <p className="note" style={{ marginTop: 4 }}>Objetivo: «{sentence.text}»<br />Transcrito: «{lastScore.transcript || '—'}»</p>
          </div>
        ) : null}

        {micError && <div className="flag" style={{ marginTop: 8 }}>{micError}</div>}

        <p className="note" lang="en" style={{ marginTop: 12 }} data-testid="ei-recording-notice">
          {EI_RECORDING_NOTICE}{' '}
          <a href="/privacy#ai" target="_blank" rel="noopener noreferrer" className="underline">
            How we handle it (opens in a new tab)
          </a>
        </p>

        <div className="answers" style={{ marginTop: 12 }}>
          {phase === 'recording' ? (
            <button className="ans yes" onClick={stopRecording}>■ Detener grabación</button>
          ) : phase === 'scoring' ? (
            <button className="ans" disabled>Transcribiendo…</button>
          ) : phase === 'result' ? (
            <button className="ans yes" onClick={next}>{idx + 1 >= sentences.length ? 'Terminar' : 'Siguiente'}</button>
          ) : (
            <button className="ans yes" onClick={startRecording} disabled={phase === 'playing'}>● Grabar mi repetición</button>
          )}
          <button className="ans" onClick={onExit}>Salir</button>
        </div>
      </div>
    </div>
  );
}
