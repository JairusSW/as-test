import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

async function loadBuildCore() {
  return import(
    pathToFileURL(path.join(repoRoot, "bin/commands/build-core.js")).href
  );
}

function makeProject(layout) {
  const root = mkdtempSync(path.join(os.tmpdir(), "as-test-dupes-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

function outFromInvocation(invocation) {
  const idx = invocation.args.indexOf("-o");
  assert.ok(idx >= 0, "-o flag should be present");
  return invocation.args[idx + 1];
}

test("ast test / ast run: getBuildInvocationPreview disambiguates colliding spec basenames", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();

  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/**/*.spec.ts"],
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "assembly/__tests__/sqli/flags.spec.ts": "// stub\n",
    "assembly/__tests__/sqli_v2/flags.spec.ts": "// stub\n",
    "assembly/__tests__/unique.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);

    const configPath = path.join(projectRoot, "as-test.config.json");
    const fileA = "assembly/__tests__/sqli/flags.spec.ts";
    const fileB = "assembly/__tests__/sqli_v2/flags.spec.ts";
    const fileUnique = "assembly/__tests__/unique.spec.ts";

    const previewA = await getBuildInvocationPreview(configPath, fileA);
    const previewB = await getBuildInvocationPreview(configPath, fileB);
    const previewUnique = await getBuildInvocationPreview(
      configPath,
      fileUnique,
    );

    const outA = outFromInvocation(previewA);
    const outB = outFromInvocation(previewB);
    const outUnique = outFromInvocation(previewUnique);

    assert.notEqual(
      outA,
      outB,
      "duplicate-basename specs must not share an outFile",
    );
    assert.match(outA, /flags\.spec\..*sqli.*\.wasm$/);
    assert.match(outB, /flags\.spec\..*sqli_v2.*\.wasm$/);
    assert.match(outUnique, /unique\.spec\.wasm$/);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("ast fuzz: getBuildInvocationPreview disambiguates colliding fuzz basenames via overrides.kind", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();

  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
      fuzz: {
        input: ["assembly/__fuzz__/**/*.fuzz.ts"],
      },
    }),
    "assembly/__tests__/example.spec.ts": "// stub\n",
    "assembly/__fuzz__/sqli/parser.fuzz.ts": "// stub\n",
    "assembly/__fuzz__/sqli_v2/parser.fuzz.ts": "// stub\n",
    "assembly/__fuzz__/unique.fuzz.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);

    const configPath = path.join(projectRoot, "as-test.config.json");
    const fileA = "assembly/__fuzz__/sqli/parser.fuzz.ts";
    const fileB = "assembly/__fuzz__/sqli_v2/parser.fuzz.ts";
    const fileUnique = "assembly/__fuzz__/unique.fuzz.ts";
    const overrides = { kind: "fuzz", target: "bindings" };

    const previewA = await getBuildInvocationPreview(
      configPath,
      fileA,
      undefined,
      {},
      overrides,
    );
    const previewB = await getBuildInvocationPreview(
      configPath,
      fileB,
      undefined,
      {},
      overrides,
    );
    const previewUnique = await getBuildInvocationPreview(
      configPath,
      fileUnique,
      undefined,
      {},
      overrides,
    );

    const outA = outFromInvocation(previewA);
    const outB = outFromInvocation(previewB);
    const outUnique = outFromInvocation(previewUnique);

    assert.notEqual(
      outA,
      outB,
      "duplicate-basename fuzz targets must not share an outFile",
    );
    assert.match(outA, /parser\.fuzz\..*sqli.*\.wasm$/);
    assert.match(outB, /parser\.fuzz\..*sqli_v2.*\.wasm$/);
    assert.match(outUnique, /unique\.fuzz\.wasm$/);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
