import { existsSync, mkdirSync, readFileSync } from "fs";
import { INTERNAL_FEATURE_NAMES, normalizeFeatureName } from "../types.js";
import { glob } from "glob";
import chalk from "chalk";
import { spawn } from "child_process";
import * as path from "path";
import {
  createMemoryStream,
  main as ascMain,
} from "assemblyscript/dist/asc.js";
import {
  applyMode,
  getPkgRunner,
  loadConfig,
  resolveArtifactPath,
  resolveSpecRelativePath,
  tokenizeCommand,
  resolveProjectModule,
} from "../util.js";
import { persistCrashRecord } from "../crash-store.js";
import { BuildWorkerPool } from "../build-worker-pool.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
export class BuildFailureError extends Error {
  constructor(args) {
    super(args.message);
    this.name = "BuildFailureError";
    this.file = args.file;
    this.mode = args.mode;
    this.invocation = args.invocation;
    this.stdout = args.stdout;
    this.stderr = args.stderr;
    this.kind = args.kind;
    this.crashLogPath = args.crashLogPath;
  }
}
export async function build(
  configPath = DEFAULT_CONFIG_PATH,
  selectors = [],
  modeName,
  featureToggles = {},
  overrides = {},
  resolvedConfig,
) {
  const loadedConfig = resolvedConfig ?? loadConfig(configPath, false);
  const mode = applyMode(loadedConfig, modeName);
  const config = Object.assign(
    Object.create(Object.getPrototypeOf(mode.config)),
    mode.config,
  );
  config.buildOptions = Object.assign(
    Object.create(Object.getPrototypeOf(mode.config.buildOptions)),
    mode.config.buildOptions,
  );
  if (overrides.target) {
    config.buildOptions.target = overrides.target;
  }
  if (overrides.args?.length) {
    config.buildOptions.args = [...config.buildOptions.args, ...overrides.args];
  }
  if (!hasCustomBuildCommand(config)) {
    ensureDeps(config);
  }
  const pkgRunner = getPkgRunner();
  const sourceInputPatterns =
    overrides.kind === "fuzz" ? config.fuzz.input : config.input;
  const inputPatterns = resolveInputPatterns(sourceInputPatterns, selectors);
  const inputFiles = (await glob(inputPatterns)).sort((a, b) =>
    a.localeCompare(b),
  );
  await assertNoArtifactCollisions(sourceInputPatterns);
  warnOnUnknownModeReferences(inputFiles, loadedConfig.modes ?? {});
  const coverageEnabled = resolveCoverageEnabled(
    config.coverage,
    featureToggles.coverage,
  );
  const buildEnv = {
    ...mode.env,
    ...config.buildOptions.env,
    AS_TEST_COVERAGE_ENABLED: coverageEnabled ? "1" : "0",
    AS_TEST_MODE_NAME: modeName ?? "default",
  };
  if (
    !resolvedConfig &&
    !process.env.AS_TEST_BUILD_API &&
    !hasCustomBuildCommand(config)
  ) {
    const pool = getSerialBuildWorkerPool();
    for (const file of inputFiles) {
      const outFile = path.join(
        config.outDir,
        resolveArtifactPath(file, sourceInputPatterns),
      );
      const invocation = getBuildCommand(
        config,
        pkgRunner,
        file,
        outFile,
        modeName,
        featureToggles,
      );
      await pool.buildFileMode({
        configPath,
        file,
        modeName,
        buildCommand: formatInvocation(invocation),
        featureToggles,
        overrides,
      });
    }
    return;
  }
  for (const file of inputFiles) {
    const outFile = path.join(
      config.outDir,
      resolveArtifactPath(file, sourceInputPatterns),
    );
    mkdirSync(path.dirname(outFile), { recursive: true });
    const invocation = getBuildCommand(
      config,
      pkgRunner,
      file,
      outFile,
      modeName,
      featureToggles,
    );
    try {
      await buildFile(invocation, buildEnv);
    } catch (error) {
      const modeLabel = modeName ?? "default";
      const stdout = getBuildStdout(error);
      const stderr = getBuildStderr(error);
      const buildCommand = formatInvocation(invocation);
      const kind = overrides.kind ?? "test";
      const crash = persistCrashRecord(config.fuzz.crashDir, {
        kind,
        stage: "build",
        file,
        entryKey: resolveSpecRelativePath(file, sourceInputPatterns).replace(
          /\.ts$/i,
          "",
        ),
        mode: modeLabel,
        cwd: process.cwd(),
        buildCommand,
        reproCommand: buildCommand,
        error: stderr || stdout || "unknown build error",
        stdout,
        stderr,
      });
      throw new BuildFailureError({
        file,
        mode: modeLabel,
        invocation,
        stdout,
        stderr,
        kind,
        crashLogPath: crash.logPath,
        message:
          `Failed to build ${path.basename(file)} in mode ${modeLabel} with ${stderr || stdout || "unknown build error"}\n` +
          `Build command: ${buildCommand}\n` +
          `Crash log: ${crash.logPath}`,
      });
    }
  }
}
let serialBuildWorkerPool = null;
function getSerialBuildWorkerPool() {
  if (!serialBuildWorkerPool) {
    serialBuildWorkerPool = new BuildWorkerPool(1);
  }
  return serialBuildWorkerPool;
}
export async function closeSerialBuildWorkerPool() {
  if (!serialBuildWorkerPool) return;
  const pool = serialBuildWorkerPool;
  serialBuildWorkerPool = null;
  await pool.close();
}
export async function getBuildInvocationPreview(
  configPath = DEFAULT_CONFIG_PATH,
  file,
  modeName,
  featureToggles = {},
  overrides = {},
) {
  const loadedConfig = loadConfig(configPath, false);
  const mode = applyMode(loadedConfig, modeName);
  const config = Object.assign(
    Object.create(Object.getPrototypeOf(mode.config)),
    mode.config,
  );
  config.buildOptions = Object.assign(
    Object.create(Object.getPrototypeOf(mode.config.buildOptions)),
    mode.config.buildOptions,
  );
  if (overrides.target) {
    config.buildOptions.target = overrides.target;
  }
  if (overrides.args?.length) {
    config.buildOptions.args = [...config.buildOptions.args, ...overrides.args];
  }
  const sourceInputPatterns =
    overrides.kind === "fuzz" ? config.fuzz.input : config.input;
  const outFile = path.join(
    config.outDir,
    resolveArtifactPath(file, sourceInputPatterns),
  );
  return getBuildCommand(
    config,
    getPkgRunner(),
    file,
    outFile,
    modeName,
    featureToggles,
  );
}
export async function getBuildReuseInfo(
  configPath = DEFAULT_CONFIG_PATH,
  file,
  modeName,
  featureToggles = {},
  overrides = {},
) {
  const loadedConfig = loadConfig(configPath, false);
  const mode = applyMode(loadedConfig, modeName);
  const config = Object.assign(
    Object.create(Object.getPrototypeOf(mode.config)),
    mode.config,
  );
  config.buildOptions = Object.assign(
    Object.create(Object.getPrototypeOf(mode.config.buildOptions)),
    mode.config.buildOptions,
  );
  if (overrides.target) {
    config.buildOptions.target = overrides.target;
  }
  if (overrides.args?.length) {
    config.buildOptions.args = [...config.buildOptions.args, ...overrides.args];
  }
  if (hasCustomBuildCommand(config)) {
    return null;
  }
  const sourceInputPatterns =
    overrides.kind === "fuzz" ? config.fuzz.input : config.input;
  const outFile = path.join(
    config.outDir,
    resolveArtifactPath(file, sourceInputPatterns),
  );
  const invocation = getBuildCommand(
    config,
    getPkgRunner(),
    file,
    outFile,
    modeName,
    featureToggles,
  );
  const coverageEnabled = resolveCoverageEnabled(
    config.coverage,
    featureToggles.coverage,
  );
  const buildEnv = {
    ...mode.env,
    ...config.buildOptions.env,
    AS_TEST_COVERAGE_ENABLED: coverageEnabled ? "1" : "0",
    AS_TEST_MODE_NAME: modeName ?? "default",
  };
  return {
    signature: JSON.stringify({
      command: invocation.command,
      args: stripOutputArgs(invocation.args),
      apiArgs: invocation.apiArgs ? stripOutputArgs(invocation.apiArgs) : [],
      env: sortRecord(buildEnv),
    }),
    outFile,
  };
}
function hasCustomBuildCommand(config) {
  return !!config.buildOptions.cmd.trim().length;
}
// Scans input spec files for `mode([...], fn)` calls whose entries reference
// mode names not present in the configured set. Collects all (file, name)
// hits and prints a single formatted block to stdout. The implicit "default"
// name is only valid when no configured mode has `default: true` — otherwise
// a named mode always runs and `AS_TEST_MODE_NAME` is never literal "default".
const MODE_CALL_RE = /\bmode\s*\(\s*\[([^\]]*)\]/g;
const MODE_STRING_RE = /["']([^"']*)["']/g;
const STRIP_COMMENTS_RE = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
const reportedModeWarnings = new Set();
const pendingModeWarningsByFile = new Map();
// Scans input spec files for `mode([...], fn)` calls whose entries reference
// mode names not present in the configured set, and buffers them for later
// printing via flushModeWarnings(). Called as early as possible (before the
// reporter starts streaming progress). De-duplicates across invocations.
export function warnOnUnknownModeReferences(files, configuredModes) {
  const modeEntries = Object.entries(configuredModes ?? {});
  const fallsBackToImplicitDefault =
    modeEntries.length === 0 ||
    modeEntries.every(([, mode]) => mode?.default === false);
  const knownModes = new Set(modeEntries.map(([name]) => name));
  if (fallsBackToImplicitDefault) knownModes.add("default");
  const knownList = [...knownModes].sort();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    text = text.replace(STRIP_COMMENTS_RE, "");
    for (const callMatch of text.matchAll(MODE_CALL_RE)) {
      const arrayContents = callMatch[1] ?? "";
      for (const strMatch of arrayContents.matchAll(MODE_STRING_RE)) {
        let value = strMatch[1] ?? "";
        if (value.length === 0) continue;
        if (value.charCodeAt(0) === 33 /* '!' */) value = value.slice(1);
        if (value.length === 0) continue;
        if (knownModes.has(value)) continue;
        const key = `${file}\x1f${value}`;
        if (reportedModeWarnings.has(key)) continue;
        reportedModeWarnings.add(key);
        const warning = {
          name: value,
          suggestion: closestKnownMode(value, knownList),
        };
        const list = pendingModeWarningsByFile.get(file);
        if (list) list.push(warning);
        else pendingModeWarningsByFile.set(file, [warning]);
      }
    }
  }
}
// Drains buffered mode warnings. When `showAll` is true, prints the full
// per-warning block; otherwise prints a one-line summary that tells the user
// to re-run with `--show-warnings`. No-op when there are no warnings.
export function flushModeWarnings(showAll) {
  if (pendingModeWarningsByFile.size === 0) return;
  const hits = [];
  for (const [file, list] of pendingModeWarningsByFile) {
    for (const w of list) {
      hits.push({ file, name: w.name, suggestion: w.suggestion });
    }
  }
  pendingModeWarningsByFile.clear();
  if (hits.length === 0) return;
  if (!showAll) {
    const count = hits.length;
    const noun = count === 1 ? "warning" : "warnings";
    process.stdout.write(
      `\nFound ${chalk.yellow.bold(count)} ${noun}. Run with ${chalk.dim("--show-warnings")} to view.\n`,
    );
    return;
  }
  const lines = [chalk.yellow.bold("WARNINGS:")];
  for (const hit of hits) {
    let line = ` - unknown mode reference ${chalk.bold(`"${hit.name}"`)} in ${chalk.dim(hit.file)}`;
    if (hit.suggestion) {
      line += ` - did you mean ${chalk.cyan(`"${hit.suggestion}"`)}?`;
    }
    lines.push(line);
  }
  process.stdout.write("\n" + lines.join("\n") + "\n");
}
// Returns the configured mode whose Levenshtein distance to `name` is below
// a small threshold (proportional to the longer string's length). Returns
// null when nothing's close enough — avoids suggesting wildly different names.
function closestKnownMode(name, candidates) {
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const d = levenshtein(name, candidate);
    const threshold = Math.max(
      2,
      Math.floor(Math.max(name.length, candidate.length) * 0.4),
    );
    if (d < bestDist && d <= threshold) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
function getBuildCommand(
  config,
  pkgRunner,
  file,
  outFile,
  modeName,
  featureToggles = {},
) {
  const userArgs = getUserBuildArgs(config);
  if (hasCustomBuildCommand(config)) {
    const tokens = tokenizeCommand(
      expandBuildCommand(
        config.buildOptions.cmd,
        file,
        outFile,
        config.buildOptions.target,
        modeName,
      ),
    );
    if (!tokens.length) {
      throw new Error("custom build command is empty");
    }
    return {
      command: tokens[0],
      args: [...tokens.slice(1), ...userArgs],
    };
  }
  const defaultArgs = getDefaultBuildArgs(config, featureToggles);
  const ascInvocation = resolveAscInvocation(pkgRunner);
  const args = [...ascInvocation.args, file, ...userArgs, ...defaultArgs];
  if (config.outDir.length) {
    args.push("-o", outFile);
  }
  return {
    command: ascInvocation.command,
    args,
    apiArgs: args.slice(1),
  };
}
function resolveAscInvocation(pkgRunner) {
  const assemblyscriptPkg = resolveProjectModule("assemblyscript/package.json");
  if (assemblyscriptPkg) {
    const ascPath = path.join(path.dirname(assemblyscriptPkg), "bin", "asc.js");
    if (existsSync(ascPath)) {
      return {
        command: process.execPath,
        args: [ascPath],
      };
    }
  }
  return {
    command: pkgRunner,
    args: ["asc"],
  };
}
function getUserBuildArgs(config) {
  const args = [];
  for (const value of config.buildOptions.args) {
    if (!value.length) continue;
    args.push(...tokenizeCommand(value));
  }
  return args;
}
function stripOutputArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg == "-o" || arg == "--outFile") {
      i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}
function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry) => typeof entry[1] == "string")
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
function expandBuildCommand(template, file, outFile, target, modeName) {
  const name = path
    .basename(file)
    .replace(/\.spec\.ts$/, "")
    .replace(/\.ts$/, "");
  return template
    .replace(/<file>/g, file)
    .replace(/<name>/g, name)
    .replace(/<outFile>/g, outFile)
    .replace(/<target>/g, target)
    .replace(/<mode>/g, modeName ?? "");
}
async function assertNoArtifactCollisions(configured) {
  const patterns = Array.isArray(configured) ? configured : [configured];
  const files = await glob(patterns);
  const seen = new Map();
  for (const file of files) {
    const artifact = resolveArtifactPath(file, patterns);
    const prev = seen.get(artifact);
    if (prev != null && prev !== file) {
      throw new Error(
        `Two input files resolve to the same artifact path "${artifact}":\n` +
          `  - ${prev}\n` +
          `  - ${file}\n` +
          `Rename one of them or narrow the input patterns to disambiguate.`,
      );
    }
    seen.set(artifact, file);
  }
}
function resolveInputPatterns(configured, selectors) {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;
  const patterns = new Set();
  for (const selector of expandSelectors(selectors)) {
    if (!selector) continue;
    if (isBareSuiteSelector(selector)) {
      const base = stripSuiteSuffix(selector);
      for (const configuredInput of configuredInputs) {
        patterns.add(
          path.join(path.dirname(configuredInput), `${base}.spec.ts`),
        );
      }
      continue;
    }
    patterns.add(selector);
  }
  return [...patterns];
}
function expandSelectors(selectors) {
  const expanded = [];
  for (const selector of selectors) {
    if (!selector) continue;
    if (!shouldSplitSelector(selector)) {
      expanded.push(selector);
      continue;
    }
    for (const token of selector.split(",")) {
      const trimmed = token.trim();
      if (!trimmed.length) continue;
      expanded.push(trimmed);
    }
  }
  return expanded;
}
function shouldSplitSelector(selector) {
  return (
    selector.includes(",") &&
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}
function isBareSuiteSelector(selector) {
  return (
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}
function stripSuiteSuffix(selector) {
  return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}
function ensureDeps(config) {
  if (config.buildOptions.target == "wasi") {
    if (!resolveWasiShim()) {
      console.log(
        `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!`,
      );
      process.exit(1);
    }
  }
}
async function buildFile(invocation, env) {
  if (process.env.AS_TEST_BUILD_API == "1" && invocation.apiArgs?.length) {
    await buildFileViaApi(invocation.apiArgs, env);
    return;
  }
  await buildFileViaSpawn(invocation, env);
}
async function buildFileViaApi(args, env) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = createMemoryStream((chunk) => {
    stdoutChunks.push(
      typeof chunk == "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
  });
  const stderr = createMemoryStream((chunk) => {
    stderrChunks.push(
      typeof chunk == "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
  });
  const previousEnv = snapshotEnv();
  applyEnv(env);
  try {
    const result = await ascMain(args, { stdout, stderr });
    if (result.error) {
      const error = result.error;
      error.stderr = stderrChunks.join("").trim();
      error.stdout = stdoutChunks.join("").trim();
      throw error;
    }
  } finally {
    restoreEnv(previousEnv);
  }
}
async function buildFileViaSpawn(invocation, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(
        stderr.trim() || stdout.trim() || `command exited with code ${code}`,
      );
      error.stderr = stderr.trim();
      error.stdout = stdout.trim();
      reject(error);
    });
  });
}
function snapshotEnv() {
  return { ...process.env };
}
function applyEnv(nextEnv) {
  const keys = new Set([...Object.keys(process.env), ...Object.keys(nextEnv)]);
  for (const key of keys) {
    const value = nextEnv[key];
    if (value == undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
function restoreEnv(previousEnv) {
  const keys = new Set([
    ...Object.keys(process.env),
    ...Object.keys(previousEnv),
  ]);
  for (const key of keys) {
    const value = previousEnv[key];
    if (value == undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
function formatInvocation(invocation) {
  return [invocation.command, ...invocation.args]
    .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
    .join(" ");
}
export { getBuildCommand, formatInvocation };
function getBuildStderr(error) {
  const err = error;
  const stderr = err?.stderr;
  if (typeof stderr == "string") {
    const trimmed = stderr.trim();
    if (trimmed.length) return trimmed;
  } else if (stderr instanceof Buffer) {
    const trimmed = stderr.toString("utf8").trim();
    if (trimmed.length) return trimmed;
  }
  const message = typeof err?.message == "string" ? err.message.trim() : "";
  return message || "unknown error";
}
function getBuildStdout(error) {
  const err = error;
  const stdout = err?.stdout;
  if (typeof stdout == "string") return stdout.trim();
  if (stdout instanceof Buffer) return stdout.toString("utf8").trim();
  return "";
}
function getDefaultBuildArgs(config, featureToggles) {
  const buildArgs = [];
  const effectiveFeatures = resolveEffectiveFeatures(config, featureToggles);
  const tryAsEnabled = resolveTryAsEnabled(effectiveFeatures.has("try-as"));
  buildArgs.push("--transform", "as-test/transform");
  if (
    resolveProjectModule("json-as/transform") &&
    !userSuppliesJsonAsTransform(config)
  ) {
    buildArgs.push("--transform", "json-as/transform");
  }
  if (tryAsEnabled) {
    buildArgs.push("--transform", "try-as/transform");
  }
  if (config.config && config.config !== "none") {
    buildArgs.push("--config", config.config);
  }
  if (tryAsEnabled) {
    buildArgs.push("--use", "AS_TEST_TRY_AS=1");
  }
  for (const feature of effectiveFeatures) {
    if (INTERNAL_FEATURE_NAMES.has(feature)) continue;
    buildArgs.push("--enable", feature);
  }
  // Should also strip any bindings-enabling from asconfig
  if (
    config.buildOptions.target == "bindings" ||
    config.buildOptions.target == "web"
  ) {
    buildArgs.push(
      "--use",
      "AS_TEST_BINDINGS=1",
      "--bindings",
      "raw",
      "--exportRuntime",
      "--exportStart",
      "_start",
    );
  } else if (config.buildOptions.target == "wasi") {
    const wasiShim = resolveWasiShim();
    if (!wasiShim) {
      throw new Error(
        'WASI target requires package "@assemblyscript/wasi-shim"',
      );
    }
    buildArgs.push("--use", "AS_TEST_WASI=1", "--config", wasiShim.configPath);
  } else {
    console.log(
      `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not determine target in config! Set target to 'bindings', 'web', or 'wasi'`,
    );
    process.exit(1);
  }
  return buildArgs;
}
// Treats anything whose path contains a "json-as" path component as a
// user-supplied json-as transform. Matches bare specifiers, subpath specifiers,
// absolute paths, and ./node_modules paths.
const JSON_AS_TRANSFORM_PATTERN = /(?:^|[\\/])json-as(?:[\\/@]|$)/;
function userSuppliesJsonAsTransform(config) {
  for (const raw of config.buildOptions.args) {
    if (!raw.length) continue;
    const tokens = tokenizeCommand(raw);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token == "--transform") {
        const value = tokens[i + 1];
        if (value && JSON_AS_TRANSFORM_PATTERN.test(value)) return true;
      } else if (token.startsWith("--transform=")) {
        const value = token.slice("--transform=".length);
        if (value && JSON_AS_TRANSFORM_PATTERN.test(value)) return true;
      }
    }
  }
  if (config.config && config.config !== "none" && existsSync(config.config)) {
    if (asconfigDeclaresJsonAs(config.config, new Set())) return true;
  }
  return false;
}
function asconfigDeclaresJsonAs(configFile, seen) {
  const resolved = path.resolve(configFile);
  if (seen.has(resolved)) return false;
  seen.add(resolved);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed != "object") return false;
  const obj = parsed;
  if (transformsContainJsonAs(obj.options)) return true;
  if (transformsContainJsonAs(obj)) return true;
  const targets = obj.targets;
  if (targets && typeof targets == "object" && !Array.isArray(targets)) {
    for (const value of Object.values(targets)) {
      if (transformsContainJsonAs(value)) return true;
    }
  }
  const extendsValue = obj.extends;
  if (typeof extendsValue == "string" && extendsValue.length) {
    const parentPath = path.resolve(path.dirname(resolved), extendsValue);
    if (existsSync(parentPath) && asconfigDeclaresJsonAs(parentPath, seen)) {
      return true;
    }
  }
  return false;
}
function transformsContainJsonAs(value) {
  if (!value || typeof value != "object") return false;
  const transform = value.transform;
  if (typeof transform == "string") {
    return JSON_AS_TRANSFORM_PATTERN.test(transform);
  }
  if (Array.isArray(transform)) {
    for (const item of transform) {
      if (typeof item == "string" && JSON_AS_TRANSFORM_PATTERN.test(item)) {
        return true;
      }
    }
  }
  return false;
}
function resolveEffectiveFeatures(config, featureToggles) {
  const effective = new Set();
  for (const name of config.features) {
    effective.add(normalizeFeatureName(name));
  }
  const overrides = featureToggles.featureOverrides ?? {};
  for (const [name, enabled] of Object.entries(overrides)) {
    const key = normalizeFeatureName(name);
    if (!key.length) continue;
    if (enabled) effective.add(key);
    else effective.delete(key);
  }
  effective.delete("");
  return effective;
}
function resolveTryAsEnabled(enabled) {
  if (!enabled) return false;
  if (!hasTryAsRuntime()) {
    throw new Error(
      'try-as feature was enabled, but package "try-as" is not installed',
    );
  }
  return true;
}
function resolveCoverageEnabled(rawCoverage, override) {
  if (override != undefined) return override;
  if (typeof rawCoverage == "boolean") return rawCoverage;
  if (rawCoverage && typeof rawCoverage == "object") {
    const enabled = rawCoverage.enabled;
    if (typeof enabled == "boolean") return enabled;
  }
  return true;
}
function hasTryAsRuntime() {
  return resolveProjectModule("try-as/package.json") != null;
}
function resolveWasiShim() {
  const resolved = resolveProjectModule(
    "@assemblyscript/wasi-shim/asconfig.json",
  );
  if (!resolved) return null;
  if (!existsSync(resolved)) return null;
  const relative = path.relative(process.cwd(), resolved).replace(/\\/g, "/");
  return {
    configPath: normalizeCliPath(relative),
  };
}
function quoteCliArg(value) {
  if (!/[\s"]/g.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
function normalizeCliPath(value) {
  if (!value.length) return ".";
  if (value.startsWith(".") || value.startsWith("/")) return value;
  return "./" + value;
}
