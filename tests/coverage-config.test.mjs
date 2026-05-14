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

test("coverage excludes dependencies by default and can allowlist packages", async () => {
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
