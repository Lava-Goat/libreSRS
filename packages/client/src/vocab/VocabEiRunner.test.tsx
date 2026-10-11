// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Elicited imitation plays the Vocabulómetro-voice clip through the app's one
// audio player, and uses the device's speech synthesis only when a sentence
// has no clip in the current voice.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabEiRunner, { EI_RECORDING_NOTICE, speechSafetyMs } from './VocabEiRunner';

const SENTENCES = [
  { id: 11, text: 'Mi hermano vive en la ciudad.', difficulty: 2 },
  { id: 12, text: 'Ayer fuimos al mercado.', difficulty: 3 },
];
let clipUrls: Record<number, string> = {};
let transcriptionEnabled: boolean | undefined = true;
const transcribe = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('../api/trpc', () => ({
  trpc: {
    vocab: {
      getTestEiSentences: { useQuery: () => ({ data: { sentences: SENTENCES, transcriptionEnabled }, isLoading: false, isError: false }) },
      getTestEiAudio: { useQuery: () => ({ data: { urls: clipUrls }, isLoading: false }) },
      transcribeEiRecording: { useMutation: () => ({ mutateAsync: transcribe.mutateAsync, isPending: false }) },
      submitResult: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null }),
      },
    },
  },
}));

type Listener = (state: { url: string | null; playing: boolean }) => void;
const player = vi.hoisted(() => ({
  listeners: new Set<(state: { url: string | null; playing: boolean }) => void>(),
  playAudio: vi.fn(),
  stopAudio: vi.fn(),
  preloadAudio: vi.fn(),
}));
vi.mock('../utils/audioPlayer', () => ({
  playAudio: player.playAudio,
  stopAudio: player.stopAudio,
  preloadAudio: player.preloadAudio,
  subscribe: (listener: Listener) => {
    player.listeners.add(listener);
    return () => { player.listeners.delete(listener); };
  },
}));

const speak = vi.fn((u: { onend?: () => void }) => { u.onend?.(); });

beforeEach(() => {
  clipUrls = {};
  transcriptionEnabled = true;
  player.listeners.clear();
  player.playAudio.mockReset().mockImplementation(() => ({ started: Promise.resolve(true), stop: vi.fn() }));
  player.stopAudio.mockReset();
  player.preloadAudio.mockReset();
  speak.mockClear();
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; onend?: () => void; constructor(t: string) { this.text = t; } });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak, cancel: vi.fn(), getVoices: () => [{ lang: 'es-ES' }], onvoiceschanged: null },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VocabEiRunner audio', () => {
  it('plays the sentence clip through the app audio player, not the browser voice', async () => {
    clipUrls = { 11: '/api/assets/s11.opus', 12: '/api/assets/s12.opus' };
    render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
    expect(player.preloadAudio).toHaveBeenCalledWith(['/api/assets/s11.opus', '/api/assets/s12.opus']);

    fireEvent.click(screen.getByRole('button', { name: /Escuchar frase/ }));
    expect(player.playAudio).toHaveBeenCalledWith('/api/assets/s11.opus');
    expect(speak).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Reproduciendo/ })).toBeDisabled();

    // The clip ends: the player clears its url, and the student may replay.
    await act(async () => { player.listeners.forEach((l) => l({ url: null, playing: false })); });
    const replay = screen.getByRole('button', { name: /Escuchar frase/ });
    expect(replay).toBeEnabled();
    fireEvent.click(replay);
    expect(player.playAudio).toHaveBeenCalledTimes(2);
  });

  it('falls back to the browser voice only for a sentence without a clip', async () => {
    clipUrls = { 12: '/api/assets/s12.opus' }; // sentence 11 has no clip in this voice
    render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Escuchar frase/ })); });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(player.playAudio).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Escuchar frase/ })).toBeEnabled();
  });

  it('falls back to the browser voice when a clip fails to load, so the student never repeats an unheard sentence', async () => {
    clipUrls = { 11: '/api/assets/missing.opus' };
    // A 404 or undecodable file: play() rejects and the player clears its url.
    player.playAudio.mockImplementation(() => {
      const started = Promise.resolve(false).then((ok) => {
        player.listeners.forEach((l) => l({ url: null, playing: false }));
        return ok;
      });
      return { started, stop: vi.fn() };
    });
    render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Escuchar frase/ })); });
    expect(player.playAudio).toHaveBeenCalledWith('/api/assets/missing.opus');
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0][0] as unknown as { text: string }).text).toBe('Mi hermano vive en la ciudad.');
    expect(screen.getByRole('button', { name: /Escuchar frase/ })).toBeEnabled();
  });

  it('gives up on a clip that never ends (paused from outside), instead of sticking on "playing"', async () => {
    vi.useFakeTimers();
    try {
      clipUrls = { 11: '/api/assets/s11.opus' };
      const stop = vi.fn();
      player.playAudio.mockImplementation(() => ({ started: Promise.resolve(true), stop }));
      render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Escuchar frase/ })); });
      expect(screen.getByRole('button', { name: /Reproduciendo/ })).toBeDisabled();
      // No 'ended' or 'error' ever arrives (a media key paused the element).
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(stop).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Escuchar frase/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: /Grabar mi repetición/ })).toBeEnabled();
      // It did start, so this is not a load failure: no browser voice on top.
      expect(speak).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a browser voice that never speaks (dropped after the failed clip), instead of sticking on "playing"', async () => {
    vi.useFakeTimers();
    try {
      clipUrls = { 11: '/api/assets/missing.opus' };
      player.playAudio.mockImplementation(() => ({ started: Promise.resolve(false), stop: vi.fn() }));
      // iOS Safari drops a speak() made outside the click: no 'end', no 'error', ever.
      speak.mockImplementationOnce(() => {});
      const cancel = vi.fn();
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { speak, cancel, getVoices: () => [{ lang: 'es-ES' }], onvoiceschanged: null },
      });
      render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Escuchar frase/ })); });
      expect(speak).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /Reproduciendo/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Grabar mi repetición/ })).toBeDisabled();
      const cancelsBefore = cancel.mock.calls.length;

      // Not before the sentence could have been spoken (29 chars: the 8 s floor).
      await act(async () => { await vi.advanceTimersByTimeAsync(7_900); });
      expect(screen.getByRole('button', { name: /Reproduciendo/ })).toBeDisabled();

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);
      expect(screen.getByRole('button', { name: /Escuchar frase/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: /Grabar mi repetición/ })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a long sentence more time than the floor', () => {
    expect(speechSafetyMs('corta')).toBe(8_000);
    expect(speechSafetyMs('x'.repeat(100))).toBe(12_000);
  });

  it('does not warn about a missing device voice when the sentence has a clip', () => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel: vi.fn(), getVoices: () => [], onvoiceschanged: null },
    });
    clipUrls = { 11: '/api/assets/s11.opus' };
    const { unmount } = render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
    expect(screen.queryByText(/no tiene una voz en español/)).toBeNull();
    unmount();
    expect(player.stopAudio).toHaveBeenCalled();

    clipUrls = {};
    render(<VocabEiRunner testId={5} onExit={vi.fn()} />);
    expect(screen.getByText(/no tiene una voz en español/)).toBeTruthy();
  });
});

describe('VocabEiRunner: the notice before recording', () => {
  it('says, in English and before any recording, where the audio goes and what is kept, word for word', () => {
    render(<VocabEiRunner testId={1} onExit={() => {}} />);
    const notice = screen.getByTestId('ei-recording-notice');
    expect(notice).toHaveAttribute('lang', 'en');
    expect(notice.textContent).toContain('Your recording is sent to OpenAI to turn it into text so it can be scored. The recording is not saved; the text and score are.');
    expect(EI_RECORDING_NOTICE).toBe('Your recording is sent to OpenAI to turn it into text so it can be scored. The recording is not saved; the text and score are.');
    expect(screen.getByRole('link', { name: /How we handle it/ })).toHaveAttribute('href', '/privacy#ai');
    // It sits above the record button, which has not been pressed.
    const record = screen.getByRole('button', { name: /Grabar mi repetición/ });
    expect(notice.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers no recording while the transcription switch is off', () => {
    transcriptionEnabled = false;
    render(<VocabEiRunner testId={1} onExit={() => {}} />);
    expect(screen.getByText(/La transcripción de voz está desactivada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grabar/ })).toBeNull();
  });

  // The switch (or AI as a whole) goes off while the test is open: the server's English refusal
  // is not shown; the runner says what it says when the switch is off at the start.
  for (const appCode of ['VOCAB_EI_TRANSCRIPTION_OFF', 'VOCAB_EI_AI_DISABLED']) {
    it(`says transcription is off when a recording is refused with ${appCode}`, async () => {
      const stop = vi.fn();
      class FakeRecorder {
        static isTypeSupported = () => true;
        state = 'inactive';
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob() }); void this.onstop?.(); }
      }
      vi.stubGlobal('MediaRecorder', FakeRecorder);
      // jsdom's Blob has no arrayBuffer().
      vi.stubGlobal('Blob', class { arrayBuffer() { return Promise.resolve(new Uint8Array(400).buffer); } });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) },
      });
      transcribe.mutateAsync.mockReset().mockRejectedValue(
        Object.assign(new Error('Speech transcription requires AI to be enabled'), { data: { appCode } }),
      );
      render(<VocabEiRunner testId={1} onExit={() => {}} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Grabar mi repetición/ })); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Detener/ })); });
      expect(await screen.findByText(/La transcripción de voz está desactivada/)).toBeInTheDocument();
      expect(screen.queryByText(/requires AI/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Grabar/ })).toBeNull();
    });
  }
});
