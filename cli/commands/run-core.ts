import chalk from "chalk";
import { spawn } from "child_process";
import { glob } from "glob";
import { Channel, MessageType } from "../wipc.js";
import {
  applyMode,
  formatTime,
  getExec,
  loadConfig,
  tokenizeCommand,
} from "../util.js";
import * as path from "path";
import { pathToFileURL } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { buildWebRunnerSource } from "./web-runner-source.js";
import type { BuildInvocation } from "./build-core.js";
import {
  CoverageSummary,
  ReporterContext,
  ReporterFactory,
  RunStats,
  TestReporter,
} from "../reporters/types.js";
import { createReporter as createDefaultReporter } from "../reporters/default.js";
import { createTapReporter } from "../reporters/tap.js";
import type { TapReporterConfig } from "../reporters/tap.js";
import { persistCrashRecord } from "../crash-store.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");

type RunFlags = {
  snapshot?: boolean;
  createSnapshots?: boolean;
  overwriteSnapshots?: boolean;
  clean?: boolean;
  showCoverage?: boolean;
  verbose?: boolean;
  coverage?: boolean;
};

type RunExecutionOptions = {
  reporter?: TestReporter;
  reporterKind?: ReporterKind;
  reporterPath?: string;
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

type RuntimeInvocation = {
  command: string;
  args: string[];
};

type ReporterKind = "default" | "tap" | "custom";
type ReporterConfigObject = {
  name?: unknown;
  options?: unknown;
  outDir?: unknown;
  outFile?: unknown;
};

export type RunResult = {
  failed: boolean;
  stats: RunStats;
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
    snapshotSummary: {
      matched: number;
      created: number;
      updated: number;
      failed: number;
    };
  }[];
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
  }[];
};

type CoverageOptions = {
  enabled: boolean;
  includeSpecs: boolean;
  include: string[];
  exclude: string[];
};

type SnapshotReply = {
  ok: boolean;
  expected: string;
  warnMissing: boolean;
};

class SnapshotStore {
  private readonly filePath: string;
  private readonly data: Record<string, string>;
  private readonly preamble: string;
  private readonly existed: boolean;
  private dirty = false;
  public created = 0;
  public updated = 0;
  public matched = 0;
  public failed = 0;
  private warnedMissing = new Set<string>();

  constructor(
    specFile: string,
    snapshotDir: string,
    duplicateSpecBasenames: Set<string> = new Set<string>(),
  ) {
    const dir = path.join(process.cwd(), snapshotDir);
    const relative = resolveArtifactRelativePath(specFile, "__tests__").replace(
      /\.ts$/,
      ".snap",
    );
    this.filePath = path.join(dir, relative);
    const sourcePath =
      resolveSnapshotSourcePath(
        specFile,
        dir,
        duplicateSpecBasenames,
        this.filePath,
      ) ?? null;
    const loaded = sourcePath
      ? readSnapshotFile(sourcePath, specFile)
      : { data: {}, normalized: false, preamble: "" };
    this.data = loaded.data;
    this.preamble = loaded.preamble;
    this.existed = Boolean(sourcePath && existsSync(sourcePath));
    this.dirty = Boolean(
      (sourcePath && sourcePath != this.filePath) || loaded.normalized,
    );
  }

  assert(
    key: string,
    actual: string,
    allowSnapshot: boolean,
    createSnapshots: boolean,
    overwriteSnapshots: boolean,
  ): SnapshotReply {
    key = canonicalizeSnapshotKey(key);
    if (!allowSnapshot)
      return { ok: true, expected: actual, warnMissing: false };
    if (!(key in this.data)) {
      if (!createSnapshots) {
        this.failed++;
        const warnMissing = !this.warnedMissing.has(key);
        if (warnMissing) this.warnedMissing.add(key);
        return {
          ok: false,
          expected: JSON.stringify("<missing snapshot>"),
          warnMissing,
        };
      }
      this.created++;
      this.dirty = true;
      this.data[key] = actual;
      return { ok: true, expected: actual, warnMissing: false };
    }
    const expected = this.data[key]!;
    if (expected === actual) {
      this.matched++;
      return { ok: true, expected, warnMissing: false };
    }
    if (!overwriteSnapshots) {
      this.failed++;
      return { ok: false, expected, warnMissing: false };
    }
    this.updated++;
    this.dirty = true;
    this.data[key] = actual;
    return { ok: true, expected: actual, warnMissing: false };
  }

  flush(): void {
    if (!this.dirty) return;
    const outDir = path.dirname(this.filePath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(
      this.filePath,
      formatSnapshotFile(
        this.data,
        this.filePath,
        this.existed ? this.preamble : defaultSnapshotPreamble(),
      ),
    );
  }
}

function resolveSnapshotSourcePath(
  specFile: string,
  snapshotDir: string,
  duplicateSpecBasenames: Set<string>,
  preferredPath: string,
): string | null {
  if (existsSync(preferredPath)) return preferredPath;
  const base = path.basename(specFile, ".ts");
  const legacyFlat = path.join(snapshotDir, `${base}.snap.json`);
  if (existsSync(legacyFlat)) return legacyFlat;
  const disambiguator = resolveDisambiguator(specFile, duplicateSpecBasenames);
  if (disambiguator.length) {
    const legacyDisambiguated = path.join(
      snapshotDir,
      `${base}.${disambiguator}.snap.json`,
    );
    if (existsSync(legacyDisambiguated)) return legacyDisambiguated;
  }
  return null;
}

function readSnapshotFile(
  filePath: string,
  specFile: string,
): { data: Record<string, string>; normalized: boolean; preamble: string } {
  const raw = readFileSync(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const normalized = normalizeSnapshotRecord(
      JSON.parse(raw) as Record<string, string>,
    );
    return { ...normalized, preamble: "" };
  }
  return parseSnapshotText(raw, specFile);
}

function parseSnapshotText(
  source: string,
  specFile: string,
): { data: Record<string, string>; normalized: boolean; preamble: string } {
  const out: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  let i = 0;
  let normalized = false;
  const preambleLines: string[] = [];
  while (i < lines.length) {
    const header = lines[i] ?? "";
    if (isSnapshotOuterComment(header) || !header.length) {
      if (!Object.keys(out).length) preambleLines.push(header);
      i++;
      continue;
    }
    const match = header.match(/^=== (.+) ===$/);
    if (!match) {
      i++;
      continue;
    }
    const localKey = match[1]!;
    i++;
    let value = "";
    if ((lines[i] ?? "") == "<<<") {
      i++;
      const block: string[] = [];
      while (i < lines.length && (lines[i] ?? "") != ">>>") {
        block.push(lines[i] ?? "");
        i++;
      }
      value = block.join("\n");
      if ((lines[i] ?? "") == ">>>") i++;
    } else {
      value = lines[i] ?? "";
      i++;
    }
    while (i < lines.length && !(lines[i] ?? "").startsWith("=== ")) {
      if (!lines[i]?.length || isSnapshotOuterComment(lines[i] ?? "")) {
        i++;
        continue;
      }
      break;
    }
    while (i < lines.length && isSnapshotOuterComment(lines[i] ?? "")) {
      i++;
    }
    const qualified = qualifySnapshotKey(specFile, localKey);
    const canonical = canonicalizeSnapshotKey(qualified);
    if (canonical != qualified) normalized = true;
    out[canonical] = value;
  }
  return {
    data: out,
    normalized,
    preamble: trimSnapshotPreamble(preambleLines),
  };
}

function normalizeSnapshotRecord(data: Record<string, string>): {
  data: Record<string, string>;
  normalized: boolean;
} {
  const out: Record<string, string> = {};
  let normalized = false;
  for (const [key, value] of Object.entries(data)) {
    const canonical = canonicalizeSnapshotKey(key);
    if (canonical != key) normalized = true;
    out[canonical] = value;
  }
  return { data: out, normalized };
}

function isSnapshotOuterComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("#") || trimmed.startsWith("//");
}

function formatSnapshotFile(
  data: Record<string, string>,
  filePath: string,
  preamble: string,
): string {
  const specFile = resolveSnapshotSpecFile(filePath);
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const key of Object.keys(data)) {
    const localKey = canonicalizeSnapshotLocalKey(
      localizeSnapshotKey(specFile, key),
    );
    if (seen.has(localKey)) continue;
    seen.add(localKey);
    const value = data[key] ?? "";
    if (value.includes("\n")) {
      sections.push(`=== ${localKey} ===\n<<<\n${value}\n>>>`);
    } else {
      sections.push(`=== ${localKey} ===\n${value}`);
    }
  }
  if (!sections.length) return "";
  const prefix = preamble.length ? preamble + "\n\n" : "";
  return prefix + sections.join("\n\n") + "\n";
}

function defaultSnapshotPreamble(): string {
  return [
    "# as-test snapshot file",
    "#",
    "# IDs use this format:",
    "#   Suite > test",
    "#   Suite > test [name]",
    "#   Suite > test #2",
    "#",
    "# Examples:",
    '#   test("renders card", () => {',
    "#     expect(view()).toMatchSnapshot();",
    "#   })",
    "#   -> renders card",
    "#",
    '#   test("renders card", () => {',
    '#     expect(view()).toMatchSnapshot("mobile");',
    "#   })",
    "#   -> renders card [mobile]",
    "#",
    '#   test("renders card", () => {',
    "#     expect(header()).toMatchSnapshot();",
    "#     expect(body()).toMatchSnapshot();",
    "#   })",
    "#   -> renders card",
    "#   -> renders card #2",
    "#",
    '#   describe("Card", () => {',
    '#     test("renders", () => {',
    "#       expect(view()).toMatchSnapshot();",
    "#     })",
    "#   })",
    "#   -> Card > renders",
    "#",
    "# Single-line values are written directly below the ID.",
    "# Multi-line values use delimiters:",
    "#   <<<",
    "#   ...",
    "#   >>>",
  ].join("\n");
}

function trimSnapshotPreamble(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && !(lines[end - 1] ?? "").trim().length) end--;
  return lines.slice(0, end).join("\n");
}

function resolveSnapshotSpecFile(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/snapshots/";
  const markerIndex = normalized.lastIndexOf(marker);
  const suffix =
    markerIndex >= 0
      ? normalized.slice(markerIndex + marker.length)
      : path.basename(normalized);
  const withoutMode = suffix.replace(/^default\//, "");
  const relative = withoutMode.replace(/\.snap$/, ".ts");
  return `assembly/__tests__/${relative}`;
}

function localizeSnapshotKey(specFile: string, key: string): string {
  const prefix = `${path.basename(specFile)}::`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function qualifySnapshotKey(specFile: string, key: string): string {
  return `${path.basename(specFile)}::${key}`;
}

function canonicalizeSnapshotKey(key: string): string {
  const sep = key.indexOf("::");
  if (sep < 0) return canonicalizeSnapshotLocalKey(key);
  const prefix = key.slice(0, sep + 2);
  const local = key.slice(sep + 2);
  return prefix + canonicalizeSnapshotLocalKey(local);
}

function canonicalizeSnapshotLocalKey(localKey: string): string {
  const named = localKey.match(/^(.*)::\d+::(.+)$/);
  if (named) {
    return `${named[1]!} [${named[2]!}]`;
  }
  const simpleNamed = localKey.match(/^(.*)::([^:]+)$/);
  if (simpleNamed && !/^\d+$/.test(simpleNamed[2]!)) {
    return `${simpleNamed[1]!} [${simpleNamed[2]!}]`;
  }
  const unnamed = localKey.match(/^(.*)::(\d+)$/);
  if (unnamed) {
    const index = Number(unnamed[2]!);
    if (!Number.isFinite(index) || index < 0) return localKey;
    return index === 0 ? unnamed[1]! : `${unnamed[1]!} #${index + 1}`;
  }
  return localKey;
}

function resolveArtifactRelativePath(
  sourceFile: string,
  segment: "__tests__" | "__fuzz__",
): string {
  const normalized = sourceFile.replace(/\\/g, "/");
  const marker = `/${segment}/`;
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return normalized.slice(index + marker.length);
  return path.basename(normalized);
}

function writeReadableLog(
  logRoot: string,
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
): void {
  const relative = resolveArtifactRelativePath(file, "__tests__").replace(
    /\.ts$/,
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

function collectReadableFailures(
  suites: any[],
  file: string,
  pathParts: string[],
): {
  title: string;
  where: string;
  message: string;
  left: string;
  right: string;
}[] {
  const out: {
    title: string;
    where: string;
    message: string;
    left: string;
    right: string;
  }[] = [];
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
          ? `${path.basename(file)}:${String(test.location ?? "")}`
          : path.basename(file),
        message: String(test.message ?? ""),
        left: JSON.stringify(test.left ?? ""),
        right: JSON.stringify(test.right ?? ""),
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
      const value = String(log.value ?? log.message ?? "");
      if (value.length) out.push(value);
    }
    const childSuites = Array.isArray(suiteAny.suites)
      ? (suiteAny.suites as any[])
      : [];
    out.push(...collectReadableLogs(childSuites));
  }
  return out;
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
  const inputPatterns = resolveInputPatterns(config.input, selectors);
  const inputFiles = (await glob(inputPatterns)).sort((a, b) =>
    a.localeCompare(b),
  );
  const duplicateSpecBasenames = await resolveDuplicateSpecBasenames(
    config.input,
  );
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
  const reporterSelection = resolveReporterSelection(
    options.reporterPath,
    config.runOptions.reporter,
  );
  const reporterKind = options.reporterKind ?? reporterSelection.kind;
  const reporter =
    options.reporter ??
    (await loadReporter(reporterSelection, resolvedConfigPath, {
      stdout: process.stdout,
      stderr: process.stderr,
    }));

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
    reporter.onRunStart?.({
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

  for (let i = 0; i < inputFiles.length; i++) {
    const file = inputFiles[i]!;
    const outFile = path.join(
      config.outDir,
      resolveArtifactFileName(
        file,
        config.buildOptions.target,
        options.modeName,
        duplicateSpecBasenames,
      ),
    );

    const fileBase = file
      .slice(file.lastIndexOf("/") + 1)
      .replace(".ts", "")
      .replace(".spec", "");
    const fileToken =
      config.buildOptions.target == "bindings" &&
      !runtimeTokens.some((token) => token.includes("<file>"))
        ? resolveBindingsHelperPath(outFile)
        : outFile;
    const invocation: RuntimeInvocation = {
      command: execPath,
      args: runtimeTokens
        .slice(1)
        .map((token) =>
          token.replace(/<name>/g, fileBase).replace(/<file>/g, fileToken),
        ),
    };
    const runCommandForLog = formatInvocation(invocation);
    const snapshotStore = new SnapshotStore(
      file,
      config.snapshotDir,
      duplicateSpecBasenames,
    );
    let report: any;
    try {
      report = await runProcess(
        invocation,
        file,
        config.fuzz.crashDir,
        options.modeName,
        snapshotStore,
        snapshotEnabled,
        createSnapshots,
        overwriteSnapshots,
        reporter,
        reporterKind == "tap",
        {
          ...mode.env,
          ...config.runOptions.env,
        },
      );
    } catch (error) {
      const modeLabel = options.modeName ?? "default";
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to run ${path.basename(file)} in mode ${modeLabel} with ${details}`,
      );
    }
    const normalized = normalizeReport(report);
    snapshotStore.flush();
    snapshotSummary.matched += snapshotStore.matched;
    snapshotSummary.created += snapshotStore.created;
    snapshotSummary.updated += snapshotStore.updated;
    snapshotSummary.failed += snapshotStore.failed;
    reports.push({
      file,
      modeName: options.modeName ?? "default",
      suites: normalized.suites,
      coverage: normalized.coverage,
      runCommand: runCommandForLog,
      snapshotSummary: {
        matched: snapshotStore.matched,
        created: snapshotStore.created,
        updated: snapshotStore.updated,
        failed: snapshotStore.failed,
      },
    });
  }

  if (config.logs && config.logs != "none") {
    const logRoot = path.join(process.cwd(), config.logs);
    if (!existsSync(logRoot)) {
      mkdirSync(logRoot, { recursive: true });
    }
    for (const report of reports) {
      writeReadableLog(
        logRoot,
        report.file,
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
    if (!existsSync(resolvedCoverageDir)) {
      mkdirSync(resolvedCoverageDir, { recursive: true });
    }
    writeFileSync(
      path.join(
        resolvedCoverageDir,
        options.coverageFileName ?? "coverage.log.json",
      ),
      JSON.stringify(coverageSummary, null, 2),
    );
  }
  if (options.emitRunComplete !== false) {
    const totalModes = Math.max(options.modeSummaryTotal ?? 1, 1);
    const executedModes = Math.min(
      Math.max(options.modeSummaryExecuted ?? 1, 1),
      totalModes,
    );
    const unexecutedModes = Math.max(0, totalModes - executedModes);
    const modeFailed = Boolean(stats.failedFiles || snapshotSummary.failed);
    reporter.onRunComplete?.({
      clean: cleanOutput,
      snapshotEnabled,
      showCoverage,
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
    reporter.flush?.();
  }

  const failed = Boolean(stats.failedFiles || snapshotSummary.failed);
  if (shouldExit) {
    process.exit(failed ? 1 : 0);
  }
  return {
    failed,
    stats,
    snapshotSummary,
    coverageSummary,
    reports,
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
  const normalized = resolveLegacyRuntime(runtimeRun, target, emitWarnings);
  return fallbackToDefaultRuntime(normalized, target, emitWarnings);
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
      command: "node ./.as-test/runners/default.wasi.js <file>",
      scriptPath: "./.as-test/runners/default.wasi.js",
    };
  }
  if (target == "bindings") {
    return {
      command: "node ./.as-test/runners/default.bindings.js <file>",
      scriptPath: "./.as-test/runners/default.bindings.js",
    };
  }
  if (target == "web") {
    return {
      command: "node ./.as-test/runners/default.web.js <file>",
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
  if (existsSync(resolvedScriptPath)) return fallback;

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
    return `import { readFileSync } from "fs";
import { WASI } from "wasi";

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning, ...args) => {
  const type = typeof args[0] == "string" ? args[0] : "";
  const name = typeof warning?.name == "string" ? warning.name : type;
  const message =
    typeof warning == "string" ? warning : String(warning?.message ?? "");
  if (
    name == "ExperimentalWarning" &&
    message.includes("WASI is an experimental feature")
  ) {
    return;
  }
  return originalEmitWarning(warning, ...args);
});

const wasmPath = process.argv[2];
if (!wasmPath) {
  process.stderr.write("usage: node ./.as-test/runners/default.wasi.js <file.wasm>\\n");
  process.exit(1);
}

try {
  const wasi = new WASI({
    version: "preview1",
    args: [wasmPath],
    env: process.env,
    preopens: {},
  });

  const binary = readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const envImports = {
    __as_test_request_fuzz_config() {
      return 0;
    },
  };
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module == "env" && entry.kind == "function" && !(entry.name in envImports)) {
      envImports[entry.name] = () => 0;
    }
  }
  const instance = new WebAssembly.Instance(module, {
    env: envImports,
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.start(instance);
} catch (error) {
  process.stderr.write("failed to run WASI module: " + String(error) + "\\n");
  process.exit(1);
}
`;
  }

  if (target == "bindings") {
    return `import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

let patched = false;

function readExact(length) {
  const out = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let read = 0;
    try {
      read = fs.readSync(0, out, offset, length - offset, null);
    } catch (error) {
      if (error && error.code === "EAGAIN") {
        continue;
      }
      throw error;
    }
    if (!read) break;
    offset += read;
  }
  const view = out.subarray(0, offset);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function writeRaw(data) {
  const view = Buffer.from(data);
  fs.writeSync(1, view);
}

function withNodeIo(imports = {}) {
  if (!patched) {
    patched = true;
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      if (chunk instanceof ArrayBuffer) {
        writeRaw(chunk);
        return true;
      }
      return originalWrite(chunk, ...args);
    };
    process.stdin.read = (size) => readExact(Number(size ?? 0));
  }
  return imports;
}

const wasmPathArg = process.argv[2];
if (!wasmPathArg) {
  process.stderr.write("usage: node ./.as-test/runners/default.bindings.js <file.wasm>\\n");
  process.exit(1);
}

const wasmPath = path.resolve(process.cwd(), wasmPathArg);
const jsPath = wasmPath.replace(/\\.wasm$/, ".js");

try {
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const mod = await import(pathToFileURL(jsPath).href);
  if (typeof mod.instantiate !== "function") {
    throw new Error("bindings helper missing instantiate export");
  }
  mod.instantiate(module, withNodeIo({}));
} catch (error) {
  process.stderr.write("failed to run bindings module: " + String(error) + "\\n");
  process.exit(1);
}
`;
  }

  if (target == "web") {
    return buildWebRunnerSource();
  }

  return null;
}

function resolveArtifactFileName(
  file: string,
  target: string,
  modeName?: string,
  duplicateSpecBasenames: Set<string> = new Set<string>(),
): string {
  const base = path
    .basename(file)
    .replace(/\.spec\.ts$/, "")
    .replace(/\.ts$/, "");
  const legacy = !modeName
    ? `${path.basename(file).replace(".ts", ".wasm")}`
    : `${base}.${modeName}.${target}.wasm`;
  if (!duplicateSpecBasenames.has(path.basename(file))) {
    return legacy;
  }
  const disambiguator = resolveDisambiguator(file, duplicateSpecBasenames);
  if (!disambiguator.length) {
    return legacy;
  }
  const ext = path.extname(legacy);
  const stem = ext.length ? legacy.slice(0, -ext.length) : legacy;
  return `${stem}.${disambiguator}${ext}`;
}

async function resolveDuplicateSpecBasenames(
  configured: string[] | string,
): Promise<Set<string>> {
  const patterns = Array.isArray(configured) ? configured : [configured];
  const files = await glob(patterns);
  const counts = new Map<string, number>();
  for (const file of files) {
    const base = path.basename(file);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [base, count] of counts) {
    if (count > 1) duplicates.add(base);
  }
  return duplicates;
}

function resolveDisambiguator(
  file: string,
  duplicateSpecBasenames: Set<string>,
): string {
  if (!duplicateSpecBasenames.has(path.basename(file))) return "";
  const relDir = path.dirname(path.relative(process.cwd(), file));
  if (!relDir.length || relDir == ".") return "";
  return relDir
    .replace(/[\\/]+/g, "__")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveBindingsHelperPath(wasmPath: string): string {
  const bindingsPath = wasmPath.replace(/\.wasm$/, ".bindings.js");
  if (existsSync(bindingsPath)) return bindingsPath;
  const legacyRunPath = wasmPath.replace(/\.wasm$/, ".run.js");
  if (existsSync(legacyRunPath)) return legacyRunPath;
  return bindingsPath;
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

function resolveInputPatterns(
  configured: string[] | string,
  selectors: string[],
): string[] {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;

  const patterns = new Set<string>();
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

function expandSelectors(selectors: string[]): string[] {
  const expanded: string[] = [];
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

function shouldSplitSelector(selector: string): boolean {
  return (
    selector.includes(",") &&
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}

function isBareSuiteSelector(selector: string): boolean {
  return (
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}

function stripSuiteSuffix(selector: string): string {
  return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
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
    }
  >();
  const hasDetailedPoints = reports.some(
    (report) => report.coverage.points.length > 0,
  );

  for (const report of reports) {
    for (const point of report.coverage.points) {
      if (isIgnoredCoverageFile(point.file, coverage)) continue;
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
      if (isIgnoredCoverageFile(report.file, coverage)) continue;
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
  if (normalized.startsWith("node_modules/")) return true;
  if (normalized.includes("/node_modules/")) return true;
  if (isAssemblyScriptStdlibFile(normalized)) return true;
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

function globPatternToRegExp(pattern: string): RegExp {
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
  return new RegExp(source);
}

function isAllowedCoverageSourceFile(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith(".ts") || lower.endsWith(".as");
}

function isAssemblyScriptStdlibFile(file: string): boolean {
  if (file.startsWith("~lib/")) return true;
  if (file.includes("/~lib/")) return true;
  if (file.startsWith("assemblyscript/std/")) return true;
  if (file.includes("/assemblyscript/std/")) return true;
  return false;
}

function resolveCoverageOptions(raw: unknown): CoverageOptions {
  if (typeof raw == "boolean") {
    return {
      enabled: raw,
      includeSpecs: false,
      include: [],
      exclude: [],
    };
  }
  if (raw && typeof raw == "object") {
    const obj = raw as Record<string, unknown>;
    return {
      enabled: obj.enabled == null ? false : Boolean(obj.enabled),
      includeSpecs: Boolean(obj.includeSpecs),
      include: Array.isArray(obj.include)
        ? obj.include.filter((item): item is string => typeof item == "string")
        : [],
      exclude: Array.isArray(obj.exclude)
        ? obj.exclude.filter((item): item is string => typeof item == "string")
        : [],
    };
  }
  return {
    enabled: false,
    includeSpecs: false,
    include: [],
    exclude: [],
  };
}

function compareCoveragePoints(
  a: {
    hash: string;
    file: string;
    line: number;
    column: number;
    type: string;
    executed: boolean;
  },
  b: {
    hash: string;
    file: string;
    line: number;
    column: number;
    type: string;
    executed: boolean;
  },
): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  return a.hash.localeCompare(b.hash);
}

async function runProcess(
  invocation: RuntimeInvocation,
  specFile: string,
  crashDir: string,
  modeName: string | undefined,
  snapshots: SnapshotStore,
  snapshotEnabled: boolean,
  createSnapshots: boolean,
  overwriteSnapshots: boolean,
  reporter: TestReporter,
  tapMode: boolean = false,
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
  let stdoutBuffer = "";
  let suppressTraceWarningLine = false;
  let spawnError: Error | null = null;

  child.on("error", (error) => {
    spawnError = error;
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
    let newline = stderrBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stderrBuffer.slice(0, newline + 1);
      stderrBuffer = stderrBuffer.slice(newline + 1);
      if (shouldSuppressWasiWarningLine(line, suppressTraceWarningLine)) {
        suppressTraceWarningLine = true;
      } else {
        suppressTraceWarningLine = false;
        process.stderr.write(line);
      }
      newline = stderrBuffer.indexOf("\n");
    }
  });

  class TestChannel extends Channel {
    protected onPassthrough(data: Buffer): void {
      stdoutBuffer += data.toString("utf8");
      if (tapMode) {
        process.stderr.write(data);
      } else {
        process.stdout.write(data);
      }
    }

    protected onCall(msg: unknown): void {
      const event = msg as Record<string, unknown>;
      const kind = String(event.kind ?? "");
      if (kind === "event:assert-fail") {
        reporter.onAssertionFail?.({
          key: String(event.key ?? ""),
          instr: String(event.instr ?? ""),
          left: String(event.left ?? ""),
          right: String(event.right ?? ""),
          message: String(event.message ?? ""),
        });
        return;
      }
      if (kind === "event:file-start") {
        reporter.onFileStart?.({
          file: String(event.file ?? "unknown"),
          depth: 0,
          suiteKind: "file",
          description: String(event.file ?? "unknown"),
        });
        return;
      }
      if (kind === "event:file-end") {
        reporter.onFileEnd?.({
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
        reporter.onSuiteStart?.({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          suiteKind: String(event.suiteKind ?? ""),
          description: String(event.description ?? ""),
        });
        return;
      }
      if (kind === "event:suite-end") {
        reporter.onSuiteEnd?.({
          file: String(event.file ?? "unknown"),
          depth: Number(event.depth ?? 0),
          suiteKind: String(event.suiteKind ?? ""),
          description: String(event.description ?? ""),
          verdict: String(event.verdict ?? "none"),
        });
        return;
      }
      if (kind === "event:warn") {
        reporter.onWarning?.({
          message: String(event.message ?? ""),
        });
        return;
      }
      if (kind === "event:log") {
        reporter.onLog?.({
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
          reporter.onSnapshotMissing?.({ key });
        }
        this.send(
          MessageType.CALL,
          Buffer.from(`${result.ok ? "1" : "0"}\n${result.expected}`, "utf8"),
        );
        return;
      }
      this.sendJSON(MessageType.CALL, { ok: true, expected: "" });
    }

    protected onDataMessage(data: Buffer): void {
      try {
        report = JSON.parse(data.toString("utf8"));
      } catch (error) {
        parseError = String(error);
      }
    }
  }

  const _channel = new TestChannel(child.stdout!, child.stdin!);

  const code = await new Promise<number>((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
  if (stderrBuffer.length) {
    if (
      !shouldSuppressWasiWarningLine(stderrBuffer, suppressTraceWarningLine)
    ) {
      process.stderr.write(stderrBuffer);
    }
  }
  if (spawnError) {
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      mode: modeName ?? "default",
      error: spawnError.stack ?? spawnError.message,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    throw spawnError;
  }

  if (parseError) {
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      mode: modeName ?? "default",
      error: `could not parse report payload: ${parseError}`,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    throw new Error(`could not parse report payload: ${parseError}`);
  }
  if (!report) {
    persistCrashRecord(crashDir, {
      kind: "test",
      file: specFile,
      mode: modeName ?? "default",
      error: "missing report payload from test runtime",
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
    });
    throw new Error("missing report payload from test runtime");
  }
  if (code !== 0) {
    // Let report determine failure counts, but keep non-zero child exits visible.
    process.stderr.write(chalk.dim(`child process exited with code ${code}\n`));
  }
  return report;
}

function shouldSuppressWasiWarningLine(
  line: string,
  suppressTraceWarningLine: boolean,
): boolean {
  if (line.includes("ExperimentalWarning: WASI is an experimental feature")) {
    return true;
  }
  if (suppressTraceWarningLine && line.includes("--trace-warnings")) {
    return true;
  }
  return false;
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
  let fileVerdict: Verdict = "none";
  for (const suite of suites) {
    fileVerdict = mergeVerdict(
      fileVerdict,
      readSuite(stats, suite, file, modeName),
    );
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
    verdict = mergeVerdict(verdict, readSuite(stats, subSuite, file, modeName));
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

  if (verdict == "fail") {
    stats.failedSuites++;
    stats.failedEntries.push({
      ...suiteAny,
      file,
      modeName,
    });
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

export async function createRunReporter(
  configPath: string = DEFAULT_CONFIG_PATH,
  reporterPath?: string,
  modeName?: string,
): Promise<{
  reporter: TestReporter;
  reporterKind: ReporterKind;
  runtimeName: string;
  resolvedConfigPath: string;
}> {
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  const loadedConfig = loadConfig(resolvedConfigPath);
  const mode = applyMode(loadedConfig, modeName);
  const config = mode.config;
  const selection = resolveReporterSelection(
    reporterPath,
    config.runOptions.reporter,
  );
  const reporter = await loadReporter(selection, resolvedConfigPath, {
    stdout: process.stdout,
    stderr: process.stderr,
  });
  const runtimeCommand = resolveRuntimeCommand(
    getConfiguredRuntimeCmd(config),
    config.buildOptions.target,
    false,
  );
  return {
    reporter,
    reporterKind: selection.kind,
    runtimeName: runtimeNameFromCommand(runtimeCommand),
    resolvedConfigPath,
  };
}

async function loadReporter(
  selection: ReporterSelection,
  configPath: string,
  context: ReporterContext,
): Promise<TestReporter> {
  if (selection.kind == "default") {
    return createDefaultReporter(context);
  }
  if (selection.kind == "tap") {
    return createTapReporter(context, selection.tap);
  }
  const reporterPath = selection.reporterPath;
  if (!reporterPath) {
    return createDefaultReporter(context);
  }
  const resolved = path.isAbsolute(reporterPath)
    ? reporterPath
    : path.resolve(path.dirname(configPath), reporterPath);

  try {
    const mod = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
    const factory = resolveReporterFactory(mod);
    return factory(context);
  } catch (error) {
    const reporterError = new Error(
      `could not load reporter "${reporterPath}": ${String(error)}`,
    ) as Error & { cause?: unknown };
    reporterError.cause = error;
    throw reporterError;
  }
}

type ReporterSelection = {
  kind: ReporterKind;
  reporterPath: string;
  tap: TapReporterConfig;
};

function resolveReporterSelection(
  cliValue: string | undefined,
  configValue: unknown,
): ReporterSelection {
  const parsed = parseReporterConfig(configValue);
  const raw = resolveCliReporter(
    process.argv.slice(2),
    cliValue ?? parsed.name,
  );
  const normalized = raw.trim();
  const canonical = normalized.toLowerCase();

  if (!normalized.length || canonical == "default") {
    return { kind: "default", reporterPath: "", tap: parsed.tap };
  }

  if (canonical == "tap" || canonical == "tap13") {
    return { kind: "tap", reporterPath: "", tap: parsed.tap };
  }

  return { kind: "custom", reporterPath: normalized, tap: parsed.tap };
}

function resolveCliReporter(argv: string[], fallback: string): string {
  let resolved = fallback;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token == "--tap") {
      resolved = "tap";
      continue;
    }
    if (token == "--reporter") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`--reporter requires a value`);
      }
      resolved = value;
      i++;
      continue;
    }
    if (token.startsWith("--reporter=")) {
      const value = token.slice("--reporter=".length);
      if (!value.length) {
        throw new Error(`--reporter requires a value`);
      }
      resolved = value;
      continue;
    }
  }
  return resolved;
}

function parseReporterConfig(value: unknown): {
  name: string;
  tap: TapReporterConfig;
} {
  const tap: TapReporterConfig = {
    mode: "single-file",
    outDir: "./.as-test/reports",
    outFile: "./.as-test/reports/report.tap",
  };

  if (typeof value == "string") {
    return { name: value, tap };
  }

  if (!value || typeof value != "object") {
    return { name: "", tap };
  }

  const config = value as ReporterConfigObject;
  const name = typeof config.name == "string" ? config.name : "";

  if (typeof config.outDir == "string" && config.outDir.trim().length) {
    tap.outDir = config.outDir.trim();
  }
  if (typeof config.outFile == "string" && config.outFile.trim().length) {
    tap.outFile = config.outFile.trim();
  } else if (tap.outDir && tap.outDir.length) {
    tap.outFile = path.join(tap.outDir, "report.tap");
  }

  if (Array.isArray(config.options)) {
    const options = config.options
      .filter((option): option is string => typeof option == "string")
      .map((option) => option.toLowerCase());
    if (options.includes("per-file")) {
      tap.mode = "per-file";
      if (!config.outFile && tap.outDir && tap.outDir.length) {
        tap.outFile = path.join(tap.outDir, "report.tap");
      }
    } else {
      tap.mode = "single-file";
    }
  }

  return { name, tap };
}

function resolveReporterFactory(mod: Record<string, unknown>): ReporterFactory {
  const fromNamed = mod.createReporter;
  if (typeof fromNamed == "function") {
    return fromNamed as ReporterFactory;
  }

  const fromDefault = mod.default;
  if (typeof fromDefault == "function") {
    return fromDefault as ReporterFactory;
  }
  if (
    fromDefault &&
    typeof fromDefault == "object" &&
    "createReporter" in (fromDefault as Record<string, unknown>)
  ) {
    const nested = (fromDefault as Record<string, unknown>).createReporter;
    if (typeof nested == "function") {
      return nested as ReporterFactory;
    }
  }

  throw new Error(
    `reporter module must export a factory as "createReporter" or default`,
  );
}
