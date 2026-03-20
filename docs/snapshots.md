# Snapshots

Snapshot assertions compare the current value to a stored snapshot.

Example:

```ts
import { test, expect } from "as-test";

test("serializes payload", () => {
  expect("hello").toMatchSnapshot("greeting");
});
```

Useful commands:

```bash
ast test
ast test --update-snapshots
ast test --no-snapshot
```

Behavior:

- snapshots are stored in the configured snapshot directory
- `--update-snapshots` writes new or changed values
- `--no-snapshot` disables snapshot assertions for the run

See also:

- [Configuration](./configuration.md)
- [CLI Guide](./cli.md)
