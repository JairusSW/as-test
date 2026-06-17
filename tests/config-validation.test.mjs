import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

const util = await import(
  pathToFileURL(path.join(repoRoot, "bin/util.js")).href
);

// loadConfig() validates the raw config and throws an aggregated error listing
// each issue as "<path>: <message>". These tests drive validation through it.
function loadConfigObject(config) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "as-test-config-"));
  const configPath = path.join(tempRoot, "as-test.config.json");
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  try {
    return util.loadConfig(configPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function expectInvalid(config, ...fragments) {
  assert.throws(
    () => loadConfigObject(config),
    (error) => {
      assert.match(error.message, /invalid config at/);
      for (const fragment of fragments) {
        assert.ok(
          error.message.includes(fragment),
          `expected validation error to include ${JSON.stringify(fragment)}\n--- got ---\n${error.message}`,
        );
      }
      return true;
    },
  );
}

test("a minimal config is accepted", () => {
  const config = loadConfigObject({});
  assert.equal(typeof config, "object");
  // defaults are materialized
  assert.equal(config.buildOptions.target, "wasi");
});

test("unknown top-level property is rejected with a suggestion path", () => {
  expectInvalid({ unknownField: 123 }, "$.unknownField", "unknown property");
});

test("a typo'd key surfaces a did-you-mean fix", () => {
  // "covrage" is one edit from "coverage"
  expectInvalid({ covrage: true }, "$.covrage", "coverage");
});

test("invalid cache value is rejected", () => {
  expectInvalid(
    { cache: "sometimes" },
    "$.cache",
    'must be a boolean, "build"/"full", or { type, maxTime }',
  );
});

test("invalid cache.maxTime duration is rejected", () => {
  expectInvalid(
    { cache: { type: "full", maxTime: "soon" } },
    "$.cache.maxTime",
    "must be a duration",
  );
});

test("buildOptions.args must be an array of strings", () => {
  expectInvalid(
    { buildOptions: { args: "--optimize" } },
    "$.buildOptions.args",
    "must be an array of strings",
  );
});

test("buildOptions.target must be a known target", () => {
  expectInvalid(
    { buildOptions: { target: "wat" } },
    "$.buildOptions.target",
    'must be "wasi", "bindings", or "web"',
  );
});

test("env must be a path, KEY=value array, or object", () => {
  expectInvalid(
    { env: 42 },
    "$.env",
    "must be a .env file path, array of KEY=value strings, or object of string values",
  );
});

test("env array entries must use KEY=value form", () => {
  expectInvalid(
    { env: ["NOEQUALS"] },
    "$.env[0]",
    'must use "KEY=value" format',
  );
});

test("multiple issues are all reported", () => {
  expectInvalid(
    { unknownField: 1, buildOptions: { target: "wat" } },
    "$.unknownField",
    "$.buildOptions.target",
  );
});
