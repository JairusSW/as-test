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
//   * nullable null                     → "null"
//   * Date                              → quoted ISO-8601 string
//   * ArrayBuffer                       → array of unsigned byte values
//   * TypedArray (ArrayBufferView)      → array of element values
//   * Array / StaticArray               → element-wise recursion
//   * Set                               → array of values
//   * Map                               → object with stringified keys
//   * managed, user `toJSON()` returns string → call it
//   * managed otherwise                       → `__AS_TEST_TO_JSON()`
//       (transform-generated structural serializer; the fallback when a
//        user `toJSON` returns a non-string, or when there's no `toJSON`)
//   * managed with neither                    → "<TypeName>" placeholder
//
// The Date/ArrayBuffer/typed-array/StaticArray/Set/Map branches use
// `value instanceof X` guards. In a generic function AssemblyScript resolves
// these statically: the branch is only compiled when `T` can actually be that
// type and pruned otherwise, so the recursive calls inside type-check against
// the real K/V/element types.
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

  // Date → quoted ISO-8601 string (matches `JSON.stringify(new Date(...))`).
  if (value instanceof Date) {
    return escape((value as Date).toISOString());
  }

  // ArrayBuffer → array of its unsigned byte values. A raw buffer has no
  // natural JSON form, so surface the bytes for debugging.
  if (value instanceof ArrayBuffer) {
    const view = Uint8Array.wrap(value as ArrayBuffer);
    const len = view.length;
    if (len == 0) return "[]";
    let out = "[";
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ",";
      out += unchecked(view[i]).toString();
    }
    return out + "]";
  }

  // Typed arrays (Int32Array, Float64Array, …) all extend ArrayBufferView.
  if (value instanceof ArrayBufferView) {
    // @ts-ignore: every typed array carries a typesafe length + indexer
    const len = value.length;
    if (len == 0) return "[]";
    let out = "[";
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ",";
      // @ts-ignore: element is the view's numeric valueof type
      out += stringify(unchecked(value[i]));
    }
    return out + "]";
  }

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

  // StaticArray<V> → element-wise recursion, same shape as a regular array.
  if (value instanceof StaticArray) {
    // @ts-ignore: typesafe length + indexer
    const len = value.length;
    if (len == 0) return "[]";
    let out = "[";
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ",";
      // @ts-ignore: element is the array's valueof type
      out += stringify(unchecked(value[i]));
    }
    return out + "]";
  }

  // Set<V> → array of its values, in insertion order.
  if (value instanceof Set) {
    const vals = value.values();
    const len = vals.length;
    if (len == 0) return "[]";
    let out = "[";
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ",";
      out += stringify(unchecked(vals[i]));
    }
    return out + "]";
  }

  // Map<K,V> → JSON object. JSON object keys must be strings, so non-string
  // keys are coerced to their `.toString()` form and quoted (e.g. a numeric
  // key `10` becomes `"10"`, matching `JSON.stringify({ 10: ... })`).
  if (value instanceof Map) {
    const keys = value.keys();
    const vals = value.values();
    const len = keys.length;
    if (len == 0) return "{}";
    let out = "{";
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ",";
      out += jsonKey(unchecked(keys[i])) + ":" + stringify(unchecked(vals[i]));
    }
    return out + "}";
  }

  if (isManaged<T>()) {
    // A user-supplied `toJSON` wins, but only when it returns a string.
    // `preferToJSONString` decides that on the return type and otherwise
    // falls back to the transform-generated structural serializer.
    // @ts-ignore: optional user-supplied serializer
    if (isDefined(value.toJSON)) {
      // @ts-ignore: optional user-supplied serializer
      return preferToJSONString(value, value.toJSON());
    }
    // @ts-ignore: transform-generated structural serializer
    if (isDefined(value.__AS_TEST_TO_JSON)) return value.__AS_TEST_TO_JSON();
    return escape("<" + nameof<T>() + ">");
  }

  // Unreachable for well-typed AS code — but emit a valid JSON string so
  // the surrounding payload stays parsable.
  return escape("<" + nameof<T>() + ">");
}

// Given a managed value and the result of calling its `toJSON()`, return
// that result when it's a string, otherwise the transform-generated
// `__AS_TEST_TO_JSON` structural serializer (or a `<TypeName>` placeholder
// if neither applies). `R` is the `toJSON` return type, so the
// `result`-returning branch is pruned — and never type-checked — for any
// non-string return type. That's what lets a `toJSON` returning, say,
// `i32` fall back here instead of being a hard compile error.
function preferToJSONString<T, R>(value: T, result: R): string {
  if (isString<R>()) return result as string;
  // @ts-ignore: transform-generated structural serializer
  if (isDefined(value.__AS_TEST_TO_JSON)) return value.__AS_TEST_TO_JSON();
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

// Render a Map key as a quoted JSON string. Primitive keys are coerced to
// their textual form first; anything else falls back to the value serializer,
// wrapped as a string so the surrounding object stays parsable.
function jsonKey<K>(key: K): string {
  if (isString<K>()) return escape(key as string);
  if (isBoolean<K>()) return escape(key ? "true" : "false");
  if (isInteger<K>() || isFloat<K>()) {
    // @ts-ignore: numeric AS primitives carry toString()
    return escape(key.toString());
  }
  return escape(stringify<K>(key));
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
