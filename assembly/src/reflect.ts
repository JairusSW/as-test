import { OBJECT, TOTAL_OVERHEAD } from "rt/common";

// Structural equality entry point. Modelled on as-pect's Reflect.equals,
// trimmed of memoisation cache and ignore-list bookkeeping — those live
// in the per-class methods emitted by the EqualsTransform.
//
// Per-call flow:
//   * primitives, strings, booleans → `===`
//   * nullables → resolve null on either side, then fall through
//   * arrays → length + element-wise recursion with the same `stack`
//   * managed values → identity short-circuit, optional `rtId` check
//     for strict mode, cycle detection via `stack`, then dispatch to
//     the class's `__AS_TEST_EQUALS(other, stack, ignore, strict)`
//
// `right` is forwarded with its full static type so the dispatched
// method's body reads fields directly via AS virtual dispatch.

export function reflectEquals<T>(
  left: T,
  right: T,
  stack: usize[],
  strict: bool,
): bool {
  if (isBoolean<T>() || isInteger<T>() || isFloat<T>() || isString<T>())
    return left === right;

  if (isNullable<T>()) {
    const lp = changetype<usize>(left);
    const rp = changetype<usize>(right);
    if (lp == 0 || rp == 0) return lp == rp;
  }

  if (isArray<T>()) {
    // @ts-expect-error: type
    const aLen = (left as valueof<T>[]).length;
    // @ts-expect-error: type
    const bLen = (right as valueof<T>[]).length;
    if (aLen != bLen) return false;
    for (let i = 0; i < aLen; i++) {
      if (
        // @ts-expect-error: type
        !reflectEquals<valueof<T>>(
          // @ts-expect-error: type
          unchecked((left as valueof<T>[])[i]),
          // @ts-expect-error: type
          unchecked((right as valueof<T>[])[i]),
          stack,
          strict,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  if (isManaged<T>()) {
    const lp = changetype<usize>(left);
    const rp = changetype<usize>(right);
    if (lp == rp) return true;
    if (lp == 0 || rp == 0) return false;

    if (strict) {
      const lo = changetype<OBJECT>(lp - TOTAL_OVERHEAD);
      const ro = changetype<OBJECT>(rp - TOTAL_OVERHEAD);
      if (lo.rtId != ro.rtId) return false;
    }

    for (let i = 0; i < stack.length; i += 2) {
      if (unchecked(stack[i]) == lp && unchecked(stack[i + 1]) == rp)
        return true;
    }

    stack.push(lp);
    stack.push(rp);

    // Pass `right` with its full static type so the dispatched method's
    // body can read fields directly. For nullable T, strip the
    // nullability with `!` — we returned early above if either operand
    // was null, so `right!` is safe at this point.
    //
    // The transform injects `__AS_TEST_EQUALS` on every user class the
    // compiler reaches, but third-party generic types (Map, Set,
    // Option<T>, …) don't carry it. Fall back to the class's `==`
    // operator (which the user can overload via `@operator("==")`),
    // collapsing to reference identity if no overload is present.
    let passed: bool;
    if (isNullable<T>()) {
      // @ts-expect-error: optional method, presence is a compile-time check
      if (isDefined(left!.__AS_TEST_EQUALS)) {
        // @ts-expect-error: declared by transform
        passed = left!.__AS_TEST_EQUALS(
          right!,
          stack,
          [] as StaticArray<i64>,
          strict,
        );
      } else {
        passed = left == right;
      }
    } else {
      // @ts-expect-error: optional method, presence is a compile-time check
      if (isDefined(left.__AS_TEST_EQUALS)) {
        // @ts-expect-error: declared by transform
        passed = left.__AS_TEST_EQUALS(
          right,
          stack,
          [] as StaticArray<i64>,
          strict,
        );
      } else {
        passed = left == right;
      }
    }

    stack.pop();
    stack.pop();
    return passed;
  }

  return left === right;
}
