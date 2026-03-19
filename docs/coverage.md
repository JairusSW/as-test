# Coverage

Coverage is enabled by default in most setups and reported after test runs.

Run with coverage output:

```bash
ast test
ast test --show-coverage
```

Config:

```json
{
  "coverage": true
}
```

or:

```json
{
  "coverage": {
    "enabled": true,
    "includeSpecs": false
  }
}
```

Behavior:

- coverage is collected from instrumented AssemblyScript sources
- standard library and node_modules paths are excluded
- `--show-coverage` prints uncovered points in the terminal
- coverage artifacts are written to the configured coverage directory
