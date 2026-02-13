# Change Log

## Unreleased

### Bug Fixes

- fix: `.not` modifier now correctly inverts assertion verdicts
- fix: `toBeInteger()` / `toBeFloat()` expected type labels were swapped and are now corrected
- fix: `beforeEach` / `afterEach` now execute once per test case instead of once per matcher call
- fix: `toBe()` now handles non-primitive values via JSON serialization fallback instead of returning `"none"`

### New Features

- feat: add `toBeTruthy()` and `toBeFalsy()` assertions
- feat: add `toBeCloseTo()` assertion for floating-point comparison with configurable precision
- feat: add `toMatch()` assertion for string substring matching
- feat: add optional custom failure message to `expect(value, message)`

### Refactors

- refactor: extract shared assertion result handling into `_resolve()` helper

### Documentation

- docs: rewrite `README.md` to match current CLI/runtime behavior and usage
- docs: add matcher reference at `docs/assertions.md`

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
