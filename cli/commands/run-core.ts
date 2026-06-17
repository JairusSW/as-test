import chalk from "chalk";
import { spawn } from "child_process";
import { minimatch } from "minimatch";
import { Channel, MessageType } from "../wipc.js";
import {
  applyMode,
  formatSpecDisplayPath,
  formatTime,
  getExec,
  loadConfig,
  resolveArtifactPath,
  resolveSnapshotPath,
  resolveSpecRelativePath,
  tokenizeCommand,
} from "../util.js";
import * as path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { PassThrough } from "stream";
import { buildWebRunnerSource } from "./web-runner-source.js";
import { PersistentWebSessionHost } from "./web-session.js";
import {
  build,
  getBuildReuseInfo,
  type BuildInvocation,
} from "./build-core.js";
import {
  cacheStorage,
  reportHasFailure,
  sha256OfFile,
} from "../build-cache.js";
import { resolveSpecFiles, emitSelectorWarnings } from "../selectors.js";
import {
  CoverageSummary,
  LogGroup,
  LogSummary,
  RenderContext,
  RunStats,
} from "../render/types.js";
import { TestRenderer } from "../render/renderer.js";
import { SnapshotStore } from "./snapshot-store.js";
import { persistCrashRecord } from "../crash-store.js";
import { describeCoveragePoint } from "../coverage-points.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");

type RunFlags = {
  snapshot?: boolean;
  createSnapshots?: boolean;
  overwriteSnapshots?: boolean;
  clean?: boolean;
  showCoverage?: boolean;
  showCoverageAll?: boolean;
  verbose?: boolean;
  showLogs?: boolean;
  coverage?: boolean;
};

type RunExecutionOptions = {
  renderer?: TestRenderer;
  webSession?: PersistentWebSessionHost | null;
  suiteSelectors?: string[];
  modeName?: string;
  modeSummaryTotal?: number;
  modeSummaryExecuted?: number;
  fileSummaryTotal?: number;
  emitRunStart?: boolean;
  emitRunComplete?: boolean;
  logFileName?: string;
  coverageFileName?: string;
  buildCommand?: string;
  buildCommandsByFile?: Record<string, string>;
};

type SuiteFailureRecord = {
  title: string;
  where: string;
  message: string;
  left: string;
  right: string;
  suitePath: string;
};

type SuiteSelectionMatch = {
  kind: "path" | "bare";
  raw: string;
  resolvedPath: string;
  depth: number;
};

type RuntimeInvocation = {
  command: string;
  args: string[];
};

// Reports the build+run verdict for a single (file, mode) pair. The watch
// loop uses this to maintain a sticky "currently failing" list that survives
// `console.clear()` between iterations.
export type SpecOutcome = {
  file: string;
  mode: string | undefined;
  failed: boolean;
};

export type SpecOutcomeSink = (outcome: SpecOutcome) => void;

export type RunResult = {
  failed: boolean;
  stats: RunStats;
  buildTime: number;
  snapshotSummary: {
    matched: number;
    created: number;
    updated: number;
    failed: number;
  };
  coverageSummary: CoverageSummary;
  reports: {
    file: string;
    modeName: string;
    suites: any[];
    coverage: FileCoverage;
    runCommand: string;
    buildCommand: string;
    snapshotSummary: {
      matched: number;
      created: number;
      updated: number;
      failed: number;
    };
    // Set when this file's result was replayed from the incremental cache
    // rather than freshly run (used by reporters to mark it).
    cached?: boolean;
  }[];
  logSummary: LogSummary;
};

type FileCoverage = {
  total: number;
  covered: number;
  uncovered: number;
  percent: number;
  points: {
    hash: string;
    file: string;
    line: number;
    column: number;
    type: string;
    executed: boolean;
    parentHash?: string;
    scopeKind?: string;
    scopeName?: string;
    depth?: number;
  }[];
};

type CoverageOptions = {
  enabled: boolean;
  mode: "project" | "all";
  includeSpecs: boolean;
  dependencies: string[];
  include: string[];
  exclude: string[];
  ignore: {
    labels: string[];
    names: string[];
    locations: string[];
    snippets: string[];
  };
};

function writeReadableLog(
  logRoot: string,
  file: string,
  inputPatterns: string[] | string,
  suites: any[],
  modeName: string | undefined,
  buildCommand: string,
  runCommand: string,
  snapshotSummary: {
    matched: number;
    created: number;
    updated: number;
    failed: number;
  },
): void {
  const relative = resolveSpecRelativePath(file, inputPatterns).replace(
    /\.ts$/i,
    ".log",
  );
  const filePath = path.join(logRoot, relative);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    filePath,
    formatReadableLog(
      file,
      suites,
      modeName,
      buildCommand,
      runCommand,
      snapshotSummary,
    ),
  );
}

function formatReadableLog(
  file: string,
  suites: any[],
  modeName: string | undefined,
  buildCommand: string,
  runCommand: string,
  snapshotSummary: {
    matched: number;
    created: number;
    updated: number;
    failed: number;
  },
): string {
  const stats = collectRunStats([suites]);
  const verdict = stats.failedFiles
    ? "FAIL"
    : stats.passedFiles
      ? "PASS"
      : "SKIP";
  const lines = [
    `Mode: ${modeName ?? "default"}`,
    `Build: ${buildCommand || "(unknown)"}`,
    `Run: ${runCommand}`,
    "",
    `${verdict}  ${file}`,
    "",
    `Snapshots: ${snapshotSummary.matched} matched, ${snapshotSummary.created} created, ${snapshotSummary.updated} updated, ${snapshotSummary.failed} failed`,
    "",
    `Suites: ${stats.passedSuites} passed, ${stats.failedSuites} failed, ${stats.skippedSuites} skipped`,
    `Tests: ${stats.passedTests} passed, ${stats.failedTests} failed, ${stats.skippedTests} skipped`,
    `Time: ${formatTime(stats.time)}`,
  ];

  const failures = collectReadableFailures(suites, file, []);
  if (failures.length) {
    lines.push("", "Failures:");
    for (const failure of failures) {
      lines.push(
        `FAIL  ${failure.title}${failure.where.length ? ` (${failure.where})` : ""}`,
      );
      if (failure.suitePath.length) {
        lines.push(
          `Repro: ${buildSuiteReproCommand(file, failure.suitePath, modeName)}`,
        );
      }
      if (failure.message.length) lines.push(`Message: ${failure.message}`);
      if (failure.left.length) lines.push(`Expected: ${failure.right}`);
      if (failure.right.length) lines.push(`Received: ${failure.left}`);
      lines.push("");
    }
    if (!lines[lines.length - 1].length) lines.pop();
  }

  const logs = collectReadableLogs(suites);
  if (logs.length) {
    lines.push("", "Log:");
    for (const entry of logs) {
      lines.push(entry);
    }
  }

  return lines.join("\n") + "\n";
}

function formatInvocation(
  invocation: RuntimeInvocation | BuildInvocation,
): string {
  return [invocation.command, ...invocation.args]
    .map((part) => (/[\s"'\\]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function filterSelectedSuites(
  suites: any[],
  selectors: string[],
  file: string,
  modeName: string,
): any[] {
  const annotated = annotateSuitePaths(suites, []);
  const matches = resolveSuiteSelectionMatches(annotated, selectors, file);
  const selected = new Set(matches.map((match) => match.resolvedPath));
  return cloneSelectedSuites(annotated, selected, file, modeName);
}

function annotateSuitePaths(suites: any[], pathParts: string[]): any[] {
  return suites.map((suite) => annotateSuiteNode(suite, pathParts));
}

function annotateSuiteNode(suite: any, pathParts: string[]): any {
  const description = String(suite?.description ?? "unknown");
  const slug = slugifySelectorSegment(description);
  const nextParts = [...pathParts, slug];
  const nextSuites = Array.isArray(suite?.suites)
    ? (suite.suites as any[])
    : [];
  const annotatedSuites = annotateSuitePaths(nextSuites, nextParts);
  return {
    ...suite,
    path: nextParts.join("/"),
    suites: annotatedSuites,
  };
}

function resolveSuiteSelectionMatches(
  suites: any[],
  selectors: string[],
  file: string,
): SuiteSelectionMatch[] {
  const matches: SuiteSelectionMatch[] = [];
  for (const selector of selectors) {
    const normalized = selector.trim();
    if (!normalized.length) continue;
    if (normalized.includes("/")) {
      const resolved = resolveExplicitSuitePath(suites, normalized);
      if (!resolved) {
        throw new Error(
          `No suites matched "${selector}" in ${formatSpecDisplayPath(file)}.`,
        );
      }
      matches.push({
        kind: "path",
        raw: selector,
        resolvedPath: resolved.path,
        depth: resolved.depth,
      });
      continue;
    }

    const resolved = resolveBareSuiteSelector(suites, normalized);
    if (!resolved) {
      throw new Error(
        `No suites matched "${selector}" in ${formatSpecDisplayPath(file)}.`,
      );
    }
    matches.push({
      kind: "bare",
      raw: selector,
      resolvedPath: resolved.path,
      depth: resolved.depth,
    });
  }
  return matches;
}

function resolveExplicitSuitePath(
  suites: any[],
  selector: string,
): { path: string; depth: number } | null {
  const normalized = selector
    .split("/")
    .map((part) => slugifySelectorSegment(part))
    .filter((part) => part.length)
    .join("/");
  if (!normalized.length) return null;
  let match: { path: string; depth: number } | null = null;
  walkSuites(suites, (suite, depth) => {
    if (suite.path == normalized) {
      match = { path: suite.path, depth };
      return true;
    }
    return false;
  });
  return match;
}

function resolveBareSuiteSelector(
  suites: any[],
  selector: string,
): { path: string; depth: number } | null {
  const slug = slugifySelectorSegment(selector);
  if (!slug.length) return null;
  const matches: Array<{ path: string; depth: number }> = [];
  walkSuites(suites, (suite, depth) => {
    const leaf =
      String(suite.path ?? "")
        .split("/")
        .pop() ?? "";
    if (leaf == slug) {
      matches.push({ path: String(suite.path), depth });
    }
    return false;
  });
  if (!matches.length) return null;
  matches.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const shallowest = matches[0]!;
  const ambiguous = matches.filter((match) => match.depth == shallowest.depth);
  if (ambiguous.length > 1) {
    throw new Error(
      `Suite selector "${selector}" is ambiguous. Matches: ${ambiguous.map((match) => match.path).join(", ")}`,
    );
  }
  return shallowest;
}

function walkSuites(
  suites: any[],
  visitor: (suite: any, depth: number) => boolean,
  depth: number = 0,
): boolean {
  for (const suite of suites) {
    if (visitor(suite, depth)) return true;
    const childSuites = Array.isArray(suite?.suites)
      ? (suite.suites as any[])
      : [];
    if (walkSuites(childSuites, visitor, depth + 1)) return true;
  }
  return false;
}

function cloneSelectedSuites(
  suites: any[],
  selected: Set<string>,
  file: string,
  modeName: string,
): any[] {
  const out: any[] = [];
  for (const suite of suites) {
    const childSuites = Array.isArray(suite.suites)
      ? (suite.suites as any[])
      : [];
    const selectedChildren = cloneSelectedSuites(
      childSuites,
      selected,
      file,
      modeName,
    );
    const keep =
      selected.has(String(suite.path ?? "")) || selectedChildren.length > 0;
    if (!keep) continue;
    out.push({
      ...suite,
      file,
      modeName,
      suites: selectedChildren,
    });
  }
  return out;
}

function slugifySelectorSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSuiteReproCommand(
  file: string,
  suitePath: string,
  modeName?: string,
): string {
  const modeArg =
    modeName && modeName != "default" ? ` --mode ${modeName}` : "";
  return `ast run ${file}${modeArg} --suite ${suitePath}`;
}

function collectReadableFailures(
  suites: any[],
  file: string,
  pathParts: string[],
): SuiteFailureRecord[] {
  const out: SuiteFailureRecord[] = [];
  for (const suite of suites) {
    const suiteAny = suite as Record<string, unknown>;
    const nextPath = [...pathParts, String(suiteAny.description ?? "unknown")];
    const tests = Array.isArray(suiteAny.tests)
      ? (suiteAny.tests as Record<string, unknown>[])
      : [];
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i]!;
      if (String(test.verdict ?? "none") != "fail") continue;
      out.push({
        title: `${nextPath.join(" > ")}#${i + 1}`,
        where: String(test.location ?? "").length
          ? `${formatSpecDisplayPath(file)}:${String(test.location ?? "")}`
          : formatSpecDisplayPath(file),
        message: String(test.message ?? ""),
        left: JSON.stringify(test.left ?? ""),
        right: JSON.stringify(test.right ?? ""),
        suitePath: String(suiteAny.path ?? ""),
      });
    }
    const childSuites = Array.isArray(suiteAny.suites)
      ? (suiteAny.suites as any[])
      : [];
    out.push(...collectReadableFailures(childSuites, file, nextPath));
  }
  return out;
}

function collectReadableLogs(suites: any[]): string[] {
  const out: string[] = [];
  for (const suite of suites) {
    const suiteAny = suite as Record<string, unknown>;
    const logs = Array.isArray(suiteAny.logs)
      ? (suiteAny.logs as Record<string, unknown>[])
      : [];
    for (const log of logs) {
      const value = String(log.text ?? log.value ?? log.message ?? "");
      if (value.length) out.push(value);
    }
    const childSuites = Array.isArray(suiteAny.suites)
      ? (suiteAny.suites as any[])
      : [];
    out.push(...collectReadableLogs(childSuites));
  }
  return out;
}

// Walk a suite tree, accumulating each suite's `log()` output keyed by the
// describe/test description path it was emitted under.
function walkSuiteLogs(
  suites: any[],
  pathParts: string[],
  out: { path: string[]; lines: string[] }[],
): void {
  for (const suite of suites) {
    const suiteAny = suite as Record<string, unknown>;
    const description = String(suiteAny.description ?? "");
    const nextPath = description.length
      ? [...pathParts, description]
      : pathParts;
    const logs = Array.isArray(suiteAny.logs)
      ? (suiteAny.logs as Record<string, unknown>[])
      : [];
    const lines = logs.map((log) =>
      String(log.text ?? log.value ?? log.message ?? ""),
    );
    if (lines.length) out.push({ path: nextPath, lines });
    const childSuites = Array.isArray(suiteAny.suites)
      ? (suiteAny.suites as any[])
      : [];
    walkSuiteLogs(childSuites, nextPath, out);
  }
}

// Group every captured log across all file reports into a per-spec tree (one
// entry per `log()` call). Feeds the process-wide collector that backs the
// aggregated `latest.log` and the `--show-logs` dump.
function collectGroupedLogs(reports: any[]): {
  count: number;
  groups: LogGroup[];
} {
  let count = 0;
  const groups: LogGroup[] = [];
  for (const report of reports) {
    const reportAny = report as Record<string, unknown>;
    const suites = Array.isArray(reportAny.suites)
      ? (reportAny.suites as any[])
      : [];
    const entries: { path: string[]; lines: string[] }[] = [];
    walkSuiteLogs(suites, [], entries);
    if (!entries.length) continue;
    for (const entry of entries) count += entry.lines.length;
    groups.push({ file: String(reportAny.file ?? "unknown"), entries });
  }
  return { count, groups };
}

// Process-lived collector backing the aggregated `latest.log`. Keyed by spec
// file, then by mode label, holding that mode's flat list of `log()` lines.
// Persisting across run() calls lets a multi-mode run accumulate every mode
// before the file is rendered, so identical output can be de-duplicated.
const collectedLogsBySpec = new Map<string, Map<string, string[]>>();

// Clear the collector. Useful for watch mode, where each cycle should start
// fresh rather than accumulate stale specs.
export function resetCollectedLogs(): void {
  collectedLogsBySpec.clear();
}

function recordModeLogs(modeLabel: string, groups: LogGroup[]): void {
  for (const group of groups) {
    const lines: string[] = [];
    for (const entry of group.entries) lines.push(...entry.lines);
    if (!lines.length) continue;
    let byMode = collectedLogsBySpec.get(group.file);
    if (!byMode) {
      byMode = new Map();
      collectedLogsBySpec.set(group.file, byMode);
    }
    byMode.set(modeLabel, lines);
  }
}

// Render the collected logs as the `latest.log` body. Within a spec, modes that
// produced byte-identical output are merged into one block tagged with every
// mode that emitted it:
//
//   [LOG] log.spec.ts (node:bindings, node:wasi):
//
//   {"a":1}
//   ...
//
// `count` is the number of de-duplicated `log()` calls (one entry per call —
// stringify escapes newlines, so a call is a single line), not counting the
// same call again per mode.
function renderCollectedLogs(): { text: string; count: number } {
  const blocks: string[] = [];
  let count = 0;
  const specs = [...collectedLogsBySpec.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const spec of specs) {
    const byMode = collectedLogsBySpec.get(spec)!;
    // Group modes by identical content so duplicate output collapses into one
    // block; `calls` is that block's log() count, tallied once regardless of
    // how many modes produced it.
    const byContent = new Map<string, { modes: string[]; calls: number }>();
    for (const [mode, lines] of byMode) {
      const content = lines.join("\n");
      const existing = byContent.get(content);
      if (existing) existing.modes.push(mode);
      else byContent.set(content, { modes: [mode], calls: lines.length });
    }
    for (const [content, { modes, calls }] of byContent) {
      const named = modes.filter((mode) => mode !== "default").sort();
      const suffix = named.length ? ` (${named.join(", ")})` : "";
      count += calls;
      blocks.push(
        `[LOG] ${formatSpecDisplayPath(spec)}${suffix}:\n\n${content}`,
      );
    }
  }
  return { text: blocks.length ? blocks.join("\n\n") + "\n" : "", count };
}

// Render the collector and (re)write the single aggregated `latest.log` at the
// base (un-mode-qualified) logs dir, so every mode shares one file. Returns the
// resulting LogSummary. Called by run() after recording its own logs, so the
// last run() of a multi-mode pass leaves a file covering — and de-duplicating —
// every mode.
function flushLatestLog(baseLogsDir: string | undefined): LogSummary {
  const rendered = renderCollectedLogs();
  if (rendered.count <= 0)
    return { count: 0, file: null, groups: [], text: "" };
  if (!baseLogsDir || baseLogsDir === "none") {
    return {
      count: rendered.count,
      file: null,
      groups: [],
      text: rendered.text,
    };
  }
  const logRoot = path.join(process.cwd(), baseLogsDir);
  if (!existsSync(logRoot)) mkdirSync(logRoot, { recursive: true });
  const latestLogPath = path.join(logRoot, "latest.log");
  writeFileSync(latestLogPath, rendered.text);
  return {
    count: rendered.count,
    file: path.relative(process.cwd(), latestLogPath) || latestLogPath,
    groups: [],
    text: rendered.text,
  };
}

export async function run(
  flags: RunFlags = {},
  configPath: string = DEFAULT_CONFIG_PATH,
  selectors: string[] = [],
  shouldExit: boolean = true,
  options: RunExecutionOptions = {},
) {
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  const reports: any[] = [];
  const loadedConfig = loadConfig(resolvedConfigPath);
  const mode = applyMode(loadedConfig, options.modeName);
  const config = mode.config;
  // Mode-level exclusion: when a mode override adds `!`-prefixed negations
  // beyond the top-level config, honor them even when the orchestrator passes
  // a single-file selector (`resolveInputPatterns` drops the configured input
  // in that case). Top-level negations are intentionally not enforced here so
  // explicit selectors can still override them (e.g. picking a __tmp_* spec).
  if (options.modeName && selectors.length > 0) {
    const topInput = Array.isArray(loadedConfig.input)
      ? loadedConfig.input
      : [loadedConfig.input];
    const modeInput = Array.isArray(config.input)
      ? config.input
      : [config.input];
    const topNegations = new Set(topInput.filter((p) => p.startsWith("!")));
    const modeOnlyNegations = modeInput
      .filter((p) => p.startsWith("!") && !topNegations.has(p))
      .map((p) => p.slice(1));
    if (modeOnlyNegations.length > 0) {
      const cwd = process.cwd();
      const allExcluded = selectors.every((sel) => {
        const abs = path.isAbsolute(sel) ? sel : path.resolve(cwd, sel);
        const rel = path.relative(cwd, abs).split(path.sep).join("/");
        return modeOnlyNegations.some((pat) =>
          minimatch(rel, pat, { dot: true, matchBase: true }),
        );
      });
      if (allExcluded) {
        return {
          failed: false,
          stats: collectRunStats([]),
          buildTime: 0,
          snapshotSummary: { matched: 0, created: 0, updated: 0, failed: 0 },
          coverageSummary: {
            enabled: false,
            showPoints: false,
            total: 0,
            covered: 0,
            uncovered: 0,
            percent: 100,
            files: [],
          },
          reports: [],
          logSummary: { count: 0, file: null, groups: [], text: "" },
        };
      }
    }
  }
  const { files: inputFiles, warnings: selectorWarnings } =
    await resolveSpecFiles(config.input, selectors);
  emitSelectorWarnings(selectorWarnings);
  const snapshotEnabled = flags.snapshot !== false;
  const createSnapshots = Boolean(flags.createSnapshots);
  const overwriteSnapshots = Boolean(flags.overwriteSnapshots);
  const cleanOutput = Boolean(flags.clean);
  const showCoverage = Boolean(flags.showCoverage);
  const coverage = resolveCoverageOptions(config.coverage);
  if (flags.coverage != undefined) {
    coverage.enabled = Boolean(flags.coverage);
  }
  const coverageEnabled = coverage.enabled;
  const coverageDir = config.coverageDir ?? "./.as-test/coverage";
  const runtimeCommand = resolveRuntimeCommand(
    getConfiguredRuntimeCmd(config),
    config.buildOptions.target,
  );
  const renderer =
    options.renderer ??
    new TestRenderer({ stdout: process.stdout, stderr: process.stderr });

  const runtimeTokens = tokenizeCommand(runtimeCommand);
  if (!runtimeTokens.length) {
    throw new Error("runtime command is empty");
  }
  const command = runtimeTokens[0]!;
  const execPath = getExec(command);

  if (!execPath) {
    const message = `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${command} in PATH variable!`;
    if (shouldExit) {
      console.log(message);
      process.exit(1);
    }
    throw new Error(message);
  }

  if (options.emitRunStart !== false) {
    renderer.onRunStart({
      runtimeName: runtimeNameFromCommand(runtimeCommand),
      clean: cleanOutput,
      verbose: Boolean(flags.verbose),
      snapshotEnabled,
      createSnapshots,
    });
  }
  if (showCoverage && !coverageEnabled) {
    process.stderr.write(
      chalk.dim(
        "coverage point output requested with --show-coverage, but coverage is disabled\n",
      ),
    );
  }

  const snapshotSummary = {
    matched: 0,
    created: 0,
    updated: 0,
    failed: 0,
  };
  let buildTime = 0;
  const ownedWebSession =
    options.webSession === undefined &&
    shouldUsePersistentHeadfulWebSession(
      config.buildOptions.target,
      runtimeCommand,
    )
      ? await PersistentWebSessionHost.start(false)
      : null;
  const webSession = options.webSession ?? ownedWebSession;

  const cacheCtx = cacheStorage.getStore();
  try {
    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i]!;
      const outFile = path.join(
        config.outDir,
        resolveArtifactPath(file, config.input),
      );

      // Tier 2: replay a stored passing report instead of running. build() ran
      // first this session and validated the build is fresh (else it cleared
      // the stored report), so here we only re-check the run-specific inputs.
      if (cacheCtx?.replay) {
        const snapPath = resolveSnapshotPath(
          file,
          config.snapshotDir,
          config.input,
        );
        const snapshotSha = existsSync(snapPath)
          ? sha256OfFile(snapPath)
          : null;
        if (
          cacheCtx.cache.canReplay(options.modeName, file, {
            runtimeCmd: runtimeCommand,
            snapshotSha,
          })
        ) {
          const cached = cacheCtx.cache.getReport(options.modeName, file) as
            | Record<string, any>
            | undefined;
          if (cached && !reportHasFailure(cached)) {
            const cachedSuites = Array.isArray(cached.suites)
              ? cached.suites
              : [];
            const selected = options.suiteSelectors?.length
              ? filterSelectedSuites(
                  cachedSuites,
                  options.suiteSelectors,
                  file,
                  options.modeName ?? "default",
                )
              : cachedSuites;
            replayCachedReport(renderer, file, selected);
            const cachedSnap = cached.snapshotSummary ?? {
              matched: 0,
              created: 0,
              updated: 0,
              failed: 0,
            };
            snapshotSummary.matched += cachedSnap.matched ?? 0;
            snapshotSummary.created += cachedSnap.created ?? 0;
            snapshotSummary.updated += cachedSnap.updated ?? 0;
            snapshotSummary.failed += cachedSnap.failed ?? 0;
            reports.push({
              file,
              modeName: options.modeName ?? "default",
              suites: selected,
              coverage: cached.coverage ?? {
                total: 0,
                covered: 0,
                uncovered: 0,
                percent: 100,
                points: [],
              },
              runCommand: cached.runCommand ?? "",
              buildCommand:
                options.buildCommandsByFile?.[file] ??
                options.buildCommand ??
                cached.buildCommand ??
                "",
              snapshotSummary: cachedSnap,
              cached: true,
            });
            continue;
          }
        }
      }

      if (!existsSync(outFile)) {
        const buildStartedAt = Date.now();
        await build(
          resolvedConfigPath,
          [file],
          options.modeName,
          { coverage: flags.coverage },
          {},
          loadedConfig,
        );
        buildTime += Date.now() - buildStartedAt;
      }

      const fileBase = file
        .slice(file.lastIndexOf("/") + 1)
        .replace(".ts", "")
        .replace(".spec", "");
      const fileToken = outFile;
      const runtimeTargetEnv = resolveRuntimeTargetEnv(
        config.buildOptions.target,
        outFile,
      );
      const invocation: RuntimeInvocation = {
        command: execPath,
        args: runtimeTokens
          .slice(1)
          .map((token) =>
            token.replace(/<name>/g, fileBase).replace(/<file>/g, fileToken),
          ),
      };
      // A managed web-session run never spawns the standalone runner, so its
      // repro must re-run the managed CLI command (which renders the same panel
      // UI) rather than `default.web.js <wasm>`, a different web stack.
      const runCommandForLog = webSession
        ? formatInvocation({
            command: execPath,
            args: [
              process.argv[1] ?? "",
              "run",
              resolveSpecRelativePath(file, config.input),
              ...(options.modeName ? ["--mode", options.modeName] : []),
            ],
          })
        : formatInvocation(invocation);
      const snapshotStore = new SnapshotStore(
        file,
        config.snapshotDir,
        config.input,
      );
      let report: any;
      try {
        const runtimeEnv = {
          ...mode.env,
          ...config.runOptions.env,
          ...runtimeTargetEnv,
          ...(process.env.BROWSER?.trim()
            ? { BROWSER: process.env.BROWSER.trim() }
            : config.runOptions.runtime.browser.trim()
              ? { BROWSER: config.runOptions.runtime.browser.trim() }
              : {}),
        };
        const crashEntryKey = resolveSpecRelativePath(
          file,
          config.input,
        ).replace(/\.ts$/i, "");
        report = webSession
          ? await runWebSessionProcess(
              webSession,
              file,
              config.fuzz.crashDir,
              crashEntryKey,
              options.modeName,
              snapshotStore,
              snapshotEnabled,
              createSnapshots,
              overwriteSnapshots,
              renderer,
              runtimeEnv,
            )
          : await runProcess(
              invocation,
              file,
              config.fuzz.crashDir,
              crashEntryKey,
              options.modeName,
              snapshotStore,
              snapshotEnabled,
              createSnapshots,
              overwriteSnapshots,
              renderer,
              runtimeEnv,
            );
      } catch (error) {
        const modeLabel = options.modeName ?? "default";
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to run ${formatSpecDisplayPath(file)} in mode ${modeLabel} with ${details}`,
        );
      }
      const normalized = normalizeReport(report);
      const selectedSuites = options.suiteSelectors?.length
        ? filterSelectedSuites(
            normalized.suites,
            options.suiteSelectors,
            file,
            options.modeName ?? "default",
          )
        : normalized.suites;
      snapshotStore.flush();
      snapshotSummary.matched += snapshotStore.matched;
      snapshotSummary.created += snapshotStore.created;
      snapshotSummary.updated += snapshotStore.updated;
      snapshotSummary.failed += snapshotStore.failed;
      const fileReport = {
        file,
        modeName: options.modeName ?? "default",
        suites: selectedSuites,
        coverage: normalized.coverage,
        runCommand: runCommandForLog,
        buildCommand:
          options.buildCommandsByFile?.[file] ?? options.buildCommand ?? "",
        snapshotSummary: {
          matched: snapshotStore.matched,
          created: snapshotStore.created,
          updated: snapshotStore.updated,
          failed: snapshotStore.failed,
        },
        // When the cache is active, mark freshly-run reports `false` (replays
        // are marked `true`) so the summary can show a cache hit/miss split.
        // Left undefined when the cache is off so no Cache line is shown.
        ...(cacheCtx?.cache ? { cached: false } : {}),
      };
      reports.push(fileReport);
      // Persist this report so an unchanged future run can replay it (Tier 2).
      // recordBuild ran during build() this session, so the entry exists.
      if (cacheCtx?.cache) {
        const snapPath = resolveSnapshotPath(
          file,
          config.snapshotDir,
          config.input,
        );
        const snapshotSha = existsSync(snapPath)
          ? sha256OfFile(snapPath)
          : null;
        cacheCtx.cache.recordReport(options.modeName, file, {
          report: fileReport,
          snapshotSha,
          runtimeCmd: runtimeCommand,
        });
      }
    }
  } finally {
    await ownedWebSession?.close();
  }

  const groupedLogs = collectGroupedLogs(reports);
  if (config.logs && config.logs != "none") {
    const logRoot = path.join(process.cwd(), config.logs);
    if (!existsSync(logRoot)) {
      mkdirSync(logRoot, { recursive: true });
    }
    for (const report of reports) {
      writeReadableLog(
        logRoot,
        report.file,
        config.input,
        report.suites,
        options.modeName,
        options.buildCommandsByFile?.[report.file] ??
          options.buildCommand ??
          "",
        report.runCommand,
        report.snapshotSummary,
      );
    }
  }
  // Record this run's logs (tagged with its mode) into the process-wide
  // collector, then rewrite the single aggregated `latest.log` covering every
  // mode seen so far. The collector persists across run() calls, so the last
  // run() of a multi-mode pass produces the complete, de-duplicated file. The
  // file lives at the base (un-mode-qualified) logs dir — `loadedConfig.logs`
  // before `applyMode` appended the per-mode subdirectory.
  recordModeLogs(options.modeName ?? "default", groupedLogs.groups);
  const logSummary = flushLatestLog(loadedConfig.logs);
  const stats = collectRunStats(reports);
  if (options.fileSummaryTotal != undefined) {
    applyConfiguredFileTotalToStats(stats, options.fileSummaryTotal);
  }
  const coverageSummary = collectCoverageSummary(
    reports,
    coverageEnabled,
    showCoverage,
    coverage,
  );
  if (
    coverageEnabled &&
    coverageDir &&
    coverageDir != "none" &&
    coverageSummary.files.length > 0
  ) {
    const resolvedCoverageDir = path.join(process.cwd(), coverageDir);
    const coverageFilePath = path.join(
      resolvedCoverageDir,
      options.coverageFileName ?? "coverage.log.json",
    );
    mkdirSync(path.dirname(coverageFilePath), { recursive: true });
    writeFileSync(coverageFilePath, JSON.stringify(coverageSummary, null, 2));
  }
  if (options.emitRunComplete !== false) {
    const totalModes = Math.max(options.modeSummaryTotal ?? 1, 1);
    const executedModes = Math.min(
      Math.max(options.modeSummaryExecuted ?? 1, 1),
      totalModes,
    );
    const unexecutedModes = Math.max(0, totalModes - executedModes);
    const modeFailed = Boolean(stats.failedFiles || snapshotSummary.failed);
    renderer.onRunComplete({
      clean: cleanOutput,
      snapshotEnabled,
      showCoverage,
      showCoverageAll: Boolean(flags.showCoverageAll),
      verbose: Boolean(flags.verbose),
      showLogs: Boolean(flags.showLogs),
      logSummary,
      buildTime,
      snapshotSummary,
      coverageSummary,
      stats,
      reports,
      modeSummary: {
        failed: modeFailed ? 1 : 0,
        skipped:
          unexecutedModes + (modeFailed || stats.passedFiles > 0 ? 0 : 1),
        total: totalModes,
      },
    });
  }

  const failed = Boolean(stats.failedFiles || snapshotSummary.failed);
  if (shouldExit) {
    process.exit(failed ? 1 : 0);
  }
  return {
    failed,
    buildTime,
    stats,
    snapshotSummary,
    coverageSummary,
    reports,
    logSummary,
  };
}

function applyConfiguredFileTotalToStats(
  stats: RunStats,
  fileSummaryTotal: number,
): void {
  const total = Math.max(fileSummaryTotal, 0);
  const executed = stats.failedFiles + stats.passedFiles + stats.skippedFiles;
  const unexecuted = Math.max(0, total - executed);
  stats.skippedFiles += unexecuted;
}

function resolveRuntimeCommand(
  runtimeRun: string,
  target: string,
  emitWarnings: boolean = true,
): string {
  const targetDefaultAligned = alignDefaultRuntimeToTarget(runtimeRun, target);
  const normalized = resolveLegacyRuntime(
    targetDefaultAligned,
    target,
    emitWarnings,
  );
  return fallbackToDefaultRuntime(normalized, target, emitWarnings);
}

function shouldUsePersistentHeadfulWebSession(
  target: string,
  runtimeCommand: string,
): boolean {
  return target == "web" && !runtimeCommand.includes("--headless");
}

function alignDefaultRuntimeToTarget(
  runtimeRun: string,
  target: string,
): string {
  const fallback = getDefaultRuntimeFallback(target);
  if (!fallback) return runtimeRun;
  const trimmed = runtimeRun.trim();
  if (!trimmed.length || trimmed == fallback.command) return runtimeRun;

  const defaults = ["wasi", "bindings", "web"]
    .map((kind) => getDefaultRuntimeFallback(kind))
    .filter(
      (item): item is { command: string; scriptPath: string } => item != null,
    );
  for (const entry of defaults) {
    if (entry.command != fallback.command && entry.command == trimmed) {
      return fallback.command;
    }
  }
  return runtimeRun;
}

function resolveLegacyRuntime(
  runtimeRun: string,
  target: string,
  emitWarnings: boolean,
): string {
  if (target == "wasi") {
    const preferredPath = "./.as-test/runners/default.wasi.js";
    const legacyPaths = ["./bin/wasi-run.js", "./.as-test/wasi/wasi.run.js"];

    if (runtimeRun.includes(preferredPath)) {
      ensureDefaultRuntimeRunner("wasi", emitWarnings);
      return runtimeRun;
    }

    for (const legacyPath of legacyPaths) {
      if (!runtimeRun.includes(legacyPath)) continue;

      const resolvedLegacyPath = path.join(process.cwd(), legacyPath);
      if (existsSync(resolvedLegacyPath)) return runtimeRun;

      ensureDefaultRuntimeRunner("wasi", emitWarnings);
      if (emitWarnings) {
        process.stderr.write(
          chalk.dim(
            `legacy WASI runtime path detected (${legacyPath}); using ${preferredPath}\n`,
          ),
        );
      }
      return runtimeRun.replace(legacyPath, preferredPath);
    }
    return runtimeRun;
  }

  if (target == "bindings") {
    const preferredPath = "./.as-test/runners/default.bindings.js";
    const legacyPath = "./.as-test/runners/default.run.js";
    if (runtimeRun.includes(preferredPath)) {
      ensureDefaultRuntimeRunner("bindings", emitWarnings);
      return runtimeRun;
    }
    if (runtimeRun.includes(legacyPath)) {
      const resolvedLegacyPath = path.join(process.cwd(), legacyPath);
      if (existsSync(resolvedLegacyPath)) {
        if (emitWarnings) {
          process.stderr.write(
            chalk.dim(
              `deprecated runtime script (${legacyPath}) detected; prefer ${preferredPath}\n`,
            ),
          );
        }
        return runtimeRun;
      }

      ensureDefaultRuntimeRunner("bindings", emitWarnings);
      if (emitWarnings) {
        process.stderr.write(
          chalk.dim(
            `legacy bindings runtime path detected (${legacyPath}); using ${preferredPath}\n`,
          ),
        );
      }
      return runtimeRun.replace(legacyPath, preferredPath);
    }
  }

  if (target == "web") {
    const preferredPath = "./.as-test/runners/default.web.js";
    if (runtimeRun.includes(preferredPath)) {
      ensureDefaultRuntimeRunner("web", emitWarnings);
    }
  }

  return runtimeRun;
}

function fallbackToDefaultRuntime(
  runtimeRun: string,
  target: string,
  emitWarnings: boolean,
): string {
  const scriptPath = extractRuntimeScriptPath(runtimeRun);
  if (!scriptPath) return runtimeRun;

  const resolvedScriptPath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(process.cwd(), scriptPath);
  if (existsSync(resolvedScriptPath)) return runtimeRun;

  const fallback = ensureDefaultRuntimeRunner(target, emitWarnings);
  if (!fallback) return runtimeRun;

  const resolvedFallbackPath = path.join(process.cwd(), fallback.scriptPath);
  if (
    resolvedScriptPath == resolvedFallbackPath ||
    scriptPath == fallback.scriptPath
  ) {
    return runtimeRun;
  }

  if (emitWarnings) {
    process.stderr.write(
      chalk.dim(
        `runtime script not found (${scriptPath}); using ${fallback.scriptPath}\n`,
      ),
    );
  }
  return fallback.command;
}

function getDefaultRuntimeFallback(
  target: string,
): { command: string; scriptPath: string } | null {
  if (target == "wasi") {
    return {
      command: "node ./.as-test/runners/default.wasi.js",
      scriptPath: "./.as-test/runners/default.wasi.js",
    };
  }
  if (target == "bindings") {
    return {
      command: "node ./.as-test/runners/default.bindings.js",
      scriptPath: "./.as-test/runners/default.bindings.js",
    };
  }
  if (target == "web") {
    return {
      command: "node ./.as-test/runners/default.web.js",
      scriptPath: "./.as-test/runners/default.web.js",
    };
  }
  return null;
}

function ensureDefaultRuntimeRunner(
  target: string,
  emitWarnings: boolean,
): { command: string; scriptPath: string } | null {
  const fallback = getDefaultRuntimeFallback(target);
  if (!fallback) return null;

  const resolvedScriptPath = path.join(process.cwd(), fallback.scriptPath);
  if (existsSync(resolvedScriptPath)) {
    return fallback;
  }

  const source = getDefaultRuntimeRunnerSource(target);
  if (!source) return fallback;

  if (!existsSync(path.dirname(resolvedScriptPath))) {
    mkdirSync(path.dirname(resolvedScriptPath), { recursive: true });
  }
  writeFileSync(resolvedScriptPath, source);

  if (emitWarnings) {
    process.stderr.write(
      chalk.dim(`runtime script missing; created ${fallback.scriptPath}\n`),
    );
  }
  return fallback;
}

function getDefaultRuntimeRunnerSource(target: string): string | null {
  if (target == "wasi") {
    return `import { instantiate } from "as-test/lib";

const imports = {};

instantiate(imports)
  .then((instance) => {
    instance.exports.start?.();
    // Add extra startup logic here when needed.
  })
  .catch((error) => {
    throw new Error("Failed to run WASI module: " + String(error));
  });
`;
  }

  if (target == "bindings") {
    return `import { instantiate } from "as-test/lib";

const imports = {};

instantiate(imports)
  .then((instance) => {
    instance.exports.start?.();
    // Add extra startup logic here when needed.
  })
  .catch((error) => {
    throw new Error("Failed to run bindings module: " + String(error));
  });
`;
  }

  if (target == "web") {
    return buildWebRunnerSource();
  }

  return null;
}

function resolveRuntimeTargetEnv(
  target: string,
  wasmPath: string,
): Record<string, string> {
  if (target == "bindings") {
    return resolveBindingsRuntimeEnv(wasmPath);
  }
  if (target == "web") {
    return resolveWebRuntimeEnv(wasmPath);
  }
  if (target == "wasi") {
    return {
      AS_TEST_RUNTIME_TARGET: "wasi",
      AS_TEST_WASM_PATH: wasmPath,
    };
  }
  return {};
}

function resolveBindingsRuntimeEnv(wasmPath: string): Record<string, string> {
  const helperPath = wasmPath.replace(/\.wasm$/, ".js");
  const kind = detectBindingsKind(wasmPath, helperPath);
  const env: Record<string, string> = {
    AS_TEST_RUNTIME_TARGET: "bindings",
    AS_TEST_WASM_PATH: wasmPath,
    AS_TEST_BINDINGS_KIND: kind,
  };
  if (kind != "none") {
    env.AS_TEST_HELPER_PATH = helperPath;
  }
  return env;
}

function resolveWebRuntimeEnv(wasmPath: string): Record<string, string> {
  const env = resolveBindingsRuntimeEnv(wasmPath);
  env.AS_TEST_RUNTIME_TARGET = "web";
  return env;
}

function detectBindingsKind(
  wasmPath: string,
  helperPath: string,
): "raw" | "esm" | "none" {
  if (!existsSync(wasmPath)) {
    throw new Error(`bindings artifact not found: ${wasmPath}`);
  }
  if (!existsSync(helperPath)) {
    return "none";
  }
  const source = readFileSync(helperPath, "utf8");
  if (/\bexport\s+(async\s+)?function\s+instantiate\b/.test(source)) {
    return "raw";
  }
  if (
    /\bexport\s+const\b/.test(source) &&
    /new URL\([^)]*\.wasm["']?,\s*import\.meta\.url\)/.test(source)
  ) {
    return "esm";
  }
  throw new Error(
    `could not detect bindings kind for ${helperPath}; expected raw or esm helper output`,
  );
}

function extractRuntimeScriptPath(runtimeRun: string): string | null {
  const tokens = runtimeRun
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length < 2) return null;

  const execToken = path.basename(tokens[0]!).toLowerCase();
  if (!isScriptHostRuntime(execToken)) return null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token == "--") {
      const next = tokens[i + 1];
      if (next && isLikelyRuntimeScriptPath(next)) return next;
      return null;
    }
    if (token.startsWith("-")) continue;
    if (isLikelyRuntimeScriptPath(token)) return token;
    return null;
  }
  return null;
}

function isScriptHostRuntime(execToken: string): boolean {
  return (
    execToken == "node" ||
    execToken == "node.exe" ||
    execToken == "node.cmd" ||
    execToken == "bun" ||
    execToken == "bun.exe" ||
    execToken == "bun.cmd" ||
    execToken == "deno" ||
    execToken == "deno.exe" ||
    execToken == "deno.cmd" ||
    execToken == "tsx" ||
    execToken == "tsx.cmd" ||
    execToken == "ts-node" ||
    execToken == "ts-node.cmd"
  );
}

function isLikelyRuntimeScriptPath(token: string): boolean {
  if (!token.length) return false;
  if (token == "<file>" || token == "<name>") return false;
  if (token.includes("://")) return false;
  if (token.startsWith("-")) return false;
  if (token.startsWith("./")) return true;
  if (token.startsWith("../")) return true;
  if (token.startsWith("/")) return true;
  if (token.startsWith(".\\")) return true;
  if (token.startsWith("..\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(token)) return true;
  return /\.(mjs|cjs|js|ts)$/.test(token);
}

function getConfiguredRuntimeCmd(config: {
  runOptions: { runtime: { cmd?: string; run?: string } };
}): string {
  const runtime = config.runOptions.runtime;
  if (runtime.cmd && runtime.cmd.length) return runtime.cmd;
  if (runtime.run && runtime.run.length) return runtime.run;
  throw new Error(
    `runtime command is missing. Set "runOptions.runtime.cmd" in as-test.config.json`,
  );
}

function runtimeNameFromCommand(command: string): string {
  const token = command.trim().split(/\s+/)[0];
  return token && token.length ? token : "runtime";
}

function normalizeReport(raw: unknown): {
  suites: any[];
  coverage: FileCoverage;
} {
  if (Array.isArray(raw)) {
    return {
      suites: raw as any[],
      coverage: {
        total: 0,
        covered: 0,
        uncovered: 0,
        percent: 100,
        points: [],
      },
    };
  }
  const value = raw as Record<string, unknown> | null;
  if (!value) {
    return {
      suites: [],
      coverage: {
        total: 0,
        covered: 0,
        uncovered: 0,
        percent: 100,
        points: [],
      },
    };
  }
  const suites = Array.isArray(value.suites) ? (value.suites as any[]) : [];
  const coverage = normalizeCoverage(value.coverage);
  return { suites, coverage };
}

function normalizeCoverage(value: unknown): FileCoverage {
  const raw = value as Record<string, unknown> | null;
  const total = Number(raw?.total ?? 0);
  const uncovered = Number(raw?.uncovered ?? 0);
  const covered =
    raw?.covered != null ? Number(raw.covered) : Math.max(total - uncovered, 0);
  const percent =
    raw?.percent != null
      ? Number(raw.percent)
      : total
        ? (covered * 100) / total
        : 100;
  const pointsRaw = Array.isArray(raw?.points)
    ? (raw?.points as unknown[])
    : [];
  const points = pointsRaw
    .map((point) => {
      const p = point as Record<string, unknown>;
      return {
        hash: String(p.hash ?? ""),
        file: String(p.file ?? ""),
        line: Number(p.line ?? 0),
        column: Number(p.column ?? 0),
        type: String(p.type ?? ""),
        executed: Boolean(p.executed),
        parentHash: String(p.parentHash ?? ""),
        scopeKind: String(p.scopeKind ?? ""),
        scopeName: String(p.scopeName ?? ""),
        depth: Number(p.depth ?? 0),
      };
    })
    .filter((point) => point.file.length > 0);
  return {
    total,
    covered,
    uncovered,
    percent,
    points,
  };
}

function collectCoverageSummary(
  reports: {
    file: string;
    suites: any[];
    coverage: FileCoverage;
  }[],
  enabled: boolean,
  showPoints: boolean,
  coverage: CoverageOptions,
): CoverageSummary {
  const summary: CoverageSummary = {
    enabled,
    showPoints,
    total: 0,
    covered: 0,
    uncovered: 0,
    percent: 100,
    files: [],
  };
  const uniquePoints = new Map<
    string,
    {
      hash: string;
      file: string;
      line: number;
      column: number;
      type: string;
      executed: boolean;
      parentHash?: string;
      scopeKind?: string;
      scopeName?: string;
      depth?: number;
    }
  >();
  const hasDetailedPoints = reports.some(
    (report) => report.coverage.points.length > 0,
  );

  // `isIgnoredCoverageFile` depends only on the file (coverage options are fixed
  // for this call), but every point carries a file — so classify each file once
  // instead of once per point. Dominates the post-run pass on large suites.
  const ignoredFileCache = new Map<string, boolean>();
  const isIgnoredFile = (file: string): boolean => {
    let ignored = ignoredFileCache.get(file);
    if (ignored === undefined) {
      ignored = isIgnoredCoverageFile(file, coverage);
      ignoredFileCache.set(file, ignored);
    }
    return ignored;
  };

  for (const report of reports) {
    for (const point of report.coverage.points) {
      if (isIgnoredFile(point.file)) continue;
      if (isIgnoredCoveragePoint(point, coverage)) continue;
      const key = `${point.file}::${point.hash}`;
      const existing = uniquePoints.get(key);
      if (!existing) {
        uniquePoints.set(key, { ...point });
      } else if (point.executed) {
        existing.executed = true;
      }
    }
  }

  if (uniquePoints.size > 0) {
    const byFile = new Map<
      string,
      {
        hash: string;
        file: string;
        line: number;
        column: number;
        type: string;
        executed: boolean;
        parentHash?: string;
        scopeKind?: string;
        scopeName?: string;
        depth?: number;
      }[]
    >();

    for (const point of uniquePoints.values()) {
      if (!byFile.has(point.file)) byFile.set(point.file, []);
      byFile.get(point.file)!.push(point);
      summary.total++;
      if (point.executed) summary.covered++;
      else summary.uncovered++;
    }

    const sortedFiles = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      const points = byFile.get(file)!;
      points.sort(compareCoveragePoints);
      let covered = 0;
      for (const point of points) {
        if (point.executed) covered++;
      }
      const total = points.length;
      if (!total) continue;
      const uncovered = total - covered;
      summary.files.push({
        file,
        total,
        covered,
        uncovered,
        percent: total ? (covered * 100) / total : 100,
        points,
      });
    }
  } else if (!hasDetailedPoints) {
    // Compatibility fallback for reports without detailed point payloads.
    for (const report of reports) {
      if (isIgnoredFile(report.file)) continue;
      if (report.coverage.total <= 0) continue;
      summary.total += report.coverage.total;
      summary.covered += report.coverage.covered;
      summary.uncovered += report.coverage.uncovered;
      summary.files.push({
        file: report.file,
        total: report.coverage.total,
        covered: report.coverage.covered,
        uncovered: report.coverage.uncovered,
        percent: report.coverage.percent,
        points: report.coverage.points,
      });
    }
  }

  summary.percent = summary.total
    ? (summary.covered * 100) / summary.total
    : 100;
  return summary;
}

function isIgnoredCoverageFile(
  file: string,
  coverage: CoverageOptions,
): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (!isAllowedCoverageSourceFile(normalized)) return true;
  if (isAssemblyScriptStdlibFile(normalized)) return true;
  const classification = classifyCoverageFile(normalized);
  if (classification.kind == "dependency") {
    if (coverage.mode != "all" && !coverage.dependencies.length) return true;
    if (
      coverage.dependencies.length &&
      (!classification.packageName ||
        !coverage.dependencies.includes(classification.packageName))
    ) {
      return true;
    }
  }
  if (!coverage.includeSpecs && normalized.endsWith(".spec.ts")) return true;
  if (
    coverage.include.length &&
    !coverage.include.some((pattern) =>
      matchesCoverageGlob(normalized, pattern),
    )
  ) {
    return true;
  }
  if (
    coverage.exclude.some((pattern) => matchesCoverageGlob(normalized, pattern))
  ) {
    return true;
  }
  return false;
}

function matchesCoverageGlob(file: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").trim();
  if (!normalizedPattern.length) return false;
  const regex = globPatternToRegExp(normalizedPattern);
  return regex.test(file);
}

const globRegexCache = new Map<string, RegExp>();

function globPatternToRegExp(pattern: string): RegExp {
  const cached = globRegexCache.get(pattern);
  if (cached) return cached;
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char == "*") {
      const next = pattern[i + 1];
      if (next == "*") {
        const after = pattern[i + 2];
        if (after == "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char == "?") {
      source += "[^/]";
      continue;
    }
    if ("\\.[]{}()+-^$|".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  source += "$";
  const regex = new RegExp(source);
  globRegexCache.set(pattern, regex);
  return regex;
}

function isAllowedCoverageSourceFile(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith(".ts") || lower.endsWith(".as");
}

// AssemblyScript normalizes node_modules/<pkg>/... to ~lib/<pkg>/... in Source.normalizedPath.
// This set contains the root names that are actual AS stdlib modules, so we can distinguish
// real stdlib (~lib/array.ts) from third-party packages (~lib/json-as/assembly/index.ts).
const AS_STDLIB_ROOT_NAMES = new Set([
  "array",
  "arraybuffer",
  "atomics",
  "bindings",
  "builtins",
  "compat",
  "console",
  "crypto",
  "dataview",
  "date",
  "diagnostics",
  "error",
  "function",
  "iterator",
  "map",
  "math",
  "memory",
  "number",
  "object",
  "polyfills",
  "process",
  "reference",
  "regexp",
  "rt",
  "set",
  "shared",
  "staticarray",
  "string",
  "symbol",
  "table",
  "typedarray",
  "uri",
  "util",
  "vector",
]);

function isAssemblyScriptStdlibFile(file: string): boolean {
  if (file.startsWith("~lib/")) {
    // Extract the first path segment after ~lib/ (strip any file extension)
    const after = file.slice("~lib/".length);
    const root = (after.split("/")[0] ?? "").replace(/\.[^.]+$/, "");
    return AS_STDLIB_ROOT_NAMES.has(root);
  }
  if (file.includes("/~lib/")) return true;
  if (file.startsWith("assemblyscript/std/")) return true;
  if (file.includes("/assemblyscript/std/")) return true;
  return false;
}

function classifyCoverageFile(file: string): {
  kind: "project" | "dependency";
  packageName: string | null;
} {
  const packageName = resolveCoverageDependencyPackage(file);
  if (packageName) {
    return { kind: "dependency", packageName };
  }
  return { kind: "project", packageName: null };
}

function resolveCoverageDependencyPackage(file: string): string | null {
  const normalized = file.replace(/\\/g, "/");

  // AssemblyScript normalizes node_modules/<pkg>/... to ~lib/<pkg>/... at compile time.
  // Handle that path format so coverage.mode and coverage.dependencies work at runtime.
  if (normalized.startsWith("~lib/")) {
    const after = normalized.slice("~lib/".length);
    const segments = after.split("/").filter(Boolean);
    if (!segments.length) return null;
    if (segments[0]!.startsWith("@")) {
      if (segments.length < 2) return null;
      return `${segments[0]}/${segments[1]}`;
    }
    // Strip file extension for bare module entries like ~lib/json-as.ts (unusual but safe)
    return segments[0]!.replace(/\.[^.]+$/, "") || null;
  }

  const marker = "/node_modules/";
  const prefixed = normalized.startsWith("node_modules/")
    ? `/${normalized}`
    : normalized;
  const index = prefixed.lastIndexOf(marker);
  if (index == -1) return null;
  const after = prefixed.slice(index + marker.length);
  if (!after.length) return null;
  const segments = after.split("/").filter(Boolean);
  if (!segments.length) return null;
  if (segments[0]!.startsWith("@")) {
    if (segments.length < 2) return null;
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0]!;
}

function resolveCoverageOptions(raw: unknown): CoverageOptions {
  if (typeof raw == "boolean") {
    return {
      enabled: raw,
      mode: "project",
      includeSpecs: false,
      dependencies: [],
      include: [],
      exclude: [],
      ignore: {
        labels: [],
        names: [],
        locations: [],
        snippets: [],
      },
    };
  }
  if (raw && typeof raw == "object") {
    const obj = raw as Record<string, unknown>;
    const ignore =
      obj.ignore && typeof obj.ignore == "object" && !Array.isArray(obj.ignore)
        ? (obj.ignore as Record<string, unknown>)
        : null;
    return {
      enabled: obj.enabled == null ? false : Boolean(obj.enabled),
      mode: obj.mode == "all" ? "all" : "project",
      includeSpecs: Boolean(obj.includeSpecs),
      dependencies: Array.isArray(obj.dependencies)
        ? obj.dependencies.filter(
            (item): item is string => typeof item == "string",
          )
        : [],
      include: Array.isArray(obj.include)
        ? obj.include.filter((item): item is string => typeof item == "string")
        : [],
      exclude: Array.isArray(obj.exclude)
        ? obj.exclude.filter((item): item is string => typeof item == "string")
        : [],
      ignore: {
        labels: Array.isArray(ignore?.labels)
          ? ignore.labels.filter(
              (item): item is string => typeof item == "string",
            )
          : [],
        names: Array.isArray(ignore?.names)
          ? ignore.names.filter(
              (item): item is string => typeof item == "string",
            )
          : [],
        locations: Array.isArray(ignore?.locations)
          ? ignore.locations.filter(
              (item): item is string => typeof item == "string",
            )
          : [],
        snippets: Array.isArray(ignore?.snippets)
          ? ignore.snippets.filter(
              (item): item is string => typeof item == "string",
            )
          : [],
      },
    };
  }
  return {
    enabled: false,
    mode: "project",
    includeSpecs: false,
    dependencies: [],
    include: [],
    exclude: [],
    ignore: {
      labels: [],
      names: [],
      locations: [],
      snippets: [],
    },
  };
}

function isIgnoredCoveragePoint(
  point: {
    file: string;
    line: number;
    column: number;
    type: string;
  },
  coverage: CoverageOptions,
): boolean {
  const ignore = coverage.ignore;
  if (
    !ignore.labels.length &&
    !ignore.names.length &&
    !ignore.locations.length &&
    !ignore.snippets.length
  ) {
    return false;
  }

  const info = describeCoveragePoint(
    point.file,
    point.line,
    point.column,
    point.type,
  );
  const location = `${point.file.replace(/\\/g, "/")}:${point.line}:${point.column}`;
  const label = info.displayType.toLowerCase();
  const name = info.subjectName?.toLowerCase() ?? "";
  const snippet = info.visible.toLowerCase();

  if (
    ignore.labels.some((pattern) =>
      matchesCoverageTextPattern(label, pattern.toLowerCase()),
    )
  ) {
    return true;
  }
  if (
    name.length &&
    ignore.names.some((pattern) =>
      matchesCoverageTextPattern(name, pattern.toLowerCase()),
    )
  ) {
    return true;
  }
  if (
    ignore.locations.some((pattern) =>
      matchesCoverageTextPattern(location, pattern.replace(/\\/g, "/")),
    )
  ) {
    return true;
  }
  if (
    snippet.length &&
    ignore.snippets.some((pattern) =>
      matchesCoverageTextPattern(snippet, pattern.toLowerCase()),
    )
  ) {
    return true;
  }

  return false;
}

function matchesCoverageTextPattern(value: string, pattern: string): boolean {
  const normalized = pattern.trim();
  if (!normalized.length) return false;
  return globPatternToRegExp(normalized).test(value);
}

function compareCoveragePoints(
  a: {
    hash: string;
    file: string;
    line: number;
    column: number;
    type: string;
    executed: boolean;
    depth?: number;
  },
  b: {
    hash: string;
    file: string;
    line: number;
    column: number;
    type: string;
    executed: boolean;
    depth?: number;
  },
): number {
  const depthA = a.depth ?? 0;
  const depthB = b.depth ?? 0;
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  if (depthA !== depthB) return depthA - depthB;
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  return a.hash.localeCompare(b.hash);
}

async function runProcess(
  invocation: RuntimeInvocation,
  specFile: string,
  crashDir: string,
  crashEntryKey: string,
  modeName: string | undefined,
  snapshots: SnapshotStore,
  snapshotEnabled: boolean,
  createSnapshots: boolean,
  overwriteSnapshots: boolean,
  renderer: TestRenderer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<any> {
  const child = spawn(invocation.command, invocation.args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    env,
  });
  let report: any = null;
  let parseError: string | null = null;
  let stderrBuffer = "";
  let stderrPendingLine = "";
  let stdoutBuffer = "";
  let spawnError: Error | null = null;
  let sawChannelClose = false;
  const runtimeEvents = {
    sawFileStart: false,
    sawFileEnd: false,
    fileName: formatSpecDisplayPath(specFile),
    fileVerdict: "none",
    fileTime: "",
    suiteStarts: 0,
    suiteEnds: 0,
    assertionFails: 0,
    warnings: 0,
    logs: 0,
  };
  const reportStream = {
    dataFrames: 0,
    dataBytes: 0,
    sawChunkStart: false,
    sawChunkEnd: false,
    chunkCountExpected: 0,
    chunkBytesExpected: 0,
    chunkTotalBytesExpected: 0,
    chunkFramesReceived: 0,
    chunkBytesReceived: 0,
    chunks: [] as Buffer[],
  };

  child.on("error", (error) => {
    spawnError = error;
  });

  child.stderr.on("data", (chunk) => {
    stderrPendingLine += chunk.toString("utf8");
    let newline = stderrPendingLine.indexOf("\n");
    while (newline >= 0) {
      const line = stderrPendingLine.slice(0, newline + 1);
      stderrPendingLine = stderrPendingLine.slice(newline + 1);
      if (!shouldSuppressWasiWarningLine(line)) {
        stderrBuffer += line;
      }
      newline = stderrPendingLine.indexOf("\n");
    }
  });

  class TestChannel extends Channel {
    protected onPassthrough(data: Buffer): void {
      stdoutBuffer += data.toString("utf8");
      process.stdout.write(data);
    }

    protected onCall(msg: unknown): void {
      const event = msg as Record<string, unknown>;
      const kind = String(event.kind ?? "");
      if (kind === "event:assert-fail") {
        runtimeEvents.assertionFails++;
        renderer.onAssertionFail({
          key: String(event.key ?? ""),
          instr: String(event.instr ?? ""),
          left: String(event.left ?? ""),
          right: String(event.right ?? ""),
          message: String(event.message ?? ""),
        });
        return;
      }
      if (kind === "event:file-start") {
        runtimeEvents.sawFileStart = true;
        runtimeEvents.fileName = String(event.file ?? runtimeEvents.fileName);
        renderer.onFileStart({
          file: String(event.file ?? "unknown"),
          depth: 0,
          suiteKind: "file",
          description: String(event.file ?? "unknown"),
        });
        return;
      }
      if (kind === "event:file-end") {
        runtimeEvents.sawFileEnd = true;
        runtimeEvents.fileName = String(event.file ?? runtimeEvents.fileName);
        runtimeEvents.fileVerdict = String(event.verdict ?? "none");
        runtimeEvents.fileTime = String(event.time ?? "");
        renderer.onFileEnd({
          file: String(event.file ?? "unknown"),
          depth: 0,
          suiteKind: "file",
          description: String(event.file ?? "unknown"),
          verdict: String(event.verdict ?? "none"),
          time: String(event.time ?? ""),
        });
        return;
      }
      if (kind === "event:suite-start") {
        runtimeEvents.suiteStarts++;
        renderer.onSuiteStart({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          suiteKind: String(event.suiteKind ?? ""),
          description: String(event.description ?? ""),
        });
        return;
      }
      if (kind === "event:suite-end") {
        runtimeEvents.suiteEnds++;
        renderer.onSuiteEnd({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          suiteKind: String(event.suiteKind ?? ""),
          description: String(event.description ?? ""),
          verdict: String(event.verdict ?? "none"),
        });
        return;
      }
      if (kind === "event:warn") {
        runtimeEvents.warnings++;
        renderer.onWarning({
          message: String(event.message ?? ""),
        });
        return;
      }
      if (kind === "event:log") {
        runtimeEvents.logs++;
        renderer.onLog({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          text: String(event.text ?? ""),
        });
        return;
      }
      if (kind === "snapshot:assert") {
        const key = String(event.key ?? "");
        const actual = String(event.actual ?? "");
        const result = snapshots.assert(
          key,
          actual,
          snapshotEnabled,
          createSnapshots,
          overwriteSnapshots,
        );
        if (result.warnMissing) {
          renderer.onSnapshotMissing({ key });
        }
        this.send(
          MessageType.CALL,
          Buffer.from(`${result.ok ? "1" : "0"}\n${result.expected}`, "utf8"),
        );
        return;
      }
      if (kind === "report:start") {
        reportStream.sawChunkStart = true;
        reportStream.sawChunkEnd = false;
        reportStream.chunkCountExpected = Number(event.chunkCount ?? 0);
        reportStream.chunkBytesExpected = Number(event.chunkBytes ?? 0);
        reportStream.chunkTotalBytesExpected = Number(event.totalBytes ?? 0);
        reportStream.chunkFramesReceived = 0;
        reportStream.chunkBytesReceived = 0;
        reportStream.chunks = [];
        return;
      }
      if (kind === "report:end") {
        reportStream.sawChunkEnd = true;
        return;
      }
      this.sendJSON(MessageType.CALL, { ok: true, expected: "" });
    }

    protected onDataMessage(data: Buffer): void {
      reportStream.dataFrames++;
      reportStream.dataBytes += data.length;
      if (reportStream.sawChunkStart && !reportStream.sawChunkEnd) {
        reportStream.chunkFramesReceived++;
        reportStream.chunkBytesReceived += data.length;
        reportStream.chunks.push(Buffer.from(data));
        return;
      }
      try {
        report = JSON.parse(data.toString("utf8"));
        parseError = null;
      } catch (error) {
        parseError = String(error);
      }
    }

    protected onClose(): void {
      sawChannelClose = true;
    }
  }

  const _channel = new TestChannel(child.stdout!, child.stdin!);

  const code = await new Promise<number>((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
  if (
    stderrPendingLine.length &&
    !shouldSuppressWasiWarningLine(stderrPendingLine)
  ) {
    stderrBuffer += stderrPendingLine;
  }
  const processSpawnError = spawnError as Error | null;
  if (processSpawnError) {
    const errorText = processSpawnError.stack ?? processSpawnError.message;
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      entryKey: crashEntryKey,
      mode: modeName ?? "default",
      error: errorText,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    return createRuntimeFailureReport(
      specFile,
      modeName,
      "failed to start test runtime",
      errorText,
      stdoutBuffer,
      stderrBuffer,
    );
  }

  if (reportStream.sawChunkStart) {
    if (!reportStream.sawChunkEnd) {
      parseError =
        parseError ?? "missing report:end marker for chunked report payload";
    } else {
      const chunkedPayload = Buffer.concat(reportStream.chunks).toString(
        "utf8",
      );
      try {
        report = JSON.parse(chunkedPayload);
        parseError = null;
      } catch (error) {
        parseError = `could not parse chunked report payload: ${String(error)}`;
      }
      if (
        reportStream.chunkCountExpected > 0 &&
        reportStream.chunkFramesReceived !== reportStream.chunkCountExpected
      ) {
        parseError =
          parseError ??
          `chunk count mismatch: expected ${reportStream.chunkCountExpected}, received ${reportStream.chunkFramesReceived}`;
      }
      if (
        reportStream.chunkTotalBytesExpected > 0 &&
        reportStream.chunkBytesReceived !== reportStream.chunkTotalBytesExpected
      ) {
        parseError =
          parseError ??
          `chunk size mismatch: expected ${reportStream.chunkTotalBytesExpected} bytes, received ${reportStream.chunkBytesReceived}`;
      }
    }
  }

  if (parseError) {
    const errorText = `could not parse report payload: ${parseError}`;
    const diagnostics = buildRuntimeReportDiagnostics(
      code,
      sawChannelClose,
      reportStream,
      runtimeEvents,
    );
    const fullError = `${errorText}\n${diagnostics}`;
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      entryKey: crashEntryKey,
      mode: modeName ?? "default",
      error: fullError,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    return createRuntimeFailureReport(
      specFile,
      modeName,
      "runtime returned an invalid report payload",
      fullError,
      stdoutBuffer,
      stderrBuffer,
    );
  }
  if (!report) {
    const synthesized = synthesizeReportFromRuntimeEvents(
      specFile,
      runtimeEvents,
    );
    if (synthesized) {
      const exitedEarly = !runtimeEvents.sawFileEnd;
      if (
        exitedEarly ||
        code !== 0 ||
        hasMeaningfulRuntimeOutput(stderrBuffer)
      ) {
        const errorParts: string[] = [];
        if (code !== 0) {
          errorParts.push(`child process exited with code ${code}`);
        } else if (exitedEarly) {
          errorParts.push(
            "test runtime exited before reporting file completion",
          );
        }
        const stderrText = normalizeRuntimeOutput(stderrBuffer);
        if (stderrText.length) {
          errorParts.push(stderrText);
        }
        const diagnostics = buildRuntimeReportDiagnostics(
          code,
          sawChannelClose,
          reportStream,
          runtimeEvents,
        );
        errorParts.push(diagnostics);
        const errorText = errorParts.join("\n\n");
        persistCrashRecord(crashDir, {
          kind: "test",
          file: specFile,
          entryKey: crashEntryKey,
          mode: modeName ?? "default",
          error: errorText || "runtime reported an unknown error",
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
        return appendRuntimeFailureReport(
          synthesized,
          specFile,
          modeName,
          code !== 0
            ? `test runtime failed with exit code ${code}`
            : exitedEarly
              ? "test runtime exited before completing the test file"
              : "test runtime wrote to stderr",
          errorText,
          stdoutBuffer,
          stderrBuffer,
        );
      }
      renderer.onWarning({
        message:
          "runtime report payload missing; reconstructed result from streamed lifecycle events",
      });
      return synthesized;
    }
    // A spec file with no test suites never calls `run()`, so it emits no
    // lifecycle frames and exits cleanly. That is an empty test file, not a
    // crash — mark it skipped instead of surfacing "missing report payload".
    if (
      code === 0 &&
      reportStream.dataFrames === 0 &&
      !runtimeEvents.sawFileStart &&
      !runtimeEvents.sawFileEnd &&
      runtimeEvents.suiteStarts === 0 &&
      !hasMeaningfulRuntimeOutput(stderrBuffer)
    ) {
      renderer.onWarning({
        message: `${formatSpecDisplayPath(specFile)} contains no tests; marked as skipped`,
      });
      return createEmptyFileSkipReport(specFile, modeName);
    }
    const errorText = "missing report payload from test runtime";
    const diagnostics = buildRuntimeReportDiagnostics(
      code,
      sawChannelClose,
      reportStream,
      runtimeEvents,
    );
    const fullError = `${errorText}\n${diagnostics}`;
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      entryKey: crashEntryKey,
      mode: modeName ?? "default",
      error: fullError,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    return createRuntimeFailureReport(
      specFile,
      modeName,
      "test runtime exited without sending a report",
      fullError,
      stdoutBuffer,
      stderrBuffer,
    );
  }
  if (code !== 0 || hasMeaningfulRuntimeOutput(stderrBuffer)) {
    const errorParts: string[] = [];
    if (code !== 0) {
      errorParts.push(`child process exited with code ${code}`);
    }
    const stderrText = normalizeRuntimeOutput(stderrBuffer);
    if (stderrText.length) {
      errorParts.push(stderrText);
    }
    const errorText = errorParts.join("\n\n");
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      entryKey: crashEntryKey,
      mode: modeName ?? "default",
      error: errorText || "runtime reported an unknown error",
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    return appendRuntimeFailureReport(
      report,
      specFile,
      modeName,
      code !== 0
        ? `test runtime failed with exit code ${code}`
        : "test runtime wrote to stderr",
      errorText,
      stdoutBuffer,
      stderrBuffer,
    );
  }
  return report;
}

async function runWebSessionProcess(
  session: PersistentWebSessionHost,
  specFile: string,
  crashDir: string,
  crashEntryKey: string,
  modeName: string | undefined,
  snapshots: SnapshotStore,
  snapshotEnabled: boolean,
  createSnapshots: boolean,
  overwriteSnapshots: boolean,
  renderer: TestRenderer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<any> {
  const input = new PassThrough();
  const output = new PassThrough();
  let report: any = null;
  let parseError: string | null = null;
  let stderrBuffer = "";
  let stdoutBuffer = "";
  let sawChannelClose = false;
  const runtimeEvents = {
    sawFileStart: false,
    sawFileEnd: false,
    fileName: formatSpecDisplayPath(specFile),
    fileVerdict: "none",
    fileTime: "",
    suiteStarts: 0,
    suiteEnds: 0,
    assertionFails: 0,
    warnings: 0,
    logs: 0,
  };
  const reportStream = {
    dataFrames: 0,
    dataBytes: 0,
    sawChunkStart: false,
    sawChunkEnd: false,
    chunkCountExpected: 0,
    chunkBytesExpected: 0,
    chunkTotalBytesExpected: 0,
    chunkFramesReceived: 0,
    chunkBytesReceived: 0,
    chunks: [] as Buffer[],
  };

  class TestChannel extends Channel {
    protected onPassthrough(data: Buffer): void {
      stdoutBuffer += data.toString("utf8");
      process.stdout.write(data);
    }

    protected onCall(msg: unknown): void {
      const event = msg as Record<string, unknown>;
      const kind = String(event.kind ?? "");
      if (kind === "event:assert-fail") {
        runtimeEvents.assertionFails++;
        renderer.onAssertionFail({
          key: String(event.key ?? ""),
          instr: String(event.instr ?? ""),
          left: String(event.left ?? ""),
          right: String(event.right ?? ""),
          message: String(event.message ?? ""),
        });
        return;
      }
      if (kind === "event:file-start") {
        runtimeEvents.sawFileStart = true;
        runtimeEvents.fileName = String(event.file ?? runtimeEvents.fileName);
        renderer.onFileStart({
          file: String(event.file ?? "unknown"),
          depth: 0,
          suiteKind: "file",
          description: String(event.file ?? "unknown"),
        });
        return;
      }
      if (kind === "event:file-end") {
        runtimeEvents.sawFileEnd = true;
        runtimeEvents.fileName = String(event.file ?? runtimeEvents.fileName);
        runtimeEvents.fileVerdict = String(event.verdict ?? "none");
        runtimeEvents.fileTime = String(event.time ?? "");
        renderer.onFileEnd({
          file: String(event.file ?? "unknown"),
          depth: 0,
          suiteKind: "file",
          description: String(event.file ?? "unknown"),
          verdict: String(event.verdict ?? "none"),
          time: String(event.time ?? ""),
        });
        return;
      }
      if (kind === "event:suite-start") {
        runtimeEvents.suiteStarts++;
        renderer.onSuiteStart({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          suiteKind: String(event.suiteKind ?? ""),
          description: String(event.description ?? ""),
        });
        return;
      }
      if (kind === "event:suite-end") {
        runtimeEvents.suiteEnds++;
        renderer.onSuiteEnd({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          suiteKind: String(event.suiteKind ?? ""),
          description: String(event.description ?? ""),
          verdict: String(event.verdict ?? "none"),
        });
        return;
      }
      if (kind === "event:warn") {
        runtimeEvents.warnings++;
        renderer.onWarning({
          message: String(event.message ?? ""),
        });
        return;
      }
      if (kind === "event:log") {
        runtimeEvents.logs++;
        renderer.onLog({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          text: String(event.text ?? ""),
        });
        return;
      }
      if (kind === "snapshot:assert") {
        const key = String(event.key ?? "");
        const actual = String(event.actual ?? "");
        const result = snapshots.assert(
          key,
          actual,
          snapshotEnabled,
          createSnapshots,
          overwriteSnapshots,
        );
        if (result.warnMissing) {
          renderer.onSnapshotMissing({ key });
        }
        this.send(
          MessageType.CALL,
          Buffer.from(`${result.ok ? "1" : "0"}\n${result.expected}`, "utf8"),
        );
        return;
      }
      if (kind === "report:start") {
        reportStream.sawChunkStart = true;
        reportStream.sawChunkEnd = false;
        reportStream.chunkCountExpected = Number(event.chunkCount ?? 0);
        reportStream.chunkBytesExpected = Number(event.chunkBytes ?? 0);
        reportStream.chunkTotalBytesExpected = Number(event.totalBytes ?? 0);
        reportStream.chunkFramesReceived = 0;
        reportStream.chunkBytesReceived = 0;
        reportStream.chunks = [];
        return;
      }
      if (kind === "report:end") {
        reportStream.sawChunkEnd = true;
        return;
      }
      this.sendJSON(MessageType.CALL, { ok: true, expected: "" });
    }

    protected onDataMessage(data: Buffer): void {
      reportStream.dataFrames++;
      reportStream.dataBytes += data.length;
      if (reportStream.sawChunkStart && !reportStream.sawChunkEnd) {
        reportStream.chunkFramesReceived++;
        reportStream.chunkBytesReceived += data.length;
        reportStream.chunks.push(Buffer.from(data));
        return;
      }
      try {
        report = JSON.parse(data.toString("utf8"));
        parseError = null;
      } catch (error) {
        parseError = String(error);
      }
    }

    protected onClose(): void {
      sawChannelClose = true;
    }
  }

  const channel = new TestChannel(input, output);
  output.on("data", (chunk) => {
    session.sendReply(Buffer.from(chunk as Buffer));
  });

  let code = 0;
  try {
    await session.runJob(
      Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] == "string",
        ),
      ),
      formatSpecDisplayPath(specFile),
      (frame) => {
        input.write(frame);
      },
    );
  } catch (error) {
    code = 1;
    await session.close(
      error instanceof Error ? error : new Error(String(error)),
    );
    stderrBuffer +=
      (error instanceof Error
        ? (error.stack ?? error.message)
        : String(error)) + "\n";
  } finally {
    input.end();
    output.end();
  }

  if (reportStream.sawChunkStart) {
    if (!reportStream.sawChunkEnd) {
      parseError =
        parseError ?? "missing report:end marker for chunked report payload";
    } else {
      const chunkedPayload = Buffer.concat(reportStream.chunks).toString(
        "utf8",
      );
      try {
        report = JSON.parse(chunkedPayload);
        parseError = null;
      } catch (error) {
        parseError = `could not parse chunked report payload: ${String(error)}`;
      }
      if (
        reportStream.chunkCountExpected > 0 &&
        reportStream.chunkFramesReceived !== reportStream.chunkCountExpected
      ) {
        parseError =
          parseError ??
          `chunk count mismatch: expected ${reportStream.chunkCountExpected}, received ${reportStream.chunkFramesReceived}`;
      }
      if (
        reportStream.chunkTotalBytesExpected > 0 &&
        reportStream.chunkBytesReceived !== reportStream.chunkTotalBytesExpected
      ) {
        parseError =
          parseError ??
          `chunk size mismatch: expected ${reportStream.chunkTotalBytesExpected} bytes, received ${reportStream.chunkBytesReceived}`;
      }
    }
  }

  if (parseError) {
    const errorText = `could not parse report payload: ${parseError}`;
    const diagnostics = buildRuntimeReportDiagnostics(
      code,
      sawChannelClose,
      reportStream,
      runtimeEvents,
    );
    const fullError = `${errorText}\n${diagnostics}`;
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      entryKey: crashEntryKey,
      mode: modeName ?? "default",
      error: fullError,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    return createRuntimeFailureReport(
      specFile,
      modeName,
      "runtime returned an invalid report payload",
      fullError,
      stdoutBuffer,
      stderrBuffer,
    );
  }
  if (!report) {
    const synthesized = synthesizeReportFromRuntimeEvents(
      specFile,
      runtimeEvents,
    );
    if (synthesized) {
      const exitedEarly = !runtimeEvents.sawFileEnd;
      if (
        exitedEarly ||
        code !== 0 ||
        hasMeaningfulRuntimeOutput(stderrBuffer)
      ) {
        const errorParts: string[] = [];
        if (code !== 0) {
          errorParts.push(`child process exited with code ${code}`);
        } else if (exitedEarly) {
          errorParts.push(
            "test runtime exited before reporting file completion",
          );
        }
        const stderrText = normalizeRuntimeOutput(stderrBuffer);
        if (stderrText.length) {
          errorParts.push(stderrText);
        }
        const diagnostics = buildRuntimeReportDiagnostics(
          code,
          sawChannelClose,
          reportStream,
          runtimeEvents,
        );
        errorParts.push(diagnostics);
        const errorText = errorParts.join("\n\n");
        persistCrashRecord(crashDir, {
          kind: "test",
          file: specFile,
          entryKey: crashEntryKey,
          mode: modeName ?? "default",
          error: errorText || "runtime reported an unknown error",
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
        return appendRuntimeFailureReport(
          synthesized,
          specFile,
          modeName,
          code !== 0
            ? `test runtime failed with exit code ${code}`
            : exitedEarly
              ? "test runtime exited before completing the test file"
              : "test runtime wrote to stderr",
          errorText,
          stdoutBuffer,
          stderrBuffer,
        );
      }
      renderer.onWarning({
        message:
          "runtime report payload missing; reconstructed result from streamed lifecycle events",
      });
      return synthesized;
    }
    const diagnostics = buildRuntimeReportDiagnostics(
      code,
      sawChannelClose,
      reportStream,
      runtimeEvents,
    );
    const fullError = `missing report payload from test runtime\n${diagnostics}`;
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      entryKey: crashEntryKey,
      mode: modeName ?? "default",
      error: fullError,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    return createRuntimeFailureReport(
      specFile,
      modeName,
      "missing report payload from test runtime",
      fullError,
      stdoutBuffer,
      stderrBuffer,
    );
  }
  if (code != 0 || hasMeaningfulRuntimeOutput(stderrBuffer)) {
    const diagnostics = buildRuntimeReportDiagnostics(
      code,
      sawChannelClose,
      reportStream,
      runtimeEvents,
    );
    renderer.onWarning({
      message: [
        code !== 0 ? `child process exited with code ${code}` : "",
        normalizeRuntimeOutput(stderrBuffer),
        diagnostics,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  return report;
}

function synthesizeReportFromRuntimeEvents(
  specFile: string,
  runtimeEvents: {
    sawFileStart: boolean;
    sawFileEnd: boolean;
    fileName: string;
    fileVerdict: string;
    fileTime: string;
    suiteStarts: number;
    suiteEnds: number;
    assertionFails: number;
    warnings: number;
    logs: number;
  },
): any | null {
  if (
    !runtimeEvents.sawFileEnd &&
    runtimeEvents.suiteStarts <= 0 &&
    runtimeEvents.suiteEnds <= 0
  ) {
    return null;
  }
  let verdict = runtimeEvents.fileVerdict;
  if (verdict == "none" && runtimeEvents.assertionFails > 0) {
    verdict = "fail";
  } else if (verdict == "none" && runtimeEvents.sawFileEnd) {
    verdict = "ok";
  }
  return {
    suites: [
      {
        file: specFile,
        description: runtimeEvents.fileName || formatSpecDisplayPath(specFile),
        depth: 0,
        kind: "file",
        verdict,
        time: {
          start: 0,
          end: 0,
        },
        suites: [],
        logs: [],
        tests: [],
      },
    ],
    coverage: {
      total: 0,
      covered: 0,
      uncovered: 0,
      percent: 100,
      points: [],
    },
  };
}

function buildRuntimeReportDiagnostics(
  code: number,
  sawChannelClose: boolean,
  reportStream: {
    dataFrames: number;
    dataBytes: number;
    sawChunkStart: boolean;
    sawChunkEnd: boolean;
    chunkCountExpected: number;
    chunkBytesExpected: number;
    chunkTotalBytesExpected: number;
    chunkFramesReceived: number;
    chunkBytesReceived: number;
  },
  runtimeEvents: {
    sawFileStart: boolean;
    sawFileEnd: boolean;
    fileName: string;
    fileVerdict: string;
    fileTime: string;
    suiteStarts: number;
    suiteEnds: number;
    assertionFails: number;
    warnings: number;
    logs: number;
  },
): string {
  return [
    `runtime diagnostics: exitCode=${code}, channelClose=${sawChannelClose ? "yes" : "no"}`,
    `report stream: dataFrames=${reportStream.dataFrames}, dataBytes=${reportStream.dataBytes}, chunked=${reportStream.sawChunkStart ? "yes" : "no"}, chunkStart=${reportStream.sawChunkStart ? "yes" : "no"}, chunkEnd=${reportStream.sawChunkEnd ? "yes" : "no"}, chunkFrames=${reportStream.chunkFramesReceived}, expectedChunkFrames=${reportStream.chunkCountExpected}, chunkBytes=${reportStream.chunkBytesReceived}, expectedChunkBytes=${reportStream.chunkTotalBytesExpected}`,
    `runtime events: fileStart=${runtimeEvents.sawFileStart ? "yes" : "no"}, fileEnd=${runtimeEvents.sawFileEnd ? "yes" : "no"}, fileVerdict=${runtimeEvents.fileVerdict}, suiteStarts=${runtimeEvents.suiteStarts}, suiteEnds=${runtimeEvents.suiteEnds}, assertionFails=${runtimeEvents.assertionFails}, warnings=${runtimeEvents.warnings}, logs=${runtimeEvents.logs}`,
  ].join("\n");
}

function createEmptyFileSkipReport(
  specFile: string,
  modeName: string | undefined,
): any {
  // No suites: a file with zero suites contributes no skipped-suite count, just
  // a skipped file (an empty `suites` array yields a "none" file verdict, which
  // collectRunStats tallies as a skipped file). The accompanying onWarning tells
  // the user the file had no tests.
  return {
    file: specFile,
    modeName: modeName ?? "default",
    suites: [],
    coverage: {
      total: 0,
      covered: 0,
      uncovered: 0,
      percent: 100,
      points: [],
    },
  };
}

function createRuntimeFailureReport(
  specFile: string,
  modeName: string | undefined,
  title: string,
  details: string,
  stdout: string,
  stderr: string,
): any {
  return appendRuntimeFailureReport(
    {
      suites: [],
      coverage: {
        total: 0,
        covered: 0,
        uncovered: 0,
        percent: 100,
        points: [],
      },
    },
    specFile,
    modeName,
    title,
    details,
    stdout,
    stderr,
  );
}

function appendRuntimeFailureReport(
  report: any,
  specFile: string,
  modeName: string | undefined,
  title: string,
  details: string,
  stdout: string,
  stderr: string,
): any {
  const suites = Array.isArray(report?.suites) ? report.suites : [];
  suites.push({
    file: specFile,
    description: formatSpecDisplayPath(specFile),
    depth: 0,
    kind: "runtime-error",
    verdict: "fail",
    time: {
      start: 0,
      end: 0,
    },
    suites: [],
    logs: [],
    tests: [
      {
        order: 0,
        type: "runtime-error",
        verdict: "fail",
        left: null,
        right: null,
        instr: title,
        message: formatRuntimeFailureMessage(details, stdout, stderr),
        location: "",
      },
    ],
    modeName: modeName ?? "default",
  });
  report.suites = suites;
  return report;
}

function formatRuntimeFailureMessage(
  details: string,
  stdout: string,
  stderr: string,
): string {
  const parts: string[] = [];
  const normalizedDetails = normalizeRuntimeOutput(details);
  const normalizedStderr = normalizeRuntimeOutput(stderr);
  const normalizedStdout = normalizeRuntimeOutput(stdout);
  if (normalizedDetails.length) parts.push(normalizedDetails);
  if (normalizedStderr.length && normalizedStderr !== normalizedDetails) {
    parts.push(`stderr:\n${normalizedStderr}`);
  }
  if (normalizedStdout.length) {
    parts.push(`stdout:\n${normalizedStdout}`);
  }
  return parts.join("\n\n");
}

function normalizeRuntimeOutput(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function hasMeaningfulRuntimeOutput(value: string): boolean {
  return normalizeRuntimeOutput(value).length > 0;
}

function shouldSuppressWasiWarningLine(line: string): boolean {
  if (line.includes("ExperimentalWarning: WASI is an experimental feature")) {
    return true;
  }
  if (line.includes("--trace-warnings")) {
    return true;
  }
  return false;
}

// Drive the reporter from a stored (passing) file report so a replayed spec
// still scrolls past the live display and is counted, exactly as a fresh run
// would render it. Only passing/skipped reports are replayed, so there are no
// assertion failures to re-emit.
function replayCachedReport(
  renderer: TestRenderer,
  file: string,
  suites: any[],
): void {
  renderer.onFileStart({
    file,
    depth: 0,
    suiteKind: "file",
    description: file,
  });
  let verdict = "none";
  for (const suite of suites) {
    verdict = mergeReplayVerdict(
      verdict,
      emitReplaySuite(renderer, file, suite),
    );
  }
  renderer.onFileEnd({
    file,
    depth: 0,
    suiteKind: "file",
    description: file,
    verdict,
    cached: true,
  });
}

function emitReplaySuite(
  renderer: TestRenderer,
  file: string,
  suite: any,
): string {
  const depth = Number(suite?.depth ?? 0);
  const kind = String(suite?.kind ?? "");
  const description = String(suite?.description ?? "");
  renderer.onSuiteStart({ file, depth, suiteKind: kind, description });
  let verdict = String(suite?.verdict ?? "none");
  const subs = Array.isArray(suite?.suites) ? suite.suites : [];
  for (const sub of subs) {
    verdict = mergeReplayVerdict(verdict, emitReplaySuite(renderer, file, sub));
  }
  renderer.onSuiteEnd({
    file,
    depth,
    suiteKind: kind,
    description,
    verdict: String(suite?.verdict ?? verdict),
  });
  return verdict;
}

function mergeReplayVerdict(a: string, b: string): string {
  if (a === "fail" || b === "fail") return "fail";
  if (a === "ok" || b === "ok") return "ok";
  if (a === "skip" || b === "skip") return "skip";
  return "none";
}

function collectRunStats(reports: unknown[]): RunStats {
  const stats: RunStats = {
    passedFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    passedSuites: 0,
    failedSuites: 0,
    skippedSuites: 0,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    time: 0.0,
    failedEntries: [],
  };

  for (const fileReport of reports) {
    readFileReport(stats, fileReport);
  }
  return stats;
}

function readFileReport(stats: RunStats, fileReport: unknown): void {
  const fileReportAny = fileReport as Record<string, unknown>;
  const suites = Array.isArray(fileReportAny.suites)
    ? (fileReportAny.suites as unknown[])
    : Array.isArray(fileReport)
      ? (fileReport as unknown[])
      : [];
  const file = String(fileReportAny.file ?? "");
  const modeName = String(fileReportAny.modeName ?? "");
  const runCommand = String(fileReportAny.runCommand ?? "");
  const buildCommand = String(fileReportAny.buildCommand ?? "");
  let fileVerdict: Verdict = "none";
  for (const suite of suites) {
    const suiteVerdict = readSuite(
      stats,
      suite,
      file,
      modeName,
      runCommand,
      buildCommand,
    );
    fileVerdict = mergeVerdict(fileVerdict, suiteVerdict);
    // Record each failed top-level suite once. The failure summary recurses into
    // it to find every failed assertion (so nested failures aren't pushed again,
    // and a top-level it()/test() failure is captured too).
    if (suiteVerdict == "fail") {
      stats.failedEntries.push({
        ...(suite as Record<string, unknown>),
        file,
        modeName,
        runCommand,
        buildCommand,
      });
    }
  }
  if (fileVerdict == "fail") {
    stats.failedFiles++;
  } else if (fileVerdict == "ok") {
    stats.passedFiles++;
  } else {
    stats.skippedFiles++;
  }
}

function readSuite(
  stats: RunStats,
  suite: unknown,
  file: string,
  modeName: string,
  runCommand: string,
  buildCommand: string,
): Verdict {
  const suiteAny = suite as Record<string, unknown>;
  let verdict = normalizeVerdict(suiteAny.verdict);

  const time = suiteAny.time as Record<string, unknown> | undefined;
  const start = Number(time?.start ?? 0);
  const end = Number(time?.end ?? 0);
  stats.time += end - start;

  const subSuites = Array.isArray(suiteAny.suites)
    ? (suiteAny.suites as unknown[])
    : [];
  for (const subSuite of subSuites) {
    verdict = mergeVerdict(
      verdict,
      readSuite(stats, subSuite, file, modeName, runCommand, buildCommand),
    );
  }

  const tests = Array.isArray(suiteAny.tests)
    ? (suiteAny.tests as Record<string, unknown>[])
    : [];
  for (const test of tests) {
    const testVerdict = normalizeVerdict(test.verdict);
    verdict = mergeVerdict(verdict, testVerdict);
    if (testVerdict == "fail") {
      stats.failedTests++;
    } else if (testVerdict == "ok") {
      stats.passedTests++;
    } else {
      stats.skippedTests++;
    }
  }

  // Every grouping block — describe, test, it, only and their skip variants —
  // is a suite; the expect() assertions counted above are the tests. (Failed
  // entries for the summary are collected per top-level suite in readFileReport.)
  if (verdict == "fail") {
    stats.failedSuites++;
  } else if (verdict == "ok") {
    stats.passedSuites++;
  } else {
    stats.skippedSuites++;
  }
  return verdict;
}

type Verdict = "fail" | "ok" | "skip" | "none";

function normalizeVerdict(value: unknown): Verdict {
  const verdict = String(value ?? "none");
  if (verdict == "fail") return "fail";
  if (verdict == "ok") return "ok";
  if (verdict == "skip") return "skip";
  return "none";
}

function mergeVerdict(current: Verdict, next: Verdict): Verdict {
  if (current == "fail" || next == "fail") return "fail";
  if (current == "ok" || next == "ok") return "ok";
  if (current == "skip" || next == "skip") return "skip";
  return "none";
}

// The CLI's single built-in renderer. Resolves config (for the mode-aware
// runtime name) and hands back a fresh TestRenderer bound to the given streams.
// `context` lets callers redirect output to a buffer for parallel runs.
export function createRenderer(
  configPath: string = DEFAULT_CONFIG_PATH,
  modeName?: string,
  context: RenderContext = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): {
  renderer: TestRenderer;
  runtimeName: string;
  resolvedConfigPath: string;
} {
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  const loadedConfig = loadConfig(resolvedConfigPath);
  const mode = applyMode(loadedConfig, modeName);
  const config = mode.config;
  const runtimeCommand = resolveRuntimeCommand(
    getConfiguredRuntimeCmd(config),
    config.buildOptions.target,
    false,
  );
  return {
    renderer: new TestRenderer(context),
    runtimeName: runtimeNameFromCommand(runtimeCommand),
    resolvedConfigPath,
  };
}

export const __coverageInternals = {
  classifyCoverageFile,
  resolveCoverageDependencyPackage,
  isIgnoredCoverageFile,
  resolveCoverageOptions,
};

// Exposed for integration tests so suite selection can be exercised against
// plain suite trees without compiling a spec.
export const __suiteSelectionInternals = {
  filterSelectedSuites,
};
