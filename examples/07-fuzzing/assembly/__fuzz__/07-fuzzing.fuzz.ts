import { expect, FuzzSeed, fuzz } from "as-test";

fuzz("ascii identifiers stay non-empty", (value: string): bool => {
  expect(value.length > 0).toBe(true);
  return value.length <= 24;
}, 250).generate((seed: FuzzSeed, run: (value: string) => bool): void => {
  run(
    seed.string({
      charset: "identifier",
      min: 1,
      max: 24,
    }),
  );
});
