import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const repoRoot = process.cwd();
const testsDir = path.join(repoRoot, "assembly", "__tests__");
// A private output root so these tests own their own cache/build dirs. The repo's
// own config dogfoods `cache: full`, so other test files running a selectorless
// `ast test` would otherwise prune our `__tmp_bc_` entries out of the shared
// `.as-test/cache` manifest while we run in parallel. Runners still generate at
// the hardcoded `.as-test/runners/`, so the runtime cmd is unaffected.
const OUT_ROOT = ".as-test-bc/";
const cacheDir = path.join(repoRoot, ".as-test-bc", "cache");

// Unique prefix so these fixtures never collide with other test files running in
// parallel, and so our selector only ever resolves our own specs (which also
// keeps cache pruning off — pruning only runs on a selector-less full run).
const PREFIX = "__tmp_bc_";
const HELPER = `${PREFIX}helper.ts`;
const SPEC_A = `${PREFIX}a.spec.ts`;
const SPEC_B = `${PREFIX}b.spec.ts`;
const SELECTOR = `${PREFIX}*.spec.ts`;
// A dedicated config (cache off by default) so these tests drive the cache
// purely via flags, independent of whatever `cache` the repo's own config sets.
const BC_CONFIG = path.join(repoRoot, `${PREFIX}config.json`);

function runNode(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runTest(extraArgs, extraEnv) {
  return runNode(
    ["./bin/index.js", "test", SELECTOR, "--config", BC_CONFIG, ...extraArgs],
    extraEnv,
  );
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) {
  return s.replace(ANSI, "");
}

function isCached(output, spec) {
  return new RegExp(`${spec}\\s+\\(cache\\)`).test(stripAnsi(output));
}

function passed(output, spec) {
  return new RegExp(`PASS\\s+${spec}`).test(stripAnsi(output));
}

async function writeHelper(body) {
  await fs.writeFile(path.join(testsDir, HELPER), body, "utf8");
}

async function writeFixtures() {
  await writeHelper("export function v(): i32 { return 1; }\n");
  await fs.writeFile(
    path.join(testsDir, SPEC_A),
    [
      'import { describe, expect, test } from "..";',
      `import { v } from "./${PREFIX}helper";`,
      'describe("bc a", () => { test("uses helper", () => { expect(v()).toBe(1); }); });',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(testsDir, SPEC_B),
    [
      'import { describe, expect, test } from "..";',
      'describe("bc b", () => { test("plain", () => { expect(1).toBe(1); }); });',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    BC_CONFIG,
    JSON.stringify({
      $schema: "./as-test.config.schema.json",
      input: [`assembly/__tests__/${PREFIX}*.spec.ts`],
      output: OUT_ROOT,
      buildOptions: { target: "wasi" },
      runOptions: { runtime: { cmd: "node .as-test/runners/default.wasi.js" } },
    }),
    "utf8",
  );
}

async function cleanup() {
  await fs.rm(path.join(testsDir, HELPER), { force: true });
  await fs.rm(path.join(testsDir, SPEC_A), { force: true });
  await fs.rm(path.join(testsDir, SPEC_B), { force: true });
  await fs.rm(BC_CONFIG, { force: true });
  await fs.rm(cacheDir, { recursive: true, force: true });
}

test(
  "incremental cache: build-skip, replay, and dependency invalidation",
  { timeout: 240000 },
  async () => {
    await cleanup();
    await writeFixtures();
    try {
      // 1. Cold run with --cache: nothing cached yet, both run fresh and pass.
      let r = await runTest(["--cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(
        isCached(r.stdout, SPEC_A),
        false,
        "cold A should not be cached",
      );
      assert.equal(
        isCached(r.stdout, SPEC_B),
        false,
        "cold B should not be cached",
      );
      assert.ok(passed(r.stdout, SPEC_A) && passed(r.stdout, SPEC_B));
      // Manifest persisted.
      await fs.access(path.join(cacheDir, "manifest.json.gz"));

      // 2. Warm run, no changes: both replay from cache.
      r = await runTest(["--cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(isCached(r.stdout, SPEC_A), true, "warm A should be cached");
      assert.equal(isCached(r.stdout, SPEC_B), true, "warm B should be cached");

      // 3. Edit one spec: only it re-runs; the other stays cached.
      await fs.writeFile(
        path.join(testsDir, SPEC_B),
        [
          'import { describe, expect, test } from "..";',
          'describe("bc b", () => { test("plain2", () => { expect(2).toBe(2); }); });',
          "",
        ].join("\n"),
        "utf8",
      );
      r = await runTest(["--cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(isCached(r.stdout, SPEC_A), true, "A unchanged -> cached");
      assert.equal(isCached(r.stdout, SPEC_B), false, "B edited -> not cached");

      // 4. Edit the shared helper: the dependent (A) rebuilds; B stays cached.
      await runTest(["--cache"]); // warm both first
      await writeHelper("export function v(): i32 { return 1; }\n// touched\n");
      r = await runTest(["--cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(
        isCached(r.stdout, SPEC_A),
        false,
        "A imports edited helper -> not cached",
      );
      assert.equal(isCached(r.stdout, SPEC_B), true, "B independent -> cached");

      // 5. --no-cache ignores the cache entirely: both run fresh.
      r = await runTest(["--no-cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(isCached(r.stdout, SPEC_A), false);
      assert.equal(isCached(r.stdout, SPEC_B), false);

      // 6. Without --cache (opt-in), the cache is off: no replay.
      r = await runTest([]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(isCached(r.stdout, SPEC_A), false, "opt-in: off by default");
    } finally {
      await cleanup();
    }
  },
);

test(
  "incremental cache: content-hash fast-path ignores mtime-only changes",
  { timeout: 240000 },
  async () => {
    await cleanup();
    await writeFixtures();
    try {
      let r = await runTest(["--cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      r = await runTest(["--cache"]);
      assert.ok(isCached(r.stdout, SPEC_A) && isCached(r.stdout, SPEC_B));

      // Bump mtimes without changing content: a content hash must keep both
      // cached (a pure-mtime check would wrongly invalidate).
      const future = new Date(Date.now() + 60_000);
      for (const f of [HELPER, SPEC_A, SPEC_B]) {
        await fs.utimes(path.join(testsDir, f), future, future);
      }
      r = await runTest(["--cache"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(
        isCached(r.stdout, SPEC_A),
        true,
        "mtime-only -> still cached",
      );
      assert.equal(
        isCached(r.stdout, SPEC_B),
        true,
        "mtime-only -> still cached",
      );
    } finally {
      await cleanup();
    }
  },
);

test(
  "incremental cache: ambient env (FORCE_COLOR) does not invalidate",
  { timeout: 240000 },
  async () => {
    await cleanup();
    await writeFixtures();
    try {
      // Cold run with color off.
      let r = await runTest(["--cache"], { FORCE_COLOR: "0", NO_COLOR: "1" });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      // Warm run with color forced ON — only an ambient env var differs, which
      // must not change the build signature, so both specs still replay.
      r = await runTest(["--cache"], { FORCE_COLOR: "1", NO_COLOR: "" });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(
        isCached(r.stdout, SPEC_A),
        true,
        "color toggle must not invalidate the cache",
      );
      assert.equal(isCached(r.stdout, SPEC_B), true);
    } finally {
      await cleanup();
    }
  },
);

// Regression: a compile-time-inlined dependency (a `const` whose value asc
// folds into the spec) must still invalidate when it changes. An earlier
// "reachable" prune mode dropped such files because the const had no reachable
// instance, producing a stale PASS — so `reachable` is now an alias for the
// always-correct `full` mode. This test guards against that class of bug.
const RCH = "__tmp_inl_";
const RCH_CONSTS = `${RCH}consts.ts`;
const RCH_SPEC = `${RCH}a.spec.ts`;
const RCH_CONFIG = path.join(repoRoot, `${RCH}config.json`);

async function writeInlineFixtures() {
  await fs.writeFile(
    path.join(testsDir, RCH_CONSTS),
    "export const N: i32 = 5;\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(testsDir, RCH_SPEC),
    [
      'import { describe, expect, test } from "..";',
      `import { N } from "./${RCH}consts";`,
      'describe("inl", () => { test("ok", () => { expect(N).toBe(5); }); });',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    RCH_CONFIG,
    JSON.stringify({
      $schema: "./as-test.config.schema.json",
      input: [`assembly/__tests__/${RCH_SPEC}`],
      output: OUT_ROOT,
      // "reachable" must behave as "full" — exercise the back-compat alias here.
      cache: "reachable",
      buildOptions: { target: "wasi" },
      runOptions: { runtime: { cmd: "node .as-test/runners/default.wasi.js" } },
    }),
    "utf8",
  );
}

async function cleanupInline() {
  await fs.rm(path.join(testsDir, RCH_CONSTS), { force: true });
  await fs.rm(path.join(testsDir, RCH_SPEC), { force: true });
  await fs.rm(RCH_CONFIG, { force: true });
  await fs.rm(cacheDir, { recursive: true, force: true });
}

test(
  "incremental cache: an inlined const dependency invalidates (no stale pass)",
  { timeout: 240000 },
  async () => {
    await cleanupInline();
    await writeInlineFixtures();
    const run = () =>
      runNode(["./bin/index.js", "test", "--config", RCH_CONFIG]);
    try {
      let r = await run(); // cold, passes with N=5
      assert.equal(r.code, 0, r.stdout + r.stderr);
      r = await run();
      assert.equal(isCached(r.stdout, RCH_SPEC), true, "warm cached");

      // Change the const so the spec would now fail. The cache MUST NOT replay
      // the stale pass — it must rebuild and surface the failure.
      await fs.writeFile(
        path.join(testsDir, RCH_CONSTS),
        "export const N: i32 = 6;\n",
        "utf8",
      );
      r = await run();
      assert.equal(
        isCached(r.stdout, RCH_SPEC),
        false,
        "editing an inlined const dep must invalidate",
      );
      assert.notEqual(r.code, 0, "re-run reflects the now-failing assertion");
    } finally {
      await cleanupInline();
    }
  },
);

const EXP = "__tmp_exp_";
const EXP_SPEC = `${EXP}a.spec.ts`;
const EXP_CONFIG = path.join(repoRoot, `${EXP}config.json`);

async function writeExpiryFixtures(maxTime) {
  await fs.writeFile(
    path.join(testsDir, EXP_SPEC),
    [
      'import { describe, expect, test } from "..";',
      'describe("exp", () => { test("ok", () => { expect(1).toBe(1); }); });',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    EXP_CONFIG,
    JSON.stringify({
      $schema: "./as-test.config.schema.json",
      input: [`assembly/__tests__/${EXP_SPEC}`],
      output: OUT_ROOT,
      cache: { type: "full", maxTime },
      buildOptions: { target: "wasi" },
      runOptions: { runtime: { cmd: "node .as-test/runners/default.wasi.js" } },
    }),
    "utf8",
  );
}

async function cleanupExpiry() {
  await fs.rm(path.join(testsDir, EXP_SPEC), { force: true });
  await fs.rm(EXP_CONFIG, { force: true });
  await fs.rm(cacheDir, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test(
  "incremental cache: { maxTime } expires entries after the window",
  { timeout: 240000 },
  async () => {
    await cleanupExpiry();
    await writeExpiryFixtures("2s");
    const run = () =>
      runNode(["./bin/index.js", "test", "--config", EXP_CONFIG]);
    try {
      let r = await run();
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(isCached(r.stdout, EXP_SPEC), false, "cold not cached");

      // Within the window: replays from cache.
      r = await run();
      assert.equal(
        isCached(r.stdout, EXP_SPEC),
        true,
        "within maxTime -> cached",
      );

      // Past the window: the entry is stale, so it rebuilds+reruns.
      await sleep(2300);
      r = await run();
      assert.equal(
        isCached(r.stdout, EXP_SPEC),
        false,
        "past maxTime -> expired, rebuilt",
      );

      // The rebuild reset the timer, so the next immediate run replays again.
      r = await run();
      assert.equal(isCached(r.stdout, EXP_SPEC), true, "timer reset -> cached");
    } finally {
      await cleanupExpiry();
    }
  },
);

const COV = "__tmp_cov_";
const COV_HELPER = `${COV}helper.ts`;
const COV_SPEC = `${COV}a.spec.ts`;
const COV_CONFIG = path.join(repoRoot, `${COV}config.json`);

async function cleanupCoverage() {
  await fs.rm(path.join(testsDir, COV_HELPER), { force: true });
  await fs.rm(path.join(testsDir, COV_SPEC), { force: true });
  await fs.rm(COV_CONFIG, { force: true });
  await fs.rm(cacheDir, { recursive: true, force: true });
}

// Extracts the aggregate "C/T covered" numbers from the coverage summary block.
function coverageStats(output) {
  const m = /(\d+)\/(\d+) covered/.exec(stripAnsi(output));
  return m ? `${m[1]}/${m[2]}` : null;
}

test(
  "incremental cache: replayed coverage matches a fresh run",
  { timeout: 240000 },
  async () => {
    await cleanupCoverage();
    // A helper with a branch so there are real coverage points to aggregate.
    await fs.writeFile(
      path.join(testsDir, COV_HELPER),
      "export function v(x: i32): i32 { if (x > 0) return 1; return 2; }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(testsDir, COV_SPEC),
      [
        'import { describe, expect, test } from "..";',
        `import { v } from "./${COV}helper";`,
        'describe("cov", () => { test("ok", () => { expect(v(1)).toBe(1); }); });',
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      COV_CONFIG,
      JSON.stringify({
        $schema: "./as-test.config.schema.json",
        input: [`assembly/__tests__/${COV_SPEC}`],
        output: OUT_ROOT,
        coverage: true,
        cache: "full",
        buildOptions: { target: "wasi" },
        runOptions: {
          runtime: { cmd: "node .as-test/runners/default.wasi.js" },
        },
      }),
      "utf8",
    );
    const run = () =>
      runNode(["./bin/index.js", "test", "--config", COV_CONFIG]);
    try {
      const cold = await run();
      assert.equal(cold.code, 0, cold.stdout + cold.stderr);
      const fresh = coverageStats(cold.stdout);
      assert.ok(fresh, `cold run produced coverage:\n${cold.stdout}`);

      const warm = await run();
      assert.equal(warm.code, 0, warm.stdout + warm.stderr);
      assert.ok(isCached(warm.stdout, COV_SPEC), "warm run should replay");
      assert.equal(
        coverageStats(warm.stdout),
        fresh,
        "replayed coverage must equal the fresh coverage",
      );
    } finally {
      await cleanupCoverage();
    }
  },
);

// --- Adversarial edge cases (codified from release-hardening probes) ---
const ADV = "__tmp_adv_";
const ADV_SPEC = `${ADV}a.spec.ts`;
const ADV_CONFIG = path.join(repoRoot, `${ADV}config.json`);

async function writeAdv(specBody, config) {
  await fs.writeFile(path.join(testsDir, ADV_SPEC), specBody, "utf8");
  await fs.writeFile(
    ADV_CONFIG,
    JSON.stringify({
      $schema: "./as-test.config.schema.json",
      input: [`assembly/__tests__/${ADV_SPEC}`],
      output: OUT_ROOT,
      buildOptions: { target: "wasi" },
      runOptions: { runtime: { cmd: "node .as-test/runners/default.wasi.js" } },
      ...config,
    }),
    "utf8",
  );
}
async function cleanupAdv() {
  await fs.rm(path.join(testsDir, ADV_SPEC), { force: true });
  await fs.rm(ADV_CONFIG, { force: true });
  await fs.rm(cacheDir, { recursive: true, force: true });
}
const advRun = (extra = []) =>
  runNode(["./bin/index.js", "test", "--config", ADV_CONFIG, ...extra]);
const advCached = (out) => isCached(out, ADV_SPEC);
const PASS_SPEC =
  'import { describe, expect, test } from "..";describe("adv",()=>{test("x",()=>{expect(1).toBe(1);});});';

test(
  "incremental cache: a failing spec is never replayed",
  { timeout: 240000 },
  async () => {
    await cleanupAdv();
    await writeAdv(
      'import { describe, expect, test } from "..";describe("adv",()=>{test("x",()=>{expect(1).toBe(2);});});',
      { cache: "full" },
    );
    try {
      let r = await advRun();
      assert.equal(advCached(r.stdout), false, "cold failing not cached");
      assert.notEqual(r.code, 0, "cold fails");
      r = await advRun();
      assert.equal(advCached(r.stdout), false, "failing spec must re-run");
      assert.notEqual(r.code, 0, "warm still fails (no stale pass)");
    } finally {
      await cleanupAdv();
    }
  },
);

test(
  "incremental cache: toggling coverage invalidates",
  { timeout: 240000 },
  async () => {
    await cleanupAdv();
    await writeAdv(PASS_SPEC, { cache: "full", coverage: true });
    try {
      await advRun(); // cold with coverage
      const r = await advRun(["--disable", "coverage"]); // warm without
      assert.equal(
        advCached(r.stdout),
        false,
        "coverage change must change the build signature",
      );
    } finally {
      await cleanupAdv();
    }
  },
);

test(
  "incremental cache: a deleted .wasm forces a rebuild",
  { timeout: 240000 },
  async () => {
    await cleanupAdv();
    await writeAdv(PASS_SPEC, { cache: "full" });
    try {
      await advRun();
      await fs.rm(
        path.join(
          repoRoot,
          ".as-test-bc/build/default",
          ADV_SPEC.replace(/\.ts$/, ".wasm"),
        ),
        { force: true },
      );
      const r = await advRun();
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(
        advCached(r.stdout),
        false,
        "missing artifact must not replay",
      );
    } finally {
      await cleanupAdv();
    }
  },
);

test(
  "incremental cache: a corrupt manifest self-heals",
  { timeout: 240000 },
  async () => {
    await cleanupAdv();
    await writeAdv(PASS_SPEC, { cache: "full" });
    try {
      await advRun();
      await fs.writeFile(
        path.join(cacheDir, "manifest.json.gz"),
        "not gzip at all",
        "utf8",
      );
      const r = await advRun();
      assert.equal(r.code, 0, "corrupt manifest must self-heal, not crash");
    } finally {
      await cleanupAdv();
    }
  },
);

test(
  "incremental cache: a custom build command disables the cache",
  { timeout: 240000 },
  async () => {
    await cleanupAdv();
    await writeAdv(PASS_SPEC, {
      cache: "full",
      buildOptions: { target: "wasi", cmd: "asc <file>" },
    });
    try {
      await advRun();
      const r = await advRun();
      assert.equal(
        advCached(r.stdout),
        false,
        "custom build command is not introspectable; never cache",
      );
    } finally {
      await cleanupAdv();
    }
  },
);
