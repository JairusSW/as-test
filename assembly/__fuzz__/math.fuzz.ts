import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("bounded integer addition", (left: i32, right: i32): bool => {
  const sum = left + right;
  expect(sum - right).toBe(left);
  return sum >= i32.MIN_VALUE; // Fails if an expectation fails or false is returned
}).generate((seed: FuzzSeed, run: (left: i32, right: i32) => bool): void => {
  run(seed.i32({ min: -1000, max: 1000 }), seed.i32({ min: -1000, max: 1000 }));
});

fuzz("numeric matchers stay consistent for bounded integers", (value: i32): bool => {
  expect(value).toBeNumber();
  expect(value).toBeInteger();
  expect(value).toBeFinite();
  expect(value).toBe(value);
  expect(value).toBeGreaterOrEqualTo(-1000);
  expect(value).toBeLessThanOrEqualTo(1000);

  if (value != 0) {
    expect(value).toBeTruthy();
  } else {
    expect(value).toBeFalsy();
  }

  return true;
}).generate((seed: FuzzSeed, run: (value: i32) => bool): void => {
  run(seed.i32({ min: -1000, max: 1000 }));
}, 250);
