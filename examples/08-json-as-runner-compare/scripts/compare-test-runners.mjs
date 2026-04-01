import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const resultsDir = path.join(rootDir, "compare-runners");
const resultsFile = path.join(resultsDir, "test-runner-results.json");
const modes = ["naive", "swar", "simd"];

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      resolve({ code, elapsedMs, stdout, stderr });
    });
  });
}

async function ensurePrepared() {
  const prepare = await runCommand("node", ["./scripts/prepare-as-pect-tests.mjs"]);
  if (prepare.code !== 0) throw new Error("Failed to prepare as-pect tests");
}

async function main() {
  await fs.mkdir(resultsDir, { recursive: true });
  await ensurePrepared();

  const results = [];

  for (const mode of modes) {
    const asTest = await runCommand("npx", ["ast", "test", "--clean", "--mode", mode]);
    if (asTest.code !== 0) throw new Error(`as-test failed in ${mode} mode`);

    const asPect = await runCommand(
      "node",
      [
        "./node_modules/@as-pect/cli/lib/test.js",
        "--config",
        "./as-pect.config.js",
        "--as-config",
        `./compare-runners/as-pect/${mode}.asconfig.json`,
        "--summary",
        "--no-logo",
      ],
      { JSON_MODE: mode.toUpperCase() },
    );
    if (asPect.code !== 0) throw new Error(`as-pect failed in ${mode} mode`);

    results.push({
      mode,
      asTestMs: Math.round(asTest.elapsedMs),
      asPectMs: Math.round(asPect.elapsedMs),
      deltaMs: Math.round(asPect.elapsedMs - asTest.elapsedMs),
      deltaPct: Number((((asPect.elapsedMs - asTest.elapsedMs) / asTest.elapsedMs) * 100).toFixed(1)),
    });
  }

  await fs.writeFile(resultsFile, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

  console.log("\nComparison");
  for (const row of results) {
    console.log(`${row.mode}: as-test=${row.asTestMs}ms, as-pect=${row.asPectMs}ms, delta=${row.deltaMs}ms (${row.deltaPct}%)`);
  }
  console.log(`\nWrote ${path.relative(rootDir, resultsFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
