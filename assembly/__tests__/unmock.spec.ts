import { expect, it, mockImport, run, unmockImport } from "..";
import { foo, getFoo } from "./mock";

// `unmockImport` keeps the real `@external("mock", "foo")` import alive in the
// wasm so the wrapper can fall back to it. That host binding only exists under
// runtimes where as-test/lib supplies/stubs imports (raw bindings, wasi). It is
// kept separate from mock.spec.ts — which only mocks — so that pure-mock specs
// stay portable to esm bindings, where the real import cannot be resolved.
mockImport("mock.foo", (): string => {
  return "buz";
});

it("should unmock imports", () => {
  unmockImport("mock.foo");
  mockImport("mock.foo", (): string => {
    return "buz";
  });
  expect(foo()).toBe("buz");
  expect(getFoo()).toBe("buz");
});

it("falls back to the real import after unmock without trapping", () => {
  // Because "mock.foo" is unmocked somewhere, the transform keeps its real
  // import (renamed) and the wrapper falls back to it when no mock is set, so
  // calling it here hits the host binding instead of trapping.
  unmockImport("mock.foo");
  foo();
  expect(true).toBe(true);
});

run();
