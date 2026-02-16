# Change Log

## Unreleased

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
