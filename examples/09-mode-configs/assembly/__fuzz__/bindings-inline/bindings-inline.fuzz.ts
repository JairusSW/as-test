import { expect, FuzzSeed, fuzz } from "as-test";

fuzz("bindings inline fuzz target", (value: string): bool => {
  expect(value.length > 0).toBe(true);
  return value.indexOf(" ") < 0;
}, 12).generate((seed: FuzzSeed, run: (value: string) => bool): void => {
  run(
    seed.string({
      charset: "identifier",
      min: 1,
      max: 12,
    }),
  );
});
