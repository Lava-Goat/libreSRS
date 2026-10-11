// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * A conjugation round's scope: one deck's quiz ('deck', as before v1.18.0,
 * reviews of other decks mixed in), or "Study all" ('all': forms from every
 * quiz the student may play, due first, then in progress, then new). A
 * Study-all round keeps a deck id too: the newest of those decks, its lead.
 */
export const ROUND_SCOPES = ['deck', 'all'] as const;
export type RoundScope = (typeof ROUND_SCOPES)[number];
