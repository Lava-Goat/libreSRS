# Third-party data and generated media

The libreSRS code is licensed under the GNU AGPL, version 3 or later (see `COPYRIGHT.md`). The items below come from elsewhere, or were made with outside tools, and keep their own terms. npm dependencies carry their own licenses in `node_modules/` and `package-lock.json`.

## Spanish word-frequency data

- **Files:** `packages/client/src/vocab/datasets/vocabData.json` (frequency bands, band token mass and the word lists drawn from them) and `packages/client/src/vocab/datasets/listenFormA.json`; the same data is embedded in `tools/vocabulometro-offline/vocabulometro.html`.
- **Source:** the Spanish word frequencies of the OpenSubtitles 2018 corpus (413 million tokens), filtered against a dictionary. Subtitle data from [OpenSubtitles.org](https://www.opensubtitles.org/); frequency list from Hermit Dave's [FrequencyWords](https://github.com/hermitdave/FrequencyWords), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **License of the derived data:** as an adaptation of a CC BY-SA 4.0 work, the frequency data in these files is distributed under CC BY-SA 4.0, not the AGPL. The changes: words not in the dictionary were dropped, the list was cut into five bands (1–500 to 3,001–5,000), and items, pseudowords and glosses were added for the tests.

## Generated media

- **Mascot:** `packages/client/public/mascot.png` was generated with OpenAI's GPT-4o in ChatGPT, as its embedded C2PA content credentials record.
- **Listening clips:** the 52 fixed clips of the Vocabulómetro `listen` mode (`packages/client/src/vocab/datasets/listenAudio.json`, also embedded in the offline file) are AI-generated speech. The repository does not record which service generated them.
- Audio and pictures that a running server generates (pronunciation, the Vocabulómetro audio bank, card pictures) are not part of the repository. They come from whichever providers the operator configures (OpenAI, ElevenLabs), under those providers' terms.

## Patched dependency

- `patched-deps/esbuild-kit-core-utils` is a patched copy of `@esbuild-kit/core-utils` by Hiroki Osame, under the MIT License; its `LICENSE` file is kept beside it.
