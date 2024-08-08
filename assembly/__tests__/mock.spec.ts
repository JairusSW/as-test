import { expect, it, log, mockFn, mockImport, run } from "..";
import { foo, getFoo } from "./mock";

// function foo(): string {
//     return "bar";
// }

mockFn(foo, (): string => {
  return "baz " + foo();
});

mockImport("mock.foo", (): string => {
  return "biz";
});

it("should mock functions", () => {
  log(foo());
  expect(foo()).toBe("baz biz");
  expect(getFoo()).toBe("biz");
});

run();
