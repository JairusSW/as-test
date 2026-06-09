# CLAUDE.md

## What this project is

`as-test` is a testing framework for AssemblyScript. Its core design goal is runtime-agnostic testing — tests run against the actual target runtime (WASI, Bindings, Web, or a custom runner) rather than a fixed Node.js shim. It ships as both a CLI (`ast` / `as-test`) and an npm package that consuming projects install as a dev dependency.

## Commands

### Building

There are three independent compilation targets. Each must be rebuilt after changes to its source:

```bash
npm run build:cli        # cli/ → bin/  (TypeScript → JS)
npm run build:lib        # lib/src/ → lib/build/  (runtime library)
npm run build:transform  # transform/src/ → transform/lib/  (ASC plugin)
```

All three together (used before release):

```bash
npm run build:cli && npm run build:lib && npm run build:transform
```

### Testing

```bash
npm test                    # Run as-test's own AssemblyScript specs via --parallel
npm run test:ci             # Same, across the node:bindings/node:wasi/wasmtime modes
npm run test:integration    # Node.js integration tests (requires built cli + lib first)
npm run test:examples       # Run all example projects
```

Run a single integration test file:

```bash
node --test tests/coverage-config.test.mjs
```

Run a single AssemblyScript spec by substring match:

```bash
node ./bin/index.js test expectation
```

Re-run one suite inside a matching file:

```bash
node ./bin/index.js run expectation --suite "expectations/toBe"
```

### Type-checking and linting

```bash
npm run typecheck   # tsc --noEmit across cli/, lib/, and transform/
npm run lint        # ESLint on transform/src/ and tools/
npm run format      # Prettier across everything
```

### Full release check

```bash
npm run release:check   # builds, tests, integration, examples, dry-run pack
```

## Architecture

### Three distinct compilation targets

| Source           | Output           | Role                                                    |
| ---------------- | ---------------- | ------------------------------------------------------- |
| `cli/`           | `bin/`           | Node.js CLI — orchestration, config, reporting          |
| `lib/src/`       | `lib/build/`     | Shared JS runtime host — `instantiate()` for runners    |
| `transform/src/` | `transform/lib/` | AssemblyScript compiler plugin — source instrumentation |

The `assembly/` directory is AssemblyScript source; it is not compiled by TypeScript and ships as-is into consuming projects.

**Important:** `bin/` is generated output. Always edit `cli/` and rebuild. Same for `lib/build/` (edit `lib/src/`) and `transform/lib/` (edit `transform/src/`).

### How a test run works end-to-end

1. **CLI** (`bin/index.js`) resolves config via `cli/util.ts:loadConfig` + `applyMode`, then calls `run-core.ts`.
2. **Build phase** (`cli/commands/build-core.ts`): invokes `asc` (the AssemblyScript compiler) on each spec file with `--transform as-test/transform`. The transform plugin runs at compile time.
3. **Transform** (`transform/src/index.ts` → `afterParse`): visits every non-stdlib AST source and applies four passes:
   - `CoverageTransform` — inserts `__REGISTER_RAW(...)` + `__COVER(hash)` calls
   - `MockTransform` — rewrites `mockFn`/`mockImport` calls
   - `LocationTransform` — injects file/line/column into `expect()` calls
   - `LogTransform` — injects source location into `log()` calls
   - Auto-injects `run()` if the entry file has test suites but no explicit `run()` call
4. **Run phase** (`cli/commands/run-core.ts`): spawns the compiled `.wasm` via the runner (`default.wasi.js`, `default.bindings.js`, etc.). The runner uses `lib/build/index.js`'s `instantiate()`.
5. **IPC** (`cli/wipc.ts` ↔ `assembly/util/wipc.ts`): the wasm process and the CLI communicate over stdin/stdout using a framed binary protocol (4-byte `WIPC` magic, 1-byte type, 4-byte length). Test results, coverage points, snapshots, and fuzz data all flow this way.
6. **Reporting**: the runner collects all results and passes them to the single built-in renderer (`cli/render/renderer.ts`).

### Key files to know

- `cli/commands/run-core.ts` — largest file (~3500 lines); owns the entire test execution pipeline including snapshot management, coverage collection, browser automation, and the `__coverageInternals` export used by integration tests
- `cli/util.ts` — config loading, `applyMode` (mode inheritance), `validateConfig`, and CLI utilities
- `cli/types.ts` — all config/runtime type definitions (`Config`, `CoverageOptions`, `ModeConfig`, etc.)
- `transform/src/coverage.ts` — coverage instrumentation (~810 lines); assigns hashes and point types (`Function`, `Return`, `IfBranch`, `Loop`, `Ternary`, `Assignment`, `Throw`)
- `assembly/index.ts` — exports all public test APIs (`describe`, `test`, `expect`, `mockFn`, `beforeEach`, etc.) and manages the global suite registry
- `assembly/coverage.ts` — runtime coverage tracking (`__REGISTER_RAW`, `__COVER`, `__ALL_POINTS`)

### Mode system

Modes are named execution contexts inside `as-test.config.json`. A mode can override any top-level config field. `applyMode` in `cli/util.ts` deep-merges a named mode onto the base config. Modes can also point to an external config file path (string value instead of object). `"default": false` excludes a mode from normal `ast test` runs while keeping it accessible via `--mode`.

### Coverage internals

Coverage filtering runs entirely in the CLI after collecting runtime points. The relevant functions in `cli/commands/run-core.ts` are:

- `isIgnoredCoverageFile(file, options)` — decides whether a file's points are included; checks file extension, then stdlib detection, then `mode`/`dependencies` classification
- `isAssemblyScriptStdlibFile(file)` — uses `AS_STDLIB_ROOT_NAMES` (a set of known stdlib root names) to distinguish real stdlib (`~lib/array.ts`) from third-party packages (`~lib/json-as/...`). This matters because AssemblyScript normalizes `node_modules/<pkg>/...` to `~lib/<pkg>/...` in `Source.normalizedPath`, which is what coverage points carry.
- `resolveCoverageDependencyPackage(file)` — handles both `node_modules/...` (synthetic/pnpm paths) and `~lib/<pkg>/...` (the actual AS runtime path format). Both are needed for `coverage.mode` and `coverage.dependencies` to work end-to-end.

The transform's own stdlib filter (`transform/src/util.ts:isStdlib`) uses a named-module regex on `internalPath` at compile time; the CLI's `AS_STDLIB_ROOT_NAMES` set serves the same purpose at report time against `normalizedPath`.

### Integration tests

`tests/*.test.mjs` use Node's built-in `node:test` runner. They import directly from `bin/` (compiled output). Some expose internal functions via named exports like `__coverageInternals` from `run-core.js`. Always rebuild `cli/` before running integration tests.

### Rendering

There is a single built-in renderer — no pluggable reporter layer. `cli/render/renderer.ts` exports `TestRenderer` (the human/console output: live TTY blocks, summaries, coverage, logs, fuzz) and `SilentRenderer` (a no-op used by the parallel matrix paths, which format their own result lines). `run-core.ts:createRenderer()` constructs one bound to the given streams; the parallel paths in `cli/index.ts` point a `TestRenderer` at a buffered stream (`createBufferedRenderer`) so each spec's output can be dumped as a block. Event payload types live in `cli/render/types.ts`.
