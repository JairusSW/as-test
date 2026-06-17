# Change Log

## 2026-06-10 - v1.7.1

### Fix Node 22 segfault when a WASI spec streams a large report

- fix: the `node:wasi` runner (`lib/src/index.ts`) now wraps every `wasiImport` entry in a plain JS pass-through before handing them to the wasm instance, instead of passing the native bindings directly. On Node 22, V8 can take a fast wasm→native call path straight into the `node:wasi` native `fd_write` that **segfaults** under a large write burst — e.g. a spec whose report is a few MB streamed over stdout (fuzz/property suites). The crash surfaced as a runner exit 139 with the harness reporting `missing report:end marker for chunked report payload` (`dataFrames=0`), since the child died mid-report. Interposing a JS function forces the safe call path; the indirection is negligible and the fix is Node-version agnostic. Node 24 was unaffected. Wrapping `fd_write` alone is sufficient, but all imports are wrapped to defend against the same fast-call miscompilation elsewhere.

## 2026-06-09 - v1.7.0

### Output is fully built-in — the pluggable reporter layer and TAP are gone

- **breaking**: removed the pluggable reporter system entirely. There is no longer a `TestReporter` interface, custom-reporter loading, a `--reporter` flag, or a `runOptions.reporter` config field. Output is now produced by a single built-in renderer. Nobody was using custom reporters; the indirection (a per-spec reporter selection/loader plus the parallel paths' per-spec buffered reporter instances) only made the run pipeline harder to follow.
- **breaking**: removed the TAP reporter and everything specific to it — the `--tap` flag, TAP v13 output, `.tap` artifact files, the `report.tap`/`outDir`/`outFile` config, and the GitHub Actions `::error` annotations. CI here never invoked `--tap` (`test:ci` runs across modes), so nothing in-repo changed; downstream users who relied on TAP output should pin `1.6.x`.
- refactor: `cli/reporters/` became `cli/render/`. `DefaultReporter` is now the concrete, non-pluggable `TestRenderer` (`cli/render/renderer.ts`); its event-payload types stay in `cli/render/types.ts` (with `ReporterContext` renamed `RenderContext`). `cli/reporters/tap.ts` and the unused `cli/reporter.ts` re-export were deleted. The reporter loader in `run-core.ts` (`createRunReporter`/`loadReporter`/`resolveReporterSelection`/`parseReporterConfig`/`resolveReporterFactory`) collapsed to one synchronous `createRenderer()` that just constructs a `TestRenderer` and resolves the mode-aware runtime name.
- refactor: the parallel matrix paths previously passed an empty `{}` "silent reporter"; that relied on every hook being optional. With the renderer's methods now concrete, a small `SilentRenderer` (no-op subclass) takes its place. The `reporterKind == "default"` gates that gated live/queue rendering for the default reporter are now unconditional (TTY-gated only), since the built-in renderer is the only one.
- fix: removed the `tapMode` stdout→stderr redirection in `runProcess`/`runWebSessionProcess`. It existed so spec `console.log` wouldn't corrupt the machine-readable TAP stream on stdout; with TAP gone, spec passthrough output always goes to stdout.

## 2026-06-09 - v1.6.1

### Parallel results print as each spec finishes

- fix: under `--parallel`, per-file result lines now print on a first-come-first-serve basis — each spec's output is emitted the moment it completes, in completion order, instead of being held back to match resolution order. v1.6.0 made `ParallelQueueDisplay` (`cli/index.ts`) buffer every completed spec keyed by a start sequence and flush only the contiguous prefix; that meant a slow first-resolved spec kept every faster spec stuck on its grey `....` line until the slow one finished, then dumped the whole backlog at once. Removed the ordering machinery (`seqByToken`/`nextSeq`/`nextFlushSeq`/`pending`/`flushOrdered`), so `complete()` clears the live block, writes the finished spec's output immediately, and re-renders the remaining in-flight lines. This reverses the resolved-order behavior introduced in v1.6.0.

## 2026-06-01 - v1.6.0

### Incremental test cache — only rebuild and rerun what changed

- feat: an opt-in incremental cache for `ast test` skips recompiling and rerunning specs whose inputs are unchanged since the last run, only acting on the ones that changed — themselves or via their dependency tree. Enable per run with `--cache`, or persistently with `"cache": true | "build" | "full"` in `as-test.config.json` (`--no-cache` overrides). Default is off. Because asc compilation is ~all of a run's wall-clock (a spec runs in microseconds but builds in seconds), skipping unchanged builds is the dominant win. New module `cli/build-cache.ts` persists a manifest under `.as-test/cache/`.
- feat: **Tier 1 (build cache)** — `build()` (`cli/commands/build-core.ts`) and the parallel `buildFileForMode` (`cli/index.ts`) skip the asc invocation when a spec, every file it imported, and the build signature (`getBuildReuseInfo`) are all unchanged and the `.wasm` still exists. Dependencies are captured from asc's actual file reads (reusing the existing `buildRecorderStorage`/`onReads` plumbing that previously only fed `--watch`), so editing a shared helper correctly rebuilds just its dependents. The cache context is threaded once via an `AsyncLocalStorage` (`cacheStorage`) set in `runTestModes`, so no per-variant plumbing was needed and `--watch` (which keeps its own in-memory graph) is untouched.
- feat: **Tier 2 (run replay)** — under `"full"`/`--cache`, `run()` (`cli/commands/run-core.ts`) replays a stored passing report instead of spawning the runtime, so cached specs still appear in the live output and in the summary/coverage. Replayed specs keep the coloured verdict badge (white text) but render the **filename dimmed with a `(cache)` tag in place of the timing**, so freshly-run specs stand out — in both the default reporter (`cli/reporters/default.ts`) and the multi-mode matrix display (`formatMatrixFileResultLine`). Only passing reports are replayed; a failing spec re-runs for fresh output. A rebuild clears the stored report, so a changed spec never replays a stale result.
- feat: change detection uses a content hash (sha256) with an mtime+size fast-path — correct across `git checkout`/`clone`/`touch` (no false rebuilds) yet cheap when nothing changed. The whole cache is invalidated when the as-test version changes (transform output may differ); replay additionally keys on the runtime command and snapshot file contents. The build signature hashes only as-test's _declared_ env (config + `buildOptions.env` + the `AS_TEST_*` flags), not the inherited `process.env`, so volatile ambient vars like `FORCE_COLOR`/`TERM`/`CI` can't spuriously invalidate the cache between runs.
- note: a reachability-based dep-pruning mode (`cache: "reachable"`) was prototyped but **not shipped** — it was unsound for AssemblyScript's compile-time inlining (inlined `const`s, `static readonly` fields, `@inline` bodies, and re-export barrels can change a spec's output without being "reachable"), so it could serve a stale pass. `"reachable"` is accepted as a deprecated alias for `"full"`, which tracks the complete dependency set and is always correct.
- feat: the run summary gains a **`Cache:` line** (between `Modes:` and `Time:`), rendered in the same aligned three-column layout as the other totals — e.g. `Cache:   46 cached,  0 skipped,  46 total` (counted per file/mode execution; `skipped` = ran fresh). It only appears when the cache is active — each report carries a `cached` flag (true = replayed, false = freshly run) that the default reporter tallies in `onRunComplete`.
- feat: **time-based expiry** via the object config form — `"cache": { "type": "full", "maxTime": "1h" }`. `maxTime` accepts `ms`/`s`/`m`/`h`/`d` durations; an entry built longer ago than that is treated as stale and rebuilt+rerun (which resets its timer). `type` selects the tier (`build`/`full`); the bare boolean/string forms still work. Parsed by `parseDurationMs`, resolved by `resolveCacheSettings` (`cli/util.ts`), enforced per-entry in `BuildCache.isBuildFresh` against a `builtAt` timestamp.
- fix: the cache is now honored under `--watch` — previously `--cache --watch` silently ignored the cache (watch only set up its own in-memory dependency graph), so every watch run rebuilt from scratch. Each watch iteration now runs inside the cache context (a fresh load per run so `maxTime` stays current), making the initial watch run and `a` (re-run all) replay unchanged specs. `build()`'s read-recorder forwards to the watch graph recorder so both stay correct together; entry-pruning is skipped under watch (scoped re-runs resolve only a subset). A new **`c` keybinding toggles the cache** live; toggling `c` (and `w`) now rewrites the watch footer in place — `c = cache (on/off)` — instead of appending a message + a fresh footer each time.
- feat: the cache is bypassed automatically when it cannot be trusted — `--fuzz` (non-deterministic), a custom build command, and (for replay only) `--create-snapshots`/`--overwrite-snapshots`. `ast clean` removes `.as-test/cache`.
- fix: under `--parallel`, per-file result lines are now emitted in resolved order (the `localeCompare` sort `resolveSpecFiles` applies after globbing) instead of completion order. Previously a cache replay finished instantly and printed ahead of still-running fresh specs, scrambling the list; `ParallelQueueDisplay` now buffers completed output and flushes the contiguous prefix in start order, so cached and freshly-run specs stay interleaved in their original order.
- chore: the cache manifest and per-spec reports under `.as-test/cache/` are gzipped (`manifest.json.gz`, `reports/*.json.gz`) — they're large, repetitive JSON dominated by coverage points, so this shrinks the cache directory ~10× (≈8 MB → ≈0.8 MB on as-test's own suite) at negligible read/write cost.

## 2026-06-01 - v1.5.3

### A file with no runnable tests is skipped, not crashed

- fix: a spec file whose only suites are skip variants (`xdescribe`/`xtest`/`xit`) is now reported as **SKIP** instead of failing with `missing report payload from test runtime`. The transform's auto-`run()` injection keys off `analyzeSourceText` → `hasSuiteCalls` (`transform/src/index.ts`), whose regex was `\b(?:describe|test|it|only|xonly|todo|fuzz|xfuzz)`. `\bdescribe` can't match `xdescribe(` — `x` and `d` are both word chars, so there's no word boundary — and likewise `\btest`/`\bit` miss `xtest`/`xit`. A file whose only suites were skipped therefore reported `hasSuiteCalls = false`, `run()` was never injected, the wasm emitted no lifecycle frames and exited `0`, and the CLI read that silent-but-clean exit as a runtime crash. The regex now matches the `x?` variants (`x?describe|x?test|x?it|x?only|todo|x?fuzz`), so `run()` is injected and the file reports itself skipped (with the suite shown and counted). `looksLikeAsTestImport` got the same `x?` treatment so a file importing _only_ an x-variant still resolves its `run` import path.
- feat: a spec file with no suites at all (empty, or only imports/comments) is now reported as a skipped file with a `… contains no tests; marked as skipped` warning, instead of `missing report payload`. Such a file never injects `run()` either, so `runProcess` (`cli/commands/run-core.ts`) now treats a clean exit (`code 0`) with zero data frames, no `file-start`/`file-end` events, no suite starts, and no stderr as an empty test file — returning a skip report (`createEmptyFileSkipReport`, `suites: []` so it counts as one skipped file and zero skipped suites) rather than a crash. A file that _does_ have suites always emits `file-start` before anything can go wrong, so this only ever fires for genuinely empty files.

## 2026-06-01 - v1.5.2

### Selectors resolve folders, files, and globs consistently

- feat: positional selectors for `ast test`/`ast run`/`ast build` now resolve through a single shared resolver (`cli/selectors.ts:resolveSpecFiles`), replacing three drifting private copies of `resolveInputPatterns` (in `build-core`, `run-core`, and `index`). Three input shapes are supported:
  - **Bare folders/files/globs** (no leading `./`) resolve against the configured input root(s) — the static prefix of each `input` glob, e.g. `assembly/__tests__` — searched recursively, and fall back to the cwd only if nothing matched there: `ast test rfc/` → `<root>/**/rfc/**/*.spec.ts`; `ast test foo` → `<root>/**/foo.spec.ts`; `ast test 'rfc/*.spec.ts'` → `<root>/**/rfc/*.spec.ts` (the user's glob appended verbatim). A bare path shorthand like `nested/array` is tried as a cwd path first, then anchored to the test folder.
  - **`./`-prefixed** selectors (and absolute / `~` paths) are cwd-relative only; on a miss we emit a `did you mean "rfc/*.spec.ts"` hint pointing at the test-folder form when that would have matched.
- feat: a bare selector that matches under more than one configured input root is flagged with a `WARN` (it still runs everything that matched), and a selector that matches nothing emits a `WARN` naming where it looked. Warnings are deduped by text across the orchestrator + per-file build/run passes (`emitSelectorWarnings`), so each prints once per invocation. Folder selectors (`rfc/`) and `,`-joined bare names (`a,b`) are recognized; selectors with an internal path separator (e.g. the orchestrator's own `assembly/__tests__/foo.spec.ts`) are still treated as direct cwd paths, preserving existing per-file dispatch.

## 2026-05-30 - v1.5.1

### An early-exiting runtime now fails instead of warning

- fix: when the runtime never delivers its final report payload, the CLI reconstructs a result from the streamed lifecycle events (`synthesizeReportFromRuntimeEvents`). Previously this always emitted a `WARN` and returned the reconstruction, only escalating to a `FAIL` if the child exited non-zero or wrote to stderr — so a spec that trapped/exited early with exit code `0` and no stderr came back as a passing reconstruction (the `runtime report payload missing; reconstructed result from streamed lifecycle events` warning storm). Both `runProcess` (WASI/bindings) and `runWebSessionProcess` (web) now treat `!runtimeEvents.sawFileEnd` — the runtime never emitted `event:file-end`, i.e. it exited before the file finished — as a failure: `appendRuntimeFailureReport` with a persisted crash record and a `test runtime exited before completing the test file` message, no misleading `WARN`. A run that _did_ reach `file-end` but simply failed to flush the final report frame is still the recoverable case (`WARN` + reconstructed result). This also closes a gap in the web path, which previously never escalated to a failure in the synthesized branch — it only warned, even on a non-zero exit.

### esm bindings now run

- fix: `instantiateEsmInstance` (`lib/src/index.ts`) now calls `patchNodeIo()` before importing the bindings helper. An esm helper auto-instantiates at import time and writes the WIPC report by calling the global `process.stdout.write(ArrayBuffer)` directly. `patchNodeIo()` — which teaches `process.stdout.write`/`process.stdin.read` to accept a raw `ArrayBuffer` and route it through `fs.writeSync` — was only wired into the raw path (via `withNodeIo`), never the esm path. So under esm bindings Node threw `ERR_INVALID_ARG_TYPE` ("chunk must be of type string or Buffer…, received an instance of ArrayBuffer") before any report was emitted, and the run crashed with `missing report payload from test runtime`. The patch is now in place by the time the helper instantiates.

### `--bindings` is respected instead of overridden

- feat: as-test no longer forces `--bindings raw` when you've already declared bindings yourself. `getDefaultBuildArgs` (`cli/commands/build-core.ts`) now takes a `bindingsAlreadyConfigured` flag and only appends `--bindings raw` when neither `buildOptions.args` nor a referenced asconfig declares `--bindings`. The other bindings flags (`AS_TEST_BINDINGS=1`, `--exportRuntime`, `--exportStart _start`) are still always injected. Two new detectors back this: `argsDeclareBindings(args)` (scans for `--bindings`/`--bindings=`) and `asconfigDeclaresBindings(configPath)` (reads `options.bindings`, follows `extends`), mirroring the existing try-as detection. Previously `--bindings esm` in `buildOptions.args` was combined with the forced `--bindings raw`, so `asc` emitted glue for **both** styles into one file; the runtime then mis-detected the kind and crashed. With this, `--bindings esm` produces esm-only glue and runs.

### Mocking works on every runtime

- change: `mock.spec.ts` is split into `mock.spec.ts` (mocking + `unmockFn` only) and `unmock.spec.ts` (the `unmockImport` cases). The split tracks the real esm/standalone-WASI boundary: the transform removes a `@external` import from the wasm when it is **only ever mocked**, but keeps it (for fall-back) when it is `unmockImport`'d anywhere. A pure-mock spec therefore imports nothing virtual and runs on **every** runtime — verified via `WebAssembly.Module.imports()`: the pure-mock wasi build imports only `wasi_snapshot_preview1`, while the unmock build imports `mock.foo`. `unmockFn` (function mocks) does not retain an import; only `unmockImport` does.
- feat: pure `mockImport` specs now run under **esm bindings** and the standalone WASI runtimes (`wasmtime`, `wasmer`, `wazero`) — `mock.spec.ts` is no longer excluded from those modes (it was in v1.5.0). Only `unmock.spec.ts`, which retains a real host binding the host can't supply under those runtimes, is excluded (`!**/unmock.spec.ts`).
- feat: two new modes in `as-test.config.json` — `node:bindings:raw` and `node:bindings:esm` (both `default: false`) — exercise each bindings style explicitly, and both are added to the `test:modes` matrix so `test:all` covers them.

### Watch mode exits with the last verdict

- feat: quitting `--watch` (ctrl+c, both the raw-mode `0x03` path and the `SIGINT` handler in `runWatchLoop`) now exits `1` when the most recent run left any spec failing **or a run is still in flight**, instead of always exiting `0`. The watch loop already tracks currently-failing `(spec, mode)` pairs in its sticky `failingSpecs` map and an `isRunning` flag, so the exit code is `isRunning || failingSpecs.size ? 1 : 0` — an interrupted run counts as a failure. This lets a red watch session fail CI and shell pipelines (`ast test --watch && deploy`) instead of masking the failure on quit.

### CI uses the main config

- chore: removed `as-test.ci.config.json`. `test:ci` now runs against the main `as-test.config.json` (`npm run test -- --mode node:bindings,node:wasi,wasmtime`), so CI uses the same modes, `features` (`try-as`), and per-mode spec exclusions as everything else — `try-as` no longer needs an explicit `--enable`, and the stale CI-only `wasmtime` exclusion that still ran `unmock.spec.ts` (and failed on the missing `mock::foo` host import) is gone.

## 2026-05-28 - v1.5.0

### `mockFn` and `mockImport` now work anywhere

- feat: `mockFn(target, callback)` and `unmockFn(target)` can be called from **anywhere** in the source — including inside a `test()` / `it()` callback — not just module top-level. The MockTransform now reads the visitor's enclosing-statement `ref` so it locates and removes the directive wherever it lives, defers list mutations to the end of `visitSource` so traversal isn't disturbed, and `unshift`s the generated mock fn to module scope so every rewritten call site can reach it. Previously, a nested `mockFn` silently no-op'd because the transform's top-level-statement scan never found the directive — calls remained un-rewritten and the test passed only because trivial assertions passed too.
- feat: `mockImport(path, callback)` + `unmockImport(path)` now retains the real import as a fallback (call this "route 2"). When a `mockImport`'d path is **never unmocked**, the `@external` import is removed and the wrapper always dispatches through `__mock_import` — same as before. When a path **is** unmocked somewhere, the transform keeps the real import (renamed `__as_test_real_<name>`, de-exported), and the wrapper becomes `if (__mock_import.has(path)) call_indirect(...) else __as_test_real_<name>(...)`. So a call after `unmockImport` falls back to the host binding instead of trapping on a missing `__mock_import` entry.
- fix: the runtime import-stub now covers any module the wasm declares (not just `env`), so a retained `mockImport` target with no host implementation (e.g. an artificial test import) gets a `() => 0` no-op stub before `WebAssembly.instantiate`. Without this, the wasm `LinkError`s on instantiation. `env` is no longer skipped — asc raw bindings put their `abort`/`trace`/`seed` defaults on the inner object and user env imports on the prototype, so the stub fills missing `env.*` user imports without clobbering asc's defaults.
- fix: in raw bindings the helper reads `imports.<module>` while building its import object, so the stub had to be applied **before** `helper.instantiate(module, imports)` is called — adding it inside the `WebAssembly.instantiate` wrapper alone was too late and surfaced as `instantiate@.../<spec>.js:...` failures (this was the chromium-headful + watch + full-suite crash where one bad job poisoned the persistent session).

### Class serializer rename — `__AS_TEST_TO_JSON()`

- change: the transform-injected class serializer is now emitted under an internal name `__AS_TEST_TO_JSON(): string` instead of `toJSON(): string`. Users can't accidentally call the generated method, and a hand-written `toJSON()` no longer collides with the generated one.
- feat: at runtime, `stringify<T>` for a managed class calls a user `toJSON()` only when its return type is a string (probed via a generic-parameter helper so the dead branch is pruned at compile time); a non-string `toJSON` cleanly falls back to the generated `__AS_TEST_TO_JSON()` structural serializer instead of being a compile error. The transform now generates `__AS_TEST_TO_JSON` for every eligible class so the fallback always exists.

### Chromium fix — fragmented WebSocket frames

- fix: chromium fragments outbound WebSocket binary messages at ~128KB. The two web server frame parsers (standalone runner in `lib/src/index.ts` and managed `PersistentWebSessionHost` in `cli/commands/web-session.ts`) read the opcode but **never checked the FIN bit or handled continuation frames (`0x0`)** — so chromium's continuation frame was silently dropped, the wipc byte stream desynced, and frame-header bytes bled into report payloads as `Bad control character in JSON`. Both parsers now reassemble fragments (buffer `0x1`/`0x2` with FIN=0, append `0x0` until FIN=1). firefox and webkit don't fragment at that size, which is why they always worked.
- fix: the CLI reassembled chunked report payloads by `data.toString("utf8")` per-chunk then joining. The producer (`assembly/util/wipc.ts`) chunks raw UTF-8 bytes, so a multibyte character straddling a chunk boundary was getting mis-decoded into replacement chars (or worse) on any transport, not just chromium. Chunks are now buffered as `Buffer`s and decoded UTF-8 once after `Buffer.concat`.

### Web mode — repro command + browser test infrastructure

- fix: when a managed web run (`ast test --mode firefox/chromium/webkit`) fails, the printed repro now points at the **managed CLI command** (`node ./bin/index.js run <spec> --mode <browser>`) instead of `node .as-test/runners/default.web.js <wasm>`. The managed path uses `PersistentWebSessionHost`'s panel UI; the standalone runner uses `lib/src/web-runner/*`'s terminal UI — completely different stacks. So the old repro never actually reproduced the failing run, and showed a different UI to boot. Top-level negations in `runCommandForLog` are now mode-aware via `webSession`.
- change: removed `tests/fixtures/fake-browser.mjs`. The integration suite's web tests now use real headless chromium (auto-detected from PATH or the Playwright cache), and `AS_TEST_SKIP_WEB=1` cleanly skips them in CI. CI workflows (`.github/workflows/as-test.yml`, `release.yml`) already set `AS_TEST_SKIP_WEB=1`. Without this, the shim's flow hung indefinitely in some local environments, eating ~hours of integration time.
- feat: a small "browser-closes-early" test now ships a `process.exit(0)` shebanged executable as `--browser` to verify the framework reports a clean disconnect error rather than hanging.

### Per-mode spec exclusion

- feat: mode-level `input` overrides can use `!`-prefixed patterns to exclude specific specs from that mode. The orchestrator's per-mode `run()` call now checks the **mode-only additions** (negations in the mode's `input` array that aren't in the top-level `input`) against the selector and returns an empty result for excluded files. Top-level negations remain ignored when a file is explicitly selected, so `test __tmp_foo` still works for paths the top-level config would otherwise filter.
- chore: `mock.spec` is excluded from `wasmtime`, `wasmer`, and `wazero` modes in `as-test.config.json`. Those CLI-only WASI runtimes can't accept arbitrary imports at instantiation, so the retained `env.*` `mockImport` target has no JS host to satisfy it.

### Scripts and CI standardization

- feat: new `build` script aliases `build:cli && build:lib && build:transform`. `test:all`, `release:check`, and `prepublishOnly` now compose with it instead of repeating the three sub-builds. `test:all` runs `build && test:modes && test:integration && test:examples`.
- chore: `test:modes` drops the duplicate `--parallel` (the base `test` script already has it), and `test:ci` composes with `npm run test --` instead of hard-coding the bin path.
- chore: `.github/workflows/as-test.yml` and `release.yml` now share identical test-job setup (checkout@v4, `actions/setup-node@v4`, `oven-sh/setup-bun@v1`, install Wasmtime, lint, typecheck, build, `test:ci`, `test:integration`). `as-test.yml` keeps the Test Summary action for PR feedback; the manual `curl`/`tar` Node bootstrap and the inline Bun installer are gone. `examples.yml` uses the `build` alias.

## 2026-05-27 - v1.4.1

### Dependency hygiene

- fix: declare `minimatch` (`^10.2.5`) as a direct dependency. The watch-mode exclusion matcher (`matchesAnyExclusion` in `cli/index.ts`) imported `minimatch` but relied on it resolving transitively through `glob` — it would have broken if `glob` ever dropped or changed that dependency. The pinned range matches what `glob` already uses, so the same resolved copy is reused.
- chore: `cli/dependency-graph.ts` no longer embeds raw NUL bytes. The `(mode, spec)` dependency-graph key delimiter is now written as a `\u0000` escape rather than a literal NUL. Behavior is identical (NUL is still the delimiter — it can't appear in a mode name or filesystem path, so keys stay collision-proof), but the source and its compiled `bin/` output are now plain text instead of being flagged binary by `git`/`grep`.

## 2026-05-26 - v1.4.0

### Dependency-free value serialization (json-as removed)

- feat: as-test no longer depends on or auto-includes `json-as`. Value serialization for assertion reports, snapshots, and `log()` is now handled by a small in-tree stringifier (`assembly/src/stringify.ts`), so `npm install --save-dev as-test` is all you need — `json-as` is no longer a peer dependency.
- feat: `stringify<T>` renders a broad set of built-in types as JSON: booleans, integers, floats, strings (RFC 8259 escaping, including UTF-16 surrogate handling), `null`, `Date` (quoted ISO-8601), `ArrayBuffer` (array of unsigned byte values), typed arrays / `ArrayBufferView` (element array), `Array`, `StaticArray`, `Set` (value array), and `Map` (JSON object; non-string keys are coerced to quoted strings). Classes render via a transform-generated `toJSON()` or a `"<TypeName>"` placeholder.
- chore: removed the json-as peer-advisor (`transform/lib/peer-advisor.js`) and the json-as transform-passthrough integration test. Classes decorated `@json`/`@serializable` are skipped by the toJSON injector, so users who want json-as serialization can still add their own `toJSON()` and wire up `--transform json-as`.

### Structural deep equality for matchers

- feat: `.toBe()`, `.toEqual()`, and `.toStrictEqual()` now compare by structure rather than by reference. The EqualsTransform (`transform/lib/equals.js`) synthesises an `__as_test_equals(...)` method for every class that appears as an `expect()`/matcher operand, including nested classes reachable through their fields; the runtime entry point (`assembly/src/reflect.ts`'s `reflectEquals`) handles primitives, nullables, arrays, managed dispatch, and cycle detection, with a strict mode that also checks runtime type ids.
- feat: hand-written `__as_test_equals` methods are left untouched by the transform, and inheritance chains are supported via a super-call ignore-list pattern.

### Surfacing `log()` output

- feat: after a run, as-test now reports how many `log()` lines were captured and writes them to a single aggregated `.as-test/logs/latest.log`, e.g. `19 logs captured → .as-test/logs/latest.log`. The file groups logs by spec and de-duplicates identical output across modes, tagging each block with the modes that produced it: `[LOG] log.spec.ts (node:bindings, node:wasi):`.
- feat: `ast test --show-logs` (also on `ast run`) prints the captured logs as a clean grouped block at the end of the run instead of pointing at the file. In a normal run logs stay quiet (just the hint line); `--verbose` and non-TTY output still stream them inline as before.
- fix: the per-spec readable log's `Log:` section was always empty — it read a `value`/`message` field that never existed on log entries (the field is `text`). It now contains the captured logs.

### Suite / test counting

- change: every grouping block — `describe`, `test`, `it`, `only` (and their skip variants) — now counts as a **suite**, and each `expect()` assertion counts as a **test**. Previously `test`/`it`/`only` weren't counted as suites and an empty one was tallied as a single test, so an `it()` that contained assertions reported `Suites: 0`. As a result a top-level `it()`/`test()` failure now also appears in the end-of-run failure summary (with its location), instead of only the inline assertion line.
- fix: nested grouping blocks now actually nest. A `describe`/`it`/`test` declared inside another block is parented to the block whose callback is running (`current_suite`) rather than to a stale depth-indexed stack, so `describe`-in-`describe` no longer flattens (the inner block's children were previously attached to the outer block, leaving the inner one empty). The unused `suites`/`depth` registration globals were removed.

### Scoped beforeEach / afterEach

- feat: `beforeEach` and `afterEach` take an optional second argument listing the suite kinds they fire around — `beforeEach(() => {}, ["describe", "test"])`. With no argument the behavior is unchanged: hooks run around test cases (`test` / `it` / `only` and skip variants) and not around grouping blocks like `describe`.

### Watch mode + dependency graph

- feat: `ast test --watch` (`-w`) tracks a per-spec dependency graph (`cli/dependency-graph.ts`) built from the files `asc` actually loads during each build, so editing a shared helper re-runs only the specs that depend on it instead of the whole suite. `asc`'s bundled stdlib and the on-disk package are excluded from the graph to keep it small.
- feat: press `w` in watch mode to toggle auto-run off (manual invocation) and back on. While paused, edits are remembered but not run — invoke runs yourself with `a` (all) or `space` (retry failing); the footer shows how many changes are pending. Resuming re-runs everything if anything changed while paused.

### Breaking

- chore: `json-as` is no longer installed or auto-included by as-test. Projects that relied on as-test pulling in `json-as`, or on json-as-shaped serialization output in reports/snapshots, should install `json-as` themselves and add a `toJSON()` to the relevant classes. Existing snapshots whose serialized form changed will need `--overwrite-snapshots` once.

### Tooling

- ci: integration tests updated for the new serialization/equality paths (`tests/coverage-points.test.mjs`, new `tests/try-as-dedupe.test.mjs` and `tests/dependency-graph.test.mjs`).

## 2026-05-22 - v1.3.0

### `features` config array + arbitrary `--enable` passthrough

- feat: new top-level `"features": ["try-as", "simd"]` array in `as-test.config.json` (and per-mode override). `try-as` is the only as-test-internal feature today and wires the `try-as/transform` + `AS_TEST_TRY_AS=1` build flags as before. Any other name in the array is passed through to `asc` as `--enable <name>` — so `"simd"`, `"threads"`, `"reference-types"`, `"gc"`, etc. now work without hand-editing `buildOptions.args`.
- feat: `ast test|run|build --enable <name>` and `--disable <name>` now accept arbitrary feature names. CLI flags override the config array (CLI `--disable simd` removes a config-listed feature; CLI `--enable simd` adds it). The known special-case `coverage` flag still routes to the dedicated top-level `coverage` config field rather than the features array. Both flags accept comma-separated lists too: `--enable try-as,coverage,simd` and `--disable try-as,coverage`. The same syntax is honored by `ast init`.
- feat: `ast init` interactive prompt now includes a multi-select "Features" step (↑/↓ to move, space to toggle, enter to confirm) with `coverage` and `try-as` options. `--enable`/`--disable` flags on `ast init` skip the prompt with explicit selections. The generated `as-test.config.json` writes `coverage` at the top level and `features` as a string array; when try-as is selected, `try-as` is also added to `devDependencies`.
- chore: schema validation rejects malformed shapes (object form, non-string array entries) with a fix hint pointing at the new shape.

### `mode()` registration gate + `AS_TEST_MODE_NAME`

- feat: new `mode(matchers: string[], fn: () => void)` helper in the `as-test` runtime, plus an `AS_TEST_MODE_NAME: string` compile-time constant. Use `mode(["node:bindings"], () => { ... })` to gate suite/test registrations on the active mode name. Matcher semantics: positive entries OR; `!name` entries exclude; `[]` is a no-op; positive + negative entries combine as "any positive matches AND no negative matches."
- feat: build-side wiring — `build-core.ts` injects `AS_TEST_MODE_NAME=<mode>` into the asc env per-mode build, and the as-test transform rewrites the initializer of `AS_TEST_MODE_NAME` in `assembly/src/mode.ts` (an `afterParse` AST patch) so the value is baked into the wasm at compile time. Default value when no mode is selected is `"default"`.
- chore: bundled `assembly/__tests__/mode.spec.ts` exercises positive/negative/mixed matchers, empty matchers, and per-mode counter behaviour end-to-end against the project's own `node:bindings` / `node:wasi` modes.

### Tooling

- chore: `build:transform` now runs `prettier -w ./transform/` after the TypeScript build so generated output stays formatted.

## 2026-05-20 - v1.2.0

### Directory-preserving artifact layout

- feat: build artifacts, fuzz artifacts, snapshots, readable logs, coverage logs, and crash records now mirror the source tree under the configured input globs instead of being flattened into a single directory with a `____`-mangled disambiguator suffix. For `assembly/__tests__/nested/array.spec.ts` the artifact is `outDir/<mode>/nested/array.spec.wasm` (previously `outDir/<mode>/array.<mode>.<target>.assembly____tests____nested.wasm`).
- feat: filename simplified to `<stem>.wasm` — the `.<mode>.<target>` suffix has been dropped since the mode is already a directory level and the target is implied by the mode config.
- feat: add `resolveGlobBase`, `resolveSpecRelativePath`, and `resolveArtifactPath` in `cli/util.ts` as the shared path helpers used by every code path that writes or looks up a per-spec artifact. Glob bases are computed component-wise (so `assembly/__tests` is not a prefix of `assembly/__tests__/foo.spec.ts`) and the longest matching base wins when multiple configured input patterns overlap.
- feat: add an up-front collision check in `build()` that throws a clear error naming both source files when two configured inputs would resolve to the same artifact path.
- fix: `ast test <one-spec>`, `ast run <one-spec>`, and `ast fuzz <one-spec>` no longer drop the disambiguator when only one of two same-basename files is being built. The build side and the runner side now compute the same path from the same configured input set.
- fix: build sites now `mkdir -p` the artifact's parent directory before invoking `asc` — pinned `assemblyscript@0.28.17`'s `-o` flag does not create parents and would otherwise ENOENT for any new nested directory.
- fix: `persistCrashRecord` now `mkdir -p`'s the entry's parent directory, supporting `/` in entry keys so nested specs and fuzz failures get their own crash files instead of clobbering by basename.
- fix: replace the hardcoded `/__tests__/` and `/__fuzz__/` markers in snapshot and readable-log path resolution with proper glob-base computation, so projects with custom input layouts now nest correctly instead of falling back to basename-only paths.

### `.toThrow()` is a real matcher

- feat: `expect((): void => { throw new Error("boom"); }).toThrow()` now invokes the wrapped callback and asserts it threw, using try-as's `__ExceptionState.Failures` counter to detect the throw. Calling `.toThrow()` on a non-function value reports a clear "needs a function" failure.
- feat: requires `--enable try-as`. Without the feature flag, `.toThrow()` warns once and is a no-op (existing behavior preserved).
- chore: the bundled try-as integration spec lives at `assembly/__tests__/try-as.spec.ts` and is run by `npm test`, which now passes `--enable try-as`.

### Breaking

- chore: clean break on snapshot file layout — the legacy `${base}.snap.json` and `${base}.${disambiguator}.snap.json` fallbacks have been removed. After upgrading, run `--create-snapshots` or `--overwrite-snapshots` once so snapshots are written at their new relative-path locations.
- chore: artifact filenames no longer carry the `<mode>.<target>` suffix; tooling that grepped the old shape needs adjusting. `ast clean` removes any orphan artifacts.
- chore: `.toThrow()` no longer accepts a bare value — it now requires a `() => void` callback and the try-as feature flag.

### Tooling

- chore: husky pre-commit / commit-msg / pre-push hooks (build → format → typecheck → lint on commit; conventional-commits enforcement; full test gate only on push to `main` of `JairusSW/as-test`).

## 2026-05-19 - v1.1.10

- feat: when the user already declares `--transform json-as/...` in `buildOptions.args` or in their referenced `asconfig.json` (top-level `options.transform`, any `targets.*.transform`, or via a single level of `extends`), as-test no longer adds its own auto-include — letting users bring their own json-as version or load path. Detection matches bare specifiers (`json-as`, `json-as/transform`), absolute paths, and `./node_modules/...` paths.

## 2026-05-19 - v1.1.9

- fix: spec files that share a basename across subdirectories (e.g. `sqli/flags.spec.ts` and `sqli_v2/flags.spec.ts`) now build to their disambiguated artifact names across `ast test`, `ast run`, and `ast fuzz` — even when only one of them is being built. Previously the single-file build paths, the selector-filtered top-level build, the per-mode test/run dispatch, the plan listing, and the fuzz runner all computed duplicates from a local (and often single-element) file list, never matched anything, and clobbered each other into a single `flags.spec.wasm` / `parser.fuzz.wasm`; the runner then reported `bindings artifact not found`. Every call site now computes the duplicate set against the full configured input glob (`config.input` for tests/runs, `config.fuzz.input` when `overrides.kind === "fuzz"`), matching the runner's lookup behavior.
- chore: as-test's own suite now includes nested fixtures (`assembly/__tests__/nested/array.spec.ts`, `assembly/__fuzz__/nested/array.fuzz.ts`) that share basenames with siblings at the top level, exercising the disambiguation path end-to-end against the real build/run pipeline. The repo `as-test.config.json` inputs were widened to `**/*.spec.ts` / `**/*.fuzz.ts` to pick them up.
- chore: `npm test` now runs both the AssemblyScript spec suite (`npm run test:as`) and the Node integration suite (`npm run test:integration`) in one command. `release:check` and `prepublishOnly` no longer need to invoke `test:integration` separately.
- chore: GitHub workflows (`as-test.yml`, `release.yml`) now run `test:integration` after `test:ci`, so the Node integration suite gates PRs and releases (previously CI only ran the AS spec suite).

## 2026-05-18 - v1.1.8

- chore: `ast init` now writes `json-as` (`^1.3.5`) into the consumer's `devDependencies` so a fresh project installs everything it needs in one step.
- fix: align the `covered, missing` column in coverage file breakdowns so long file paths no longer push the counts out of column.
- feat: `--show-coverage` (and `--show-coverage=all`) now auto-enable coverage when coverage hasn't been explicitly toggled, removing the "coverage is disabled" warning when only the show flag is passed.

## 2026-05-18 - v1.1.7

### Modes & CLI

- fix: when a config declares named modes, the implicit base config no longer runs alongside them; only modes with `default !== false` are selected. Configs without any declared modes still fall back to the base mode.
- feat: add `--watch` to `ast test` to re-run on source or spec changes (150ms debounce, clear-screen, `Ctrl+C` to stop). Watches all base directories derived from `input` patterns plus `assembly/` and the resolved config file; ignores `node_modules`, `.git`, and the configured `outDir`.

### Runtime

- chore: replace the homegrown JSON serialization helpers (`quote`, `rawOrNull`, `stringifyValue`, `escape`, `unicodeEscape`, `stringifyArray`) with `json-as` across the AssemblyScript runtime and transform, and delete `assembly/util/json.ts`. The `LogTransform` now injects `import { JSON } from "json-as/assembly"` per instrumented source and inlines `JSON.stringify<T>()` into the log helper.
- chore: promote `json-as` to a required peer dependency (`>=1.3.5`, the first version compatible with the AS NodeKind tuple changes used here). npm 7+ installs it automatically; pnpm and yarn users must add `json-as` to their own `devDependencies` alongside `as-test`.
- chore: remove the unused `__as_test_log_default` and `__as_test_json_value` exports.

## 2026-05-14 - v1.1.6

- fix: coverage `mode` and `dependencies` filtering now correctly handles AssemblyScript-normalized `~lib/<pkg>/...` paths, which are the actual runtime paths emitted for `node_modules` imports.
- fix: `ENTRY_FILE` injected by the transform now uses the full relative path instead of the basename, preventing snapshot key collisions between specs with the same filename in different directories; snapshot lookup normalizes the file prefix to maintain backward compatibility with existing `.snap` files.
- fix: transform visitor and coverage instrumentation now resolve `NodeKind` values at runtime instead of relying on compile-time const enum inlining, so they remain correct across AssemblyScript versions.
- fix: add a no-op `TupleType` case to the transform visitor so files using tuple types no longer throw during instrumentation.
- fix: coverage transform no longer wraps `return this` in constructors, preventing AS231 ("A class with a constructor explicitly returning something else than 'this' must be '@final'").
- fix: coverage transform preserves expression-body arrows instead of converting them to block bodies, preventing TS1140 ("Type argument expected") on typed arrow parameters such as `[1,2,3].map((x: i32) => x + 1)`.

## 2026-05-14 - v1.1.4

- feat: add `coverage.mode` (`project` or `all`) plus `coverage.dependencies` package allowlisting so dependency coverage can include normal or pnpm-installed packages without raw path globs.

## 2026-05-13 - v1.1.3

### Coverage

- feat: make coverage gaps hierarchical and easier to scan, with parent-before-child grouping, tree-style connectors, collapsed nested gaps by default, and `--show-coverage=all` / `--verbose` expansion.
- feat: add richer coverage point names including `DefaultValue`, `Ternary`, `IfBranch`, `Assignment`, `Loop`, `Return`, and `Throw` so uncovered points describe the actual construct instead of falling back to broad labels.
- fix: make coverage snippets underline the emitted construct span instead of recomputing from the raw column, so cases like inline `if (...) ...` and assignments highlight the right text.

## 2026-05-13 - v1.1.2

### Reporting & CLI

- fix: update build and run failures to provide clearer error messages plus reproduction commands and instructions.
- fix: remove the confirmation prompt from `ast clean`.

## 2026-05-12 - v1.1.1

- add `ast clean` command to remove build outputs, coverage outputs, crash reports, and logs.
- remove deps

## 2026-05-12 - v1.1.0

### Upgrading to 1.1.0

- refresh generated runners with:

  ```bash
  rm -rf .as-test/runners && npx as-test init
  ```

- generated runners now use a single file per target and import `instantiate(...)` from `as-test/lib`
- new bindings and web runners no longer use `*.hooks.js`
- named modes now support `default: false` to make a mode manual-only
- the repo examples and default config now use mode names like `node:wasi`, `node:bindings`, `chromium`, and `chromium:headless`

### Runtime & Runners

- feat: replace the split bindings/web hooks model with single-file runners that import `instantiate(...)` from `as-test/lib`, keeping bindings, WASI, and web runner syntax aligned.
- feat: add `as-test/lib` as the shared JS runtime host layer for bindings, WASI, and web targets, with runtime artifact resolution happening out of sight before runner execution.
- feat: autodetect bindings helper shape at runtime support level (`raw`, `esm`, or `none`) and keep the generated runner surface minimal.
- fix: make `ast run` rebuild missing artifacts on demand instead of failing when only some selected outputs already exist.
- fix: report real lazy-build time in `ast run` summaries instead of always printing `0us build`.
- fix: remove build artifact copy/reuse shortcuts so each selected file/mode compiles directly, avoiding stale output reuse across modes.

### Web Runtime

- feat: move headful web execution to a persistent single-browser-session architecture that opens one page, runs multiple binaries through it, and keeps browser-side runtime details hidden from the runner file.
- feat: redesign the non-headless browser page into a minimal macOS-inspired loading surface with light/dark mode support and simpler status messaging.
- feat: make headful web runs wait for the user to open the local session URL, and expose a browser-side exit control.
- fix: keep all browser bootstrap, asset, and websocket traffic on one local port.
- fix: improve browser discovery and launch behavior across Chromium, Firefox, and WebKit, including Playwright cache lookup, macOS app bundle resolution, paths with spaces, and owned-process teardown.
- fix: fail terminal-side runs when the browser side disconnects unexpectedly, and close the browser side when the websocket is lost.

### WASI

- fix: make the WASI stdin transport retry only on retryable WASI read errors (`AGAIN` and `INTR`), which resolves intermittent snapshot reply corruption in `node:wasi` runs.

### Modes & CLI

- feat: add per-mode `default: boolean` selection so modes can be included in implicit runs or kept manual-only.
- feat: add `ast clean` to remove configured build outputs, coverage outputs, crash reports, and logs.
- feat: make `ast clean` remove everything by default without prompting.
- fix: restore unnamed root-config execution alongside named default modes when `--mode` is omitted.
- fix: make `ast clean` ignore mode `default: false` flags and treat an omitted `--mode` as a full clean across every configured mode.
- fix: make `ast clean --mode ...` stay scoped to the selected mode(s) and skip shared output paths that are still owned by unselected modes instead of deleting them.
- fix: make full `ast clean` remove the configured output roots directly so stale legacy build, coverage, and log directories are removed too.
- fix: simplify `ast clean` console output so it only prints removed paths plus a final summary.

### Tests

- feat: add integration coverage for bindings (`raw`, `esm`, `none`), WASI, and web runtime paths, including browser-resolution regressions and single-origin web runner behavior.

## 2026-05-08 - v1.0.16

- feat: modes inherit pre-declared properties if not explicitly overriden

## 2026-05-04 - v1.0.15

- fix: path resolving

## 2026-05-04 - v1.0.14

### Fuzzing

- feat: add `FuzzSeed` helpers for `i8`, `u8`, `i16`, `u16`, `i64`, `u64`, and `bool()`.
- feat: make integer `FuzzSeed` helpers default to the full range of their target type when no options are provided, instead of collapsing to `0`.
- perf: add unchecked full-range fast paths for default integer seed generation while keeping explicit user-provided ranges validated.

## 2026-05-03 - v1.0.13

- feat: add `--fuzzer` / `--fuzzers` filtering for `ast fuzz` and `ast test --fuzz`, accept `--suite` / `--suites` as fuzz aliases, and include target-specific repro commands in fuzz failure output.
- feat: add `--suite` / `--suites` filtering for `ast run` and `ast test`, and print suite-specific repro commands on failing test assertions.

## 2026-04-28 - v1.0.12

- perf: faster seed generation
- feat: make fuzz campaigns use a random base seed by default when `fuzz.seed` and CLI seed overrides are not set, while keeping deterministic replay via `--seed` / `--fuzz-seed`.

## 2026-04-18 - v1.0.11

### Coverage

- fix: ignore additional AssemblyScript compile-time builtin calls during coverage instrumentation, including `isVector`, `isVoid`, and `lengthof`.

## 2026-04-18 - v1.0.10

### Reporting

- feat: when coverage is incomplete and `--show-coverage` is not passed, the default reporter now prints `Coverage (run with --show-coverage to display uncovered points)`; otherwise it keeps the plain `Coverage` header.

### Assertions

- fix: register top-level `expect(...)` and `log(...)` calls (outside explicit suites) into a synthetic global suite so they are counted and reported in final totals.

## 2026-04-18 - v1.0.9

### Runtime

- fix: align default runtime command selection with `buildOptions.target` so `bindings` runs no longer probe `default.wasi.js` first or emit unnecessary fallback warnings.

### Fuzzing

- feat: allow per-fuzzer operation overrides via `.generate(generator, operations)` and `.generateTyped(generator, operations)` in addition to the existing third `fuzz(..., operations)` argument.

### Type Ergonomics

- feat: add and publish an IDE-only declaration shim (`assembly/as-test.intellisense.d.ts`) so `FuzzSeed` option objects can omit fields like `exclude` without TypeScript IntelliSense errors.

### Examples

- chore: remove `examples/08-json-as-runner-compare` and update `examples/package.json` test scripts accordingly.

## 2026-03-31 - v1.0.7

### Coverage

- feat: make CLI coverage output easier to scan with a summarized coverage block, per-file breakdown, grouped uncovered points, clickable `file:line:column` locations, trimmed source snippets, aligned gap columns, source-aware labels such as `Function`, `Method`, `Constructor`, `Property`, and `Call`, and coverage-point ignore rules for labels, names, locations, and snippets.

### Fuzzing

- feat: allow `fuzz(...)` and `xfuzz(...)` targets to override their own operation count with an optional third argument, so one file can mix short smoke fuzzers and heavier targets without changing the global `fuzz.runs` config.
- feat: make `--runs` / `--fuzz-runs` accept absolute and relative overrides such as `500`, `1.5x`, `+10%`, and `+100000`, applying them to each fuzzer's effective run count for that command.

## 2026-03-31 - v1.0.6

### Fuzzing

- feat: print exact failing fuzz seeds and one-run repro commands on logical fuzz failures, and persist captured `run(...)` inputs in `.as-test/crashes` so side-effectful generators still leave behind replayable failure data.

### Reporting

- fix: correct reporter override output behavior.

## 2026-03-30 - v1.0.5

### CLI

- fix: preserve selectors passed after `--parallel` so commands like `ast test --parallel math` still target the requested suite.
- fix: treat uncaught runtime stderr / missing report payloads as normal failed test results instead of transport-level crashes, with cleaner default reporter output.
- perf: reuse build artifacts across modes when the resolved non-custom build invocation and build environment are identical, copying the first artifact instead of recompiling.

## 2026-03-27 - v1.0.4

### Build Command

- fix: make `ast build` exit cleanly instead of hanging after work completes.
- feat: make `ast build` print per-mode build results and a final summary.
- feat: make `ast build` support `--parallel`, `--jobs`, and `--build-jobs`.

### Parallel Execution

- perf: add persistent build workers for parallel `ast run` and `ast test` so AssemblyScript modules stay warm across file builds instead of spawning a fresh compiler process per build.
- perf: route normal and single-build-worker builds through the same persistent compiler-worker path so serial `ast test`, `ast run`, and `ast fuzz` runs also reuse the AssemblyScript API instead of spawning a fresh `asc` process per file.
- perf: make each queue worker own one file through all selected modes before releasing its slot, which removes mid-file mode interleaving across workers.
- feat: add `--parallel` with an automatic worker heuristic that stays in the 2-4 worker range for typical suites and only grows past that when there are substantially more files to process.
- fix: keep parallel mixed-mode builds correct by isolating long-lived compiler workers by build signature so WASI and bindings state does not leak between builds.
- fix: make `--jobs`, `--build-jobs`, and `--run-jobs` cooperate with ordered queue reporting while still emitting final per-file results as each file completes.

### Docs

- docs: refresh the README and external docs set for the current explicit-import workflow, `ast init`, `--parallel`, the split snapshot flags, and the current fuzzing/runtime guidance.

## 2026-03-25 - v1.0.2

### Explicit Imports, Typings & Reporting

- feat: export the public fuzz option and fuzzer types directly from `assembly/index.ts` so runtime exports and package typings stay aligned.
- fix: remove the experimental side-effect `import "as-test"` path and return the package to explicit imports only in the transform, typings, examples, tests, and README.
- fix: remove the temporary declaration-file build path and return the package to a simpler no-`.d.ts` setup.
- fix: keep fuzzing green while leaving the in-repo AssemblyScript `IntegerOptions` ergonomics issue for a later API change.
- fix: align summary output columns for `failed`, `skipped`, and `total` across test/run/fuzz totals.
- fix: make `ast test --fuzz` print fuzz file results before the final combined summary, with one merged totals block that includes `Fuzz` alongside the normal test totals.

### Assertions & Serialization

- feat: split equality matchers into `toBe`, `toEqual`, and `toStrictEqual` with explicit semantics:
  - `toBe` uses identity / exact primitive equality
  - `toEqual` uses deep equality
  - `toStrictEqual` uses deep equality plus runtime-type matching for managed values.
- feat: support method-based class equality via `__as_test_equals(other, strict)`, with compile-time errors for unsupported managed classes instead of silent fallback behavior.
- feat: support method-based managed-value JSON serialization via `__as_test_json()`, with `__as_test_json_value()` exported for nested field serialization.

### Runtime & Tooling

- refactor: replace the handwritten JS WIPC channel implementation with the `wipc-js` dependency.
- chore: switch CLI TypeScript module resolution to `Bundler` so package export maps resolve correctly.
- chore: run linting in the main test workflow in addition to the existing release workflow.
- chore: update `prettier` to `3.8.1` and `assemblyscript-prettier` to `3.0.4`.
- perf: trim WIPC traffic so passing expectations are not reported in realtime, while warnings and `log()` output now use structured events.

### Config & Environment

- feat: allow `env` config values to come from a `.env` path, `KEY=value` array, or object map.
- feat: support merged env overrides at the top level, `buildOptions`, `runOptions`, and per-mode build/run config.
- feat: disable coverage by default and add `coverage.include` / `coverage.exclude` glob filters so projects can opt in and scope reports explicitly.

### Web Runner

- feat: add a `web` target that runs bindings-style artifacts in a browser over a WebSocket-backed WIPC bridge.
- feat: scaffold `.as-test/runners/default.web.js` and a `web-headless` mode during `ast init --target web`.
- feat: prompt to install Chromium with Playwright when a web run starts without an available browser.
- fix: remove per-file web runner startup noise from normal test output.

### Docs

- docs: remove outdated `run()` calls from README usage snippets where they are no longer needed.
- docs: add a `docs/` directory with focused guides for setup, tests, fuzzing, mocking, snapshots, coverage, reporters, assertions, config, CLI usage, and diagnostics.
- docs: link the new docs index from the main README.
- docs: reorder the README to follow the beginner workflow from installation through tests, mocking, snapshots, fuzzing, and runtimes.
- docs: simplify the main README and replace stale examples with snippets that reflect the current config shape and working APIs.
- docs: update snapshot CLI examples to use `--create-snapshots`.

### CI

- fix: add a dedicated `test:ci` script and `as-test.ci.config.json` so CI stays on the Wasmtime/WASI path instead of fanning out into `web-headless`.
- fix: remove the baked-in `web-headless` mode from the repo's default config so the project defaults stay on the Wasmtime/WASI runner.
- feat: add a dedicated `examples.yml` workflow that runs the standalone examples individually on push.
- feat: install Chromium through Playwright for the `07-web` example job and pass its executable through `BROWSER`.
- feat: add local `act` defaults and package scripts so GitHub Actions workflows can be exercised before pushing.

### Init & Examples

- feat: `ast init` can scaffold a basic fuzzer example and now writes `assembly/tsconfig.json` for editor-friendly AssemblyScript setup.
- feat: update the generated `.gitignore` block to keep the `.as-test/` root while excluding runners and snapshots.
- feat: add more standalone fuzzing examples and a dedicated `07-web` example project.
- fix: rename `05-mocking-and-import-snapshots` to `05-mocking-and-imports` and align its file/test labels with the new name.
- docs: update examples to use side-effect `import "as-test"` style where possible.

### Fuzzing

- feat: add `ast fuzz` to build and run dedicated `*.fuzz.ts` bindings targets.
- feat: add `ast test --fuzz` to run fuzz targets after the normal spec pass and print a combined console summary.
- feat: add an AssemblyScript-first fuzz API via `fuzz("name", callback).generate((seed, run) => ...)`.
- feat: add built-in `FuzzSeed` generators for booleans, numbers, bytes, strings, arrays, and picks.
- feat: treat failed expectations and `false` returns as fuzz failures, while traps and throws are reported as crashes.
- feat: add top-level `fuzz` config for fuzz target discovery and default driver settings.
- feat: add `xfuzz(...)` for skipped fuzz targets and report fuzz results through the built-in reporters, including TAP output.
- feat: store fuzz and runtime crash artifacts as stable `.as-test/crashes/<entry>.json` and `.as-test/crashes/<entry>.log` files.
- fix: fail `ast fuzz` and `ast test --fuzz` on logical fuzz failures, not only crashes.
- fix: disambiguate duplicate fuzz basenames using the selected input set so same-named fuzz files do not overwrite one another.
- fix: auto-inject `run()` correctly for fuzz files without being confused by generator-local `run(...)` parameters.
- fix: make `try-as` opt-in even when the package is installed; it now only runs when explicitly enabled.

### Snapshots & Logs

- feat: switch text snapshots to readable `.snap` files with path-preserving output under `.as-test/snapshots/`.
- feat: add comment support in `.snap` files and use clearer snapshot IDs like `Suite > test`, `Suite > test [name]`, and `Suite > test #2`.
- feat: add readable per-file `.log` artifacts with mode, build command, run command, snapshot summary, suite/test totals, and failure details.
- feat: split snapshot write flags into `--create-snapshots` and `--overwrite-snapshots`.
- fix: preserve existing snapshot file preambles/comments on rewrite and only generate the default snapshot header when a new `.snap` file is first created.
- fix: canonicalize legacy snapshot IDs on load/assert/write so old `::0` and `::name` variants collapse into the new readable IDs.

### Mocking & Runtime API

- fix: remove `snapshotImport(...)` and `restoreImport(...)` from the active runtime API in favor of the simpler mocking surface.
- fix: escape control bytes and invalid surrogate code units consistently in runtime JSON serialization, including WIPC event frames and fuzz failure payloads.

## 2026-03-11 - v1.0.1

- patch: automatically tokenize buildOptions.args so that `["--enable simd"]` becomes `["--enable", "simd"]`

## 2026-03-11 - v1.0.0

### Docs

- docs: add README guidance for strict config validation behavior and example error output.

### CLI & Config Validation

- feat: validate config shape and field types before applying defaults for all CLI entry points.
- feat: reject unknown config keys with nearest-key suggestions.
- feat: show structured validation diagnostics with JSON paths and fix hints.
- feat: fail fast on invalid config JSON with parser error details.
-

### Release Readiness

- fix: resolve `@assemblyscript/wasi-shim` and `try-as` with package resolution instead of assuming a local `./node_modules` folder, so nested example projects and other valid installs run correctly.
- fix: pass the WASI shim config to `asc` as a cwd-relative path, which avoids nested-project WASI build failures with standalone examples.
- feat: add root `test:examples` coverage and include full standalone example validation in `release:check`.
- feat: validate all examples in both `wasi` and `bindings` modes as part of release readiness.
- docs: update README and examples docs for the standalone example layout and root-level validation flow.
- chore: promote package version to `1.0.0` and switch `publishConfig` to public npm publishing.

## 2026-02-25 - v0.5.3

### CLI, Modes & Matrix

- feat: support mode fan-out behavior consistently across `ast build`, `ast run`, and `ast test`.
- feat: when no `--mode` is provided and modes are configured, run using configured modes.
- feat: add matrix-style per-file output with mode-aware timing:
  - non-verbose: average time
  - verbose: per-mode times.
- feat: add real-time matrix line updates in the default reporter and normalize timing precision to one decimal.
- feat: support comma-separated bare selectors (for example `ast test box,custom,generics,string`) across build/run/test selectors.

### Config Merge & Env Behavior

- fix: apply mode config as field-level merge over base config instead of replacing entire sections.
- fix: merge `buildOptions.args` between base config and mode config.
- fix: pass config env variables to both build and run processes for mode execution.

### Build Pipeline & Feature Flags

- feat: include the exact build command in build failure output.
- feat: allow `buildOptions.cmd` to override default command generation while still appending user build args.
- feat: support CLI feature toggles:
  - `--enable coverage` / `--disable coverage`
  - `--enable try-as` / `--disable try-as`.

### Reporter & Summaries

- fix: move mode summary rendering into the default reporter (via run-complete event payload).
- feat: include `modeSummary` for single-mode runs.
- feat: include mode and snapshot totals in final summary output.
- fix: `--clean` output now behaves as non-TTY in default reporter:
  - no in-place line editing,
  - no suite expand/collapse logs,
  - final per-file verdict lines only.

### Coverage & Transform

- fix: ignore AssemblyScript builtin/compiler helper calls during coverage instrumentation (including `isString`, `changetype<T>`, `idof<T>`, `sizeof<T>`).
- fix: mock transform now collects mocked import targets across sources so WASI mock imports are rewritten reliably (resolves import-shape runtime failures).

## 2026-02-24 - v0.5.2

### Runtime & Serialization

- refactor: remove `json-as` dependency by inlining portable serialization and deserialization helpers into the runtime.

### CLI

- fix: enforce deterministic alphanumeric test input ordering for `ast build`, `ast run`, and `ast test`.

### Dependencies

- chore: remove unused runtime dependencies `as-variant` and `gradient-string`.

## 2026-02-23

### Runtime Matrix & Mode Execution

- feat: add `--mode <name[,name...]>` support for `ast build`, `ast run`, and `ast test`, including multi-mode fan-out in one command.
- feat: add config `modes` map for per-mode overrides (`buildOptions`, `runOptions`, `env`, and optional output/log/coverage/snapshot directories).
- feat: when running with `--mode`, compile artifacts are emitted as `<name>.<mode>.<type>.wasm` (where `type` is `wasi` or `bindings`).

### Bindings Runner Naming

- feat: switch default bindings runner path to `./.as-test/runners/default.bindings.js`.
- fix: keep backward compatibility with deprecated `./.as-test/runners/default.run.js` and legacy `*.run.js` bindings helper files.
- feat: add runtime warnings for deprecated bindings runner path usage and automatic fallback to `default.bindings.js` when needed.

### Init, Examples & Docs

- feat: `init` now writes both `.as-test/runners/default.wasi.js` and `.as-test/runners/default.bindings.js`.
- docs: update README runtime examples and mode artifact naming guidance for `--mode`.
- docs: refresh `examples/` docs/configs for `default.bindings.js` and add a mode matrix example config.

## 2026-02-18

### Reporter & CLI

- feat: add built-in TAP v13 reporter (`tap`) for `ast run` and `ast test`.
- feat: add reporter selection flags `--tap` and `--reporter <name|path>`.
- feat: when TAP reporter is active, write a single TAP artifact by default to `./.as-test/reports/report.tap`.
- feat: allow reporter object config (`name`, `options`, `outDir`, `outFile`) for TAP output control, including `single-file` (default) and `per-file`.
- feat: emit GitHub Actions `::error` annotations for failed TAP assertions (with file/line/col when available).
- fix: keep TAP stdout clean by routing runtime passthrough output to stderr in TAP mode.
- fix: ensure reporter flag values are not treated as test selectors in `ast test`.

### Mocking API & Transform

- feat: add `unmockFn(oldFn)` and `unmockImport(path)` APIs to complement `mockFn` and `mockImport`.
- feat: add `snapshotImport(imp, version)` and `restoreImport(imp, version)` to snapshot and restore a single import mock by version.
- feat: support both import path strings and import functions for `imp`, and `string`/`i32` versions.
- feat: `snapshotImport` also supports callback form (`snapshotImport(imp, () => ...)`) that snapshots to default version `"default"`.
- feat: update transform/runtime handling so `unmockFn` stops later function-call rewrites and `unmockImport` clears the active import mock mapping.

### Config & Docs

- docs: document built-in TAP usage in README (`--tap`, `--reporter tap`, and config-based usage).
- docs: update config schema reporter description to include built-in `default` and `tap` values.
- docs: add README mocking section covering `mockFn`, `unmockFn`, `mockImport`, and `unmockImport`.

## 2026-02-16 - v0.5.1

### Miscellaneous

- fix: init script exited when selecting 'y'

## 2026-02-16 - v0.5.0

### CLI & Runtime

- feat: `ast test` supports selectors by name, path, or glob and resolves bare names against configured spec directories.
- feat: `ast test` now runs per-file sequentially (`build #1 -> run #1 -> ...`) and prints one aggregated final summary.
- fix: `ast test` exits non-zero when no `.spec.ts` files match selectors/config input.
- fix: `ast build` is silent on success and only prints concise stderr details on failure.
- feat: add `--verbose` mode for expanded live suite/test status output without collapsing nodes.
- fix: suppress noisy Node WASI experimental warning lines during test execution.
- refactor: runtime config is `runOptions.runtime.cmd` (legacy `runtime.run` and `runOptions.run` remain supported).
- fix: if the configured runtime script path is missing, automatically fall back to the target default runner.

### Reporter & API

- feat: add skip helpers `xdescribe`, `xtest`, `xit`, and `xexpect`.
- feat: include skipped counts for files, suites, and tests in final summaries.
- feat: add string boundary matchers `toStartWith()` and `toEndWith()`.
- feat: add `toBeTruthy()`, `toBeFalsy()`, `toBeCloseTo()`, `toMatch()`, optional message support in `expect(value, message)`, and snapshot matcher `toMatchSnapshot(name?)`.
- fix: improve assertion correctness across `.not`, type matcher labels, hook execution frequency, non-primitive `toBe()` handling, and failure source locations.

### Coverage

- feat: add `--show-coverage` and support object-style coverage config (`{ enabled, includeSpecs }`).
- fix: limit coverage to source files (`.ts`/`.as`), excluding `node_modules` and AssemblyScript stdlib paths.
- fix: skip writing coverage artifacts when no valid source files remain after filtering.
- fix: dedupe identical coverage points across sequential runs and stabilize point/file ordering in reports.

### Init, Config & Docs

- feat: `init` supports positional install directory (`as-test init ./path`) in addition to `--dir`.
- feat: `init` supports example modes (`minimal`, `full`, `none`) and scaffolds target-specific local runners.
- feat: WASI init adds `@assemblyscript/wasi-shim`; bindings init scaffolds `.as-test/runners/default.run.js`.
- refactor: default WASI runtime path is `./.as-test/runners/default.wasi.js`; generated runners are ESM-only.
- docs: refresh README and schema docs for current CLI behavior, config fields, runtime fallback, coverage, and reporter usage.

### Tooling

- chore: add release validation workflow via `release:check` and tighten package publish file selection.

## 2025-05-28 - v0.4.4

- deps: update json-as to `v1.1.13`

## 2025-05-29 - v0.4.3

- deps: add json-as to peer dependencies as `*`

## 2025-05-28 - v0.4.2

- deps: update json-as to `v1.1.11`
- deps: make json-as a peer dependency

## 2025-03-12 - v0.4.1

- deps: update json-as to `v1.0.1`

## 2025-03-09 - v0.4.0

- deps: update json-as to `v1.0.0`

## 2025-03-03 - v0.4.0-beta.3

- fix: flip 'expected' and 'received'

## 2025-03-03 - v0.4.0-beta.2

- deps: update json-as to `v1.0.0-beta.10`

## 2025-03-03 - v0.4.0-beta.1

- deps: update json-as to `v1.0.0-beta.8`
