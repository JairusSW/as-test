# Mocking

`as-test` supports direct function mocking and import-path mocking.

Function mocks:

```ts
import { mockFn, unmockFn, test, expect } from "as-test";
import { add } from "../math";

test("can mock a function", () => {
  mockFn(add, (a: i32, b: i32): i32 => 99);
  expect(add(1, 2)).toBe(99);
  unmockFn(add);
});
```

Import mocks:

```ts
import { mockImport, unmockImport, test, expect } from "as-test";
import { readValue } from "../reader";

test("can mock an import", () => {
  mockImport("env.read", (): i32 => 7);
  expect(readValue()).toBe(7);
  unmockImport("env.read");
});
```

Import snapshots:

```ts
import { snapshotImport, restoreImport } from "as-test";

snapshotImport("env.read", "baseline");
restoreImport("env.read", "baseline");
```

Use import snapshots when the mock configuration changes during one run and needs to be restored later.
