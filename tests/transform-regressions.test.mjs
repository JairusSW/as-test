import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const repoRoot = process.cwd();

function runNode(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

// Bug A (AS231): constructor with `return this` must not be wrapped by the coverage transform.
// The transform's visitReturnStatement must skip `return this` to avoid
// "A class with a constructor explicitly returning something else than 'this' must be '@final'".
test("coverage transform: constructor with 'return this' builds without AS231", async () => {
  const specPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_regression_a.spec.ts",
  );
  await fs.writeFile(
    specPath,
    [
      'import { describe, it, expect } from "..";',
      "",
      "class Counter {",
      "  x: i32;",
      "  constructor(x: i32) {",
      "    this.x = x;",
      "    return this;",
      "  }",
      "}",
      "",
      'describe("constructor return this", () => {',
      '  it("compiles and runs", () => {',
      "    expect(new Counter(5).x).toBe(5);",
      "  });",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "build",
        "assembly/__tests__/__tmp_regression_a.spec.ts",
        "--mode",
        "node:wasi",
        "--enable",
        "coverage",
      ],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 0, `Expected exit 0 but got ${result.code}:\n${output}`);
    assert.doesNotMatch(output, /AS231/, "AS231 must not appear in output");
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

// Bug B (TS1140): typed arrow function parameters inside expect() must not trigger
// "Type argument expected" when the coverage transform rewrites the arrow function.
// The transform must keep expression-body arrows as expression-bodied (not convert to
// block bodies) so arrowKind is preserved and the AS compiler parses params correctly.
test("coverage transform: typed arrow parameters inside map() build without TS1140", async () => {
  const specPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_regression_b.spec.ts",
  );
  await fs.writeFile(
    specPath,
    [
      'import { describe, it, expect } from "..";',
      "",
      'describe("typed arrow params", () => {',
      '  it("compiles and runs", () => {',
      "    const kinds: i32[] = [1, 2, 3].map((x: i32) => x + 1);",
      "    expect(kinds.length).toBe(3);",
      "  });",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "build",
        "assembly/__tests__/__tmp_regression_b.spec.ts",
        "--mode",
        "node:wasi",
        "--enable",
        "coverage",
      ],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 0, `Expected exit 0 but got ${result.code}:\n${output}`);
    assert.doesNotMatch(output, /TS1140/, "TS1140 must not appear in output");
  } finally {
    await fs.rm(specPath, { force: true });
  }
});
