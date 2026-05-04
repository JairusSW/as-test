# 09 Mode Configs

This example demonstrates the newer mode model:

- a mode can be an inline config object
- a mode can point to a separate `as-test` config file
- a mode can replace the active fuzz config while also changing runtime/build settings
- the root/default path can stay separate through a root-only config file when you want scripts that do not fan out into named modes

## Modes

- default: uses the root config and runs the shared WASI spec/fuzzer set
- `bindings-inline`: an inline mode object that swaps to a bindings-only fuzz config
- `bindings-file`: a string path mode that loads `./as-test.config.bindings-file.json`

The example keeps the default/root scripts on dedicated root-only configs so:

- `npm run test:default` exercises only the shared root config
- `npm run test:fuzz` exercises only the shared root fuzz target through `./as-test.config.root-fuzz.json` and its explicit `root-fuzz` mode
- mode-specific scripts still use `./as-test.config.json`

## Commands

```bash
npm test
npm run test:inline
npm run test:file
npm run test:fuzz
npm run test:fuzz:inline
npm run test:fuzz:file
```

`npm test` only runs the stable spec-side paths for this example. The fuzz scripts are kept as focused manual commands because the current CLI still has a mode-scoped fuzz artifact naming issue.

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
