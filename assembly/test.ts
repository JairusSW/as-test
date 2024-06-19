import { describe, expect, run } from ".";

describe("Should create suite successfully", () => {
    expect("foo joe momma joe mommmmma").toBe("booq2132132312");
    expect("abcdefg").not.toBe("abcdefg");
    expect("hello").toBe("hello");
    expect<Nullable | null>(null).toBeNull();
    expect(5).toBeGreaterOrEqualTo(9)
});

class Nullable { }

run();