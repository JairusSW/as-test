import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const repoRoot = process.cwd();

test("packed as-test compiles from a clean consumer without extra AssemblyScript deps", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "as-test-package-surface-"),
  );
  const cacheDir = path.join(tempDir, "npm-cache");
  const consumerDir = path.join(tempDir, "consumer");
  await fs.mkdir(path.join(consumerDir, "assembly"), { recursive: true });
  await fs.mkdir(path.join(consumerDir, "node_modules"), { recursive: true });

  await fs.writeFile(
    path.join(consumerDir, "assembly", "index.ts"),
    [
      'import { describe, expect, test } from "as-test";',
      "",
      'describe("surface", () => {',
      '  test("works", () => {',
      "    expect(1 + 1).toBe(2);",
      "  });",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.symlink(
    path.join(repoRoot, "node_modules", "assemblyscript"),
    path.join(consumerDir, "node_modules", "assemblyscript"),
  );
  await fs.symlink(
    path.join(repoRoot, "node_modules", "json-as"),
    path.join(consumerDir, "node_modules", "json-as"),
  );

  const pack = await run("npm", ["pack", "--json", "--cache", cacheDir], {
    cwd: repoRoot,
  });
  assert.equal(pack.code, 0, pack.stderr);
  const [{ filename }] = JSON.parse(pack.stdout);
  const tarballPath = path.join(repoRoot, filename);

  await fs.mkdir(path.join(consumerDir, "node_modules", "as-test"), {
    recursive: true,
  });
  const untar = await run(
    "tar",
    [
      "-xzf",
      tarballPath,
      "-C",
      path.join(consumerDir, "node_modules", "as-test"),
      "--strip-components=1",
    ],
    { cwd: repoRoot },
  );
  assert.equal(untar.code, 0, untar.stderr);

  const compile = await run(
    "node",
    [
      "./node_modules/assemblyscript/bin/asc.js",
      "assembly/index.ts",
      "--target",
      "debug",
      "--exportRuntime",
      "--transform",
      "./node_modules/as-test/transform",
      "--transform",
      "./node_modules/json-as/transform",
    ],
    { cwd: consumerDir },
  );
  assert.equal(compile.code, 0, compile.stderr);
  assert.doesNotMatch(compile.stderr, /as-console|stringify|as-rainbow/);

  await fs.rm(tarballPath, { force: true });
});

async function run(command, args, options) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
