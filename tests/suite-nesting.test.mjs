import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const repoRoot = process.cwd();
const specRel = "assembly/__tests__/__tmp_nesting.spec.ts";
const specPath = path.join(repoRoot, specRel);

// A describe inside a describe must nest: the inner block's test is parented to
// the inner describe, not flattened onto the outer one. We assert this through
// the failure summary path of a deliberately-failing deep test.
const SPEC_SOURCE = `import { describe, expect, it, test } from "..";

describe("outer", () => {
  describe("inner", () => {
    it("deep fails", () => {
      expect(1).toBe(2);
    });
  });
  test("shallow passes", () => {
    expect(3).toBe(3);
  });
});
`;

test("describe-in-describe nests (failure path keeps every level)", async () => {
  await fs.writeFile(specPath, SPEC_SOURCE, "utf8");
  try {
    const result = await runNode([
      "./bin/index.js",
      "run",
      specRel,
      "--mode",
      "node:wasi",
    ]);
    const output = result.stdout + result.stderr;
    assert.notEqual(result.code, 0, output);
    // The failure title must include the inner describe — i.e. the full nested
    // path "outer > inner > deep fails", not the flattened "outer > deep fails".
    assert.match(output, /outer > inner > deep fails/);
    // Three grouping blocks (outer, inner, deep fails) collapse to suites; the
    // shallow test adds a 4th. Each is counted as a suite, expect()s as tests.
    assert.match(output, /Suites:\s+\d+ failed,\s+\d+ skipped,\s+4 total/);
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
