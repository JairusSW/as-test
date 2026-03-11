import {
  describe,
  expect,
  mockFn,
  mockImport,
  restoreImport,
  run,
  snapshotImport,
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

describe("05 mocking and import snapshots", () => {
  test("mockImport controls external imports", () => {
    expect(now()).toBe(10);
    expect(clockLabel()).toBe("t=10");
  });

  test("snapshotImport/restoreImport with version", () => {
    snapshotImport(now, 1);
    mockImport("env.now", (): i32 => {
      return 22;
    });
    expect(now()).toBe(22);

    restoreImport(now, 1);
    expect(now()).toBe(10);
  });

  test("snapshotImport callback form uses default version", () => {
    snapshotImport("env.now", (): i32 => {
      return now();
    });
    mockImport("env.now", (): i32 => {
      return 35;
    });
    expect(now()).toBe(35);

    restoreImport("env.now", "default");
    expect(now()).toBe(10);
  });

  test("unmockImport clears import mapping", () => {
    unmockImport("env.now");
    mockImport("env.now", (): i32 => {
      return 10;
    });
    expect(now()).toBe(10);
  });
});

run();
