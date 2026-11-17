# eve authored module cache race

Reproduction for [vercel/eve#6566](https://github.com/vercel/eve/issues/6566): parallel `eve` processes can import an authored module cache file that another process is still writing.

## The bug

eve bundles each authored module (eval files, `evals.config.ts`, agent tools, ...) to `node_modules/.cache/eve/authored-modules/<sha1>.mjs` and imports it from there. Every process that loads the same module writes the same path.

When the cache file doesn't exist yet, `writeAuthoredModuleCacheFile` writes it in place with `writeFileSync(filePath, code)`. A second process that checks the same path in the meantime finds the file (its `utimesSync` succeeds), skips the write and imports it while it is still empty or partly written.

**Cause in one line:** the ENOENT branch of `writeAuthoredModuleCacheFile` (`packages/eve/src/internal/authored-module-cache.ts`) writes the final path directly instead of writing a temp file and renaming it, as `replaceFile` already does.

## Run it

Needs Node 24 and no model or API key.

```sh
npm install
npm run repro
```

Each round clears `node_modules/.cache/eve/authored-modules`, then starts 4 `eve eval --list` processes at once. `eve eval --list` is eve's public CLI: it discovers and imports every `evals/**/*.eval.ts` file, the same loading path `eve eval <id>` takes before it starts the agent server, but it never calls a model. The 8 evals all import one large generated fixture (`evals/fixtures/rows.ts`, 8 MB, written by the script), so each cache file is big enough that its write is a window another process can land in.

Tune it with environment variables: `ROUNDS` (default 30), `PROCESSES` (default 4), `FIXTURE_MB` (default 8). On the machine below, more processes lowered the rate: they fall out of step on a busy CPU.

## Expected output on eve 1.0.2

On an Apple Silicon Mac (12 cores, APFS, Node 24.22), a run takes about 20 seconds:

```text
round  1: 0/4 processes imported a half-written module
round  2: 0/4 processes imported a half-written module
round  3: 1/4 processes imported a half-written module
...

Sample errors:
  [round 3] Eval file "evals/case-01.eval.ts" does not export a valid EveEval (or array of EveEvals) as its default export. Use defineEval() to create the eval.
  ...

Failed in 12 of 30 rounds; 20 of 120 processes imported a half-written module.
```

Three runs in a row: 12, 13 and 13 of 30 rounds failed (38 of 90 rounds, 60 of 360 processes). The script exits 1 when any process imported a half-written module.

On macOS (APFS) a reader sees the file either empty or whole, so the error is always `does not export a valid EveEval`: the empty module imports fine and has no default export. On Linux a reader can also see a truncated file, which gives `Unexpected end of input` instead.

## The fix, checked locally

Changing the ENOENT branch in the installed `node_modules/eve/dist/src/internal/authored-module-cache.js` to write `${filePath}.${randomUUID()}.tmp` and `renameSync` it onto `filePath` (rethrowing after removing the temp file on failure) takes the failures to zero: 0 of 90 rounds with 4 processes, and 0 of 90 rounds with 8. That patch isn't part of this repo.
