// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
// Elicited imitation: scoring of a transcribed repetition against the target
// sentence. Pure, dependency-free so it is unit-testable.

/** Accent/punctuation-insensitive tokenization for scoring. */
export function eiTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zñ0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Length of the longest common subsequence of two token arrays. */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

export interface EiScore {
  score: number;   // 0–1: order-aware token F1 against the target
  targetTokens: number;
  hypTokens: number;
  matched: number;
}

/**
 * Elicited-imitation accuracy: the LCS of target and hypothesis tokens (which
 * rewards correct words in the correct order) folded into an F1 so that both
 * omissions and insertions are penalized. Robust to ASR punctuation/casing.
 */
export function scoreElicitedImitation(target: string, hypothesis: string): EiScore {
  const t = eiTokens(target);
  const h = eiTokens(hypothesis);
  const matched = lcsLength(t, h);
  const recall = t.length ? matched / t.length : 0;
  const precision = h.length ? matched / h.length : 0;
  const score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { score, targetTokens: t.length, hypTokens: h.length, matched };
}

/**
 * Default graded Spanish sentence bank for elicited imitation, ordered by
 * length/complexity (difficulty 1 = shortest/easiest). Seeded on first use so a
 * teacher has a usable EI test without authoring sentences.
 *
 * Pitched at a first-year course and ordered from simple to harder, so
 * students repeat language they have already met:
 *   1–2  5–7 words, present tense, core verbs (llamarse, ir, gustar,
 *        tener, ser, hay).
 *   3–4  8–12 words, present tense, joined with y / pero / porque.
 *   5–6  12–16 words; ir a + infinitive, and one preterite sentence.
 * No subjunctive, conditional or compound tenses. No numerals written as
 * words above "un/una" (Whisper transcribes them as digits, which would score
 * as a miss), and only names Whisper spells reliably.
 */
export const DEFAULT_EI_SENTENCES: { text: string; difficulty: number }[] = [
  { text: 'El estudiante se llama Leo.', difficulty: 1 },
  { text: 'El perro va a la escuela.', difficulty: 1 },
  { text: 'A Mateo le gusta la pizza.', difficulty: 1 },
  { text: 'Mi abuela tiene una motocicleta.', difficulty: 2 },
  { text: 'En esta familia hay mucho amor.', difficulty: 2 },
  { text: 'Diego es alto y Mario es bajo.', difficulty: 2 },
  { text: 'Hugo no entiende nada de matemáticas y necesita ayuda.', difficulty: 3 },
  { text: 'Los profesores son estudiantes y los estudiantes son profesores.', difficulty: 3 },
  { text: 'Nico no come fruta ni verduras, solo come pan.', difficulty: 3 },
  { text: 'La comida es deliciosa, pero el restaurante es muy pequeño.', difficulty: 4 },
  { text: 'La casa es enorme, pero solo tiene un cuarto pequeño.', difficulty: 4 },
  { text: 'Los coches están muy sucios porque nunca llueve en el pueblo.', difficulty: 4 },
  { text: 'El equipo siempre pierde, pero la portera dice que mañana juegan otra vez.', difficulty: 5 },
  { text: 'Con sus tenis mágicos, el chico baila en el desayuno y en la escuela.', difficulty: 5 },
  { text: 'La abuela va a visitar a sus nietos y van a comer mariscos en la playa.', difficulty: 6 },
  { text: 'Ayer los estudiantes jugaron un partido de fútbol contra los profesores y nadie ganó.', difficulty: 6 },
];
