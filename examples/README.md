# Examples

Each example is now a standalone project initialized with `ast init`.

## Folders

- `01-basic`: Minimal `describe` / `test` / `expect` usage.
- `02-hooks`: `beforeEach` and `afterEach` behavior.
- `03-matchers`: Common numeric, string, and array matchers.
- `04-snapshots`: unnamed and named `toMatchSnapshot` usage.
- `05-mocking-and-import-snapshots`: `mockFn`, `unmockFn`, `mockImport`, `unmockImport`, `snapshotImport`, and `restoreImport`.
- `06-skips`: `xdescribe`, `xtest`, `xit`, and `xexpect`.

## Run One Example

```bash
cd examples/01-basic
npm i
npm test
```

## Run From `examples/` Root

```bash
cd examples
npm test
```

## Notes

- `01` through `06` run both `wasi` and `bindings` modes.
- Artifacts are isolated under each example's local `.as-test/` directory.
