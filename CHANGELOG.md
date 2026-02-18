# Change Log

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
