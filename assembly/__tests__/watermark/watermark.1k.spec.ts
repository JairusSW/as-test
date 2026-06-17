import { describe, expect, test } from "../..";

// 1000 expect().toBe()s driven at runtime. A loop compiles to a single call
// site (instant asc build, no per-expect data segment), unlike unrolled
// literals, while still exercising 1000 assertions + report entries.
describe("watermark 1k", () => {
  test("loop", () => {
    for (let i = 0; i < 1000; i++) {
      expect(i).toBe(i);
    }
  });
});
