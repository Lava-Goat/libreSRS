# Extensions

An extension adds a feature to libreSRS without core knowing about it: its own
tRPC routers, its own tables, extra fields on a few core responses, and pieces
of the client (slots, page hooks, admin tabs, messages). A build with no
extension is complete; core never imports one.

## Where the code goes

One folder per extension id (`[a-z0-9-]+`), in each place a tool already
compiles:

| Part | Folder |
|---|---|
| Server code and its tests | `packages/server/src/extensions/<id>/` |
| Its migrations | `packages/server/drizzle/extensions/<id>/` (own journal and ledger) |
| Shared code | `packages/shared/src/extensions/<id>/` (`@libresrs/shared/extensions/<id>`) |
| Client code and its tests | `packages/client/src/extensions/<id>/` |
| e2e specs | `tests/e2e/extensions/<id>/`, `tests/e2e-fullstack/extensions/<id>/` |

Two aggregator files list the extensions a build has:

```ts
// packages/server/src/extensions/enabled.ts
import { combine } from './api.js';
import mine, { type MineFields } from './mine/index.js';
export type Fields = MineFields;                 // two: MergeFields<MineFields, OtherFields>
export type Routers = typeof mine.routers;       // two: & typeof other.routers
export const extensions = combine<Fields, Routers>(mine);

// packages/client/src/extensions/enabled.tsx
import { combineClient } from './api';
import mine from './mine';
export const clientExtensions = combineClient(mine);
```

Without them, `@libresrs/server-extensions` and `@libresrs/client-extensions`
resolve to `none.ts` / `none.tsx` (tsconfig `paths`, and the Vite/vitest alias
in `packages/client/extensions.alias.ts`).

## How core asks

- **Server.** `src/index.ts` awaits `loadExtensions()` (`load.ts`) before
  anything else; core then reads `ext()` (`registry.ts`):
  - `ext().routers` are added to the app router (a key core uses is refused);
  - `await ext().run(hook, ctx)` returns the fields an extension adds to a
    response, and `ext().defaults.<hook>` the "nothing to tell" values where no
    hook runs. Response types spread `ExtensionFields[...]`, which are
    `Partial`: every reader handles their absence;
  - `ext().beforeSession` are Express routers mounted before the session
    (token-authenticated APIs);
  - `ext().timers` are started by `index.ts` once the server listens
    (`timers.ts`: every `everyMs`, never overlapping themselves, `unref()`'d,
    a throw logged as `extension.timer_failed`; none under `NODE_ENV=test`,
    unless `LIBRESRS_E2E_TIMERS_EVERY_MS` asks for them, every that many ms,
    as the full-stack e2e does in `tests/e2e-fullstack/startApi.ts`);
  - `ext().privacy` is what the extensions tell the legal pages
    (`ServerExtension.privacy`, `PrivacyDisclosures`): blocks for the privacy
    policy about the extension's own data flows, a paragraph for the
    privacy summary, values for operator fields, planned-change rows, rows and
    blocks for the third parties it sends student data to, and prior
    versions (`services/legal/render.ts`). An extension whose data leaves the
    server must say so here;
  - and, with it, an operator's own legal pages (`ServerExtension.legalDocuments`,
    below).
- **Hooks.** `review`, `studyFinish`, `answer` (sets finished), `answerGraded`
  (every conjugation answer graded and stored, never a replay: its grading
  facts and `answerId`), `roundSummary`, `studyAllOverview`, `userDetail`
  (`api.ts` HookContexts). conjugation.answer runs `answerGraded`, then
  `answer`, and stores the response again once, only when a hook told
  something (a replay then gets the same).
- **Secrets.** An extension that keeps a secret in its own tables seals it with
  `services/appSettings.ts` `sealSecret` / `openSecret`, as the app settings'
  keys are (re-key them all before rotating `SESSION_SECRET`).
- **Client.** `src/extensions/index.tsx`: `<ExtensionSlot name=… />` (the
  slots and their props: `api.ts` SlotProps; the conjugation runner has
  `conjugation.header`, after "Round", with the round and its last graded
  answer, and `conjugation.verdictNote`, inside the verdict's status text,
  with the answer), the page
  hooks (`useDeckFinishParts`, `useStudyAllFinishParts`,
  `useConjugationParts`), `tabIdsWith`/`tabsWith` for admin tabs, and
  `registerMessages` (i18n) for the extension's strings.
- **Database.** `src/db/runMigrations.ts` runs core's migrations, then each
  `drizzle/extensions/<id>/` folder with its own ledger
  (`__ext_<id>_migrations`). An optional `adopt.json` marks steps a database
  already has (tables made before the extension had its own folder) as applied,
  once, on the first run.
- **Environment.** `LIBRESRS_EXTENSIONS=none` runs core alone (CI, recovery).
  `LIBRESRS_REQUIRE_EXTENSIONS=a,b` fails the boot unless those ids loaded.

## An operator's own legal pages

The core ships neutral default pages (`src/legal/defaults/*.md`: `/privacy`,
`/privacy/summary`, `/terms`, `/subprocessors`, `/privacy/coppa-notice`) that
tell readers the operator has not published its own texts yet. Whoever runs a
site is responsible for its privacy policy and terms; an extension publishes
them with `legalDocuments` (`LegalDocumentSet` in `api.ts`):

```ts
import { readFileSync } from 'node:fs';
const page = (file: string) => readFileSync(new URL(`./legal/${file}`, import.meta.url), 'utf8');

const mine: ServerExtension = {
  id: 'my-legal', routers: {}, defaults: { /* every group {} */ }, hooks: {},
  legalDocuments: {
    // Any of privacy, privacy-summary, terms, subprocessors, coppa-notice; the rest keep the defaults.
    documents: { privacy: page('privacy-policy.md'), terms: page('terms-of-service.md') },
    // Facts of your own, each read from LEGAL_<KEY> (e.g. LEGAL_HOSTING_COMPANY).
    fields: [{ key: 'hosting_company', fallback: { kind: 'missing' }, help: 'Who hosts the server.' }],
    // Values worked out from the others (optional).
    computed: (values) => ({ hosting_line: values.hosting_company ? `Hosted by ${values.hosting_company}.` : '' }),
  },
  // Earlier versions, served at /privacy/<slug> and /terms/<slug>.
  privacy: { priorVersions: [] },
};
```

- The templates sit in the extension's own `legal/` folder; the server's build
  copies every `src/extensions/<id>/legal/` beside the compiled code
  (`packages/server/scripts/copy-legal-templates.mjs`), so read them relative
  to the module, as above.
- They use the defaults' syntax and placeholders (`doc/legal-documents.md`):
  the AI tables and sentences stay live from the AI settings.
- `combine()` refuses a page two extensions replace, and a field core or
  another extension already declares; a computed value may not reuse a name
  core fills.
- Keep the anchors the app links to: `/privacy#AI-Policy` (and `#ai`),
  `/privacy#security`, `/privacy#changes`, `/terms#aup`.

## Rules

- An extension creates only tables and indexes with its own prefix. It may
  reference core tables by foreign key, but never ALTERs them. Core migrations
  never name an extension table.
- An extension imports from core only:
  - server: `db/index.js`, `logger.js`, `routers/trpc.js`, `middleware/*`,
    `services/*`, `utils/*`, `extensions/api.js`;
  - client: `api/trpc`, `i18n`, `utils/*`, `hooks/*`, leaf components,
    `components/admin/userDetailParts`, `extensions/api`.
- An extension never imports what loads it (`src/index.ts`, `routers/index.ts`,
  the routers that call its hooks, `extensions/{index,registry,load,enabled}`,
  pages, the conjugation runner, the user page), except as `import type`.
- Core never imports an extension folder or an aggregator, in any form (the
  bare folder, a file in it, `export … from`, `import()`); it may import the
  mechanism (`extensions/{api,index,registry,load,none,timers}`). Lint enforces this
  (`eslint.config.cjs`, tested by `lintGuard.test.ts`); `npm run typecheck:core`
  typechecks core as if no extension existed (it does not catch an import: tsc
  follows one into an excluded folder).
- A response field has one owner. `combine()` refuses a field two extensions
  declare (group by group: `userDetail`'s `user` and top level apart), and
  `run()` keeps only the fields an extension's `defaults` declare. A field with
  the name of a core field is a type error where core builds the response
  (`FieldsBeside`, `fieldsBeside()` in `api.ts`), and `fieldsBeside()` drops it
  at run time, so core's value always stands.
- Core calls hooks only outside synchronous transactions, and never reads
  `ext()` at module scope (except `index.ts`, after `loadExtensions()`).
- A hook that throws is logged (`extension.hook_failed`) and its defaults
  stand: an extension never fails the core request that asked it.
- An extension uses only dependencies core already declares.
- A core migration that rebuilds `users` or `decks` (DROP + RENAME with
  `foreign_keys` on) cascades into extension rows. It must say so in its
  header, and be tested with extension rows present.
