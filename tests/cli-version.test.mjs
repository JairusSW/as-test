import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

test("getCliVersion prefers as-test package.json over cwd package.json", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "as-test-version-"));
  const originalCwd = process.cwd();
  try {
    writeFileSync(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "consumer-project", version: "9.9.9" }),
      "utf8",
    );
    process.chdir(tempRoot);

    const util = await import(
      pathToFileURL(path.join(repoRoot, "bin/util.js")).href
    );
    const repoPkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    );

    assert.equal(util.getCliVersion(), repoPkg.version);
  } finally {
    process.chdir(originalCwd);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
