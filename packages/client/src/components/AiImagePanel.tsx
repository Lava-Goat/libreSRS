// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { useState } from 'react';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';

interface Props {
  cardId: number;
  allowGenerate?: boolean;
}

/**
 * A card's AI picture, on the back. Making one stays as it was; removing it takes it off the card
 * for every student, so since v1.20.0 only the teacher has that control (and ai.removeImage is
 * the teacher's alone on the server).
 */
export default function AiImagePanel({ cardId, allowGenerate = true }: Props) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const assetsQuery = trpc.ai.getCardAssets.useQuery({ cardId });
  const generateMutation = trpc.ai.generateImage.useMutation();
  const removeMutation = trpc.ai.removeImage.useMutation();

  const rawUrl = removed ? null : (generatedUrl ?? assetsQuery.data?.image?.url ?? null);
  const imageUrl = loadFailed ? null : rawUrl;

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ cardId });
      setGeneratedUrl(result.imageUrl);
      setRemoved(false);
      setLoadFailed(false);
      assetsQuery.refetch();
    } catch {
      // Error handled by mutation state
    }
  };

  const handleRemove = async () => {
    try {
      await removeMutation.mutateAsync({ cardId });
      setGeneratedUrl(null);
      setRemoved(true);
      setLoadFailed(false);
      assetsQuery.refetch();
    } catch {
      // Error handled by mutation state
    }
  };

  if (imageUrl) {
    return (
      <div className="mt-3 flex flex-col items-center gap-1">
        <img
          src={imageUrl}
          alt={t('AI-generated illustration')}
          className="max-w-[200px] max-h-[200px] rounded-lg shadow-sm dark:shadow-gray-900/20"
          onError={() => setLoadFailed(true)}
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('AI-generated')}</span>
          {allowGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
            >
              {generateMutation.isPending ? t('Generating...') : t('Regenerate')}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleRemove}
              disabled={removeMutation.isPending}
              className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
            >
              {t('Remove')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!allowGenerate) return null;

  return (
    <div className="mt-2">
      <button
        onClick={handleGenerate}
        disabled={generateMutation.isPending}
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 disabled:opacity-50 transition-colors"
      >
        {generateMutation.isPending ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t('Generating...')}
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            {rawUrl ? t('Regenerate Image') : t('Generate Image')}
          </>
        )}
      </button>
      {generateMutation.isError && (
        <p className="text-xs text-red-500 mt-1">{t('Failed to generate image')}</p>
      )}
    </div>
  );
}
