import {
  describe,
  expect,
  mockFn,
  mockImport,
  test,
  unmockFn,
  unmockImport,
} from "as-test";
import { clockLabel, now } from "./clock";

function localValue(): i32 {
  return 5;
}

mockImport("env.now", (): i32 => {
  return 10;
});

mockFn(localValue, (): i32 => {
  return 99;
});

test("mockFn rewrites following calls", () => {
  expect(localValue()).toBe(99);
});

unmockFn(localValue);

test("unmockFn restores following calls", () => {
  expect(localValue()).toBe(5);
});

describe("05 mocking and imports", () => {
  test("mockImport controls external imports", () => {
    expect(now()).toBe(10);
    expect(clockLabel()).toBe("t=10");
  });

  test("unmockImport clears import mapping", () => {
    unmockImport("env.now");
    mockImport("env.now", (): i32 => {
      return 10;
    });
    expect(now()).toBe(10);
  });
});
