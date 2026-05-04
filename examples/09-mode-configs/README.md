# 09 Mode Configs

This example demonstrates the newer mode model:

- a mode can be an inline config object
- a mode can point to a separate `as-test` config file
- a mode can replace the active fuzz config while also changing runtime/build settings

## Modes

- default: uses the root config and runs the shared WASI spec/fuzzer set
- `bindings-inline`: an inline mode object that swaps to a bindings-only fuzz config
- `bindings-file`: a string path mode that loads `./as-test.config.bindings-file.json`

## Commands

```bash
npm test
npm run test:inline
npm run test:file
npm run test:fuzz
npm run test:fuzz:inline
npm run test:fuzz:file
```

## Key Config Shape

```json
{
  "modes": {
    "bindings-inline": {
      "fuzz": {
        "input": ["./assembly/__fuzz__/bindings-inline/*.fuzz.ts"]
      }
    },
    "bindings-file": "./as-test.config.bindings-file.json"
  }
}
```
