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
}, 250);

fuzz(
  "string matchers stay consistent on derived slices",
  (input: string): bool => {
    const split = input.length >> 1;
    const prefix = input.substr(0, split);
    const suffix = input.substr(split);

    expect(input).toBeString();
    expect(input).toContain(prefix);
    expect(input).toMatch(suffix);

    if (input.length > 0) {
      expect(input).toBeTruthy();
      expect(input).toContain(input.charAt(input.length - 1));
    } else {
      expect(input).toBeFalsy();
    }

    return true;
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
}, 250);
