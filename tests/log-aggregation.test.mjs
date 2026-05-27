import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const repoRoot = process.cwd();
const specRel = "assembly/__tests__/__tmp_log_aggregation.spec.ts";
const specPath = path.join(repoRoot, specRel);
const latestLogPath = path.join(repoRoot, ".as-test", "logs", "latest.log");

const SPEC_SOURCE = `import { describe, expect, log, test } from "..";

describe("log aggregation fixture", () => {
  test("emits logs", () => {
    log("hello from log()");
    log(42);
    expect(1).toBe(1);
  });
});
`;

// `ast test <spec>` runs both default modes (node:bindings, node:wasi). Both
// emit identical log() output, so latest.log should collapse them into a single
// block tagged with both modes.
test("logs are aggregated into latest.log, de-duplicated across modes", async () => {
  await fs.writeFile(specPath, SPEC_SOURCE, "utf8");
  await fs.rm(latestLogPath, { force: true });
  try {
    const result = await runNode(["./bin/index.js", "test", specRel]);
    assert.equal(result.code, 0, result.stdout + result.stderr);

    // End-of-run hint points at the aggregated file.
    assert.match(
      result.stdout,
      /logs captured .* \.as-test\/logs\/latest\.log/,
    );

    const latest = await fs.readFile(latestLogPath, "utf8");
    // One block for the spec, tagged with BOTH modes (deduped), then the logs.
    assert.match(
      latest,
      /\[LOG\] __tmp_log_aggregation\.spec\.ts \(node:bindings, node:wasi\):/,
    );
    assert.match(latest, /hello from log\(\)/);
    assert.match(latest, /\n42\n?/);
    // The identical block must appear exactly once, not once per mode.
    const blocks = latest.match(/\[LOG\] __tmp_log_aggregation\.spec\.ts/g);
    assert.equal(blocks.length, 1, "expected a single de-duplicated block");
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

test("--show-logs prints the captured logs to stdout", async () => {
  await fs.writeFile(specPath, SPEC_SOURCE, "utf8");
  try {
    const result = await runNode([
      "./bin/index.js",
      "test",
      specRel,
      "--show-logs",
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Logs \(\d+\)/);
    assert.match(result.stdout, /hello from log\(\)/);
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

function runNode(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
