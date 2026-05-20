# Change Log

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
