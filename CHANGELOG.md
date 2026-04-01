# Change Log

## Unreleased

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
