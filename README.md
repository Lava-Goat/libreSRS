<p align="center">
  <img src="logo.svg" alt="libreSRS" width="200">
</p>

# libreSRS

libreSRS is a web app for a language class: flashcards scheduled with FSRS spaced repetition, plus the other tools one teacher uses with their students. It was built for a high-school Spanish I course. The project's home is libresrs.org.

The flashcard part works for any language: each deck has its own source and target language and accents, and `doc/hebrew-100.csv` is a Hebrew sample deck. The conjugation quizzes and the Vocabulómetro are Spanish only.

This README describes version 1.26.2 (`/api/build-info` reports the running version). The app also shows it at `/readme`, to anyone, without signing in, so it holds no private host names, IP addresses or keys.

## Features

### Flashcards

- FSRS scheduling (`ts-fsrs`) with four ratings: Again, Hard, Good, Easy.
- Reversible decks: front-to-back and back-to-front are scheduled separately.
- Daily limits for new cards and reviews per group (20 and 20 by default), per student and per deck. The teacher can fix a student's limits, or let them go only higher or only lower.
- Undo of the last review. Keys: Space or Enter shows the answer, 1 to 4 rate, Ctrl/Cmd+Z undoes.
- Study all (`/study/all`): every deck with cards due, newest deck first, each under its own limits, ending with one "All Done!".
- Virtual Decks: a student's own part of a deck, chosen by card numbers such as `1-50, 75, 100-110`.
- "Your Progress" stats, and a CSV of one's own review history (refused above 100,000 rows).

### Decks, groups and rosters

- The teacher makes decks in Admin > Decks: CSV import (columns `front` and `back`, a short list of allowed HTML tags, 2 MiB at most), Anki `.apkg` import (25 MiB at most), and CSV export.
- Groups hold decks and students. Every user is also in the built-in `All` group.
- Google Classroom rosters can be imported from a CSV or through the Classroom API.
- Group exports (Admin > Groups): summary, reviews, vocab, completions, labs, speaking and conjugation.

### Conjugation

- A conjugation quiz built from a deck's verbs, once the teacher turns it on for that deck (`/conjugation/:deckId`), and a conjugation Study all (`/conjugation/all`) in rounds of 20 that mix every quiz's due, started and new forms.
- A form is mastered when it is answered right at the top level on two different school days. Mastered forms come back after 1 week, 3 weeks, then every 8 weeks.
- "Intro to conjugation" is a guide that grows with each deck and each student. It opens only between questions.
- A "give the form" question can be shown as a sentence with a blank ("Mis primos ___ (vivir) en Lima."), per deck and off by default: built-in sentences checked by one deterministic checker, with a per-deck holdback to measure them. The same questions and progress either way.
- The engine is in `packages/shared/src/conjugation/` (the sentences in its `sentences/` folder).

### Listening labs, exam labs and the Tests page

- Listening labs (`/labs`, Admin > Labs): the teacher uploads an audio file; the student listens up to a required point and speaks in the answer pauses.
- Labs record nothing. The page reports how long its microphone heard a voice in each pause, and the server checks that against its own log of the listening. The teacher can change a student's credit.
- Exam labs: a lab in an exam set (for example "U3") is one form of a test. Each student gets one start per set; the teacher can reset it.
- The Tests page (`/tests`) has one card per exam set with its listening forms and speaking tests.

### Speaking tasks

- Students record a task (`/speaking`, Admin > Speaking) for the teacher to hear.
- Recordings are private: they are kept in `data/recordings/`, not in the public asset store, and only the student and the teacher can play them.
- A task with an exam set is a speaking test and appears on the Tests page.

### Vocabulómetro

- A vocabulary-proficiency suite (`/vocabulometro`, Admin > Vocabulómetro) with 11 modes: `size`, `mastery`, `listen`, `c500`, `a500`, `s5000`, `listen2`, `dictado`, `ctest`, `ldt` and `ei`. The teacher opens each test for chosen groups.
- `listen2` and `dictado` play from a bank of generated audio; `listen` plays fixed clips built into the page. The elicited-imitation mode (`ei`) transcribes a student's repetition to score it and does not keep the audio.
- A single-file offline version is in `tools/vocabulometro-offline/`.

### Sign-up sheets

- The teacher lists class days with a few seats each (`/signups`, Admin > Sign-ups); students pick their days. A day locks for students when it arrives.

### AI help (optional, off by default)

- Mnemonics are teacher-only: the teacher asks for a suggestion on any card and accepts or rejects it; students read the accepted one on the back of the card. Suggestions come from OpenAI (or any OpenAI-compatible server) or, when the text provider is set to Anthropic, from Claude.
- Pronunciation audio per card side from OpenAI or ElevenLabs, with a voice for each accent. Audio can play on its own, per group or per student.
- A picture per card from OpenAI's image model. Only the teacher can remove one.
- Transcription (OpenAI) for the Vocabulómetro's `ei` ("repeat the sentence") mode: the one feature that sends something a student made (the recording) to a provider. It has its own switch in Admin > AI, off on a new install, and the test tells the student before recording where the audio goes.
- Each user gets 20 real provider calls per minute; answers already cached are free. If a provider says its balance is empty, that provider is paused and retried; Admin > AI has a Resume button.
- Generated audio and pictures go to the public asset store, `data/assets/`, served at `/api/assets/`.
- The base URL can point at any OpenAI-compatible server the backend can reach (Ollama, LM Studio, vLLM). Inside a container, `localhost` is the container itself. Every call that goes to OpenAI (mnemonics unless the text provider is Anthropic, OpenAI speech, pictures, moderation, transcription) uses that URL; ElevenLabs and Claude keep their own. There is no fallback to OpenAI, so turn off the features the server does not offer.

### Sign-in and access

- Google sign-in asks only for `profile` and `email`. If Google's userinfo service refuses, the server asks once more, then uses the checked ID token.
- Sign in with a PIN (students only): a student number or school email plus a 4-digit PIN from the teacher (Admin > Users or Groups). PINs are stored as salted scrypt hashes. Five wrong PINs lock an account for 15 minutes, doubling up to 24 hours, and each network address may get 300 wrong per 15 minutes. Admin > Access sets the mode: Auto (the default; offered only while Google sign-in looks blocked for students at school), On or Off.
- Clever sign-in and Clever roster import are in the code; `CLEVER_AUTH_DISABLED=true` hides them without deleting stored credentials.
- Who may sign in: an existing user always; `ADMIN_EMAIL` always, as admin; with no users and no `ADMIN_EMAIL`, the first person to sign in becomes admin (only when Google sign-in is configured); anyone else only through the allowlist in Admin > Access (exact addresses or safe regular expressions).
- With no Google client stored, the app opens the `/setup` wizard, which saves the client and turns on Google sign-in without a restart.

### Admin, languages and themes

- Admin tabs: Dashboard, Groups, Decks, Labs, Speaking, Sign-ups, Users, Access, AI, Vocabulómetro, plus any an extension adds.
- Interface in 9 languages: English (default), Spanish, Arabic, Chinese, Vietnamese, Brazilian Portuguese, Russian, Persian and Hebrew; Arabic, Persian and Hebrew run right to left. Spanish covers nearly everything; the others cover part of the interface and fall back to English.
- Light and dark themes.

## How it is built

An npm workspaces monorepo:

- `packages/client`: React 19, React Router 7, Vite 7, Tailwind 4, TanStack Query with the tRPC client.
- `packages/server`: Express 5, tRPC 11, Passport, drizzle-orm on `better-sqlite3`, pino logs, zod.
- `packages/shared`: FSRS helpers, the conjugation engine, types. It is built to `dist/`, and the server and client import the built copy, so build it first (the `dev`, `typecheck` and `test:e2e:fullstack` scripts do).

The server:

- tRPC routers in `packages/server/src/routers/`, served at `/api/trpc`. Mutations need the CSRF double-submit cookie `libresrs_csrf`, echoed in the `x-csrf-token` header.
- Other routes: `/healthz` and `/api/build-info` (version, tag, commit); `/auth/*` (Google, Classroom, PIN, Clever); `/api/assets`; `POST /api/media` (teacher audio uploads); `POST /api/speaking/:taskId/submission`; `GET /api/recordings/:filename`. In production it also serves the built client, `/logo.svg` and the userscripts under `/tools`. An extension may mount its own token-authenticated routes beside these.
- One SQLite database. At boot the server applies any new migrations, switches on WAL mode, warms the conjugation engine, loads the stored settings, ensures the `All` group, connects the session store, then listens on port 6767.
- Sessions use `express-session`: a Redis-protocol store (valkey) in production, memory in development.

Extensions plug in through `packages/*/src/extensions/` (see `packages/server/src/extensions/README.md`). Core runs and passes its tests without any: an extension adds tRPC routers, fields on a few responses, page slots, Admin tabs, translations and its own migrations, through the hooks that README lists. `npm run typecheck:core` typechecks the code as it is with no extension.

## Quick start on macOS

You need Node 24 (what CI and the image use; Node 22.12 or later works) and npm. For Anki import you also need `unzip`, `zstd` and `sqlite3` on your PATH; macOS has `unzip` and `sqlite3`, and `brew install zstd` adds the third.

```bash
npm ci
cp .env.example .env
```

Edit `.env` before the first run:

- Set `ADMIN_EMAIL` to your Google address.
- Leave `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CLEVER_CLIENT_ID` and `CLEVER_CLIENT_SECRET` commented out to use `/setup`, or uncomment them and put real ones in. Any value there, even a placeholder, is stored in a new database and counts as configured, which skips `/setup` and breaks sign-in.
- Leave `SESSION_SECRET` empty in development if you like, and keep `REQUIRE_REDIS=false` to keep sessions in memory (a server restart then signs you out).

The server reads the `.env` at the repository root.

```bash
npm run dev
```

This builds `packages/shared`, then runs three watchers together: the shared build, the server on port 6767, and Vite on port 5173, which passes `/api` and `/auth` to the server. Open `http://localhost:5173`.

Google sign-in in development needs an OAuth client (enter it in `/setup` or in `.env`) with this redirect URI, plus the second one for Classroom import:

```text
http://localhost:6767/auth/google/callback
http://localhost:6767/auth/google/classroom/callback
```

In production the same paths sit on your own domain. The development database and files are in `packages/server/data/`, which git ignores.

## Configuration

Google, Clever and AI settings live in the database (the `app_settings` row). Their environment variables are read only once, to fill a new database; after that the environment is ignored. AI settings change in Admin > AI. A Google client can be entered in `/setup` only while none is stored. Clever credentials have no page in the app; only the admin tRPC procedures `admin.saveCleverCredentials` and `admin.clearCleverCredentials` change them.

Stored keys (the Google and Clever secrets, the AI keys) are encrypted with `APP_SETTINGS_ENCRYPTION_KEY`, or else `SESSION_SECRET`, or else a development key. Changing whichever of these is in use makes the stored keys unreadable, and the server then fails at boot. Back up the database first. There is no re-encryption tool. Either re-encrypt the secret columns yourself, or clear them with `sqlite3` (`google_client_secret`, `clever_client_secret`, `openai_api_key`, `elevenlabs_api_key`, `anthropic_api_key`), switch the key, and enter them again: the Google client in `/setup` (it reopens once the secret is gone, and anyone can reach it while it is open, so do it at once) and the AI keys in Admin > AI. Changing `SESSION_SECRET` also signs everyone out.

In production the app sees only the variables `docker-compose.jonerix.yml` lists under `environment:`. To use any other variable below, add it there.

Read from the environment at every start:

- `NODE_ENV`: `production` requires the session store, makes cookies Secure, serves the built client and refuses an empty or known placeholder secret.
- `PORT` (6767) and `DATABASE_URL` (`./data/flashcards.db`; a file path only).
- `SESSION_SECRET`: production needs a strong random value. An empty value or a known placeholder such as `change-me-in-production` stops the server at boot.
- `APP_SETTINGS_ENCRYPTION_KEY` (optional) and `ADMIN_EMAIL`.
- `REDIS_URL` and `REQUIRE_REDIS` (the session store).
- `TRUST_PROXY` (1 in production, off in development), `SESSION_COOKIE_SAMESITE` (`lax` or `none`), `SESSION_COOKIE_SECURE` (`false` turns it off).
- `FRONTEND_URL` (where sign-in sends the browser back to, in any mode), and, outside production only, `FRONTEND_PORT` (5173) and `ALLOWED_REDIRECT_HOSTS`.
- `VITE_ALLOWED_HOSTS` (development only, read by the Vite dev server): extra host names it answers to, comma-separated, for example when it sits behind a proxy at `FRONTEND_URL`. Empty (the default): only `localhost` and IP addresses.
- `CLEVER_AUTH_DISABLED`, `CLEVER_REDIRECT_URI`, `CLEVER_ROSTER_REDIRECT_URI`.
- `PIN_AUTO_SCHOOL_IPS`: the school network's public IP addresses, comma-separated, used by PIN sign-in's Auto mode. Empty (the default): in production, Auto mode never switches PIN sign-in on (the server logs a warning at boot, and Admin > Access says so while Auto is picked); On and Off still work.
- `USERSCRIPTS_DIR` (default `data/tools`), `LOG_LEVEL` (`debug` in development, `info` in production) and `ENABLE_LEGACY_MIGRATION_BACKFILL`.
- `LEGAL_*`: the operator's name and contacts for the legal pages (`/privacy`, `/terms`, `/subprocessors` and the rest) and `/.well-known/security.txt`. The pages are neutral defaults that say the operator has not published its own texts yet and state only what the software does and which AI features are on; the operator is responsible for its own privacy policy and terms, and publishes them through an extension (see `doc/legal-documents.md`). Unset, the pages say "[not yet stated]" and name nobody. `LOG_HASH_KEY` (optional) keys the one-way hashes the logs keep of PIN usernames and teachers' emails (else derived from `SESSION_SECRET`). `DELETION_LEDGER` (default `data/deletions.jsonl`): the record of deletions the deletion tool keeps; `DELETION_LEDGER_KEY` (optional) keys its email hashes (else a key file made beside the ledger on the first deletion; back it up with the ledger and never change it).

Read only to fill a new database:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CLEVER_CLIENT_ID`, `CLEVER_CLIENT_SECRET`.
- `AI_ENABLED` (false), `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `AI_TEXT_PROVIDER` (`openai` or `anthropic`).
- `AI_PRONUNCIATION_ENABLED`, `AI_IMAGE_ENABLED`, `AI_MNEMONIC_ENABLED` (all true).
- `AI_MNEMONIC_MODEL`, `AI_IMAGE_MODEL`, `AI_IMAGE_QUALITY`, `AI_TTS_MODEL`. Without them the code uses `gpt-4.1`, `gpt-image-1`, `low` and `gpt-4o-mini-tts`; `.env.example` and the compose file set `gpt-5.2` and `gpt-image-1.5` instead. The Claude model has no variable; it defaults to `claude-opus-5-5`.
- `AI_TTS_PROVIDER` (`openai` or `elevenlabs`), `ELEVENLABS_API_KEY`, `AI_TTS_VOICE_MAP` (JSON, accent to voice ID), `VOCAB_TTS_VOICE_ID`.

Kept only in the database, with no variable: the PIN mode, the allowlist, lab pause rules, the group, student and deck settings, and any extension's own settings.

## Tests

On a fresh clone, build `packages/shared` once before the unit tests.

```bash
npm run build -w @libresrs/shared
npm test                 # Vitest in all three packages
npm run lint             # ESLint 9 (eslint.config.cjs)
npm run typecheck        # builds shared, then tsc in server and client
npm run typecheck:core   # the same with every extension left out
```

Browser tests use Playwright. Install the browsers once:

```bash
npm run test:e2e:install
```

The main suite (`tests/e2e/`) runs against the Vite server on port 4173 with the API mocked, in five projects: `chromium`, `firefox`, `webkit`, `mobile-chrome` (Pixel 7) and `mobile-safari` (iPhone 14). Accessibility scans with axe-core run in `chromium` and `mobile-safari`. The Express headers and CSP are not part of this suite.

```bash
npm run test:e2e             # all five projects
npm run test:e2e:chromium
npm run test:e2e:desktop     # chromium, firefox, webkit
npm run test:e2e:mobile
npm run test:e2e:headed      # also :ui and :debug
```

The full-stack suite (`tests/e2e-fullstack/`) starts the real server with a fresh SQLite database behind Vite; only Google is replaced by a local fake. It uses Chromium, one worker, and ports 14173, 16767 and 16768. Set `E2E_FULLSTACK_SERVER_LOGS=1` to see the server's logs.

```bash
npm run test:e2e:fullstack   # or test:e2e:fullstack:headed
```

Things to know:

- Without `CI` set, Playwright reuses whatever already listens on port 4173 and does not retry. Free the port first instead of setting `CI=1`.
- Playwright's WebKit on a Mac uses the Mac's own audio capture, which can stop answering. Without `CI`, a recording test in `webkit` or `mobile-safari` skips itself when its microphone check fails; with `CI=1` it fails instead, and those failures are not regressions.
- `npm run lint` does not include the `jsx-a11y` rules. Accessibility is checked by the axe scans.
- If `npm` is not on your PATH, set `NPM_BIN` for the Vite server the mocked suite starts.

Tool tests:

```bash
node tools/vocabulometro-offline/tests/run.js
```

## Building and deploying

```bash
npm run build    # shared, then server (with build info), then client
```

Production runs two containers, wired by `docker-compose.jonerix.yml` (project name `libresrs-jonerix`):

- `app`, from `Dockerfile.jonerix`: Node 24 Alpine build stages and a jonerix runtime image (x86_64 only), pulled from GitHub's container registry and pinned by digest (`JONERIX_IMAGE`), with a smoke test of the SQLite driver at build time. It listens on 6767 and keeps its data in `/app/data`, a host folder set by `LIBRESRS_DATA_DIR` (default `./data/libresrs`).
- `valkey`, from `Dockerfile.valkey.jonerix`: the session store, with no volume and no published port.

The jonerix runtime and valkey keep the shipped runtime on permissive licenses. Containers log with Docker's default driver. Settings that belong to one host, such as sending logs to a GELF endpoint, go in an untracked compose override passed after the main file on every command (`-f docker-compose.jonerix.yml -f docker-compose.host.yml`; that name is git-ignored).

```bash
GIT_COMMIT=$(git rev-parse --short HEAD) \
  docker compose -p libresrs-jonerix -f docker-compose.jonerix.yml up -d --build
```

To deploy an image built elsewhere: build it with `GIT_COMMIT` and `GIT_TAG` set, move it with `docker save` and `docker load`, back up the data folder (see "Data, migrations and backups"), then run `docker compose -p libresrs-jonerix -f docker-compose.jonerix.yml up -d --no-deps --no-build app` (the app only: recreating valkey signs everyone out) and wait for `/healthz` to report the new version.

The build installs packages with `npm ci` from the registry. It can install from `vendor/npm-cache` instead (`USE_VENDORED_ASSETS=true`), but this repository ships that cache empty: run `scripts/vendor-node-deps.sh` to fill it before using that path or `npm run install:offline`. `Dockerfile.jonerix` copies the folder, so keep it.

## Release flow and CI

1. Work on a `feat/*` or `fix/*` branch and open a pull request.
2. Raise the version in all four `package.json` files (the root and `packages/client`, `server`, `shared`).
3. Merge into `main` when CI passes (a maintainer may stage a release on a `dev` branch first).
4. Tag the merge commit `vX.Y.Z` and push the tag.
5. Build and deploy the image (see above).

Bug fixes raise the patch number (1.22.1), new features the minor number (1.23.0; it can go past 9). 2.0 is kept for a complete rewrite.

CI (GitHub Actions) is `.github/workflows/ci.yml`: on pushes to `main` and on every pull request, `npm ci` from the registry, lint, typecheck, unit tests and the build on Node 24. It does not run the browser suites. `.github/workflows/cla.yml` runs the Contributor License Agreement check on pull requests (see "License and copyright" below).

Release assets, a runtime tarball (`libresrs-runtime.tar.gz` and its `.sha256`) and an install script (`libresrs-install.sh`), are built by `scripts/build-runtime-bundle.sh` and `scripts/render-installer.sh`.

No test runs the install script. It needs `curl`, `tar`, `node` and `npm`, installs into `~/.local/libresrs` (or `--prefix <path>`), sets `REDIS_URL` to `redis://127.0.0.1:6379` (run a Redis-protocol server there), and with `--service` sets up a systemd or launchd service. For a release that carries it:

```bash
curl -fsSL https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/libresrs-install.sh | sh -s -- --prefix <path> --service
```

## Userscripts

A browser userscript kept at `tools/<folder>/<name>.user.js` is served at `/tools/<folder>/<name>.user.js` and updates itself from there (its `@updateURL`). This repository ships none.

A browser extension installs an update only when `@version` goes up. So after a change, raise `@version` and run:

```bash
npm run userscripts:stamp
```

It copies each script to `packages/client/public/tools/<folder>/` (the copy the image serves) and records its version and SHA-256 in `tools/<folder>/stamp.json`. It refuses a changed script whose version did not go up, and `packages/client/src/userscripts.test.ts` fails while a script, its served copy and its record disagree. With no userscripts it does nothing. The server serves whichever copy has the higher `@version`: the built-in one or the one in `USERSCRIPTS_DIR` on the host, so a newer script can go live without a release. `npm run userscripts:publish` hands the scripts to a publisher where the tree has one; this one has none, so it says so and stops.

## Data, migrations and backups

Everything lives in one data folder (`/app/data` in the image, `packages/server/data/` in development):

- `flashcards.db`, with its `-wal` and `-shm` files.
- `assets/`: the public asset store (course audio, generated speech and pictures, the Vocabulómetro audio bank). The app never deletes from it.
- `recordings/`: students' speaking recordings (private).
- `tools/`: userscripts published without a release.

Back up the database with SQLite's `.backup` command, never a plain copy of a live WAL database, and back up `assets/` and `recordings/` as well:

```bash
sqlite3 data/flashcards.db ".backup 'flashcards-backup.db'"
```

Sessions are only in valkey, which has no volume. Recreating the valkey container (for example after rebuilding it) signs everyone out, which is why the deploy recreates only the app.

Migrations are SQL files in `packages/server/drizzle/`, applied at boot (or with `npm run db:migrate`). An extension's own migrations live in `packages/server/drizzle/extensions/<id>/`, with their own ledger table, and run after the core ones (`packages/server/src/db/runMigrations.ts`). They are written by hand: the snapshots in `drizzle/meta/` stop at 0027, so do not commit what `npm run db:generate` writes. A new migration needs the SQL file, its entry in `drizzle/meta/_journal.json`, the change in `packages/server/src/db/schema.ts`, and the same change in the hand-written test schema `packages/server/src/testUtils/fsrsTestDb.ts`. The steps are in `packages/server/drizzle/README.md`, and the server tests migrate a fresh database. Columns kept only for rollback are listed in `packages/server/drizzle/DEPRECATED.md`.

## Security notes

- Every response carries `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Permitted-Cross-Domain-Policies` and a Content-Security-Policy, plus HSTS when cookies are Secure. The CSP is written by hand in `packages/server/src/index.ts`, and `packages/server/src/middleware/security-headers.test.ts` repeats it: a new media source, worker or outside host needs both changed, or browsers refuse it.
- Rate limits are per address and sized for a whole school behind one address: `/auth` 600 per 15 minutes, `/api/trpc` 3,000 per minute, saving setup credentials 10 per 15 minutes, audio uploads and playback 600 per minute.
- Sessions use a 7-day HttpOnly cookie, Secure in production.
- The request log keeps no referrer and no query string on sign-in addresses (`/auth/*`); a URL whose query holds an email address is logged without it. Reporting a vulnerability: `SECURITY.md`.
- A review can only change the reviewing user's own card state (`packages/server/src/services/fsrs_security.test.ts`).

## Background

The mnemonic feature builds on the author's classroom study: Storm, Jon-Erik G. (2021), "Spanish Vocabulary Acquisition by English Speakers Using Spaced-Repetition Algorithms and Mnemonics", [Journal of Teacher Action Research](https://practicalteacherresearch.com) 7(3), ISSN 2332-2233. With spaced repetition alone, students did 21% better on words spelled like their English counterparts than on other words; after brief mnemonic lessons for the other words, the experimental group improved significantly and the control group did not. The article's record is on [EBSCO](https://openurl.ebsco.com/EPDB%3Agcd%3A8%3A21556888/detailv2?sid=ebsco%3Aplink%3Ascholar&id=ebsco%3Agcd%3A152478652&crl=f).

## Repository layout

```text
packages/client/        React app
packages/server/        Express + tRPC server; drizzle/ holds the migrations
packages/shared/        FSRS helpers, conjugation engine, types
tests/e2e/              Playwright suite with the API mocked
tests/e2e-fullstack/    Playwright suite with the real server
tools/                  the offline Vocabulómetro (and any userscripts)
doc/                    sample decks
scripts/                userscript, build-info, installer and vendoring scripts
.github/workflows/      CI and the CLA check (GitHub Actions)
vendor/npm-cache/       offline npm cache, copied by Dockerfile.jonerix (keep the folder)
patched-deps/           a patched dev dependency (@esbuild-kit/core-utils)
Dockerfile.jonerix, Dockerfile.valkey.jonerix, docker-compose.jonerix.yml
                        the production images and compose file
```

## More documentation

- `packages/server/drizzle/README.md`: migrations.
- `packages/server/drizzle/DEPRECATED.md`: columns kept for rollback.
- `packages/server/src/extensions/README.md`: how an extension plugs in, and its rules.
- `doc/legal-documents.md`: the legal pages, the `LEGAL_*` values an operator sets, how to publish your own pages, and the deletion tool.
- `SECURITY.md`: reporting a vulnerability.
- `tools/vocabulometro-offline/README.md`: the single-file offline Vocabulómetro.
- `THIRD_PARTY.md`: the word-frequency data's source and license, and which media are AI-generated.
- Sample decks: `doc/spanish-100.csv`, `doc/hebrew-100.csv`.

## License and copyright

Copyright 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE. See `COPYRIGHT.md`.

libreSRS is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version (`AGPL-3.0-or-later`; the license text is in `LICENSE`). The word-frequency data is under CC BY-SA 4.0; see `THIRD_PARTY.md`.

Contributions are welcome under the Contributor License Agreement in `CLA.md`. On your first pull request the CLA Assistant Lite check asks you to sign it: reply to the pull request with the comment `I have read the CLA Document and I hereby sign the CLA`. Your signature is recorded on the repository's `cla-signatures` branch and covers your later pull requests too. If you contribute on behalf of an employer, contact info@libresrs.org first.

## Contact

support@libresrs.org
