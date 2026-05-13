import {
  fuzz,
  FuzzSeed,
  IntegerOptions,
  FloatOptions,
  StringOptions,
  BytesOptions,
  ArrayOptions,
} from "as-test";

const PERF_I32 = new IntegerOptions<i32>();
PERF_I32.min = -100000;
PERF_I32.max = 100000;
const PERF_U32 = new IntegerOptions<u32>();
PERF_U32.min = 0;
PERF_U32.max = 1000000;
const PERF_F64 = new FloatOptions<f64>();
PERF_F64.min = -1.0;
PERF_F64.max = 1.0;
const PERF_ASCII = new StringOptions();
PERF_ASCII.charset = "ascii";
PERF_ASCII.min = 4;
PERF_ASCII.max = 24;
const PERF_BYTES = new BytesOptions();
PERF_BYTES.min = 8;
PERF_BYTES.max = 32;
const PERF_ARRAY = new ArrayOptions();
PERF_ARRAY.min = 4;
PERF_ARRAY.max = 16;

fuzz("seed perf i32/u32/f64", (_n: i32): bool => true).generate(
  (seed: FuzzSeed, run: (n: i32) => bool): void => {
    let accI: i32 = 0;
    let accU: u32 = 0;
    let accF: f64 = 0.0;
    for (let i = 0; i < 128; i++) {
      accI += seed.i32(PERF_I32);
      accU ^= seed.u32(PERF_U32);
      accF += seed.f64(PERF_F64);
    }
    run(accI + <i32>accU + <i32>accF);
  },
  20000,
);

fuzz("seed perf strings", (_n: i32): bool => true).generate(
  (seed: FuzzSeed, run: (n: i32) => bool): void => {
    let total = 0;
    for (let i = 0; i < 96; i++) {
      total += seed.string(PERF_ASCII).length;
    }
    run(total);
  },
  20000,
);

fuzz("seed perf bytes/array", (_n: i32): bool => true).generate(
  (seed: FuzzSeed, run: (n: i32) => bool): void => {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      score += seed.bytes(PERF_BYTES).length;
      score += seed.array<i32>(
        (s) => s.i32({ min: -9, max: 9 }),
        PERF_ARRAY,
      ).length;
    }
    run(score);
  },
  20000,
);
