import { rainbow } from "as-rainbow";

export function visualize<T>(value: T): string {
  if (isNullable<T>() && changetype<usize>(value) == <usize>0) {
    return "null";
  } else if (isString<T>()) {
    return value as string;
  } else if (isBoolean<T>()) {
    // @ts-ignore
    return value.toString();
  } else if (isInteger<T>() || isFloat<T>()) {
    // @ts-ignore
    return value.toString();
  }

  return unreachable();
}

export function isTruthy<T>(value: T): boolean {
  if (isNullable<T>() && changetype<usize>(value) === <usize>0) {
    return false;
  } else if (isString<T>()) {
    return (value as string).length != 0;
  } else if (isBoolean<T>()) {
    return value as boolean;
    // @ts-ignore
  } else if ((isInteger<T>() || isFloat<T>()) && isNaN(value)) {
    return false;
  }
  return true;
}

export function isFalsy<T>(value: T): boolean {
  return !isTruthy(value);
}

class Diff {
  left: string;
  right: string;
}
export function diff(left: string, right: string, not: boolean = false): Diff {
  let rDiff = "";
  let lDiff = "";

  let i = 0;

  for (; i < min(left.length, right.length); i++) {
    const lChar = left.charAt(i);
    const rChar = right.charAt(i);
    if (not) {
      if (lChar == rChar) {
        lDiff += rainbow.bgGreen(rChar);
        rDiff += rainbow.bgRed(lChar);
      } else {
        lDiff += rChar;
        rDiff += lChar;
      }
    } else {
      if (lChar != rChar) {
        lDiff += rainbow.bgGreen(rChar);
        rDiff += rainbow.bgRed(lChar);
      } else {
        lDiff += rChar;
        rDiff += lChar;
      }
    }
  }

  if (!not) {
    for (; i < left.length; i++) {
      rDiff += rainbow.bgRed(left.charAt(i));
    }
    for (; i < right.length; i++) lDiff += rainbow.bgRed(right.charAt(i));
  }

  return {
    left: lDiff,
    right: rDiff,
  };
}

// @ts-ignore
@inline
export function colorText(format: i32[], text: string): string {
  return `\u001b[${format[0].toString()}m${text}\u001b[${format[1].toString()}m`;
}