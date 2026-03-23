import {
  __as_test_json_value,
  afterEach,
  beforeEach,
  describe,
  expect,
  run,
  test,
} from "..";

let beforeCount = 0;
let afterCount = 0;

class Point {
  x: i32;
  y: i32;

  constructor(x: i32, y: i32) {
    this.x = x;
    this.y = y;
  }

  __as_test_equals(other: Point, strict: bool): bool {
    return this.x == other.x && this.y == other.y;
  }

  __as_test_json(): string {
    return (
      '{"x":' +
      __as_test_json_value<i32>(this.x) +
      ',"y":' +
      __as_test_json_value<i32>(this.y) +
      "}"
    );
  }
}

class Shape {
  size: i32;

  constructor(size: i32) {
    this.size = size;
  }

  __as_test_equals(other: Shape, strict: bool): bool {
    return this.size == other.size;
  }

  __as_test_json(): string {
    return '{"size":' + __as_test_json_value<i32>(this.size) + "}";
  }
}

class Circle extends Shape {}

class Square extends Shape {}

class LabelledPoint {
  point: Point;
  label: string;

  constructor(point: Point, label: string) {
    this.point = point;
    this.label = label;
  }

  __as_test_json(): string {
    return (
      '{"point":' +
      __as_test_json_value<Point>(this.point) +
      ',"label":' +
      __as_test_json_value<string>(this.label) +
      "}"
    );
  }
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

  test("custom message argument compiles and runs", () => {
    expect(10, "math should still work").toBe(10);
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

  test("toThrow supports direct throw assertions with try-as", () => {
    expect(new Map<string, string>().get("invalid")).toThrow();
    expect(1).toBe(1);
  });

  test("toThrow fails for non-throwing expressions", () => {
    expect(10).not.toThrow();
  });

  test("beforeEach/afterEach are called once per test", () => {
    expect(beforeCount).toBe(11);
    expect(afterCount).toBe(10);
  });
});
