import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { pathToFileURL } from "url";

const repoRoot = process.cwd();
const utilUrl = pathToFileURL(path.join(repoRoot, "bin/util.js")).href;

test("resolveGlobBase extracts longest non-glob prefix", async () => {
  const { resolveGlobBase } = await import(utilUrl);
  assert.equal(
    resolveGlobBase("assembly/__tests__/**/*.spec.ts"),
    path.join("assembly", "__tests__"),
  );
  assert.equal(resolveGlobBase("**/*.spec.ts"), "");
  assert.equal(resolveGlobBase("assembly/foo.spec.ts"), "assembly");
  assert.equal(
    resolveGlobBase("/abs/path/**/*.ts"),
    path.sep + path.join("abs", "path"),
  );
  assert.equal(
    resolveGlobBase("assembly/{a,b}/**/*.ts"),
    "assembly",
    "brace expansion is a glob metachar",
  );
});

test("resolveSpecRelativePath picks the longest matching base", async () => {
  const { resolveSpecRelativePath } = await import(utilUrl);
  const patterns = ["assembly/**/*.spec.ts", "assembly/__tests__/**/*.spec.ts"];
  assert.equal(
    resolveSpecRelativePath("assembly/__tests__/foo.spec.ts", patterns),
    "foo.spec.ts",
    "longest matching base wins",
  );
  assert.equal(
    resolveSpecRelativePath("assembly/other/bar.spec.ts", patterns),
    path.join("other", "bar.spec.ts"),
  );
});

test("resolveSpecRelativePath does component-wise prefix matching", async () => {
  const { resolveSpecRelativePath } = await import(utilUrl);
  // base "assembly/__tests" must not be treated as a prefix of
  // "assembly/__tests__/foo.spec.ts" even though it is a string prefix.
  assert.equal(
    resolveSpecRelativePath("assembly/__tests__/foo.spec.ts", [
      "assembly/__tests/**/*.spec.ts",
    ]),
    "foo.spec.ts",
    "no matching base falls back to basename",
  );
});

test("resolveSpecRelativePath handles patterns without a static prefix", async () => {
  const { resolveSpecRelativePath } = await import(utilUrl);
  const patterns = ["**/*.spec.ts"];
  const relInsideCwd = path.join(
    "assembly",
    "__tests__",
    "nested",
    "foo.spec.ts",
  );
  assert.equal(
    resolveSpecRelativePath(relInsideCwd, patterns),
    relInsideCwd,
    "with empty base, files keep their full cwd-relative path",
  );
});

test("resolveArtifactPath strips .ts and preserves .spec/.fuzz suffixes", async () => {
  const { resolveArtifactPath } = await import(utilUrl);
  const patterns = ["assembly/__tests__/**/*.spec.ts"];
  assert.equal(
    resolveArtifactPath("assembly/__tests__/array.spec.ts", patterns),
    "array.spec.wasm",
  );
  assert.equal(
    resolveArtifactPath("assembly/__tests__/nested/array.spec.ts", patterns),
    path.join("nested", "array.spec.wasm"),
  );

  const fuzzPatterns = ["assembly/__fuzz__/**/*.fuzz.ts"];
  assert.equal(
    resolveArtifactPath("assembly/__fuzz__/array.fuzz.ts", fuzzPatterns),
    "array.fuzz.wasm",
  );
  assert.equal(
    resolveArtifactPath("assembly/__fuzz__/nested/array.fuzz.ts", fuzzPatterns),
    path.join("nested", "array.fuzz.wasm"),
  );
});
