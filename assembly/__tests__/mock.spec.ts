import {
  expect,
  it,
  mockFn,
  mockImport,
  restoreImport,
  run,
  snapshotImport,
  unmockFn,
  unmockImport,
} from "..";
import { foo, getFoo } from "./mock";

mockFn(foo, (): string => {
  return "baz " + foo(); // nested foo() should still call the original
});

mockImport("mock.foo", (): string => {
  return "buz";
});

it("should mock functions", () => {
  expect(foo()).toBe("baz buz");
});

unmockFn(foo);

it("should unmock functions", () => {
  expect(foo()).toBe("buz");
});

it("should mock imports", () => {
  mockImport("mock.foo", (): string => {
    return "biz";
  });
  expect(foo()).toBe("biz");
  expect(getFoo()).toBe("biz");
});

it("should snapshot and restore imports by function|string and string|i32 version", () => {
  snapshotImport(foo, 1);
  mockImport("mock.foo", (): string => {
    return "snap";
  });
  snapshotImport("mock.foo", "v2");
  mockImport("mock.foo", (): string => {
    return "zap";
  });
  expect(foo()).toBe("zap");
  expect(getFoo()).toBe("zap");

  restoreImport("mock.foo", "v2");
  expect(foo()).toBe("snap");
  expect(getFoo()).toBe("snap");

  restoreImport(foo, 1);
  expect(foo()).toBe("biz");
  expect(getFoo()).toBe("biz");
});

it("should support callback snapshot syntax", () => {
  mockImport("mock.foo", (): string => {
    return "biz";
  });
  snapshotImport("mock.foo", (): string => {
    return foo();
  });
  mockImport("mock.foo", (): string => {
    return "zip";
  });
  expect(foo()).toBe("zip");
  restoreImport("mock.foo", "default");
  expect(foo()).toBe("biz");
});

it("should unmock imports", () => {
  unmockImport("mock.foo");
  mockImport("mock.foo", (): string => {
    return "buz";
  });
  expect(foo()).toBe("buz");
  expect(getFoo()).toBe("buz");
});

run();
