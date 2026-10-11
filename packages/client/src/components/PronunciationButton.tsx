import { useState, useCallback, useEffect, useRef } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { playAudio, subscribe, type PlayHandle } from '../utils/audioPlayer';

interface Props {
  cardId: number;
  side: 'front' | 'back';
  audioUrl?: string;
}

export default function PronunciationButton({ cardId, side, audioUrl: audioUrlProp }: Props) {
  const { t } = useI18n();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const assetsQuery = trpc.ai.getCardAssets.useQuery(
    { cardId },
    { enabled: audioUrlProp == null }
  );
  const generateMutation = trpc.ai.generatePronunciation.useMutation();

  // Playback lives in the shared single-element player, so this button follows
  // it rather than owning an element of its own — a second element playing the
  // same clip alongside autoplay is what sounded like reverb.
  //
  // Track the url we actually played: on a card whose audio does not exist yet
  // the click GENERATES a clip, so the url is not the one derived from props
  // and comparing against that would drop the playing state immediately.
  const playingUrlRef = useRef<string | null>(null);
  const handleRef = useRef<PlayHandle | null>(null);

  // Stop a clip THIS button started when it unmounts — the answer-side button
  // unmounts on every card advance, and without this a clip started by hand
  // bleeds into the next card. The handle's token makes this a no-op if
  // something newer is already playing, so it can never cut off another clip.
  useEffect(() => () => handleRef.current?.stop(), []);
  useEffect(() => subscribe(({ url }) => {
    if (playingUrlRef.current && url !== playingUrlRef.current) {
      playingUrlRef.current = null;
      setIsPlaying(false);
    }
  }), []);

  const handleClick = useCallback(async () => {
    if (isPlaying || isGenerating) return;

    const assetKey = side === 'front' ? 'audioFront' : 'audioBack';
    let audioUrl = audioUrlProp ?? assetsQuery.data?.[assetKey]?.url;

    if (!audioUrl) {
      setIsGenerating(true);
      try {
        const result = await generateMutation.mutateAsync({ cardId, side });
        audioUrl = result.audioUrl;
        assetsQuery.refetch();
      } catch (err) {
        console.error('[pronunciation] Failed to generate audio', err);
        setIsGenerating(false);
        return;
      }
      setIsGenerating(false);
    }

    if (!audioUrl) return;

    setIsPlaying(true);
    playingUrlRef.current = audioUrl;
    // Replaces whatever is playing (including a just-started autoplay clip).
    const handle = playAudio(audioUrl);
    handleRef.current = handle;
    const started = await handle.started;
    if (!started) {
      playingUrlRef.current = null;
      setIsPlaying(false);
    }
  }, [cardId, side, isPlaying, isGenerating, audioUrlProp, assetsQuery, generateMutation]);

  const disabled = isPlaying || isGenerating;

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-1.5 py-1 text-gray-400 dark:text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
      title={t('Play pronunciation')}
    >
      {isGenerating ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07l-1.41-1.41a3 3 0 000-4.24l1.41-1.42zM19.07 4.93a10 10 0 010 14.14l-1.41-1.41a8 8 0 000-11.31l1.41-1.42z" />
        </svg>
      )}
    </button>
  );
}
