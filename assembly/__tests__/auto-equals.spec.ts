// EqualsTransform — the transform synthesises `__as_test_equals(other, strict)`
// for any class that shows up as an `expect()` / `toBe()` / `toEqual()` /
// `toStrictEqual()` operand, including nested classes reachable through
// candidate fields. None of the classes below declare `__as_test_equals` by
// hand; the equality below would not compile if the transform were not wired
// in.

import { describe, expect, test } from "..";

// Simple primitive-only candidate.
class Pair {
  a: i32;
  b: i32;

  constructor(a: i32, b: i32) {
    this.a = a;
    this.b = b;
  }
}

// Mixed primitive + string fields.
class Person {
  name: string;
  age: u32;

  constructor(name: string, age: u32) {
    this.name = name;
    this.age = age;
  }
}

// Nested managed candidate — Inner is not mentioned at any expect() site
// but Outer is. The candidate-set should expand via Outer.inner: Inner.
class Inner {
  v: i32;
  constructor(v: i32) {
    this.v = v;
  }
}

class Outer {
  label: string;
  inner: Inner;

  constructor(label: string, inner: Inner) {
    this.label = label;
    this.inner = inner;
  }
}

// Nullable self-referential field (Token-style). Exercises the
// `changetype<usize>` null-guard branch in the generated method.
class Node {
  value: i32;
  next: Node | null = null;

  constructor(value: i32) {
    this.value = value;
  }
}

// User-supplied __as_test_equals using the new uniform signature
// (rawRef: Object, stack, ignore, strict). The transform must leave the
// method alone. Non-physical semantics — UserOverride is equal iff
// `a == other.a`, ignoring `b`.
class UserOverride {
  a: i32;
  b: i32;

  constructor(a: i32, b: i32) {
    this.a = a;
    this.b = b;
  }

  __AS_TEST_EQUALS(
    other: UserOverride,
    _stack: usize[],
    _ignore: StaticArray<i64>,
    _strict: bool,
  ): bool {
    return this.a == other.a;
  }
}

// Inheritance + user override on the parent: BaseFoo declares custom
// equals via the new signature; ChildFoo gets a transform-generated
// method that, via the super-call-with-ignore-list pattern, ends up
// invoking the parent's body for inherited fields. The transform pins
// ChildFoo's `other` parameter to `BaseFoo` to match the user's
// declared type and avoid AS TS2394.
class BaseFoo {
  shared: i32;

  constructor(shared: i32) {
    this.shared = shared;
  }

  __AS_TEST_EQUALS(
    other: BaseFoo,
    _stack: usize[],
    _ignore: StaticArray<i64>,
    _strict: bool,
  ): bool {
    return this.shared == other.shared;
  }
}

class ChildFoo extends BaseFoo {
  extra: string;

  constructor(shared: i32, extra: string) {
    super(shared);
    this.extra = extra;
  }
}

// Plain inheritance with no user method anywhere in the chain. Transform
// should generate both A's and B's methods pinned to the root class name.
class BaseBar {
  a: i32;

  constructor(a: i32) {
    this.a = a;
  }
}

// Three-level inheritance to exercise the super-call ignore-list pattern
// across more than one parent.
class GrandparentMix {
  g: i32;

  constructor(g: i32) {
    this.g = g;
  }
}

class ParentMix extends GrandparentMix {
  p: string;

  constructor(g: i32, p: string) {
    super(g);
    this.p = p;
  }
}

class ChildMix extends ParentMix {
  c: bool;

  constructor(g: i32, p: string, c: bool) {
    super(g, p);
    this.c = c;
  }
}

// Cycle through a self-referential nullable field. Without cycle
// detection in reflectEquals, comparing two such graphs would recurse
// forever and stack-overflow the wasm.
class Cyclic {
  value: i32;
  loop: Cyclic | null = null;

  constructor(value: i32) {
    this.value = value;
  }
}

// Array field — exercises the generic `reflectEquals(this.f, other.f, …)`
// dispatch for `Array<T>` of primitives.
class Bag {
  items: i32[];

  constructor(items: i32[]) {
    this.items = items;
  }
}

// Empty class — transform should still emit a method (the body just
// returns true / delegates to super). Used as a field type below to
// verify nothing breaks when a candidate has no fields.
class Marker {}

class WithMarker {
  marker: Marker;
  label: string;

  constructor(marker: Marker, label: string) {
    this.marker = marker;
    this.label = label;
  }
}

// Static fields must be skipped by the field collector — otherwise the
// generated body would compile-error trying to read `this.staticField`.
class WithStatic {
  static FACTOR: i32 = 100;
  scaled: i32;

  constructor(scaled: i32) {
    this.scaled = scaled;
  }
}

class ChildBar extends BaseBar {
  b: i32;

  constructor(a: i32, b: i32) {
    super(a);
    this.b = b;
  }
}

describe("auto-equals (transform-generated __as_test_equals)", () => {
  test("primitive-only class", () => {
    expect(new Pair(1, 2)).toEqual(new Pair(1, 2));
    expect(new Pair(1, 2)).not.toEqual(new Pair(1, 3));
  });

  test("mixed primitive + string fields", () => {
    expect(new Person("alice", 30)).toEqual(new Person("alice", 30));
    expect(new Person("alice", 30)).not.toEqual(new Person("alice", 31));
    expect(new Person("alice", 30)).not.toEqual(new Person("bob", 30));
  });

  test("nested managed candidate recurses through inner", () => {
    const left = new Outer("x", new Inner(7));
    const right = new Outer("x", new Inner(7));
    expect(left).toEqual(right);

    const different = new Outer("x", new Inner(8));
    expect(left).not.toEqual(different);
  });

  test("nullable managed field — both null", () => {
    expect(new Node(5)).toEqual(new Node(5));
  });

  test("nullable managed field — chained values match", () => {
    const a = new Node(1);
    a.next = new Node(2);
    const b = new Node(1);
    b.next = new Node(2);
    expect(a).toEqual(b);
  });

  test("nullable managed field — null vs non-null differ", () => {
    const a = new Node(1);
    const b = new Node(1);
    b.next = new Node(2);
    expect(a).not.toEqual(b);
  });

  test("user-supplied __as_test_equals is not overwritten", () => {
    // The custom override considers a/b equal iff a matches. If the
    // transform clobbered the user method, this assertion would fail
    // because the auto-generated version compares both fields.
    expect(new UserOverride(1, 9)).toEqual(new UserOverride(1, 7));
  });

  test("toStrictEqual still enforces rtId mismatch", () => {
    // Two structurally equal Pair instances → strict succeeds.
    expect(new Pair(1, 2)).toStrictEqual(new Pair(1, 2));
  });

  test("subclass of class with user equals: child fields are still compared", () => {
    // BaseFoo's user method only compares `shared`. The transform-generated
    // method on ChildFoo must compare both `shared` AND `extra`.
    expect(new ChildFoo(1, "x")).toEqual(new ChildFoo(1, "x"));
    expect(new ChildFoo(1, "x")).not.toEqual(new ChildFoo(1, "y"));
    expect(new ChildFoo(1, "x")).not.toEqual(new ChildFoo(2, "x"));
  });

  test("subclass of plain class: both base and child get generated equals", () => {
    expect(new BaseBar(1)).toEqual(new BaseBar(1));
    expect(new ChildBar(1, 2)).toEqual(new ChildBar(1, 2));
    expect(new ChildBar(1, 2)).not.toEqual(new ChildBar(1, 3));
    expect(new ChildBar(1, 2)).not.toEqual(new ChildBar(2, 2));
  });

  test("three-level inheritance composes via super-call ignore-list", () => {
    expect(new ChildMix(1, "x", true)).toEqual(new ChildMix(1, "x", true));
    expect(new ChildMix(1, "x", true)).not.toEqual(
      new ChildMix(1, "x", false), // child's `c` differs
    );
    expect(new ChildMix(1, "x", true)).not.toEqual(
      new ChildMix(1, "y", true), // parent's `p` differs
    );
    expect(new ChildMix(1, "x", true)).not.toEqual(
      new ChildMix(2, "x", true), // grandparent's `g` differs
    );
  });

  test("cycle: self-referential nullable graph terminates and compares equal", () => {
    const a = new Cyclic(1);
    a.loop = a;
    const b = new Cyclic(1);
    b.loop = b;
    expect(a).toEqual(b);
  });

  test("cycle: structurally-different cycles compare unequal", () => {
    const a = new Cyclic(1);
    a.loop = a;
    const b = new Cyclic(2);
    b.loop = b;
    expect(a).not.toEqual(b);
  });

  test("array field: element-wise equality is recursed", () => {
    expect(new Bag([1, 2, 3])).toEqual(new Bag([1, 2, 3]));
    expect(new Bag([1, 2, 3])).not.toEqual(new Bag([1, 2, 4]));
    expect(new Bag([1, 2, 3])).not.toEqual(new Bag([1, 2]));
  });

  test("empty class is structurally always equal to itself", () => {
    const a = new Marker();
    const b = new Marker();
    expect(a).toEqual(b);
    expect(a).toStrictEqual(b);
  });

  test("container of an empty class compares field-by-field", () => {
    expect(new WithMarker(new Marker(), "ok")).toEqual(
      new WithMarker(new Marker(), "ok"),
    );
    expect(new WithMarker(new Marker(), "ok")).not.toEqual(
      new WithMarker(new Marker(), "no"),
    );
  });

  test("static fields are skipped by the field collector", () => {
    // If the transform tried to read `this.FACTOR` (the static), the
    // generated body would fail at compile time. Reaching here proves
    // it compiled, and the comparison below proves the instance field
    // is the only one being compared.
    expect(new WithStatic(5)).toEqual(new WithStatic(5));
    expect(new WithStatic(5)).not.toEqual(new WithStatic(6));
  });

  test("null vs non-null nullable field is unequal", () => {
    const a = new Node(1);
    const b = new Node(1);
    a.next = new Node(2);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);
  });

  test("both-null nullable field passes the equality check", () => {
    expect(new Node(1)).toEqual(new Node(1));
  });
});
