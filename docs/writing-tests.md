# Writing Tests

Basic test file:

```ts
import { describe, test, expect } from "as-test";

describe("math", () => {
  test("addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("close to", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
  });
});
```

Useful APIs:

- `describe(name, callback)`
- `test(name, callback)`
- `it(name, callback)`
- `xdescribe`, `xtest`, `xit` for skipped cases
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`
- `expect(value, message?)`

Run tests:

```bash
ast test
ast test math
ast test ./assembly/__tests__/*.spec.ts
```

Selectors:

- bare names resolve against configured `input` globs
- explicit file paths and globs are supported
- comma-separated bare selectors also work, for example `ast test math,array,string`

See also:

- [CLI Guide](./cli.md)
- [Configuration](./configuration.md)
- [Snapshots](./snapshots.md)
