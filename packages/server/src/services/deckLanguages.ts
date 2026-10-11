// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** A deck's languages as codes: the front side's (source) and the back side's (target). */
export interface DeckLanguages {
  sourceLanguage: string | null;
  targetLanguage: string | null;
}

/** The deck's two language codes, null when unset (or the deck is gone). */
export function getDeckLanguages(deckId: number): DeckLanguages {
  const row = db
    .select({ sourceLanguage: schema.decks.sourceLanguage, targetLanguage: schema.decks.targetLanguage })
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .get();
  return { sourceLanguage: row?.sourceLanguage ?? null, targetLanguage: row?.targetLanguage ?? null };
}
