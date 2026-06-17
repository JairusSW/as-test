import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

const { __suiteSelectionInternals } = await import(
  pathToFileURL(path.join(repoRoot, "bin/commands/run-core.js")).href
);
const { filterSelectedSuites } = __suiteSelectionInternals;

// Minimal suite-tree builders mirroring the runtime report shape
// ({ description, suites }). filterSelectedSuites annotates each node with a
// slugified `path` and prunes everything not on a selected branch.
const suite = (description, ...suites) => ({ description, suites });

function select(suites, selectors) {
  return filterSelectedSuites(suites, selectors, "spec.ts", "default");
}

function collectPaths(suites, out = []) {
  for (const s of suites) {
    out.push(s.path);
    collectPaths(s.suites ?? [], out);
  }
  return out;
}

const tree = () => [suite("outer", suite("inner", suite("leaf")))];

test("a bare selector matches a nested suite by its leaf name", () => {
  const result = select(tree(), ["inner"]);
  const paths = collectPaths(result);
  assert.deepEqual(paths, ["outer", "outer/inner"]);
});

test("an explicit slash path selects exactly that branch", () => {
  const result = select(tree(), ["outer/inner"]);
  assert.deepEqual(collectPaths(result), ["outer", "outer/inner"]);
});

test("selecting a suite keeps that node; unselected nested suites are pruned", () => {
  // Only the explicitly selected node (and its direct tests) is retained — its
  // child suites are dropped unless they are themselves on a selected branch.
  const result = select(tree(), ["outer"]);
  assert.deepEqual(collectPaths(result), ["outer"]);
});

test("selecting a leaf keeps the ancestor chain as containers", () => {
  const result = select(tree(), ["outer/inner/leaf"]);
  assert.deepEqual(collectPaths(result), [
    "outer",
    "outer/inner",
    "outer/inner/leaf",
  ]);
});

test("descriptions are slugified for matching", () => {
  const suites = [suite("Math", suite("Adds Numbers"))];
  const result = select(suites, ["adds-numbers"]);
  assert.deepEqual(collectPaths(result), ["math", "math/adds-numbers"]);
});

test("a non-matching selector throws a clear error", () => {
  assert.throws(() => select(tree(), ["nope"]), /No suites matched "nope"/);
});

test("an ambiguous bare selector throws and lists the matches", () => {
  // two "dupe" suites at the same depth
  const suites = [suite("a", suite("dupe")), suite("b", suite("dupe"))];
  assert.throws(
    () => select(suites, ["dupe"]),
    (error) => {
      assert.match(error.message, /ambiguous/);
      assert.match(error.message, /a\/dupe/);
      assert.match(error.message, /b\/dupe/);
      return true;
    },
  );
});

test("a bare selector resolves to the shallowest match when depths differ", () => {
  // "target" appears at depth 1 and nested deeper; shallowest wins, no throw
  const suites = [
    suite("target"),
    suite("wrap", suite("mid", suite("target"))),
  ];
  const result = select(suites, ["target"]);
  assert.ok(collectPaths(result).includes("target"));
});
