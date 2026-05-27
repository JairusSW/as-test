import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";

const { argsDeclareTryAs, asconfigDeclaresTryAs } =
  await import("../bin/commands/build-core.js");

test("argsDeclareTryAs: detects --transform try-as/transform", () => {
  assert.equal(argsDeclareTryAs(["--transform", "try-as/transform"]), true);
});

test("argsDeclareTryAs: detects bare 'try-as' spec", () => {
  assert.equal(argsDeclareTryAs(["--transform", "try-as"]), true);
});

test("argsDeclareTryAs: detects -t shorthand", () => {
  assert.equal(argsDeclareTryAs(["-t", "try-as/transform"]), true);
});

test("argsDeclareTryAs: detects --transform=try-as form", () => {
  assert.equal(argsDeclareTryAs(["--transform=try-as/transform"]), true);
});

test("argsDeclareTryAs: ignores unrelated transforms", () => {
  assert.equal(
    argsDeclareTryAs(["--transform", "as-test/transform", "--optimize"]),
    false,
  );
});

test("argsDeclareTryAs: does not match 'try-as'-prefixed packages", () => {
  // "try-as-something/transform" should not match; regex requires word boundary.
  assert.equal(
    argsDeclareTryAs(["--transform", "try-as-something/transform"]),
    false,
  );
});

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "as-test-dedupe-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("asconfigDeclaresTryAs: detects try-as in options.transform", async () => {
  await withTempDir(async (dir) => {
    const cfg = path.join(dir, "asconfig.json");
    await fs.writeFile(
      cfg,
      JSON.stringify({ options: { transform: ["try-as/transform"] } }),
    );
    assert.equal(asconfigDeclaresTryAs(cfg), true);
  });
});

test("asconfigDeclaresTryAs: returns false when transform missing", async () => {
  await withTempDir(async (dir) => {
    const cfg = path.join(dir, "asconfig.json");
    await fs.writeFile(
      cfg,
      JSON.stringify({ options: { transform: ["json-as/transform"] } }),
    );
    assert.equal(asconfigDeclaresTryAs(cfg), false);
  });
});

test("asconfigDeclaresTryAs: follows extends chain (string)", async () => {
  await withTempDir(async (dir) => {
    const base = path.join(dir, "base.json");
    const child = path.join(dir, "asconfig.json");
    await fs.writeFile(
      base,
      JSON.stringify({ options: { transform: ["try-as/transform"] } }),
    );
    await fs.writeFile(child, JSON.stringify({ extends: "./base.json" }));
    assert.equal(asconfigDeclaresTryAs(child), true);
  });
});

test("asconfigDeclaresTryAs: follows extends chain (array)", async () => {
  await withTempDir(async (dir) => {
    const base = path.join(dir, "base.json");
    const other = path.join(dir, "other.json");
    const child = path.join(dir, "asconfig.json");
    await fs.writeFile(base, JSON.stringify({ options: {} }));
    await fs.writeFile(
      other,
      JSON.stringify({ options: { transform: ["try-as/transform"] } }),
    );
    await fs.writeFile(
      child,
      JSON.stringify({ extends: ["./base.json", "./other.json"] }),
    );
    assert.equal(asconfigDeclaresTryAs(child), true);
  });
});

test("asconfigDeclaresTryAs: tolerates cyclic extends", async () => {
  await withTempDir(async (dir) => {
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    await fs.writeFile(a, JSON.stringify({ extends: "./b.json" }));
    await fs.writeFile(b, JSON.stringify({ extends: "./a.json" }));
    assert.equal(asconfigDeclaresTryAs(a), false);
  });
});

test("asconfigDeclaresTryAs: returns false for missing/'none' path", () => {
  assert.equal(asconfigDeclaresTryAs(undefined), false);
  assert.equal(asconfigDeclaresTryAs("none"), false);
  assert.equal(asconfigDeclaresTryAs("/nonexistent/path.json"), false);
});
