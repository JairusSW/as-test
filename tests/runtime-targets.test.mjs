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

test("bindings runner supports raw, esm, and none", async (t) => {
  for (const kind of ["raw", "esm", "none"]) {
    await t.test(kind, async () => {
      const fixture = await createBindingsFixture(kind);
      const result = await runNode([
        ".as-test/runners/default.bindings.js",
      ], {
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

test("wasi runner supports wasi artifacts", async () => {
  const fixture = await createWasiFixture();
  const result = await runNode([".as-test/runners/default.wasi.js"], {
    AS_TEST_RUNTIME_TARGET: "wasi",
    AS_TEST_WASM_PATH: fixture.wasmPath,
  });
  assert.equal(result.code, 0, result.stderr);
});

test("web runner supports raw, esm, and none", async (t) => {
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }
  const browserShim = path.join(repoRoot, "tests/fixtures/fake-browser.mjs");
  for (const kind of ["raw", "esm", "none"]) {
    await t.test(kind, async () => {
      const fixture = await createBindingsFixture(kind);
      const result = await runNode([".as-test/runners/default.web.js"], {
        BROWSER: `node ${browserShim}`,
        AS_TEST_RUNTIME_TARGET: "web",
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

test("web mode fails when the browser side closes early", async (t) => {
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }

  const browserShim = path.join(repoRoot, "tests/fixtures/fake-browser.mjs");
  const launcherPath = path.join(os.tmpdir(), `as-test-browser-close-${Date.now()}.mjs`);
  await fs.writeFile(
    launcherPath,
    `#!/usr/bin/env node
process.env.AS_TEST_FAKE_BROWSER_CLOSE_PHASE = "start";
await import(${JSON.stringify(pathToFileURL(browserShim).href)});
`,
    "utf8",
  );
  await fs.chmod(launcherPath, 0o755);

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
  assert.notEqual(result.code, 0, "expected web mode to fail when browser closes early");
  assert.match(
    result.stderr + result.stdout,
    /web browser (disconnected|process exited)/i,
  );
});

test("macOS web mode resolves Playwright Chromium cache and launches paths with spaces", async (t) => {
  if (process.platform != "darwin") {
    t.skip("macOS-only Playwright cache layout");
    return;
  }
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }

  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "as-test-home-"));
  const executablePath = path.join(
    tempHome,
    "Library",
    "Caches",
    "ms-playwright",
    "chromium-1223",
    "chrome-mac-arm64",
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing",
  );
  await fs.mkdir(path.dirname(executablePath), { recursive: true });
  const browserShim = path.join(repoRoot, "tests/fixtures/fake-browser.mjs");
  await fs.writeFile(
    executablePath,
    `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(browserShim).href)};\n`,
    "utf8",
  );
  await fs.chmod(executablePath, 0o755);

  const result = await runNode(
    [
      "./bin/index.js",
      "test",
      "math",
      "--mode",
      "chromium:headless",
      "--browser",
      "chromium",
    ],
    {
      HOME: tempHome,
      BROWSER: "",
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    },
  );
  assert.equal(result.code, 0, result.stderr);
});

test("macOS web mode resolves Firefox from Applications when requested by name", async (t) => {
  if (process.platform != "darwin") {
    t.skip("macOS-only Firefox app bundle lookup");
    return;
  }
  if (!(await canListenOnLoopback())) {
    t.skip("loopback listeners are not permitted in this environment");
    return;
  }

  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "as-test-firefox-home-"));
  const executablePath = path.join(
    tempHome,
    "Applications",
    "Firefox.app",
    "Contents",
    "MacOS",
    "firefox",
  );
  await fs.mkdir(path.dirname(executablePath), { recursive: true });
  const browserShim = path.join(repoRoot, "tests/fixtures/fake-browser.mjs");
  await fs.writeFile(
    executablePath,
    `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(browserShim).href)};\n`,
    "utf8",
  );
  await fs.chmod(executablePath, 0o755);

  const result = await runNode(
    [
      "./bin/index.js",
      "test",
      "math",
      "--mode",
      "firefox:headless",
      "--browser",
      "firefox",
    ],
    {
      HOME: tempHome,
      BROWSER: "",
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    },
  );
  assert.equal(result.code, 0, result.stderr);
});

async function createBindingsFixture(kind) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `as-test-${kind}-`));
  const stem = path.join(tempDir, "binary");
  if (kind == "none") {
    const result = await asc.compileString(startSource);
    assert.ifError(result.error);
    await fs.writeFile(`${stem}.wasm`, Buffer.from(result.binary));
    return { wasmPath: `${stem}.wasm`, helperPath: null };
  }
  const result = await asc.compileString(startSource, { bindings: kind });
  assert.ifError(result.error);
  await fs.writeFile(`${stem}.wasm`, Buffer.from(result.binary));
  await fs.writeFile(`${stem}.js`, result["binary.js"], "utf8");
  return { wasmPath: `${stem}.wasm`, helperPath: `${stem}.js` };
}

async function createWasiFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "as-test-wasi-"));
  const wasmPath = path.join(tempDir, "artifact.wasm");
  const files = new Map([["entry.ts", startSource]]);
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
        return fs.writeFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
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
