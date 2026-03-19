# CLI Guide

Main commands:

- `ast init`
- `ast build`
- `ast run`
- `ast test`
- `ast fuzz`
- `ast doctor`

Examples:

```bash
ast test
ast test math,array
ast test --mode wasi,web-headless
ast test --list
ast fuzz
ast fuzz parser --runs 5000 --seed 42
ast doctor
```

Common flags:

- `--config <path>`
- `--mode <name[,name...]>`
- `--list`
- `--list-modes`
- `--verbose`
- `--clean`
- `--enable <feature>`
- `--disable <feature>`

Test-specific:

- `--update-snapshots`
- `--no-snapshot`
- `--show-coverage`
- `--fuzz`
- `--fuzz-runs <n>`
- `--fuzz-seed <n>`

Fuzz-specific:

- `--runs <n>`
- `--seed <n>`

Selector rules:

- bare names resolve against configured input directories
- explicit file paths and globs are accepted
- comma-separated bare names are expanded, for example `ast test math,array,string`
