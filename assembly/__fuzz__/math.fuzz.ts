import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("bounded integer addition", (left: i32, right: i32): bool => {
  const sum = left + right;
  expect(sum - right).toBe(left);
  return sum >= i32.MIN_VALUE; // Fails if an expectation fails or false is returned
}).generate((seed: FuzzSeed, run: (left: i32, right: i32) => bool): void => {
  run(
    seed.i32({ min: -1000, max: 1000 }),
    seed.i32({ min: -1000, max: 1000 }),
  );
});
