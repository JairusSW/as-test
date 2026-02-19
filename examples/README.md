# Examples

This folder contains complete, runnable examples for `as-test`.

## Quick Start

From this `examples/` directory:

```bash
npm i
npm run test:01
npm run test
```

`test:01` and `test` run both runtimes (`wasi` and `bindings`).

Run a single target:

```bash
npm run test:01:wasi
npm run test:01:bindings
```

Run all suites for a single target:

```bash
npm run test:wasi
npm run test:bindings
```

Update snapshots for all example suites on both runtimes:

```bash
npm run test:update-snapshots
```

## Layout

```text
examples/
  README.md
  asconfig.json
  as-test.config.json
  as-test.bindings.config.json
  package.json
  .as-test/runners/default.wasi.js
  .as-test/runners/default.run.js
  assembly/__tests__/
    01-basic.spec.ts
    02-hooks.spec.ts
    03-matchers.spec.ts
    04-snapshots.spec.ts
    05-mocking-and-import-snapshots.spec.ts
    06-skips.spec.ts
    clock.ts
```

## What Each Example Covers

- `01-basic.spec.ts`: Minimal `describe` / `test` / `expect` usage.
- `02-hooks.spec.ts`: `beforeEach` and `afterEach` behavior.
- `03-matchers.spec.ts`: Common numeric, string, and array matchers.
- `04-snapshots.spec.ts`: unnamed and named `toMatchSnapshot` usage.
- `05-mocking-and-import-snapshots.spec.ts`: `mockFn`, `unmockFn`, `mockImport`, `unmockImport`, `snapshotImport`, and `restoreImport`.
- `06-skips.spec.ts`: `xdescribe`, `xtest`, `xit`, and `xexpect`.

## Notes

- These files are designed to be copied into your own project and adapted.
- Runtime artifacts are isolated under `examples/.as-test/*`.
- `clock.ts` is a small external-import fixture used to demonstrate runtime import mocking patterns.
