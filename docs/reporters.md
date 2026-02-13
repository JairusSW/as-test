# Custom Reporters

`as-test` supports host-side reporter modules through `runOptions.reporter` in `as-test.config.json`.

## Config

```json
{
  "runOptions": {
    "runtime": {
      "name": "node",
      "run": "node ./tests/<name>.run.js"
    },
    "reporter": "./tests/my-reporter.js"
  }
}
```

Reporter paths are resolved as:

- Absolute path: used as-is
- Relative path: resolved from the config file directory

If `runOptions.reporter` is empty or omitted, the built-in reporter (`cli/reporters/default.ts`) is used.

## Module Contract

A reporter module must export a factory in one of these forms:

- Named export: `createReporter`
- Default export: function
- Default export object containing `createReporter`

The factory receives a context and returns an object with any lifecycle hooks you need.

```ts
export function createReporter(context) {
  return {
    onRunStart(event) {},
    onFileStart(event) {},
    onFileEnd(event) {},
    onSuiteStart(event) {},
    onSuiteEnd(event) {},
    onAssertionFail(event) {},
    onSnapshotMissing(event) {},
    onRunComplete(event) {},
  };
}
```

## Lifecycle Events

- `onRunStart(event)`
  - `{ runtimeName, clean, snapshotEnabled, updateSnapshots }`
- `onFileStart(event)` / `onFileEnd(event)`
- `onSuiteStart(event)` / `onSuiteEnd(event)`
  - Progress event shape:
    - `{ file, depth, suiteKind, description, verdict?, time? }`
- `onAssertionFail(event)`
  - `{ key, instr, left, right, message }`
- `onSnapshotMissing(event)`
  - `{ key }`
- `onRunComplete(event)`
  - `{ clean, snapshotEnabled, showCoverage, snapshotSummary, coverageSummary, stats, reports }`

`snapshotSummary`:

- `{ matched, created, updated, failed }`

`stats`:

- `{ passedFiles, failedFiles, passedSuites, failedSuites, passedTests, failedTests, time, failedEntries }`

`coverageSummary`:

- `{ enabled, total, covered, uncovered, percent, files }`
- each `files[]` item also includes `points[]` with `{ hash, file, line, column, type, executed }`

## Minimal Example

```js
// tests/my-reporter.js
export function createReporter() {
  return {
    onFileEnd(event) {
      const verdict = event.verdict ?? "none";
      process.stdout.write(`${verdict.toUpperCase()} ${event.file} ${event.time ?? ""}\n`);
    },
    onRunComplete(event) {
      process.stdout.write(
        `done: ${event.stats.failedFiles} failed files, ${event.stats.failedTests} failed tests\n`,
      );
    },
  };
}
```
