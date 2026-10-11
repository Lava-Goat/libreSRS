// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/* global URL, process, console */
// Writes a reviewer's sheet: per unit and verb, every frame once, filled in with one subject,
// its English, the subjects it rotates through and the endings it takes.
// Build shared first, then: node src/conjugation/sentences/reviewSheet.mjs review-sheet.md
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const D = fileURLToPath(new URL('../../../dist/conjugation', import.meta.url));
const { detectVerbs, cellsFor } = await import(D + '/index.js');
const S = await import(D + '/sentences/index.js');
const { UNIT_CARDS, UNIT_IDS, unitDeck } = await import(D + '/sentences/testUnits.js');

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const MAX_ENDINGS = 8;
const head = [];
const body = [];
let frames = 0;
let sentences = 0;
const perUnit = [];

for (const u of UNIT_IDS) {
  const entries = detectVerbs(UNIT_CARDS[u]).map((v) => v.infinitive);
  const deck = unitDeck(u, entries);
  const ctx = S.deckContext(deck);
  const bankList = S.subjectBank(ctx);
  const expList = S.experiencerBank(ctx);
  const byId = new Map([...bankList, ...expList].map((b) => [b.id, cap(b.es)]));
  // named groups, so a list of 40 subjects reads "students" (by the subject tags)
  const group = (list, test) => list.filter((b) => test(b.subject.tags)).map((b) => cap(b.es));
  const groups = (list) => [
    ['everyone', list.map((b) => cap(b.es))],
    ['all people', group(list, (t) => t.includes('person'))],
    ['all students', group(list, (t) => t.includes('learner'))],
    ['all adults', group(list, (t) => t.includes('adult'))],
    ['the speaker, relatives and pets', group(list, (t) => t.includes('family'))],
  ];
  const named = groups(bankList);
  const namedExp = groups(expList);
  const describe = (subjects, exp) => {
    let best = null;
    for (const [name, members] of exp ? namedExp : named) {
      const missing = members.filter((m) => !subjects.includes(m));
      const extra = subjects.filter((m) => !members.includes(m));
      const cost = missing.length + extra.length;
      if (!best || cost < best.cost) best = { name, missing, extra, cost, size: members.length };
    }
    if (!best || best.cost > 8 || subjects.length < 8) return null;
    let out = `${best.name} (${best.size})`;
    if (best.missing.length) out += ` except ${best.missing.join(', ')}`;
    if (best.extra.length) out += `, plus ${best.extra.join(', ')}`;
    return out;
  };
  let unitFrames = 0;
  let unitSentences = 0;
  body.push(`\n## ${u}\n`);
  body.push('The subject groups of this unit (who "everyone", "all students"… are):\n');
  for (const [name, members] of named) body.push(`- **${name}** (${members.length}): ${members.join(', ')}`);
  body.push(`- **everyone (gustar)** (${namedExp[0][1].length}): ${namedExp[0][1].join(', ')}`);
  for (const e of entries) {
    const byFrame = new Map();
    for (const c of cellsFor(e, deck.tenses, { vosotros: false })) {
      for (const r of S.sentencePool(e, c, deck)) {
        const list = byFrame.get(r.frameId) ?? [];
        list.push(r);
        byFrame.set(r.frameId, list);
      }
    }
    const n = [...byFrame.values()].reduce((a, l) => a + l.length, 0);
    unitFrames += byFrame.size;
    unitSentences += n;
    body.push(`\n### ${e} · ${byFrame.size} frames, ${n} sentences\n`);

    for (const [fid, list] of byFrame) {
      const pick = list.find((r) => r.subjectKind === 'np_sg' || r.subjectKind === 'np_pl' || r.subjectKind === 'experiencer') ?? list[0];
      const filled = `${pick.before} **${pick.answers[0]}** ${pick.after}`.replace(/\s+/g, ' ').trim();
      body.push(`- \`${fid}\` ${cap(filled)} — _${pick.english ?? '(no English)'}_`);
      // the subject itself, without "En la foto," / "también" / "le" around it
      const subjects = [...new Set(list.filter((r) => r.subjectId).map((r) => byId.get(r.subjectId) ?? cap(r.before.replace(/^En [^,]+, /, ''))))];
      let who;
      if (!subjects.length) who = 'none (impersonal)';
      else if (list[0].subjectKind === 'thing') who = subjects.join(', ');
      else who = describe(subjects, pick.subjectKind === 'experiencer') ?? subjects.join(', ');

      const endings = [...new Set(list.map((r) => r.after))];
      const shown = endings.slice(0, MAX_ENDINGS).join(' · ');
      const more = endings.length > MAX_ENDINGS ? ` · +${endings.length - MAX_ENDINGS} more` : '';
      body.push(`  - Subjects (${subjects.length}): ${who}`);
      if (endings.length > 1) body.push(`  - Endings (${endings.length}): ${shown}${more}`);
    }
  }
  frames += unitFrames;
  sentences += unitSentences;
  perUnit.push(`${u} ${unitFrames} frames / ${unitSentences} sentences`);
}

head.push('# Built-in sentences: review sheet');
head.push('');
head.push(`1. **Counts:** ${frames} frames, ${sentences} sentences (${perUnit.join('; ')}), at the sample decks' settings (present only, no vosotros, no vos). Every drilled cell has a sentence except costar yo / tú / nosotros (only things cost).`);
head.push('2. **What the checker guarantees for every sentence (built-in, AI or edited):** one blank with the right verb in parentheses; a subject before it that fits exactly one drilled form (no tu / su / nuestro, no collective nouns, no "Ana y tú" with vosotros on); gustar takes the "A …" person and a thing liked that decides gusta / gustan; no second verb, no other form of the same verb, no time word that clashes with the tense; every word on this unit\'s or an earlier unit\'s cards or the core list; no "le / les" before the blank unless it doubles an agreeing "a + person" with dar-type verbs; nobody named twice (mi papá … mi padre, mis abuelos … mi abuela); no "nosotros … mi madre".');
head.push('3. **What it cannot judge:** whether a sentence is natural or suits a school. That is what this sheet is for: each line below is one frame; the subjects and endings rotate.');
head.push('4. **To hide one sentence later** (after v1.25.0): press Hide on it in the deck\'s sentence list; it stays hidden for that deck. **To drop a whole frame everywhere:** report its id (the code at the start of the line, e.g. `dar.money`) and it can come out of frames.ts.');
head.push('5. **How to read a line:** the filled-in sentence (verb form in bold) and the English the student sees after answering; "Subjects" lists who it rotates through, by the groups at the top of each unit; "Endings" are the complements it takes.');

if (!process.argv[2]) throw new Error('usage: node reviewSheet.mjs <out.md>');
fs.writeFileSync(process.argv[2], [...head, ...body].join('\n') + '\n');
console.log(perUnit.join('\n'), frames, sentences);
