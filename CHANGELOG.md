# Change Log

## Unreleased

### New Features

- feat: add string boundary matchers `toStartWith()` and `toEndWith()`
- feat: add skip helpers `xdescribe()`, `xtest()`, `xit()`, and `xexpect()`
- feat: include skipped totals for files, suites, and tests in final summaries
- feat: add per-file sequential `test` execution (`build #n -> run #n`) with one aggregated final summary
- feat: allow `ast test <name>` selector resolution against configured spec directories
- feat: allow `init` positional directory (`as-test init ./path`) in addition to `--dir`

### Bug Fixes

- fix: `ast test` now fails when no `.spec.ts` files match selectors/config input
- fix: `build` now stays silent on success and prints concise stderr-only failure output
- fix: remove runtime build hook APIs from reporter lifecycle and keep reporter surface run-focused
- fix: suppress noisy Node WASI experimental warning lines during test execution
- fix: ensure coverage reports include only source files with `.ts` or `.as` extensions
- fix: ignore `node_modules` and AssemblyScript stdlib files in coverage summaries
- fix: skip writing coverage artifact files when no covered source files remain after filtering

### Refactors

- refactor: replace `runOptions.runtime.name/run` with `runOptions.runtime.cmd`
- refactor: normalize legacy `runtime.run` configs to `runtime.cmd` on load for backward compatibility
- refactor: default WASI runtime to local runner `./.as-test/runners/default.wasi.js`
- refactor: make generated local WASI runner ESM-only and remove shebangs from generated runners
- refactor: expand `init` scaffold flow (`minimal/full/none`, target-aware runner/dependency setup, force-aware managed files)

### Documentation

- docs: refresh README to reflect current setup, runtime config, selectors, skip helpers, and coverage behavior

### Tooling

- chore: update CI test invocation to remove `AS_TEST_IGNORE_CORE_FILES` override

## 2026-02-16 - v0.5.0

### Bug Fixes

- fix: `toThrow()` now warns once and self-disables when `try-as` is unavailable
- fix: `.not` modifier now correctly inverts assertion verdicts
- fix: `toBeInteger()` / `toBeFloat()` expected type labels were swapped and are now corrected
- fix: `beforeEach` / `afterEach` now execute once per test case instead of once per matcher call
- fix: `toBe()` now handles non-primitive values via JSON serialization fallback instead of returning `"none"`
- fix: failed assertion summaries now include `file:line:column` source locations when available

### New Features

- feat: add optional `try-as` dependency so `Exception.prototype.toThrow` can be enabled via direct `try-as` import
- feat: add `toBeTruthy()` and `toBeFalsy()` assertions
- feat: add `toBeCloseTo()` assertion for floating-point comparison with configurable precision
- feat: add `toMatch()` assertion for string substring matching
- feat: add optional custom failure message to `expect(value, message)`
- feat: add `toMatchSnapshot(name?)` matcher with host-managed snapshot storage
- feat: add CLI snapshot flags `--snapshot` and `--update-snapshots`
- feat: add `as-test.config.schema.json` for config autocomplete and validation
- feat: add `--show-coverage` to print every coverage point with line/column references
- feat: support coverage config as boolean or object (`{ enabled, includeSpecs }`)

### Refactors

- refactor: extract shared assertion result handling into `_resolve()` helper
- refactor: switch bindings test transport to WIPC frames for host/guest communication
- refactor: move assertion failure reporting to host in real-time via WIPC events
- refactor: simplify live progress output to file-level status lines (`PASS/FAIL <file> <time>`) for cleaner terminal output
- refactor: move default CLI reporter to `cli/reporters/default.ts` and introduce an extensible reporter lifecycle interface
- refactor: complete coverage plumbing from wasm runtime to host summary/report outputs
- fix: dedupe coverage points across per-file wasm runs and report point locations by each point's real source file
- fix: exclude `*.spec.ts`, `node_modules`, and as-test runtime files from coverage by default
- refactor: remove generic `plugins` config usage and use top-level `coverage` config only
- refactor: default generated outputs to `./.as-test/` (`build`, `logs`, and snapshots via `snapshotDir`)
- refactor: write coverage artifacts to configurable `coverageDir` instead of `logs`
- refactor: auto-enable `try-as` transform/build define when dependency is installed
- refactor: add log transform to serialize class instances by auto-injecting `@json` and stringification fallbacks
- refactor: harden CLI version lookup to resolve package metadata outside repository root

### Documentation

- docs: rewrite `README.md` to match current CLI/runtime behavior and usage
- docs: document matcher, reporter, and release guidance directly in `README.md`

### Tooling

- chore: add ESLint 9 flat config with AssemblyScript parser patching support
- chore: add package `files` whitelist and `release:check` script for publish validation
- chore: ignore local npm cache directory (`.npm-cache/`)

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
