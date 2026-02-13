# Assertion Reference

This document describes matcher behavior in `as-test`.

## Basics

```ts
expect(value).toBe(expected);
expect(value, "custom message").toBe(expected);
expect(value).not.toBe(expected);
```

- `expect(value, message)` stores the custom message and includes it when the assertion fails.
- `.not` inverts the next matcher verdict.

## Equality

- `toBe(expected)`

Behavior:
- Primitive values use strict comparison.
- Arrays are compared structurally.
- Other values fallback to JSON serialization comparison.

## Nullability

- `toBeNull()`

## Numeric

- `toBeGreaterThan(value)`
- `toBeGreaterOrEqualTo(value)`
- `toBeLessThan(value)`
- `toBeLessThanOrEqualTo(value)`
- `toBeNumber()`
- `toBeInteger()`
- `toBeFloat()`
- `toBeFinite()`
- `toBeCloseTo(expected, precision = 2)`

Notes:
- Relational and `toBeCloseTo` matchers require numeric values.
- `toBeCloseTo` uses decimal precision tolerance.

## Boolean / Truthiness

- `toBeBoolean()`
- `toBeTruthy()`
- `toBeFalsy()`

Truthy/falsy behavior follows framework-specific checks for strings, numbers, nullable refs, and booleans.

## Strings

- `toBeString()`
- `toMatch(substring)`

`toMatch` checks whether the string contains the provided substring.

## Arrays

- `toBeArray()`
- `toHaveLength(length)`
- `toContain(item)`

## Hook Execution

Hook semantics that affect assertions:

- `beforeEach` and `afterEach` execute once per test case (`test` / `it`).
- They do not execute per matcher call.
