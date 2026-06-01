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
    assert.equal(
      result.code,
      0,
      `Expected exit 0 but got ${result.code}:\n${output}`,
    );
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
    assert.equal(
      result.code,
      0,
      `Expected exit 0 but got ${result.code}:\n${output}`,
    );
    assert.doesNotMatch(output, /TS1140/, "TS1140 must not appear in output");
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

// Bug C: a file whose only suites are skip variants (xdescribe/xtest/xit) must
// still get run() auto-injected so it reports itself as skipped. Previously the
// hasSuiteCalls regex only matched the non-x names, so `\bdescribe` failed to
// match `xdescribe`, run() was never injected, no report frame was emitted, and
// the CLI surfaced it as "missing report payload from test runtime" (a crash).
test("xdescribe-only file is reported skipped, not crashed", async () => {
  const specRel = "assembly/__tests__/__tmp_xdescribe_only.spec.ts";
  const specPath = path.join(repoRoot, specRel);
  await fs.writeFile(
    specPath,
    [
      'import { expect, xdescribe } from "..";',
      "",
      'xdescribe("only an xdescribe, nothing else", () => {',
      "  expect((): void => {",
      "    let x = 1;",
      "  }).not.toThrow();",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await runNode(
      ["./bin/index.js", "test", specRel, "--mode", "node:wasi"],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.equal(
      result.code,
      0,
      `Expected exit 0 but got ${result.code}:\n${output}`,
    );
    assert.doesNotMatch(
      output,
      /missing report payload/,
      "all-skipped file must not be treated as a runtime crash",
    );
    assert.match(output, /SKIP/, "the file should be reported as skipped");
    assert.match(output, /Files:\s+0 failed, 1 skipped, 1 total/);
    assert.match(output, /Suites:\s+0 failed, 1 skipped, 1 total/);
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

// Bug C (cont.): a spec file with no suites at all never calls run() and emits
// no frames. A clean exit with zero lifecycle events is an empty test file, not
// a crash — the CLI marks it skipped (with a warning) rather than reporting a
// missing report payload.
test("empty spec file (no suites) is reported skipped, not crashed", async () => {
  const specRel = "assembly/__tests__/__tmp_empty_file.spec.ts";
  const specPath = path.join(repoRoot, specRel);
  await fs.writeFile(
    specPath,
    ["// intentionally empty", 'import { expect } from "..";', ""].join("\n"),
    "utf8",
  );

  try {
    const result = await runNode(
      ["./bin/index.js", "test", specRel, "--mode", "node:wasi"],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.equal(
      result.code,
      0,
      `Expected exit 0 but got ${result.code}:\n${output}`,
    );
    assert.doesNotMatch(
      output,
      /missing report payload/,
      "empty file must not be treated as a runtime crash",
    );
    assert.match(output, /contains no tests/, "should warn the file is empty");
    assert.match(output, /Files:\s+0 failed, 1 skipped, 1 total/);
  } finally {
    await fs.rm(specPath, { force: true });
  }
});
