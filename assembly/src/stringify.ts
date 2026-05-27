// Tiny in-tree replacement for json-as's runtime. Used for two jobs:
//
//   1. Stringifying user values for the wipc assertion-report payload
//      (was `JSON.stringify<T>(value)`).
//   2. JSON-escaping internal strings before splicing them into hand-built
//      wire payloads (was `JSON.stringify<string>(s)`).
//
// Dispatch order in `stringify<T>`:
//   * primitives / booleans / numbers   → `.toString()`
//   * strings                           → JSON-escape + quote
//   * arrays                            → element-wise recursion
//   * nullable null                     → "null"
//   * managed with `toJSON(): string`   → call it
//   * managed without `toJSON()`        → "<TypeName>" placeholder
//
// Classes decorated with `@json` / `@serializable` are skipped by the
// EqualsTransform's toJSON injector. Users who want those classes to
// render prettily in reports can add their own one-line `toJSON()`
// (e.g. `return JSON.stringify(this);` if they've also wired up
// `--transform json-as`). as-test itself stays json-as-free.

export function stringify<T>(value: T): string {
  if (isBoolean<T>()) return value ? "true" : "false";
  if (isInteger<T>() || isFloat<T>()) {
    // @ts-ignore: every numeric AS primitive carries toString()
    return value.toString();
  }
  if (isString<T>()) {
    return escape(value as string);
  }

  if (isNullable<T>() && changetype<usize>(value) == 0) return "null";

  if (isArray<T>()) {
    // @ts-ignore: typesafe length
    const len = (value as valueof<T>[]).length;
    if (len == 0) return "[]";
    let out = "[";
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ",";
      out += stringify<valueof<T>>(
        // @ts-ignore: bounds-checked above
        unchecked((value as valueof<T>[])[i]),
      );
    }
    return out + "]";
  }

  if (isManaged<T>()) {
    // @ts-ignore: hand-written or transform-generated serializer
    if (isDefined(value.toJSON)) return value.toJSON();
    return escape("<" + nameof<T>() + ">");
  }

  // Unreachable for well-typed AS code — but emit a valid JSON string so
  // the surrounding payload stays parsable.
  return escape("<" + nameof<T>() + ">");
}

// JSON string escape per RFC 8259, with explicit handling for UTF-16
// surrogates (matches json-as's serializeString behaviour).
//
//   * `"`, `\`, control chars U+0000..U+001F → escape sequences
//   * valid surrogate pair (high → low)      → pass both code units through
//   * lone surrogate (high not followed by   → emit `\uXXXX` for the
//     low, or low without a preceding high)    single code unit
//   * everything else                         → pass through
export function escape(s: string): string {
  let out = '"';
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c == 0x22 /* " */) {
      out += '\\"';
      continue;
    }
    if (c == 0x5c /* \ */) {
      out += "\\\\";
      continue;
    }
    if (c == 0x08) {
      out += "\\b";
      continue;
    }
    if (c == 0x09) {
      out += "\\t";
      continue;
    }
    if (c == 0x0a) {
      out += "\\n";
      continue;
    }
    if (c == 0x0c) {
      out += "\\f";
      continue;
    }
    if (c == 0x0d) {
      out += "\\r";
      continue;
    }
    if (c < 0x20) {
      out += "\\u00" + hexNibble((c >>> 4) & 0xf) + hexNibble(c & 0xf);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      // High surrogate followed by a low surrogate is a valid pair —
      // emit both code units verbatim and skip the low surrogate index.
      if (c <= 0xdbff && i + 1 < len) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += String.fromCharCode(c);
          out += String.fromCharCode(next);
          i++;
          continue;
        }
      }
      // Lone surrogate — escape the single code unit.
      out += "\\u" + hex4(<u32>c);
      continue;
    }
    out += String.fromCharCode(c);
  }
  return out + '"';
}


@inline function hexNibble(n: u32): string {
  // 0..9 → '0'..'9'; 10..15 → 'a'..'f'.
  return String.fromCharCode(n < 10 ? 0x30 + n : 0x61 + (n - 10));
}


@inline function hex4(c: u32): string {
  return (
    hexNibble((c >>> 12) & 0xf) +
    hexNibble((c >>> 8) & 0xf) +
    hexNibble((c >>> 4) & 0xf) +
    hexNibble(c & 0xf)
  );
}
