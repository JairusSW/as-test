import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("byte-sized integers stay within range", (value: i32): bool => {
  expect(value >= 0).toBe(true);
  return value <= 255;
}).generate((seed: FuzzSeed, run: (value: i32) => bool): void => {
  run(seed.i32({ min: 0, max: 255 }));
});
