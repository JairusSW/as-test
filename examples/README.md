# Examples

Each example is now a standalone project initialized with `ast init`.

## Folders

- `01-basic`: Minimal `describe` / `test` / `expect` usage.
- `02-hooks`: `beforeEach` and `afterEach` behavior.
- `03-matchers`: Common numeric, string, and array matchers.
- `04-snapshots`: unnamed and named `toMatchSnapshot` usage.
- `05-mocking-and-imports`: `mockFn`, `unmockFn`, `mockImport`, and `unmockImport`.
- `06-skips`: `xdescribe`, `xtest`, `xit`, and `xexpect`.
- `07-fuzzing`: `fuzz(...)`, custom generators, `ast fuzz`, and `ast test --fuzz`.
- `07-web`: browser-runner example using `default.web.js` and a `web-headless` mode.
- `08-json-as-runner-compare`: compares `as-test` and `as-pect` against the `json-as` test suite in `naive`, `swar`, and `simd` modes.

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
- `07` focuses on the fuzzing workflow and runs `ast test --fuzz`.
- `07-web` needs a runnable browser. Use `npm test` there with `BROWSER` set, or install Chromium / Firefox locally.
- Artifacts are isolated under each example's local `.as-test/` directory.
