export function formatValue<T>(value: T, deep: boolean = false): string {
  if (isNullable<T>() && changetype<usize>(value) == <usize>0) {
    return "null";
  }

  if (isString<T>()) {
    const text = value as string;
    return deep ? "'" + text + "'" : text;
  }

  if (isBoolean<T>() || isInteger<T>() || isFloat<T>()) {
    // @ts-expect-error: primitive formatting
    return value.toString();
  }

  if (isArray<T>()) {
    // @ts-expect-error: array-like handling
    const values = value as valueof<T>[];
    if (!values.length) return "[]";
    let out = "[";
    for (let i = 0; i < values.length; i++) {
      if (i) out += ", ";
      out += formatValue<valueof<T>>(unchecked(values[i]), true);
    }
    out += "]";
    return out;
  }

  if (value instanceof Map) {
    // @ts-expect-error: generic runtime access
    const keys = value.keys();
    if (!keys.length) return "Map(0) {}";
    // @ts-expect-error: generic runtime access
    const values = value.values();
    let out = "Map(" + keys.length.toString() + ") { ";
    for (let i = 0; i < keys.length; i++) {
      if (i) out += ", ";
      out += formatValue(
        changetype<valueof<typeof keys>>(unchecked(keys[i])),
        true,
      );
      out += " => ";
      out += formatValue(
        changetype<valueof<typeof values>>(unchecked(values[i])),
        true,
      );
    }
    out += " }";
    return out;
  }

  if (value instanceof Set) {
    // @ts-expect-error: generic runtime access
    const values = value.values();
    if (!values.length) return "Set(0) {}";
    let out = "Set(" + values.length.toString() + ") { ";
    for (let i = 0; i < values.length; i++) {
      if (i) out += ", ";
      out += formatValue(
        changetype<valueof<typeof values>>(unchecked(values[i])),
        true,
      );
    }
    out += " }";
    return out;
  }

  if (isManaged<T>()) {
    // @ts-expect-error: custom serializer when provided
    if (isDefined(value.__as_test_json)) {
      // @ts-expect-error: dynamic method dispatch
      return value.__as_test_json();
    }
  }

  return nameof<T>();
}


@inline
export function colorText(format: i32[], text: string): string {
  return `\u001b[${format[0].toString()}m${text}\u001b[${format[1].toString()}m`;
}


@inline
export function red(text: string): string {
  return colorText([31, 39], text);
}


@inline
export function green(text: string): string {
  return colorText([32, 39], text);
}


@inline
export function bgRed(text: string): string {
  return colorText([41, 49], text);
}


@inline
export function bgGreen(text: string): string {
  return colorText([42, 49], text);
}


@inline
export function bold(text: string): string {
  return colorText([1, 22], text);
}
