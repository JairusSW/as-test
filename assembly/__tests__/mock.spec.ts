import { expect, it, mockFn, mockImport, run, unmockFn } from "..";
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

run();
