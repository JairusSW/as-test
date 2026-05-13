import { expect, FuzzSeed, fuzz } from "as-test";

fuzz(
  "shared root fuzz target",
  (value: string): bool => {
    expect(value.length > 0).toBe(true);
    return value.length <= 16;
  },
  15,
).generate((seed: FuzzSeed, run: (value: string) => bool): void => {
  run(
    seed.string({
      charset: "identifier",
      min: 1,
      max: 16,
    }),
  );
});
