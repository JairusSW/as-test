import { describe, expect, it, log, run, test } from "..";
import { sleep } from "as-sleep/assembly";
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
  it("100ms", () => {
    const start = Date.now();
    sleep(100);
    expect(Date.now() - start).toBeGreaterOrEqualTo(100);
  });
  it("1s", () => {
    const start = Date.now();
    log("Sleeping...");
    sleep(1000);
    log("Done!");
    expect(Date.now() - start).toBeGreaterOrEqualTo(1000);
  });
});

run();
