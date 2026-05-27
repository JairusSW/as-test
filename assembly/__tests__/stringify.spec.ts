// Exercises the in-tree stringifier in `assembly/src/stringify.ts`. Two
// directions:
//
//   1. JSON-string `escape` — including surrogate pairs and lone
//      surrogates (matches json-as's serializeString behaviour).
//   2. The `__as_test_stringify` runtime hook used by the matchers'
//      assertion-report payload — exercised indirectly through
//      `expect(...).toBe(...)` on values that need it.

import { describe, expect, test } from "..";
import { __as_test_stringify } from "..";

// `__as_test_stringify` is the helper the EqualsTransform-generated
// `toJSON()` calls into.

// Class with no decorator + no hand-written toJSON. The transform should
// inject a `toJSON(): string` that produces a flat JSON object.
class Plain {
  a: i32 = 0;
  b: string = "";

  constructor(a: i32, b: string) {
    this.a = a;
    this.b = b;
  }
}

// Class with a hand-written toJSON — must be left alone by the
// transform.
class CustomJSON {
  v: i32 = 0;

  constructor(v: i32) {
    this.v = v;
  }

  toJSON(): string {
    return '{"custom":' + this.v.toString() + "}";
  }
}

describe("stringify: escape", () => {
  test("ASCII passes through", () => {
    expect(__as_test_stringify<string>("hello")).toBe('"hello"');
  });

  test("backslash and quote are escaped", () => {
    expect(__as_test_stringify<string>('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  test("control characters use named escapes", () => {
    expect(__as_test_stringify<string>("\b")).toBe('"\\b"');
    expect(__as_test_stringify<string>("\t")).toBe('"\\t"');
    expect(__as_test_stringify<string>("\n")).toBe('"\\n"');
    expect(__as_test_stringify<string>("\f")).toBe('"\\f"');
    expect(__as_test_stringify<string>("\r")).toBe('"\\r"');
  });

  test("other control characters use \\u00XX", () => {
    expect(__as_test_stringify<string>(String.fromCharCode(0x01))).toBe(
      '"\\u0001"',
    );
    expect(__as_test_stringify<string>(String.fromCharCode(0x1f))).toBe(
      '"\\u001f"',
    );
  });

  test("valid surrogate pair passes through unchanged", () => {
    // U+1D44E ('𝑎' MATHEMATICAL ITALIC SMALL A) encoded as D835 DC4E.
    const pair = String.fromCharCode(0xd835) + String.fromCharCode(0xdc4e);
    const out = __as_test_stringify<string>(pair);
    expect(out.length).toBe(4); // "AB" → 4 chars (quote, D835, DC4E, quote)
    // Round-trip: stripping the quotes should yield the original 2-char pair.
    expect(out.charCodeAt(0)).toBe(0x22);
    expect(out.charCodeAt(1)).toBe(0xd835);
    expect(out.charCodeAt(2)).toBe(0xdc4e);
    expect(out.charCodeAt(3)).toBe(0x22);
  });

  test("lone high surrogate is escaped as \\uXXXX", () => {
    expect(__as_test_stringify<string>(String.fromCharCode(0xd800))).toBe(
      '"\\ud800"',
    );
  });

  test("lone low surrogate is escaped as \\uXXXX", () => {
    expect(__as_test_stringify<string>(String.fromCharCode(0xdc00))).toBe(
      '"\\udc00"',
    );
  });

  test("high surrogate not followed by a low is escaped", () => {
    const broken = String.fromCharCode(0xd800) + "x";
    expect(__as_test_stringify<string>(broken)).toBe('"\\ud800x"');
  });
});

describe("stringify: primitives", () => {
  test("booleans", () => {
    expect(__as_test_stringify<bool>(true)).toBe("true");
    expect(__as_test_stringify<bool>(false)).toBe("false");
  });

  test("integers and floats use toString()", () => {
    expect(__as_test_stringify<i32>(42)).toBe("42");
    expect(__as_test_stringify<f64>(1.5)).toBe("1.5");
  });

  test("nullable references render `null`", () => {
    const x: Plain | null = null;
    expect(__as_test_stringify<Plain | null>(x)).toBe("null");
  });
});

describe("stringify: arrays", () => {
  test("empty", () => {
    const a: i32[] = [];
    expect(__as_test_stringify<i32[]>(a)).toBe("[]");
  });

  test("primitives are flat-joined", () => {
    const a: i32[] = [1, 2, 3];
    expect(__as_test_stringify<i32[]>(a)).toBe("[1,2,3]");
  });

  test("strings are escaped per element", () => {
    const a: string[] = ["a", 'b"c'];
    expect(__as_test_stringify<string[]>(a)).toBe('["a","b\\"c"]');
  });
});

describe("stringify: classes", () => {
  test("auto-generated toJSON renders own fields", () => {
    expect(__as_test_stringify<Plain>(new Plain(7, "ok"))).toBe(
      '{"a":7,"b":"ok"}',
    );
  });

  test("hand-written toJSON wins over the transform", () => {
    expect(__as_test_stringify<CustomJSON>(new CustomJSON(99))).toBe(
      '{"custom":99}',
    );
  });
});
