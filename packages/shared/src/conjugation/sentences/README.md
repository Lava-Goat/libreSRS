# Sentences with a blank

The conjugator can show a give-the-form item as a sentence instead of a person label:

```
Mis primos ___ (vivir) en Lima.          → viven
A mis primos ___ (gustar) el perro.      → les gusta
Mi prima ___ (llamarse) Ana.             → se llama
En la escuela ___ (haber) muchos chicos. → hay
```

The subject before the blank decides the person. The engine (`conjugate`) always writes
the form; no frame, AI output or teacher edit ever contains it. One deterministic checker,
`validate()`, runs on built-in, AI-written and teacher-edited sentences alike.

## Files

| File | What it holds |
|---|---|
| `types.ts` | `SentenceDeck` (the settings the engine reads), the rendered and checked shapes, the rule codes |
| `words.ts` | nouns (gender, plural, English, subject tags), adjectives (four forms), names, places, the core list |
| `vocab.ts` | the vocabulary rule and the compiled, cached `DeckContext` |
| `subjects.ts` | the subject / experiencer parser (person, number, gender, English) and the subject bank |
| `cues.ts` | time words and the tenses they agree with; the time word a multi-tense deck gets |
| `fillers.ts` | the complement slots (`{city}`, `{food}`, `{like}`, `{age}`…), each phrase with its English |
| `frames.ts` | the hand-written frames for every verb Units 1-4 drill |
| `english.ts` | English verb forms per tense for the feedback line |
| `render.ts` | `renderCandidates`, `sentencePool`, `pickSentence`, `filledIn`, `coverage` |
| `validate.ts` | `validate`, `validateText`, `splitSentence`, `sentenceVerb` |
| `testUnits.ts` | test data: the cards of Units 1-4 (not imported at runtime; `@libresrs/shared/conjugation/sentences/testUnits` for the server's tests) |
| `renderList.mjs` | writes every built-in sentence, filled in, for reviewers |
| `reviewSheet.mjs` | writes a reviewer's sheet: each frame once, filled in, with its subjects and endings |

## Data format

A deck:

```ts
const deck: SentenceDeck = {
  tenses: ['present'], vosotros: false, vos: null,
  entries: ['ser', 'vivir', 'gustarle'],      // drilled entries, canonical ids
  cards: unit3Cards, earlierCards: [...unit1Cards, ...unit2Cards],
  approvedWords: [],                          // words the teacher allowed by hand
};
```

A rendered sentence (`RenderedSentence`): `before`, `after`, `infinitiveCue` (what the
parentheses show: `gustar` for gustarle, `haber` for hay), `answers` (the engine's accepted
forms), `english` (for the feedback after the answer; null when the tense has no English
template), `subjectId`, `subjectKind` (pronoun, name, np_sg, np_pl, coord_yo, coord_tu, coord,
thing, experiencer: for the teacher's breakdown), `sentenceRef` (stable:
`tpl:vivir.city/np:mis-primos/city=lima/present`) and `frameId`.

`validate({ entry, cell, before, after, cue }, deck)` returns `{ ok, reasons, warnings,
subject, thingNumber, timeWords, answers }`. Each reason names its rule (`blank`, `cue`,
`notDrilled`, `noSubject`, `unknownSubject`, `bannedSubject`, `accent`, `agreement`, `person`,
`ambiguous`, `experiencer`, `thingLiked`, `clitic`, `impersonalSubject`, `timeWord`, `leak`,
`secondVerb`, `vocabulary`, `negativeCommand`, `sameReferent`, `possessive`) with a plain-English
message for the teacher.
The file comment of `validate.ts` lists what each rule rejects. `validateText` takes a sentence
written as `"Mis primos ___ (vivir) en Lima."`, the shape the AI step will return.

## How to add a frame

1. Open `frames.ts` and find the entry's `group(...)` (or add one: the key is the entry id).
2. Add a line:

   ```ts
   park: { es: '{S} ___ en el parque.', en: '{S} {V} at the park.', v: 'live', tenses: HABIT },
   ```

   - `es`: `{S}` (subject) comes first, then `___`. Use `{E}` for a gustar experiencer and
     `{T}` with `pivot: '<list>'` for a thing subject (El café ___ (costar)…). Complements are
     `{slot}` names from `fillers.ts` (`{slot:2}` is a second, different pick from the same
     list and set). Never write the verb form, a clitic before the blank, or "no" before a
     command's blank. The one clitic allowed is `{LE}` (le / les, agreeing with the person slot
     named by `io`) with a verb that takes an indirect object:
     `'{S} {LE} ___ las gracias a {personObj}.', io: 'personObj'` (Yo les doy las gracias a mis
     tías). Natives always add it; it is outside the answer.
   - `en`: `{S}` / `{E}` / `{T}`, `{V}` (the verb for the tense and person), `{Vneg}`,
     `{POSS}`, `{THERE}` and the same slots. `v` is the English verb (`english.ts`; add it there
     if it is new).
   - `who`: subject tags it suits (default `['person']`; `animal`, `learner`, `adult`, `teacher`,
     `server`, `family`, `household` (parents, siblings), `kid`, `baby`, `elder`). `notWho`
     excludes tags. `persons` limits the persons. `noNames` / `noFormal` skip names and usted /
     ustedes. `avoidLemmas` skips subjects with those nouns. The speaker is a student: yo, tú,
     nosotros and the names are `learner` only; usted is `adult`.
   - People slots: `personObj` (anyone), `familyObj` (parents, grandparents: vivir con),
     `peerObj` (siblings, cousins, friends: study / go to school with), `knowObj` (conocer: no
     family for a family subject), `companionObj` (a trip), `customerObj`, `serverObj`. A slot
     never names the subject again in other words or the other gender (mi papá / mi padre, mis
     abuelos / mi abuela), and a "we" subject gets no "mi / mis" person (a native says nuestro).
   - `tenses`: list every tense the sentence is natural in. Without it the frame is present only.
3. Every word must be on the deck's cards, an earlier deck or the core list (`words.ts`), or the
   frame does not render in that deck. A new noun or adjective goes into `words.ts` with its
   gender and forms, so the checker can read it.
4. Run `npx vitest run src/conjugation/sentences` (build shared first). The sweep renders every
   frame × subject × tense for every unit and fails on any sentence the checker rejects.
5. Regenerate the reviewers' list and read the new sentences (CI checks the grammar the
   checker knows, not whether the Spanish is natural):
   `node src/conjugation/sentences/renderList.mjs rendered.md` (after building shared), and the
   reviewer's sheet: `node src/conjugation/sentences/reviewSheet.mjs review-sheet.md`.

## Content rules

- Food suits the place and the meal: markets and stores sell groceries (`foodBuy`), restaurants
  serve dishes (`foodOrder`), breakfast has its own foods and drinks; no soda at breakfast.
- Nobody lives with, travels with or goes to school with a teacher, a server or an unrelated
  adult; nobody comments on a teacher's looks; no teacher dislikes school.
- Children do not pay, work or ask for the check; "ya sabe leer y escribir" is for children only.
- Thing subjects pick their lists by band: prices by what costs (cheap, meal, item), opening and
  closing hours by place (a restaurant closes at ten or eleven).
- No progressive with a clock time, a meal or a time of day ("Estoy llegando a las ocho").

## Coverage (Units 1-4 of the sample decks)

Every drilled cell has sentences except `costar` yo / tú / nosotros: only a thing costs, so those
three cells keep the short label (the sample decks have only cuesta / cuestan), and under the holdback
they are left out of the measurement (no arm is recorded). Every other cell has at least three
sentences, so none comes back every time (v1.25.0 added the student frames of vivir tú, trabajar,
enseñar and vender yo / tú, which had one each).
Subjunctives and commands have no frames; those cells also keep the label.
