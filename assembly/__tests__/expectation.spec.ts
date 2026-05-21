import { afterEach, beforeEach, describe, expect, run, test } from "..";
// Import JSON directly so json-as transform does not add broken pnpm paths.
import { JSON } from "json-as/assembly";

let beforeCount = 0;
let afterCount = 0;


@json
class Point {
  x: i32 = 0;
  y: i32 = 0;

  constructor(x: i32, y: i32) {
    this.x = x;
    this.y = y;
  }

  __as_test_equals(other: Point, strict: bool): bool {
    return this.x == other.x && this.y == other.y;
  }

  __as_test_json(): string {
    return JSON.stringify(this);
  }
}


@json
class Shape {
  size: i32 = 0;

  constructor(size: i32) {
    this.size = size;
  }

  __as_test_equals(other: Shape, strict: bool): bool {
    return this.size == other.size;
  }

  __as_test_json(): string {
    return JSON.stringify(this);
  }
}


@json
class Circle extends Shape {}


@json
class Square extends Shape {}


@json
class LabelledPoint {
  point: Point = new Point(0, 0);
  label: string = "";

  constructor(point: Point, label: string) {
    this.point = point;
    this.label = label;
  }

  __as_test_json(): string {
    return JSON.stringify(this);
  }
}

const WHERE_POINT_ACTUAL: Point = new Point(3, 4);
const WHERE_POINT_EXPECTED: Point = new Point(3, 4);

function wherePointMatches(): bool {
  return (
    WHERE_POINT_ACTUAL.x == WHERE_POINT_EXPECTED.x &&
    WHERE_POINT_ACTUAL.y == WHERE_POINT_EXPECTED.y
  );
}

beforeEach(() => {
  beforeCount++;
});

afterEach(() => {
  afterCount++;
});

describe("Expectation helpers", () => {
  test("not modifier inverts matcher verdict", () => {
    expect(1).not.toBe(2);
    expect(2).toBe(2);
  });

  test("truthy and falsy matchers", () => {
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
    expect(1).toBeTruthy();
    expect(0).toBeFalsy();
    expect("as-test").toBeTruthy();
    expect("").toBeFalsy();
  });

  test("type matchers cover primitive and collection categories", () => {
    expect("as-test").toBeString();
    expect(true).toBeBoolean();
    expect([1, 2, 3]).toBeArray();
    expect(42).toBeNumber();
    expect(42).toBeInteger();
    expect(3.14).toBeFloat();
    expect(3.14).toBeFinite();
    expect<Point | null>(null).toBeNull();
  });

  test("comparison matchers cover numeric branches", () => {
    expect(10).toBeGreaterThan(5);
    expect(10).toBeGreaterOrEqualTo(10);
    expect(5).toBeLessThan(10);
    expect(5).toBeLessThanOrEqualTo(5);
  });

  test("close-to and string matchers", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
    expect("AssemblyScript testing").toMatch("testing");
    expect("AssemblyScript testing").toContain("testing");
    expect("AssemblyScript testing").toContains("Assembly");
    expect("as-test").toStartWith("as");
    expect("as-test").toEndWith("test");
    expect("as-test").not.toStartWith("ts");
    expect("as-test").not.toEndWith("as");
  });

  test("array helpers cover length and containment", () => {
    expect([1, 2, 3]).toHaveLength(3);
    expect([1, 2, 3]).toContain(2);
    expect([1, 2, 3]).toContains(1);
  });

  test("custom message argument compiles and runs", () => {
    expect(10, "math should still work").toBe(10);
    expect(10).toBe(10, "matcher message should compile");
    expect(10).toBeGreaterThan(5, "greater-than message should compile");
    expect(10).toBeGreaterOrEqualTo(
      10,
      "greater-or-equal message should compile",
    );
    expect(5).toBeLessThan(10, "less-than message should compile");
    expect(5).toBeLessThanOrEqualTo(5, "less-or-equal message should compile");
    expect(3.14159).toBeCloseTo(3.14, 2, "close-to message should compile");
    expect("AssemblyScript testing").toMatch(
      "testing",
      "match message should compile",
    );
    expect("AssemblyScript testing").toContain(
      "testing",
      "contain message should compile",
    );
    expect("as-test").toStartWith("as", "starts-with message should compile");
    expect("as-test").toEndWith("test", "ends-with message should compile");
    expect([1, 2, 3]).toHaveLength(3, "length message should compile");
    expect(true).toBeTruthy("truthy message should compile");
    expect(false).toBeFalsy("falsy message should compile");
    expect(10).toBeNumber("number message should compile");
    expect(10).toBeInteger("integer message should compile");
    expect(3.14).toBeFloat("float message should compile");
    expect("as-test").toBeString("string message should compile");
    expect(true).toBeBoolean("boolean message should compile");
    expect([1, 2, 3]).toBeArray("array message should compile");
    expect<f64>(3.14).toBeFinite("finite message should compile");
    expect<Point | null>(null).toBeNull("null message should compile");
    expect([1, 2, 3]).toEqual([1, 2, 3], "equal message should compile");
    expect([1, 2, 3]).toStrictEqual(
      [1, 2, 3],
      "strict-equal message should compile",
    );
  });

  test("toBe uses identity for arrays and managed references", () => {
    const left = [1, 2, 3];
    const same = left;
    const copy = [1, 2, 3];
    expect(left).toBe(same);
    expect(left).not.toBe(copy);

    const point = new Point(1, 2);
    const samePoint = point;
    const copyPoint = new Point(1, 2);
    expect(point).toBe(samePoint);
    expect(point).not.toBe(copyPoint);
  });

  test("toEqual supports arrays and pointer-free classes", () => {
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect([1, 2, 3]).not.toEqual([1, 2, 4]);

    const point = new Point(1, 2);
    const sameValue = new Point(1, 2);
    const differentValue = new Point(2, 3);
    expect(point).toEqual(sameValue);
    expect(point).not.toEqual(differentValue);
  });

  test("toStrictEqual enforces runtime type for pointer-free classes", () => {
    const circle: Shape = new Circle(4);
    const square: Shape = new Square(4);
    const sameCircle: Shape = new Circle(4);
    expect(circle).toEqual(square);
    expect(circle).not.toStrictEqual(square);
    expect(circle).toStrictEqual(sameCircle);
  });

  test("toBe still uses identity for classes with nested references", () => {
    const point = new LabelledPoint(new Point(1, 2), "demo");
    expect(point).toBe(point);
    expect(point).not.toBe(new LabelledPoint(new Point(1, 2), "demo"));
  });

  test("toThrow matcher compiles and is callable", () => {
    expect((): void => {
      throw new Error("boom");
    }).toThrow();
  });

  test("where accepts a bool predicate", () => {
    expect(7).where(true);
    expect(7).not.where(false);
    expect(7).where(7 > 0 && 7 < 10);
  });

  test("where accepts a () => bool lambda", () => {
    expect(7).where((): bool => true);
    expect(7).not.where((): bool => false);
  });

  test("where lambda can delegate to a module-level helper", () => {
    expect<Point>(WHERE_POINT_ACTUAL).where((): bool => wherePointMatches());
  });

  test("matchers chain into where as independent assertions", () => {
    expect(7)
      .toBe(7)
      .where((): bool => true);
    expect(10)
      .toBeGreaterThan(5)
      .where(10 < 100);
    expect("as-test")
      .toBeString()
      .toStartWith("as")
      .where((): bool => true);
  });

  test("skip swallows a failing where", () => {
    expect(7).skip().where(false);
    expect(7)
      .skip()
      .where((): bool => false);
  });

  test("beforeEach/afterEach are called once per test", () => {
    expect(beforeCount).toBe(18);
    expect(afterCount).toBe(17);
  });
});
