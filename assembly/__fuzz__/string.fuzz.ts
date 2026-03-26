import { expect, fuzz, FuzzSeed } from "as-test";

fuzz(
  "ascii strings survive concatenation boundaries",
  (input: string): bool => {
    const wrapped = "[" + input + "]";
    const restored = wrapped.substr(1, input.length);

    expect(restored).toBe(input);
    return input.length <= 40;
  },
).generate((seed: FuzzSeed, run: (input: string) => bool): void => {
  run(
    seed.string({
      charset: "ascii",
      min: 0,
      max: 40,
      exclude: [0x00, 0x0a, 0x0d],
    }),
  );
});
