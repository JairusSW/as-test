# Configuration

Main config file: `as-test.config.json`

Minimal example:

```json
{
  "input": ["assembly/__tests__/*.spec.ts"],
  "output": ".as-test/",
  "buildOptions": {
    "target": "wasi"
  },
  "runOptions": {
    "runtime": {
      "cmd": "node .as-test/runners/default.wasi.js <file>"
    }
  }
}
```

Important fields:

- `input`: spec file globs
- `output`: root output directory, or an object with explicit output paths
- `env`: environment variables passed to build and runtime processes
- `buildOptions.target`: `wasi`, `bindings`, or `web`
- `buildOptions.cmd`: optional custom build command template
- `runOptions.runtime.cmd`: runtime command template
- `runOptions.reporter`: reporter selection
- `modes`: named mode overrides selected with `--mode`

Fuzz config:

```json
{
  "fuzz": {
    "input": ["assembly/__fuzz__/*.fuzz.ts"],
    "runs": 1000,
    "seed": 1337,
    "target": "bindings",
    "corpusDir": ".as-test/fuzz/corpus",
    "crashDir": ".as-test/fuzz/crashes"
  }
}
```

Current fuzz fields:

- `fuzz.input`
- `fuzz.runs`
- `fuzz.seed`
- `fuzz.target`
- `fuzz.corpusDir`
- `fuzz.crashDir`

Validation behavior:

- config parsing is strict
- unknown keys fail validation
- invalid types fail validation
- `ast doctor` is the fastest way to check config issues
