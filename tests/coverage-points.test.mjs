import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { pathToFileURL } from "url";

const repoRoot = process.cwd();

test("coverage point descriptors prefer parameter default values over declaration lines", async () => {
  const { describeCoveragePoint } = await import(
    pathToFileURL(path.join(repoRoot, "bin/coverage-points.js")).href
  );

  const info = describeCoveragePoint(
    "assembly/src/expectation.ts",
    334,
    45,
    "DefaultValue",
  );

  assert.equal(info.displayType, "DefaultValue");
  assert.equal(info.subjectName, "precision");
  assert.equal(info.visible.slice(info.highlightStart, info.highlightEnd), "2");
});

test("coverage point descriptors keep transform-emitted ternary labels", async () => {
  const { describeCoveragePoint } = await import(
    pathToFileURL(path.join(repoRoot, "bin/coverage-points.js")).href
  );

  const info = describeCoveragePoint("assembly/index.ts", 46, 51, "Ternary");

  assert.equal(info.displayType, "Ternary");
  assert.equal(info.subjectName, null);
  assert.equal(
    info.visible.slice(info.highlightStart, info.highlightEnd),
    '"unknown"',
  );
});
