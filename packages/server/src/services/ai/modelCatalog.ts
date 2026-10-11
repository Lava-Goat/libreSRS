// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Live model catalog for the admin AI dropdowns. Fetches the provider's
// /models endpoint (OpenAI or any OpenAI-compatible base URL), groups the ids
// into the selector families, and caches the result for 7 days. The admin
// panel can force a refresh with a button. Falls back to the static curated
// AVAILABLE_MODELS when the endpoint is unreachable (no key, offline, or a
// compatible server that does not implement /models).
import { AVAILABLE_MODELS } from './aiTemplates.js';
import { getAiRuntimeConfig } from './config.js';
import { listElevenLabsModels } from './elevenLabsSpeech.js';
import { logger } from '../../logger.js';

export interface ModelFamilies {
  mnemonic: string[];
  image: string[];
  imageQuality: string[];
  tts: string[];
}

export interface ModelCatalog {
  models: ModelFamilies;
  /** Epoch ms of the successful live fetch; null → static fallback list. */
  fetchedAt: number | null;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

let cache: ModelCatalog | null = null;

/** Dated snapshots (e.g. -2026-03-05) are hidden from chat/image dropdowns to
 *  keep them scannable; undated aliases track the same models. TTS keeps its
 *  dated ids — they are few and the default is one of them. */
const DATED = /-20\d{2}-\d{2}-\d{2}$/;

/** Chat-completions-capable text models: gpt-4o/4.1/5 families, minus
 *  specialized ids (code, search, audio/realtime/transcribe/tts) and -pro
 *  models, which are not served by the chat/completions endpoint. */
function isChatModel(id: string): boolean {
  return /^gpt-(4o|4\.1|5)/.test(id)
    && !/(codex|search|audio|realtime|transcribe|tts|image|-pro)/.test(id)
    && !DATED.test(id);
}

export function groupModelIds(ids: string[]): Pick<ModelFamilies, 'mnemonic' | 'image' | 'tts'> {
  // Newest-first reads naturally in a dropdown (5.6 above 5.5 above 4o).
  const desc = (a: string, b: string) => b.localeCompare(a);
  const chat = ids.filter(isChatModel).sort(desc);
  const tts = ids.filter((id) => /tts/.test(id) && !/-1106$/.test(id)).sort(desc);
  const image = ids.filter((id) => /^gpt-image/.test(id) && !DATED.test(id)).sort(desc);
  return { mnemonic: chat, image, tts };
}

export async function getModelCatalog(force = false): Promise<ModelCatalog> {
  if (!force && cache?.fetchedAt && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache;
  }

  try {
    const cfg = await getAiRuntimeConfig();
    // When ElevenLabs serves TTS, the tts dropdown lists ITS models (with a
    // static fallback inside listElevenLabsModels — it never throws).
    const elevenLabsTts = cfg.ttsProvider === 'elevenlabs' && cfg.elevenlabsApiKey
      ? await listElevenLabsModels(cfg.elevenlabsApiKey)
      : null;
    // api.openai.com rejects unauthenticated /models calls — skip the network
    // round-trip entirely (also keeps unit tests offline). Key-less compatible
    // endpoints (e.g. a local Ollama) are still queried.
    if (!cfg.openaiApiKey && cfg.openaiBaseUrl.startsWith('https://api.openai.com')) {
      if (elevenLabsTts) {
        // No OpenAI side to query, but the TTS list is live — serve it with the
        // static chat/image lists.
        cache = {
          models: { ...AVAILABLE_MODELS, tts: elevenLabsTts },
          fetchedAt: Date.now(),
        };
        return cache;
      }
      throw new Error('no API key configured for api.openai.com');
    }
    const res = await fetch(`${cfg.openaiBaseUrl}/models`, {
      headers: cfg.openaiApiKey ? { Authorization: `Bearer ${cfg.openaiApiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`models list HTTP ${res.status}`);
    }
    const data = await res.json() as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) {
      throw new Error('models list is empty');
    }

    const grouped = groupModelIds(ids);
    cache = {
      models: {
        // A family the provider does not expose falls back to the curated list
        // so no dropdown ever renders empty.
        mnemonic: grouped.mnemonic.length > 0 ? grouped.mnemonic : AVAILABLE_MODELS.mnemonic,
        image: grouped.image.length > 0 ? grouped.image : AVAILABLE_MODELS.image,
        tts: elevenLabsTts ?? (grouped.tts.length > 0 ? grouped.tts : AVAILABLE_MODELS.tts),
        imageQuality: AVAILABLE_MODELS.imageQuality,
      },
      fetchedAt: Date.now(),
    };
    logger.info({ event: 'ai.model_catalog_refreshed', chat: grouped.mnemonic.length, tts: grouped.tts.length, image: grouped.image.length }, 'Model catalog refreshed from provider');
    return cache;
  } catch (error) {
    logger.warn({ event: 'ai.model_catalog_fetch_failed', err: error }, 'Model catalog fetch failed; using static list');
    // Do not cache the failure: the next (or forced) call retries. A stale
    // previously-successful cache is still better than the static list.
    if (cache?.fetchedAt) return cache;
    return { models: { ...AVAILABLE_MODELS }, fetchedAt: null };
  }
}

/** Reset the cache (for testing). */
export function resetModelCatalogCache(): void {
  cache = null;
}
