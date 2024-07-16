import { describe, expect, run, test } from "..";
import { sleep } from "as-sleep/assembly";
describe("Should sleep", () => {
    test("1ms", () => {
        sleep(1);
        expect(1).toBe(1);
    });
    test("10ms", () => {
        sleep(10);
        expect(1).toBe(1);
    });
    test("100ms", () => {
        sleep(100);
        expect(1).toBe(1);
    });
    test("1s", () => {
        sleep(1000);
        expect(1).toBe(1);
    });
});

run();