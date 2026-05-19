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
  const root = mkdtempSync(path.join(os.tmpdir(), "as-test-jsonas-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

function countJsonAsTransforms(invocation) {
  const args = invocation.args;
  let count = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] == "--transform") {
      const v = args[i + 1] ?? "";
      if (v.includes("json-as")) count++;
    } else if (
      typeof args[i] == "string" &&
      args[i].startsWith("--transform=") &&
      args[i].includes("json-as")
    ) {
      count++;
    }
  }
  return count;
}

test("default: as-test auto-includes --transform json-as/transform", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 1);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("user supplies --transform json-as via buildOptions.args: no auto-include", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      buildOptions: {
        target: "bindings",
        args: ["--transform json-as/transform"],
      },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 1);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("user supplies --transform=<abs-path-to-json-as>: no auto-include", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      buildOptions: {
        target: "bindings",
        args: ["--transform=/abs/path/json-as/transform/lib/index.js"],
      },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 1);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("user declares json-as transform in asconfig.options.transform: no auto-include", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      config: "asconfig.json",
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "asconfig.json": JSON.stringify({
      options: { transform: ["json-as/transform"] },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 0);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("user declares json-as transform in asconfig target: no auto-include", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      config: "asconfig.json",
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "asconfig.json": JSON.stringify({
      targets: {
        debug: { transform: "json-as/transform" },
      },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 0);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("user declares json-as transform via asconfig extends: no auto-include", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      config: "asconfig.json",
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "asconfig.json": JSON.stringify({
      extends: "asconfig.base.json",
    }),
    "asconfig.base.json": JSON.stringify({
      options: { transform: ["json-as/transform"] },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 0);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("unrelated transform in asconfig does not suppress auto-include", async () => {
  const { getBuildInvocationPreview } = await loadBuildCore();
  const projectRoot = makeProject({
    "as-test.config.json": JSON.stringify({
      input: ["assembly/__tests__/*.spec.ts"],
      config: "asconfig.json",
      buildOptions: { target: "bindings" },
      runOptions: { runtime: { cmd: "node base.js" } },
    }),
    "asconfig.json": JSON.stringify({
      options: { transform: ["unrelated/transform"] },
    }),
    "assembly/__tests__/x.spec.ts": "// stub\n",
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(projectRoot);
    const invocation = await getBuildInvocationPreview(
      path.join(projectRoot, "as-test.config.json"),
      "assembly/__tests__/x.spec.ts",
    );
    assert.equal(countJsonAsTransforms(invocation), 1);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
