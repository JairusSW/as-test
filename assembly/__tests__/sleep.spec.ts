import { sleep } from "as-sleep/assembly";
import { describe, expect, it } from "as-test";
describe("Should sleep", () => {
  it("1ms", () => {
    const start = Date.now();
    sleep(1);
    expect(Date.now() - start).toBeGreaterOrEqualTo(1);
  });
  it("10ms", () => {
    const start = Date.now();
    sleep(10);
    expect(Date.now() - start).toBeGreaterOrEqualTo(10);
  });
});
