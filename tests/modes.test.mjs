import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

async function loadUtil() {
  return import(pathToFileURL(path.join(repoRoot, "bin/util.js")).href);
}

function makeTempConfig(json) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "as-test-modes-"));
  const file = path.join(dir, "as-test.config.json");
  writeFileSync(file, JSON.stringify(json), "utf8");
  return { dir, file };
}

test("getDefaultModeNames returns only modes with default !== false", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
    modes: {
      autoOne: {},
      autoTwo: { default: true },
      manualOne: { default: false },
      manualTwo: { default: false },
    },
  });
  try {
    const config = util.loadConfig(file, false);
    const defaults = util.getDefaultModeNames(config);
    assert.deepEqual(defaults.sort(), ["autoOne", "autoTwo"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getDefaultModeNames returns empty when no modes are declared", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
  });
  try {
    const config = util.loadConfig(file, false);
    assert.deepEqual(util.getDefaultModeNames(config), []);
    assert.deepEqual(Object.keys(config.modes), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMode with a named mode inherits base runner when mode does not override runOptions", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
    modes: {
      noRunner: {
        buildOptions: { target: "bindings" },
      },
    },
  });
  try {
    const config = util.loadConfig(file, false);
    const applied = util.applyMode(config, "noRunner");
    assert.equal(applied.config.runOptions.runtime.cmd, "node base.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMode with a named mode that overrides runOptions uses the mode's runner", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
    modes: {
      ownRunner: {
        runOptions: { runtime: { cmd: "wasmtime run <file>" } },
      },
    },
  });
  try {
    const config = util.loadConfig(file, false);
    const applied = util.applyMode(config, "ownRunner");
    assert.equal(applied.config.runOptions.runtime.cmd, "wasmtime run <file>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMode without a mode name returns base config with default output segment", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    output: ".as-test/",
    runOptions: { runtime: { cmd: "node base.js" } },
  });
  try {
    const config = util.loadConfig(file, false);
    const applied = util.applyMode(config);
    assert.equal(applied.config.runOptions.runtime.cmd, "node base.js");
    assert.match(applied.config.outDir, /default/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMode rejects an unknown mode name", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
    modes: { real: {} },
  });
  try {
    const config = util.loadConfig(file, false);
    assert.throws(() => util.applyMode(config, "missing"), /unknown mode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execution mode resolution: configs with declared modes never include the base mode", async () => {
  // Mirrors resolveExecutionModes in cli/index.ts: when modes are declared, the
  // base config (undefined) must not be in the selected list.
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
    modes: {
      "node:wasi": { buildOptions: { target: "wasi" } },
      "node:bindings": { buildOptions: { target: "bindings" } },
      wasmtime: { default: false, buildOptions: { target: "wasi" } },
    },
  });
  try {
    const config = util.loadConfig(file, false);
    const hasDeclaredModes = Object.keys(config.modes).length > 0;
    const resolved = hasDeclaredModes
      ? util.getDefaultModeNames(config)
      : [undefined];
    assert.deepEqual(resolved.sort(), ["node:bindings", "node:wasi"]);
    assert.ok(!resolved.includes(undefined));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execution mode resolution: configs without modes fall back to the base mode", async () => {
  const util = await loadUtil();
  const { file, dir } = makeTempConfig({
    input: ["assembly/__tests__/*.spec.ts"],
    runOptions: { runtime: { cmd: "node base.js" } },
  });
  try {
    const config = util.loadConfig(file, false);
    const hasDeclaredModes = Object.keys(config.modes).length > 0;
    const resolved = hasDeclaredModes
      ? util.getDefaultModeNames(config)
      : [undefined];
    assert.deepEqual(resolved, [undefined]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
