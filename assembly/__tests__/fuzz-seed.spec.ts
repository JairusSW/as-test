import { describe, expect, FuzzSeed, IntegerOptions, test } from "..";

function createOptionsI8(): IntegerOptions<i8> {
  const options = new IntegerOptions<i8>();
  options.min = -5;
  options.max = 5;
  options.exclude = [<i8>-1, <i8>0, <i8>1];
  return options;
}

function createOptionsU8(): IntegerOptions<u8> {
  const options = new IntegerOptions<u8>();
  options.min = 2;
  options.max = 9;
  options.exclude = [<u8>4, <u8>8];
  return options;
}

function createOptionsI16(): IntegerOptions<i16> {
  const options = new IntegerOptions<i16>();
  options.min = -320;
  options.max = 320;
  options.exclude = [<i16>-10, <i16>10];
  return options;
}

function createOptionsU16(): IntegerOptions<u16> {
  const options = new IntegerOptions<u16>();
  options.min = 10;
  options.max = 1024;
  options.exclude = [<u16>12, <u16>256];
  return options;
}

function createOptionsI64(): IntegerOptions<i64> {
  const options = new IntegerOptions<i64>();
  options.min = -900000000000;
  options.max = 900000000000;
  options.exclude = [<i64>-7, <i64>0, <i64>7];
  return options;
}

function createOptionsU64(): IntegerOptions<u64> {
  const options = new IntegerOptions<u64>();
  options.min = 5;
  options.max = 900000000000;
  options.exclude = [<u64>8, <u64>16];
  return options;
}

describe("FuzzSeed primitive generators", () => {
  test("defaults integer generators to the full type range", () => {
    const seed = new FuzzSeed(123);

    let sawNegativeI8 = false;
    let sawPositiveI8 = false;
    let sawNegativeI16 = false;
    let sawPositiveI16 = false;
    let sawNegativeI32 = false;
    let sawPositiveI32 = false;
    let sawNegativeI64 = false;
    let sawPositiveI64 = false;
    let sawNonZeroU8 = false;
    let sawNonZeroU16 = false;
    let sawNonZeroU32 = false;
    let sawNonZeroU64 = false;

    for (let i = 0; i < 256; i++) {
      const i8Value = seed.i8();
      if (i8Value < 0) sawNegativeI8 = true;
      if (i8Value > 0) sawPositiveI8 = true;

      const i16Value = seed.i16();
      if (i16Value < 0) sawNegativeI16 = true;
      if (i16Value > 0) sawPositiveI16 = true;

      const i32Value = seed.i32();
      if (i32Value < 0) sawNegativeI32 = true;
      if (i32Value > 0) sawPositiveI32 = true;

      const i64Value = seed.i64();
      if (i64Value < 0) sawNegativeI64 = true;
      if (i64Value > 0) sawPositiveI64 = true;

      if (seed.u8() != 0) sawNonZeroU8 = true;
      if (seed.u16() != 0) sawNonZeroU16 = true;
      if (seed.u32() != 0) sawNonZeroU32 = true;
      if (seed.u64() != 0) sawNonZeroU64 = true;
    }

    expect(sawNegativeI8).toBe(true);
    expect(sawPositiveI8).toBe(true);
    expect(sawNegativeI16).toBe(true);
    expect(sawPositiveI16).toBe(true);
    expect(sawNegativeI32).toBe(true);
    expect(sawPositiveI32).toBe(true);
    expect(sawNegativeI64).toBe(true);
    expect(sawPositiveI64).toBe(true);
    expect(sawNonZeroU8).toBe(true);
    expect(sawNonZeroU16).toBe(true);
    expect(sawNonZeroU32).toBe(true);
    expect(sawNonZeroU64).toBe(true);
  });

  test("supports i8/u8/i16/u16 ranges and exclusions", () => {
    const seed = new FuzzSeed(42);
    const i8Options = createOptionsI8();
    const u8Options = createOptionsU8();
    const i16Options = createOptionsI16();
    const u16Options = createOptionsU16();
    let i8InRange = true;
    let i8Excluded = false;
    let u8InRange = true;
    let u8Excluded = false;
    let i16InRange = true;
    let i16Excluded = false;
    let u16InRange = true;
    let u16Excluded = false;

    for (let i = 0; i < 64; i++) {
      const i8Value = seed.i8(i8Options);
      if (i8Value < i8Options.min || i8Value > i8Options.max) i8InRange = false;
      if (i8Value == -1 || i8Value == 0 || i8Value == 1) i8Excluded = true;

      const u8Value = seed.u8(u8Options);
      if (u8Value < u8Options.min || u8Value > u8Options.max) u8InRange = false;
      if (u8Value == 4 || u8Value == 8) u8Excluded = true;

      const i16Value = seed.i16(i16Options);
      if (i16Value < i16Options.min || i16Value > i16Options.max) {
        i16InRange = false;
      }
      if (i16Value == -10 || i16Value == 10) i16Excluded = true;

      const u16Value = seed.u16(u16Options);
      if (u16Value < u16Options.min || u16Value > u16Options.max) {
        u16InRange = false;
      }
      if (u16Value == 12 || u16Value == 256) u16Excluded = true;
    }

    expect(i8InRange).toBe(true);
    expect(i8Excluded).toBe(false);
    expect(u8InRange).toBe(true);
    expect(u8Excluded).toBe(false);
    expect(i16InRange).toBe(true);
    expect(i16Excluded).toBe(false);
    expect(u16InRange).toBe(true);
    expect(u16Excluded).toBe(false);
  });

  test("supports i64/u64 ranges and exclusions", () => {
    const seed = new FuzzSeed(1337);
    const i64Options = createOptionsI64();
    const u64Options = createOptionsU64();
    let i64InRange = true;
    let i64Excluded = false;
    let u64InRange = true;
    let u64Excluded = false;

    for (let i = 0; i < 64; i++) {
      const i64Value = seed.i64(i64Options);
      if (i64Value < i64Options.min || i64Value > i64Options.max) {
        i64InRange = false;
      }
      if (i64Value == -7 || i64Value == 0 || i64Value == 7) i64Excluded = true;

      const u64Value = seed.u64(u64Options);
      if (u64Value < u64Options.min || u64Value > u64Options.max) {
        u64InRange = false;
      }
      if (u64Value == 8 || u64Value == 16) u64Excluded = true;
    }

    expect(i64InRange).toBe(true);
    expect(i64Excluded).toBe(false);
    expect(u64InRange).toBe(true);
    expect(u64Excluded).toBe(false);
  });

  test("supports bool as an alias of boolean", () => {
    const left = new FuzzSeed(999);
    const right = new FuzzSeed(999);

    for (let i = 0; i < 64; i++) {
      expect(left.bool()).toBe(right.boolean());
    }
  });
});
