// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// The Vocabulómetro voice picker lists the ElevenLabs account's voices with
// their category and saves the choice as the Vocabulómetro voice.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VocabVoicePicker } from './VocabManager';

const saveMutate = vi.fn();
let voiceData: Record<string, unknown>;

vi.mock('../api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      vocab: {
        getVocabVoice: { invalidate: vi.fn() },
        getAudioBankWords: { invalidate: vi.fn() },
        getEiSentenceAudioStatus: { invalidate: vi.fn() },
      },
    }),
    vocab: {
      getVocabVoice: { useQuery: () => ({ data: voiceData }) },
      setVocabVoice: { useMutation: () => ({ mutate: saveMutate, isPending: false, isError: false, error: null }) },
    },
    ai: {
      listTtsVoices: {
        useQuery: () => ({
          data: {
            configured: true,
            voices: [
              { voiceId: 'voiceTeacherB', name: 'Me', labels: {}, category: 'cloned' },
              { voiceId: 'voiceTeacherA', name: 'Teacher', labels: {}, category: 'professional' },
            ],
          },
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (s: string, p?: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p?.[k] ?? '')),
  }),
}));

beforeEach(() => {
  saveMutate.mockClear();
  voiceData = {
    ttsProvider: 'elevenlabs', hasElevenLabsKey: true,
    vocabVoiceId: null, defaultVoiceId: 'voiceTeacherB', effectiveVoiceId: 'voiceTeacherB',
  };
});

describe('VocabVoicePicker', () => {
  it('lists the account voices with their category and saves the chosen voice', () => {
    render(<VocabVoicePicker />);
    const select = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Default AI voice (Me)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Teacher · professional clone' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Me · instant clone' })).toBeTruthy();

    fireEvent.change(select, { target: { value: 'voiceTeacherA' } });
    expect(saveMutate).toHaveBeenCalledWith({ voiceId: 'voiceTeacherA' });
  });

  it('clears the voice back to the default AI voice', () => {
    voiceData.vocabVoiceId = 'voiceTeacherA';
    render(<VocabVoicePicker />);
    const select = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(select.value).toBe('voiceTeacherA');
    fireEvent.change(select, { target: { value: '' } });
    expect(saveMutate).toHaveBeenCalledWith({ voiceId: null });
  });

  it('explains that OpenAI speech has no Vocabulómetro voice', () => {
    voiceData.ttsProvider = 'openai';
    render(<VocabVoicePicker />);
    expect(screen.queryByLabelText('Voice')).toBeNull();
    expect(screen.getByText(/Speech is served by OpenAI/)).toBeTruthy();
  });
});
