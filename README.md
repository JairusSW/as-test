<h1 align="center"><pre>╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗
╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ 
╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ </pre></h1>

A lightweight testing framework for AssemblyScript.

🔹 Minimal and fast – Run your tests without unnecessary overhead.

🔹 Familiar API – Inspired by modern JavaScript testing frameworks.

🔹 Powerful mocking – Easily override functions and track calls.

🔹 Seamless CI/CD integration – Works effortlessly in automation pipelines.

🔹 Universal environment – Run your tests on any platform, runtime, or bindings.

## 💾 Installation

```bash
npm install as-test
npm intall json-as
```

Initialize your test setup with:

```bash
as-test init
```

This creates a test directory at `assembly/__tests__/` with a sample test file.

## 📝 Writing Tests

Create a new test file in `assembly/__tests__/`, for example, `math.spec.ts`:

```js
import { describe, test, expect, run } from "as-test";

describe("Math operations", () => {
  test("Addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("Subtraction", () => {
    expect(5 - 2).toBe(3);
  });

  test("Multiplication", () => {
    expect(3 * 3).toBe(9);
  });
});

run();
```

## 🔍 Examples

### 🏗️ Mocking Functions

Use `mockFn` to override functions during testing:

```js
import { mockFn } from "as-test";

// Mock console.log
mockFn<void>("console.log", (data: string): void => {
  console.log("[MOCKED]: " + data);
});

run();
```

Or override imported functions with `mockImport`.

### ⚒️ Setup and Teardown

Use `beforeAll` and `afterAll` to run code before and after a test is run.

```js
import { beforeAll, afterAll } from "as-test";

beforeAll(() => {
  log("Setting up test environment...");
});

afterAll(() => {
  log("Tearing down test environment...");
});

run();
```

### 📃 Pretty Logging

Using `console.log` will mess up the terminal output. Instead, use the inbuilt `log` function:

```js
import { log } from "as-test";

log("This is a pretty log function");

run();
```

Or override all existing `console.log` calls with `log`:

```js
import { mockFn, log } from "as-test";

mockFn<void>("console.log", (data: string): void => {
    log(data);
});

run();
```

### 🔄 Running Tests in CI

To integrate `as-test` into your CI/CD workflow, see the [example configuration](https://github.com/JairusSW/as-test/blob/main/.github/workflows/as-test.yml).

`assembly/__tests__/example.spec.ts`

## 📃 License

This project is distributed under an open source license. You can view the full license using the following link: [License](./LICENSE)

## 📫 Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/as-test/issues) and to converse, please send me an email at [me@jairus.dev](mailto:me@jairus.dev)

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/as-test)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448) or on the [AssemblyScript Discord Server](https://discord.gg/assemblyscript/)
