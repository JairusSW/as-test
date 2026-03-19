import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("index windows stay ordered", (start: i32, end: i32): bool => {
  expect(start <= end).toBe(true);
  return end - start <= 64;
}).generate((seed: FuzzSeed, run: (start: i32, end: i32) => bool): void => {
  const start = seed.i32({ min: 0, max: 64 });
  const width = seed.i32({ min: 0, max: 64 });
  run(start, start + width);
});
