import { stringify } from "as-console/stringify";

export function quote(value: string): string {
  return '"' + escape(value) + '"';
}

export function rawOrNull(value: string): string {
  return value.length ? value : "null";
}

export function stringifyValue<T>(value: T): string {
  if (isNullable<T>() && changetype<usize>(value) == <usize>0) {
    return "null";
  }

  if (isBoolean<T>()) {
    return (value as bool) ? "true" : "false";
  }

  if (isInteger<T>() || isFloat<T>()) {
    // @ts-ignore
    return value.toString();
  }

  if (isString<T>()) {
    // @ts-ignore
    return quote(value as string);
  }

  if (isArray<T>()) {
    // @ts-ignore
    return stringifyArray<valueof<T>>(value as valueof<T>[]);
  }

  const formatted = stringify<T>(value);
  if (formatted != "none") {
    return quote(formatted);
  }

  return quote(nameof<T>());
}

function stringifyArray<T>(values: T[]): string {
  if (!values.length) return "[]";

  let out = "[";
  for (let i = 0; i < values.length; i++) {
    if (i) out += ",";
    out += stringifyValue<T>(unchecked(values[i]));
  }
  out += "]";
  return out;
}

function escape(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch == 34) {
      out += '\\"';
    } else if (ch == 92) {
      out += "\\\\";
    } else if (ch == 10) {
      out += "\\n";
    } else if (ch == 13) {
      out += "\\r";
    } else if (ch == 9) {
      out += "\\t";
    } else if (ch < 32) {
      out += "\\u00";
      const hex = ch.toString(16);
      if (hex.length < 2) out += "0";
      out += hex;
    } else {
      out += value.charAt(i);
    }
  }
  return out;
}
