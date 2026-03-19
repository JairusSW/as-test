# Fuzzing

Fuzzers live separately from specs, usually in `assembly/__fuzz__/*.fuzz.ts`.

Example:

```ts
import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("bounded integer addition", (left: i32, right: i32): bool => {
  const sum = left + right;
  expect(sum - right).toBe(left);
  return sum >= i32.MIN_VALUE;
}).generate((seed: FuzzSeed, run: (left: i32, right: i32) => bool): void => {
  run(
    seed.i32({ min: -1000, max: 1000 }),
    seed.i32({ min: -1000, max: 1000 }),
  );
});
```

Commands:

```bash
ast fuzz
ast fuzz math --runs 10000 --seed 42
ast test --fuzz
ast test --fuzz --fuzz-runs 10000 --fuzz-seed 42
```

Evaluation rules:

- a thrown error or trap is a crash
- a failed `expect(...)` is a failure
- returning `false` is a failure
- returning `true` or `void` passes if no assertion failed

Built-in seed helpers:

- `seed.boolean()`
- `seed.i32({ min, max, exclude })`
- `seed.u32({ min, max, exclude })`
- `seed.f32({ min, max, exclude })`
- `seed.f64({ min, max, exclude })`
- `seed.bytes({ min, max, include, exclude })`
- `seed.buffer({ min, max, include, exclude })`
- `seed.string({ charset, min, max, include, exclude, prefix, suffix })`
- `seed.array((seed) => value, { min, max })`
- `seed.pick(values)`

Supported string charsets:

- `ascii`
- `alpha`
- `alnum`
- `digit`
- `hex`
- `base64`
- `identifier`
- `whitespace`
- `custom`

Notes:

- fuzzers are registered separately from tests
- `ast test` does not run fuzzers unless `--fuzz` is set
- `ast fuzz` always builds fuzz targets as `bindings`
- failures are reported in a fuzz summary, not in normal test counts
- generator callback parameters currently need explicit type annotations in AssemblyScript

Related guides:

- [Configuration](./configuration.md)
- [CLI Guide](./cli.md)
