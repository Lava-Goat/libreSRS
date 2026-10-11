# Vocabulómetro — standalone offline variant

`vocabulometro.html` is the single-file, no-login, no-server build of the Vocabulómetro:
six modes (size, mastery, listen, c500, a500, s5000) sharing the same corpus, estimators, and
`VNHS1.` result-code format as the deployed app at `/vocabulometro`. Open it from `file://` on
any machine; students hand the result code to the teacher (or submit via the optional Google
Form block at the top of the file). The deployed app has five more modes (listen2, dictado,
ctest, ldt, ei); they are not in this file.

The React/server implementation in `packages/client/src/vocab/` + `packages/server/src/routers/vocab.ts`
was originally ported from this file's lineage; when fixing estimator or protocol logic, fix BOTH
and keep `tests/` (this dir, plain node: `node tests/run.js`) and the vitest suites in sync.

To brand the header for a school or class, fill in the `MASTHEAD` constant next to the `GFORM`
block in the script (a school name, and a badge such as the school year); both are empty by default.
