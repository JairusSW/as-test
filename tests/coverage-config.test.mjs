import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { pathToFileURL } from "url";

const repoRoot = process.cwd();

async function loadCoverageInternals() {
  const mod = await import(
    pathToFileURL(path.join(repoRoot, "bin/commands/run-core.js")).href
  );
  return mod.__coverageInternals;
}

async function loadUtilInternals() {
  return import(pathToFileURL(path.join(repoRoot, "bin/util.js")).href);
}

test("coverage config defaults to project mode", async () => {
  const internals = await loadCoverageInternals();
  const options = internals.resolveCoverageOptions(true);

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "project");
  assert.deepEqual(options.dependencies, []);
});

test("coverage resolver extracts package names from npm and pnpm node_modules paths", async () => {
  const internals = await loadCoverageInternals();

  assert.equal(
    internals.resolveCoverageDependencyPackage(
      "node_modules/json-as/assembly/index.ts",
    ),
    "json-as",
  );
  assert.equal(
    internals.resolveCoverageDependencyPackage(
      "node_modules/@scope/pkg/assembly/index.ts",
    ),
    "@scope/pkg",
  );
  assert.equal(
    internals.resolveCoverageDependencyPackage(
      "node_modules/.pnpm/json-as@1.3.5/node_modules/json-as/assembly/index.ts",
    ),
    "json-as",
  );
  assert.equal(
    internals.resolveCoverageDependencyPackage(
      "node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg/assembly/index.ts",
    ),
    "@scope/pkg",
  );
});

test("coverage resolver extracts package names from AS-normalized ~lib/ paths", async () => {
  const internals = await loadCoverageInternals();

  // AssemblyScript normalizes node_modules/<pkg>/... to ~lib/<pkg>/... at compile time.
  // coverage.mode and coverage.dependencies must work against these real runtime paths.
  assert.equal(
    internals.resolveCoverageDependencyPackage(
      "~lib/json-as/assembly/index.ts",
    ),
    "json-as",
  );
  assert.equal(
    internals.resolveCoverageDependencyPackage(
      "~lib/@scope/pkg/assembly/index.ts",
    ),
    "@scope/pkg",
  );
  // Real AS stdlib must NOT be identified as a dependency package
  assert.equal(
    internals.resolveCoverageDependencyPackage("~lib/array.ts"),
    "array",
  );
});

test("stdlib files are ignored regardless of mode", async () => {
  const internals = await loadCoverageInternals();

  const allCoverage = internals.resolveCoverageOptions({
    enabled: true,
    mode: "all",
  });

  // Real AS stdlib under ~lib/ must always be ignored
  assert.equal(
    internals.isIgnoredCoverageFile("~lib/array.ts", allCoverage),
    true,
  );
  assert.equal(
    internals.isIgnoredCoverageFile("~lib/map.ts", allCoverage),
    true,
  );
  assert.equal(
    internals.isIgnoredCoverageFile("~lib/rt/pure.ts", allCoverage),
    true,
  );
  assert.equal(
    internals.isIgnoredCoverageFile("~lib/string.ts", allCoverage),
    true,
  );

  // Third-party packages under ~lib/ must NOT be treated as stdlib
  assert.equal(
    internals.isIgnoredCoverageFile(
      "~lib/json-as/assembly/index.ts",
      allCoverage,
    ),
    false,
  );
  assert.equal(
    internals.isIgnoredCoverageFile(
      "~lib/@scope/pkg/assembly/index.ts",
      allCoverage,
    ),
    false,
  );
});

test("coverage excludes dependencies by default and can allowlist packages (node_modules paths)", async () => {
  const internals = await loadCoverageInternals();
  const dependencyFile =
    "node_modules/.pnpm/json-as@1.3.5/node_modules/json-as/assembly/index.ts";

  const projectCoverage = internals.resolveCoverageOptions(true);
  assert.equal(
    internals.isIgnoredCoverageFile(dependencyFile, projectCoverage),
    true,
  );

  const allowlistedCoverage = internals.resolveCoverageOptions({
    enabled: true,
    mode: "project",
    dependencies: ["json-as"],
  });
  assert.equal(
    internals.isIgnoredCoverageFile(dependencyFile, allowlistedCoverage),
    false,
  );

  const allCoverage = internals.resolveCoverageOptions({
    enabled: true,
    mode: "all",
  });
  assert.equal(
    internals.isIgnoredCoverageFile(dependencyFile, allCoverage),
    false,
  );
});

test("coverage excludes dependencies by default and can allowlist packages (~lib/ paths)", async () => {
  const internals = await loadCoverageInternals();
  // These are the actual paths AssemblyScript emits at runtime for node_modules imports
  const dependencyFile = "~lib/json-as/assembly/index.ts";
  const scopedDependencyFile = "~lib/@scope/pkg/assembly/index.ts";

  const projectCoverage = internals.resolveCoverageOptions(true);
  assert.equal(
    internals.isIgnoredCoverageFile(dependencyFile, projectCoverage),
    true,
  );
  assert.equal(
    internals.isIgnoredCoverageFile(scopedDependencyFile, projectCoverage),
    true,
  );

  const allowlistedCoverage = internals.resolveCoverageOptions({
    enabled: true,
    mode: "project",
    dependencies: ["json-as"],
  });
  assert.equal(
    internals.isIgnoredCoverageFile(dependencyFile, allowlistedCoverage),
    false,
  );
  assert.equal(
    internals.isIgnoredCoverageFile(scopedDependencyFile, allowlistedCoverage),
    true,
  );

  const allCoverage = internals.resolveCoverageOptions({
    enabled: true,
    mode: "all",
  });
  assert.equal(
    internals.isIgnoredCoverageFile(dependencyFile, allCoverage),
    false,
  );
  assert.equal(
    internals.isIgnoredCoverageFile(scopedDependencyFile, allCoverage),
    false,
  );
});

test("applyMode accepts partial coverage config objects without ignore rules", async () => {
  const util = await loadUtilInternals();

  const loaded = util.loadConfig("./as-test.config.json");
  loaded.coverage = {
    enabled: true,
    includeSpecs: false,
    include: ["assembly/**/*.ts", "../rules-sdk/assembly/**/*.ts"],
  };

  const applied = util.applyMode(loaded, undefined);

  assert.equal(applied.config.coverage.enabled, true);
  assert.deepEqual(applied.config.coverage.ignore.labels, []);
  assert.deepEqual(applied.config.coverage.include, [
    "assembly/**/*.ts",
    "../rules-sdk/assembly/**/*.ts",
  ]);
});
