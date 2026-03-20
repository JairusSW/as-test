# Assertions

Assertions are built around `expect(value, message?)`.

Basic examples:

```ts
expect(1 + 2).toBe(3);
expect("hello").toStartWith("he");
expect("world").toEndWith("ld");
expect(true).toBeTruthy();
expect(false).toBeFalsy();
expect(3.14159).toBeCloseTo(3.14, 2);
expect("abc123").toMatch("[a-z]+\\d+");
```

Negation:

```ts
expect(1).not.toBe(2);
```

Messages:

```ts
expect(total, "sum should stay stable").toBe(42);
```

Snapshot matcher:

```ts
expect(payload).toMatchSnapshot("payload");
```

Assertions inside fuzzers:

- they fail the fuzz iteration
- they do not count as normal test cases
- they are reported in the fuzz summary
