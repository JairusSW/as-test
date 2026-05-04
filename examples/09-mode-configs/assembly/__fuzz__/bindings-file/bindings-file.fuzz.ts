import { expect, FuzzSeed, fuzz } from "as-test";

fuzz("bindings file fuzz target", (value: string): bool => {
  expect(value.length <= 20).toBe(true);
  return value.length > 0;
}, 10).generate((seed: FuzzSeed, run: (value: string) => bool): void => {
  run(
    seed.string({
      charset: "identifier",
      min: 1,
      max: 20,
    }),
  );
});
