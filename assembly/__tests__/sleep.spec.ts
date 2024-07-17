import { describe, expect, log, run, test } from "..";
import { sleep } from "as-sleep/assembly";
describe("Should sleep", () => {
  test("1ms", () => {
    const start = Date.now();
    sleep(1);
    expect(Date.now() - start).toBeGreaterOrEqualTo(1);
  });
  test("10ms", () => {
    const start = Date.now();
    sleep(10);
    expect(Date.now() - start).toBeGreaterOrEqualTo(10);
  });
  test("1s", () => {
    const start = Date.now();
    sleep(1000);
    expect(Date.now() - start).toBeGreaterOrEqualTo(1000);
  });
  test("5s", () => {
    const start = Date.now();
    log("Sleeping...");
    sleep(5000);
    log("Done!");
    expect(Date.now() - start).toBeGreaterOrEqualTo(5000);
  });
});

run();
