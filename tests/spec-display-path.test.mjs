import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const repoRoot = process.cwd();

test("formatSpecDisplayPath trims nested __tests__ roots", async () => {
  const { formatSpecDisplayPath } = await import(
    pathToFileURL(path.join(repoRoot, "bin/util.js")).href
  );

  assert.equal(
    formatSpecDisplayPath(
      path.join(repoRoot, "assembly/__tests__/foo/bar.spec.ts"),
    ),
    "foo/bar.spec.ts",
  );
  assert.equal(
    formatSpecDisplayPath(
      path.join(repoRoot, "assembly/__tests__/math.spec.ts"),
    ),
    "math.spec.ts",
  );
  assert.equal(
    formatSpecDisplayPath(path.join(repoRoot, "custom/specs/foo/bar.spec.ts")),
    "custom/specs/foo/bar.spec.ts",
  );
});

test("reporting paths use the shared spec display helper", async () => {
  const reporterSource = await fs.readFile(
    path.join(repoRoot, "cli/reporters/default.ts"),
    "utf8",
  );
  const runCoreSource = await fs.readFile(
    path.join(repoRoot, "cli/commands/run-core.ts"),
    "utf8",
  );
  const indexSource = await fs.readFile(
    path.join(repoRoot, "cli/index.ts"),
    "utf8",
  );

  assert.match(reporterSource, /formatSpecDisplayPath\(event\.file\)/);
  assert.match(reporterSource, /formatSpecDisplayPath\(this\.currentFile\)/);
  assert.match(
    runCoreSource,
    /No suites matched.*formatSpecDisplayPath\(file\)/s,
  );
  assert.match(indexSource, /const fileName = formatSpecDisplayPath\(file\);/);
});
