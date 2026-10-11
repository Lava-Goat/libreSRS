# Legal pages: privacy policy, terms and the rest

libreSRS serves five legal pages and a security contact file:

| Address | Page |
|---|---|
| `/privacy` | Privacy Policy |
| `/privacy/summary` | Privacy summary, for students and families |
| `/privacy/coppa-notice` | Notice to schools about children's privacy |
| `/terms` | Terms of Service |
| `/subprocessors` | Where data is stored |
| `/.well-known/security.txt` | The security contact ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)), once one is set |

**Whoever runs a copy of libreSRS (the operator) is responsible for that site's privacy policy
and terms, and should publish its own.** The software cannot know who you are, what your
agreements with schools say, where your server is or who can reach it, so it does not write those
pages for you.

## What the software ships: neutral defaults

Until you publish your own texts, each page shows a short default
(`packages/server/src/legal/defaults/*.md`, copied to `dist/legal/defaults/` by the build). Each
default says, at the top, that the operator has not published its own page yet, and makes no
promise on the operator's behalf. Beyond your name and contacts (below), it states only what the
software itself does as it is distributed, and what the site's settings show right now:

- that the software has no advertising, analytics or tracking built in, and that its pages load
  scripts only from the site itself;
- that API keys and sign-in secrets saved in the admin settings are stored encrypted in the
  database;
- **the AI features on this site right now** (Privacy Policy, `/privacy#AI-Policy`; the older
  `/privacy#ai` lands there too) and **the AI providers right now** (`/subprocessors`): tables
  read from the AI settings (Admin > AI) on every page load
  (`packages/server/src/services/legal/aiDisclosure.ts`), each feature with its switch, its
  provider, what it sends and whether that is student data, and one sentence the settings make
  true (no AI feature that sends student data is on; or the one that does, the "repeat the
  sentence" transcription, is on);
- what an extension says about its own data flows (below).

The pages keep the addresses the app links to: `/privacy#AI-Policy`, `/privacy#ai`,
`/privacy#security` (named by security.txt), `/privacy#changes` and `/terms#aup` (the sign-in
page's "Rules for using the site").

## Your name and contacts

Each value is an environment variable on the server. With Docker Compose, put them under
`environment:` in your untracked host override (`docker-compose.host.yml`), not in a tracked
file; write a literal `$` as `$$` there (Compose interpolates `$`). Values may use Markdown.
Restart the app after a change. Where a value is needed and not set, the page shows
"[not yet stated]" and a notice that the operator has not filled it in.

| Variable | What to write | When unset |
|---|---|---|
| `LEGAL_OPERATOR_LEGAL_NAME` | Legal name of the operating entity, e.g. "Example Learning, Inc.". | "[not yet stated]" |
| `LEGAL_OPERATOR_SHORT_NAME` | The name the operator does business as. | left out |
| `LEGAL_SERVICE_DOMAIN` | The site's domain (defaults to the host of `FRONTEND_URL`). | left out |
| `LEGAL_SUPPORT_EMAIL` | General contact address. | "[not yet stated]" |
| `LEGAL_PRIVACY_EMAIL` | Privacy contact. | `LEGAL_SUPPORT_EMAIL` |
| `LEGAL_SECURITY_EMAIL` | Security contact; also the Contact line of `/.well-known/security.txt`. | `LEGAL_SUPPORT_EMAIL` |
| `LEGAL_OPERATOR_POSTAL_ADDRESS` | Postal contact address. | "[not yet stated]" |
| `LEGAL_OPERATOR_PHONE` | Contact telephone number. | "[not yet stated]" |
| `LEGAL_SOURCE_URL` | Public repository of the source code your site runs. | left out |

## Publishing your own pages

Your own texts go in an extension (`packages/server/src/extensions/README.md`): its
`legalDocuments` (`LegalDocumentSet` in `packages/server/src/extensions/api.ts`) gives a Markdown
template for each page you replace; a page you leave out keeps the default. Your templates use
the same syntax as the defaults (`packages/server/src/services/legal/render.ts`):

- `{{name}}` is a value, `{{?name|text}}` text only when it has one, `{{!name|text}}` only when
  it has none; a line a conditional empties is dropped, so a conditional table row leaves no gap;
- `{{include: privacy-summary.md}}` is another page's body (yours, else the default), its title
  dropped and its headings one level down;
- front matter (`title`, `version`, `lang`) sits between `---` lines on top;
- tables take a `<caption>…</caption>` line just before them, and headings an id
  (`## Security {#security}`, or `{#AI-Policy #ai}` for two).

Every value above is there, and so are the code's own: the AI tables and sentences
(`ai_features_table`, `ai_providers_table`, `ai_no_student_data`, `ai_student_audio`,
`ai_settings_unknown`, `ai_safety_check`), `security_txt_statement` (once a security contact is
set), `clever_disabled`, and what extensions disclose (`extension_disclosures`,
`instance_specific_disclosures`, `instance_disclosures_short`, `planned_changes_instance`,
`instance_subprocessor_rows`, `instance_subprocessor_sections`, `privacy_prior_versions`,
`terms_prior_versions`). For facts of your own, the set declares
`fields` (each read from `LEGAL_<KEY IN CAPITALS>`, with what it shows when unset) and may work
out a few `computed` values from them. A prior version of a page (`/privacy/<slug>`,
`/terms/<slug>`) is a `priorVersions` entry of the extension's `privacy`.

An extension whose data leaves the server must say so in its `privacy` (`PrivacyDisclosures`):
the default policy shows those blocks under "Extensions on this site" (`/privacy#instance`).

## Related switches and tools

- **Speech transcription** (Admin > AI): the Vocabulómetro "repeat the sentence" test sends each
  recording to OpenAI to be transcribed. It has its own switch, off on a new install, and needs
  AI as a whole on. The test tells the student, before recording, that the recording is sent to
  OpenAI and is not saved.
- **Deleting a student's data**:
  `node packages/server/dist/db/deleteUser.js --email <address> --request "<the request>" --by "<who>" [--dry-run]`
  deletes the account, every row that goes with it and its recordings, prints a receipt and
  appends it to the deletion ledger (`data/deletions.jsonl`, or `DELETION_LEDGER`). The ledger
  keeps the account's numeric ID and a keyed hash of its email (never the email); its key is
  `DELETION_LEDGER_KEY`, or else `deletions.jsonl.key` beside the ledger, made on the first
  deletion. Back the key up with the ledger and never change it. After restoring a database
  snapshot, `--replay --by "<who>"` deletes again every account the ledger names. A restore must
  never replace the ledger with an older copy: it is what the restore re-applies.
- **Logs**: sign-in addresses are logged without their query string, PIN usernames and teachers'
  emails only as a keyed hash (`LOG_HASH_KEY`, else derived from `SESSION_SECRET`), and each
  transcription as one `ai.transcription` line (user, test, duration, outcome).
