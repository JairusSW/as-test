import test from "node:test";
import assert from "node:assert/strict";
import asc from "assemblyscript/asc";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { pathToFileURL } from "url";

const repoRoot = process.cwd();
const startSource =
  "export function _start(): void {}\nexport function answer(): i32 { return 42; }\n";
// Declares (and calls, so it's actually imported) a non-env import that the
// runner is never given — mirrors an unmocked mockImport target with no host
// implementation. Instantiation only succeeds if the runner stubs it.
const missingImportSource =
  '@external("mockmod", "missing")\n' +
  "declare function missing(): i32;\n" +
  "export function _start(): void { missing(); }\n";

test("bindings runner supports raw, esm, and none", async (t) => {
  for (const kind of ["raw", "esm", "none"]) {
    await t.test(kind, async () => {
      const fixture = await createBindingsFixture(kind);
      const result = await runNode([".as-test/runners/default.bindings.js"], {
        AS_TEST_RUNTIME_TARGET: "bindings",
        AS_TEST_WASM_PATH: fixture.wasmPath,
        ...(fixture.helperPath
          ? {
              AS_TEST_HELPER_PATH: fixture.helperPath,
              AS_TEST_BINDINGS_KIND: kind,
            }
          : { AS_TEST_BINDINGS_KIND: "none" }),
      });
      assert.equal(result.code, 0, result.stderr);
    });
  }
});

test("generated runners can be invoked directly with a wasm path argument", async () => {
  const bindingsFixture = await createBindingsFixture("raw");
  const wasiFixture = await createWasiFixture();

  const bindingsResult = await runNode([
    ".as-test/runners/default.bindings.js",
    bindingsFixture.wasmPath,
  ]);
  assert.equal(bindingsResult.code, 0, bindingsResult.stderr);

  const wasiResult = await runNode([
    ".as-test/runners/default.wasi.js",
    wasiFixture.wasmPath,
  ]);
  assert.equal(wasiResult.code, 0, wasiResult.stderr);
});

test("wasi runner supports wasi artifacts", async () => {
  const fixture = await createWasiFixture();
  const result = await runNode([".as-test/runners/default.wasi.js"], {
    AS_TEST_RUNTIME_TARGET: "wasi",
    AS_TEST_WASM_PATH: fixture.wasmPath,
  });
  assert.equal(result.code, 0, result.stderr);
});

test("bindings runner stubs an unprovided non-env import", async (t) => {
  // esm is excluded: asc esm bindings resolve @external imports as JS module
  // imports, which fail before instantiation — see the dedicated test below.
  for (const kind of ["raw", "none"]) {
    await t.test(kind, async () => {
      const fixture = await createBindingsFixture(kind, missingImportSource);
      const result = await runNode([".as-test/runners/default.bindings.js"], {
        AS_TEST_RUNTIME_TARGET: "bindings",
        AS_TEST_WASM_PATH: fixture.wasmPath,
        ...(fixture.helperPath
          ? {
              AS_TEST_HELPER_PATH: fixture.helperPath,
              AS_TEST_BINDINGS_KIND: kind,
            }
          : { AS_TEST_BINDINGS_KIND: "none" }),
      });
      assert.equal(result.code, 0, result.stderr);
    });
  }
});

test("esm bindings can't back an unprovided import (it's a JS module import)", async () => {
  const fixture = await createBindingsFixture("esm", missingImportSource);
  const result = await runNode([".as-test/runners/default.bindings.js"], {
    AS_TEST_RUNTIME_TARGET: "bindings",
    AS_TEST_WASM_PATH: fixture.wasmPath,
    AS_TEST_HELPER_PATH: fixture.helperPath,
    AS_TEST_BINDINGS_KIND: "esm",
  });
  // esm bindings emit `import { missing } from "mockmod"`, so an unprovided
  // import fails to resolve at module load — runtime import stubbing can't
  // reach it. This documents the boundary rather than a stubbable path.
  assert.notEqual(result.code, 0, "expected esm to fail on the missing module");
  assert.match(result.stderr + result.stdout, /mockmod|MODULE_NOT_FOUND/);
});

test("wasi runner stubs an unprovided non-env import", async () => {
  const fixture = await createWasiFixture(missingImportSource);
  const result = await runNode([".as-test/runners/default.wasi.js"], {
    AS_TEST_RUNTIME_TARGET: "wasi",
    AS_TEST_WASM_PATH: fixture.wasmPath,
  });
  assert.equal(result.code, 0, result.stderr);
});

test("runtime failures print repro and resolved commands", async () => {
  const badSpecPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_runtime_fail.spec.ts",
  );
  await fs.writeFile(
    badSpecPath,
    'import { test } from "..";\nthrow new Error("lol");\ntest("never runs", () => {});\n',
    "utf8",
  );
  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "test",
        "assembly/__tests__/__tmp_runtime_fail.spec.ts",
        "--mode",
        "node:wasi",
        "--no-parallel",
      ],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.notEqual(
      result.code,
      0,
      "expected temp runtime-fail spec to fail before reporting",
    );
    assert.match(output, /FAIL\s+__tmp_runtime_fail\.spec\.ts#1/);
    assert.match(output, /Oops! Looks like the runtime crashed!/);
    assert.match(output, /Mode\(s\): node:wasi/);
    assert.match(output, /To reproduce, run the following commands:/);
    assert.match(output, /Mode: node:wasi/);
    assert.match(output, /Build: .*__tmp_runtime_fail\.spec\.wasm/);
    assert.match(
      output,
      /Run: .*default\.wasi\.js .*__tmp_runtime_fail\.spec\.wasm/,
    );
    assert.match(output, /Here's a log dump too:/);
  } finally {
    await fs.rm(badSpecPath, { force: true });
  }
});

test("parallel test mode reports build failures after other files finish", async () => {
  const badSpecPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_build_fail.spec.ts",
  );
  await fs.writeFile(
    badSpecPath,
    'import { test } from "..";\n\ntest("broken build", () => {\n  const value =\n});\n',
    "utf8",
  );

  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "test",
        "assembly/__tests__/math.spec.ts",
        "assembly/__tests__/__tmp_build_fail.spec.ts",
        "--parallel",
        "--mode",
        "node:wasi",
      ],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.notEqual(result.code, 0, "expected malformed spec build to fail");
    assert.match(output, /PASS\s+math\.spec\.ts/);
    assert.match(output, /FAIL\s+__tmp_build_fail\.spec\.ts#1/);
    assert.match(output, /Oops! Looks like the test failed to build!/);
    assert.match(output, /Mode\(s\): node:wasi/);
    assert.match(output, /Build: .*__tmp_build_fail\.spec\.wasm/);
    assert.match(output, /Crash log:/);
  } finally {
    await fs.rm(badSpecPath, { force: true });
  }
});

test("coverage gaps group unhit parent scopes before nested points", async () => {
  const helperPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_coverage_helper.ts",
  );
  const specPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_coverage.spec.ts",
  );

  await fs.writeFile(
    helperPath,
    [
      "export function covered(): i32 {",
      "  return 1;",
      "}",
      "",
      "export function neverCalled(",
      "  value: i32 = nestedValue(1),",
      "): i32 {",
      "  return value;",
      "}",
      "",
      "export function partiallyCovered(",
      "  value: i32 = nestedValue(2),",
      "): i32 {",
      "  return value;",
      "}",
      "",
      "function nestedValue(value: i32): i32 {",
      "  return value + 1;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    specPath,
    [
      'import { test, expect } from "..";',
      'import { covered, partiallyCovered } from "./__tmp_coverage_helper";',
      "",
      'test("coverage", () => {',
      "  expect(covered()).toBe(1);",
      "  expect(partiallyCovered(1)).toBe(1);",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "test",
        "assembly/__tests__/__tmp_coverage.spec.ts",
        "--mode",
        "node:wasi",
        "--no-parallel",
        "--enable",
        "coverage",
        "--show-coverage",
      ],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 0, output);
    assert.match(output, /Coverage Gaps/);
    assert.match(output, /__tmp_coverage_helper\.ts \(6 uncovered\)/);
    assert.match(
      output,
      /Function\s+assembly\/__tests__\/__tmp_coverage_helper\.ts:5:\d+.*neverCalled/,
    );
    assert.match(output, /\(\+2 nested uncovered points\)/);
    assert.match(
      output,
      /Function\s+assembly\/__tests__\/__tmp_coverage_helper\.ts:11:\d+.*partiallyCovered/,
    );
    assert.match(
      output,
      /Run with --show-coverage=all or --verbose to expand nested coverage gaps\./,
    );
  } finally {
    await fs.rm(helperPath, { force: true });
    await fs.rm(specPath, { force: true });
  }
});

test("coverage gaps expand nested points for verbose and --show-coverage=all", async () => {
  const helperPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_coverage_helper.ts",
  );
  const specPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_coverage.spec.ts",
  );

  await fs.writeFile(
    helperPath,
    [
      "export function covered(): i32 {",
      "  return 1;",
      "}",
      "",
      "export function neverCalled(",
      "  value: i32 = nestedValue(1),",
      "): i32 {",
      "  return value;",
      "}",
      "",
      "export function partiallyCovered(",
      "  value: i32 = nestedValue(2),",
      "): i32 {",
      "  return value;",
      "}",
      "",
      "function nestedValue(value: i32): i32 {",
      "  return value + 1;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    specPath,
    [
      'import { test, expect } from "..";',
      'import { covered, partiallyCovered } from "./__tmp_coverage_helper";',
      "",
      'test("coverage", () => {',
      "  expect(covered()).toBe(1);",
      "  expect(partiallyCovered(1)).toBe(1);",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    for (const extraArgs of [
      ["--show-coverage=all"],
      ["--show-coverage", "--verbose"],
    ]) {
      const result = await runNode(
        [
          "./bin/index.js",
          "test",
          "assembly/__tests__/__tmp_coverage.spec.ts",
          "--mode",
          "node:wasi",
          "--no-parallel",
          "--enable",
          "coverage",
          ...extraArgs,
        ],
        {},
      );
      const output = result.stdout + result.stderr;
      assert.equal(result.code, 0, output);
      assert.doesNotMatch(output, /\(\+1 nested uncovered point\)/);
      assert.match(
        output,
        /DefaultValue\s+assembly\/__tests__\/__tmp_coverage_helper\.ts:6:\d+.*value: i32 = nestedValue\(1\)/,
      );
      assert.match(
        output,
        /DefaultValue\s+assembly\/__tests__\/__tmp_coverage_helper\.ts:12:\d+.*value: i32 = nestedValue\(2\)/,
      );
    }
  } finally {
    await fs.rm(helperPath, { force: true });
    await fs.rm(specPath, { force: true });
  }
});

test("coverage gaps surface control-flow and assignment kinds", async () => {
  const helperPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_coverage_kinds_helper.ts",
  );
  const specPath = path.join(
    repoRoot,
    "assembly",
    "__tests__",
    "__tmp_coverage_kinds.spec.ts",
  );

  await fs.writeFile(
    helperPath,
    [
      "export function coveredLoop(): i32 {",
      "  let total = 0;",
      "  for (let i = 0; i < 1; i++) total += i;",
      "  return total;",
      "}",
      "",
      "export function uncoveredIfBranch(flag: bool): i32 {",
      "  if (flag) return 1;",
      "  return 0;",
      "}",
      "",
      "export function uncoveredAssignment(): i32 {",
      "  let value = 0;",
      "  value = nestedValue(3);",
      "  return value;",
      "}",
      "",
      "export function uncoveredLoop(): i32 {",
      "  for (let i = 0; i < 2; i++) {",
      "    if (i == 1) return i;",
      "  }",
      "  return -1;",
      "}",
      "",
      "export function uncoveredThrow(): void {",
      '  throw new Error("boom");',
      "}",
      "",
      "function nestedValue(value: i32): i32 {",
      "  return value + 1;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    specPath,
    [
      'import { test, expect } from "..";',
      'import { coveredLoop, uncoveredIfBranch } from "./__tmp_coverage_kinds_helper";',
      "",
      'test("coverage kinds", () => {',
      "  expect(coveredLoop()).toBe(0);",
      "  expect(uncoveredIfBranch(false)).toBe(0);",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "test",
        "assembly/__tests__/__tmp_coverage_kinds.spec.ts",
        "--mode",
        "node:wasi",
        "--no-parallel",
        "--enable",
        "coverage",
        "--show-coverage=all",
      ],
      {},
    );
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 0, output);
    assert.match(
      output,
      /IfBranch\s+assembly\/__tests__\/__tmp_coverage_kinds_helper\.ts:8:\d+.*if \(flag\) return 1;/,
    );
    assert.match(
      output,
      /Assignment\s+assembly\/__tests__\/__tmp_coverage_kinds_helper\.ts:14:\d+.*value = nestedValue\(3\);/,
    );
    assert.match(
      output,
      /Loop\s+assembly\/__tests__\/__tmp_coverage_kinds_helper\.ts:19:\d+.*for \(let i = 0; i < 2; i\+\+\) \{/,
    );
    assert.match(
      output,
      /Return\s+assembly\/__tests__\/__tmp_coverage_kinds_helper\.ts:22:\d+.*return -1;/,
    );
    assert.match(
      output,
      /Throw\s+assembly\/__tests__\/__tmp_coverage_kinds_helper\.ts:26:\d+.*throw new Error\("boom"\);/,
    );
  } finally {
    await fs.rm(helperPath, { force: true });
    await fs.rm(specPath, { force: true });
  }
});

test("web runner supports raw, esm, and none", async (t) => {
  if (process.env.AS_TEST_SKIP_WEB) {
    t.skip("AS_TEST_SKIP_WEB is set");
    return;
  }
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }
  for (const kind of ["raw", "esm", "none"]) {
    await t.test(kind, async () => {
      const fixture = await createBindingsFixture(kind);
      const result = await runNode(
        [".as-test/runners/default.web.js", "--headless", fixture.wasmPath],
        {
          AS_TEST_RUNTIME_TARGET: "web",
          AS_TEST_WASM_PATH: fixture.wasmPath,
          ...(fixture.helperPath
            ? {
                AS_TEST_HELPER_PATH: fixture.helperPath,
                AS_TEST_BINDINGS_KIND: kind,
              }
            : { AS_TEST_BINDINGS_KIND: "none" }),
        },
      );
      assert.equal(result.code, 0, result.stderr);
    });
  }
});

test("web runner stubs an unprovided non-env import", async (t) => {
  if (process.env.AS_TEST_SKIP_WEB) {
    t.skip("AS_TEST_SKIP_WEB is set");
    return;
  }
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }
  // esm excluded: asc esm bindings resolve @external imports as JS module
  // imports, which fail before instantiation — see the dedicated bindings test.
  for (const kind of ["raw", "none"]) {
    await t.test(kind, async () => {
      const fixture = await createBindingsFixture(kind, missingImportSource);
      const result = await runNode(
        [".as-test/runners/default.web.js", "--headless", fixture.wasmPath],
        {
          AS_TEST_RUNTIME_TARGET: "web",
          AS_TEST_WASM_PATH: fixture.wasmPath,
          ...(fixture.helperPath
            ? {
                AS_TEST_HELPER_PATH: fixture.helperPath,
                AS_TEST_BINDINGS_KIND: kind,
              }
            : { AS_TEST_BINDINGS_KIND: "none" }),
        },
      );
      assert.equal(result.code, 0, result.stderr);
    });
  }
});

test("web mode fails when the browser side closes early", async (t) => {
  if (process.env.AS_TEST_SKIP_WEB) {
    t.skip("AS_TEST_SKIP_WEB is set");
    return;
  }
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }
  // A "browser" that exits immediately should cause the framework to detect
  // the disconnect and report a clean failure rather than hang. Shebanged +
  // executable so the CLI's browser resolver accepts it as a launcher path.
  const launcherPath = path.join(
    os.tmpdir(),
    `as-test-noop-browser-${Date.now()}.mjs`,
  );
  await fs.writeFile(
    launcherPath,
    "#!/usr/bin/env node\nprocess.exit(0);\n",
    "utf8",
  );
  await fs.chmod(launcherPath, 0o755);
  try {
    const result = await runNode(
      [
        "./bin/index.js",
        "test",
        "math",
        "--mode",
        "chromium",
        "--browser",
        launcherPath,
      ],
      {},
    );
    assert.notEqual(
      result.code,
      0,
      "expected web mode to fail when browser exits early",
    );
    assert.match(
      result.stderr + result.stdout,
      /web (browser|runtime) (disconnected|process exited|exited)/i,
    );
  } finally {
    await fs.rm(launcherPath, { force: true });
  }
});

async function createBindingsFixture(kind, source = startSource) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `as-test-${kind}-`));
  const stem = path.join(tempDir, "binary");
  if (kind == "none") {
    const result = await asc.compileString(source);
    assert.ifError(result.error);
    await fs.writeFile(`${stem}.wasm`, Buffer.from(result.binary));
    return { wasmPath: `${stem}.wasm`, helperPath: null };
  }
  const result = await asc.compileString(source, { bindings: kind });
  assert.ifError(result.error);
  await fs.writeFile(`${stem}.wasm`, Buffer.from(result.binary));
  await fs.writeFile(`${stem}.js`, result["binary.js"], "utf8");
  return { wasmPath: `${stem}.wasm`, helperPath: `${stem}.js` };
}

async function createWasiFixture(source = startSource) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "as-test-wasi-"));
  const wasmPath = path.join(tempDir, "artifact.wasm");
  const files = new Map([["entry.ts", source]]);
  const result = await asc.main(
    [
      "entry.ts",
      "--use",
      "AS_TEST_WASI=1",
      "--config",
      "./node_modules/@assemblyscript/wasi-shim/asconfig.json",
      "--outFile",
      wasmPath,
    ],
    {
      stdout: process.stdout,
      stderr: process.stderr,
      readFile(name) {
        return files.has(name) ? files.get(name) : null;
      },
      writeFile(name, data) {
        return fs.writeFile(
          name,
          Buffer.isBuffer(data) ? data : Buffer.from(data),
        );
      },
      listFiles() {
        return [...files.keys()];
      },
    },
  );
  assert.ifError(result.error);
  return { wasmPath };
}

async function canListenOnLoopback() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function runNode(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
