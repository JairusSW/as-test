import chalk from "chalk";
import { spawn } from "child_process";
import { glob } from "glob";
import { getExec, loadConfig } from "./util.js";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import {
  CoverageSummary,
  ReporterContext,
  ReporterFactory,
  RunStats,
  TestReporter,
} from "./reporters/types.js";
import { createReporter as createDefaultReporter } from "./reporters/default.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");

enum MessageType {
  OPEN = 0x00,
  CLOSE = 0x01,
  CALL = 0x02,
  DATA = 0x03,
}

class Channel {
  private static readonly MAGIC = Buffer.from("WIPC");
  private static readonly HEADER_SIZE = 9;
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
  ) {
    this.input.on("data", (chunk) => this.onData(chunk as Buffer));
  }

  protected send(type: MessageType, payload?: Buffer): void {
    const body = payload ?? Buffer.alloc(0);
    const header = Buffer.alloc(Channel.HEADER_SIZE);
    Channel.MAGIC.copy(header, 0);
    header.writeUInt8(type, 4);
    header.writeUInt32LE(body.length, 5);
    this.output.write(Buffer.concat([header, body]));
  }

  protected sendJSON(type: MessageType, msg: unknown): void {
    this.send(type, Buffer.from(JSON.stringify(msg), "utf8"));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      if (this.buffer.length === 0) return;
      const idx = this.buffer.indexOf(Channel.MAGIC);

      if (idx === -1) {
        this.onPassthrough(this.buffer);
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (idx > 0) {
        this.onPassthrough(this.buffer.subarray(0, idx));
        this.buffer = this.buffer.subarray(idx);
      }
      if (this.buffer.length < Channel.HEADER_SIZE) return;

      const type = this.buffer.readUInt8(4);
      const length = this.buffer.readUInt32LE(5);
      const frameSize = Channel.HEADER_SIZE + length;
      if (this.buffer.length < frameSize) return;

      const payload = this.buffer.subarray(Channel.HEADER_SIZE, frameSize);
      this.buffer = this.buffer.subarray(frameSize);
      this.handleFrame(type, payload);
    }
  }

  private handleFrame(type: MessageType, payload: Buffer): void {
    switch (type) {
      case MessageType.OPEN:
        this.onOpen();
        break;
      case MessageType.CLOSE:
        this.onClose();
        break;
      case MessageType.CALL:
        this.onCall(JSON.parse(payload.toString("utf8")));
        break;
      case MessageType.DATA:
        this.onDataMessage(payload);
        break;
      default:
        this.onPassthrough(payload);
    }
  }

  protected onPassthrough(_data: Buffer): void {}
  protected onOpen(): void {}
  protected onClose(): void {}
  protected onCall(_msg: unknown): void {}
  protected onDataMessage(_data: Buffer): void {}
}

type RunFlags = {
  snapshot?: boolean;
  updateSnapshots?: boolean;
  clean?: boolean;
  showCoverage?: boolean;
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
};

type SnapshotReply = {
  ok: boolean;
  expected: string;
  warnMissing: boolean;
};

class SnapshotStore {
  private readonly filePath: string;
  private readonly data: Record<string, string>;
  private dirty = false;
  public created = 0;
  public updated = 0;
  public matched = 0;
  public failed = 0;
  private warnedMissing = new Set<string>();

  constructor(specFile: string, snapshotDir: string) {
    const base = path.basename(specFile, ".ts");
    const dir = path.join(process.cwd(), snapshotDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${base}.snap.json`);
    this.data = existsSync(this.filePath)
      ? (JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, string>)
      : {};
  }

  assert(
    key: string,
    actual: string,
    allowSnapshot: boolean,
    updateSnapshots: boolean,
  ): SnapshotReply {
    if (!allowSnapshot) return { ok: true, expected: actual, warnMissing: false };
    if (!(key in this.data)) {
      if (!updateSnapshots) {
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
    if (!updateSnapshots) {
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
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

export async function run(
  flags: RunFlags = {},
  configPath: string = DEFAULT_CONFIG_PATH,
) {
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  const reports: any[] = [];
  const config = loadConfig(resolvedConfigPath);
  const inputFiles = await glob(config.input);
  const snapshotEnabled = flags.snapshot !== false;
  const updateSnapshots = Boolean(flags.updateSnapshots);
  const cleanOutput = Boolean(flags.clean);
  const showCoverage = Boolean(flags.showCoverage);
  const coverage = resolveCoverageOptions(config.coverage);
  const coverageEnabled = coverage.enabled;
  const reporter = await loadReporter(
    config.runOptions.reporter,
    resolvedConfigPath,
    {
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );

  const command = config.runOptions.runtime.run.split(" ")[0];
  const execPath = getExec(command);

  if (!execPath) {
    console.log(
      `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${command} in PATH variable!`,
    );
    process.exit(1);
  }

  reporter.onRunStart?.({
    runtimeName: config.runOptions.runtime.name,
    clean: cleanOutput,
    snapshotEnabled,
    updateSnapshots,
  });
  if (showCoverage && !coverageEnabled) {
    process.stderr.write(
      chalk.dim(
        'coverage point output requested with --show-coverage, but coverage is disabled\n',
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
      file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm"),
    );

    const fileBase = file
      .slice(file.lastIndexOf("/") + 1)
      .replace(".ts", "")
      .replace(".spec", "");
    let cmd = config.runOptions.runtime.run.replace(command, execPath);
    cmd = cmd.replace("<name>", fileBase);
    if (config.buildOptions.target == "bindings" && !cmd.includes("<file>")) {
      cmd = cmd.replace(
        "<file>",
        outFile
          .replace("build", "tests")
          .replace(".spec", "")
          .replace(".wasm", ".run.js"),
      );
    } else {
      cmd = cmd.replace("<file>", outFile);
    }

    const snapshotStore = new SnapshotStore(file, config.snapshotDir);
    const report = await runProcess(
      cmd,
      snapshotStore,
      snapshotEnabled,
      updateSnapshots,
      reporter,
    );
    const normalized = normalizeReport(report);
    snapshotStore.flush();
    snapshotSummary.matched += snapshotStore.matched;
    snapshotSummary.created += snapshotStore.created;
    snapshotSummary.updated += snapshotStore.updated;
    snapshotSummary.failed += snapshotStore.failed;
    reports.push({
      file,
      suites: normalized.suites,
      coverage: normalized.coverage,
    });
  }

  if (config.logs && config.logs != "none") {
    if (!existsSync(path.join(process.cwd(), config.logs))) {
      mkdirSync(path.join(process.cwd(), config.logs), { recursive: true });
    }
    writeFileSync(
      path.join(process.cwd(), config.logs, "test.log.json"),
      JSON.stringify(reports, null, 2),
    );
    if (coverageEnabled) {
      const coverageSummary = collectCoverageSummary(
        reports,
        true,
        showCoverage,
        coverage,
      );
      writeFileSync(
        path.join(process.cwd(), config.logs, "coverage.log.json"),
        JSON.stringify(coverageSummary, null, 2),
      );
    }
  }
  const stats = collectRunStats(reports.map((report) => report.suites));
  const coverageSummary = collectCoverageSummary(
    reports,
    coverageEnabled,
    showCoverage,
    coverage,
  );
  reporter.onRunComplete?.({
    clean: cleanOutput,
    snapshotEnabled,
    showCoverage,
    snapshotSummary,
    coverageSummary,
    stats,
    reports,
  });

  if (stats.failedFiles || snapshotSummary.failed) process.exit(1);
  process.exit(0);
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
  const pointsRaw = Array.isArray(raw?.points) ? (raw?.points as unknown[]) : [];
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

    for (const [file, points] of byFile.entries()) {
      let covered = 0;
      for (const point of points) {
        if (point.executed) covered++;
      }
      const total = points.length;
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
  } else {
    // Compatibility fallback for reports without detailed point payloads.
    for (const report of reports) {
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

  summary.percent = summary.total ? (summary.covered * 100) / summary.total : 100;
  return summary;
}

function isIgnoredCoverageFile(file: string, coverage: CoverageOptions): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (normalized.startsWith("node_modules/")) return true;
  if (normalized.includes("/node_modules/")) return true;
  if (!coverage.includeSpecs && normalized.endsWith(".spec.ts")) return true;
  if (normalized.includes("/as-test/assembly/")) {
    if (!normalized.includes("/as-test/assembly/__tests__/")) return true;
  }
  if (normalized.startsWith("assembly/")) {
    if (!normalized.startsWith("assembly/__tests__/")) return true;
  }
  if (normalized.includes("/assembly/")) {
    if (!normalized.includes("/assembly/__tests__/")) {
      if (
        normalized.endsWith("/assembly/index.ts") ||
        normalized.endsWith("/assembly/coverage.ts") ||
        normalized.includes("/assembly/src/") ||
        normalized.includes("/assembly/util/")
      ) {
        return true;
      }
    }
  }
  return false;
}

function resolveCoverageOptions(raw: unknown): CoverageOptions {
  if (typeof raw == "boolean") {
    return {
      enabled: raw,
      includeSpecs: false,
    };
  }
  if (raw && typeof raw == "object") {
    const obj = raw as Record<string, unknown>;
    return {
      enabled: obj.enabled == null ? true : Boolean(obj.enabled),
      includeSpecs: Boolean(obj.includeSpecs),
    };
  }
  return {
    enabled: false,
    includeSpecs: false,
  };
}

async function runProcess(
  cmd: string,
  snapshots: SnapshotStore,
  snapshotEnabled: boolean,
  updateSnapshots: boolean,
  reporter: TestReporter,
): Promise<any> {
  const child = spawn(cmd, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });
  let report: any = null;
  let parseError: string | null = null;

  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  class TestChannel extends Channel {
    protected onPassthrough(data: Buffer): void {
      process.stdout.write(data);
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
      if (kind === "snapshot:assert") {
        const key = String(event.key ?? "");
        const actual = String(event.actual ?? "");
        const result = snapshots.assert(
          key,
          actual,
          snapshotEnabled,
          updateSnapshots,
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _channel = new TestChannel(child.stdout!, child.stdin!);

  const code = await new Promise<number>((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });

  if (parseError) {
    throw new Error(`could not parse report payload: ${parseError}`);
  }
  if (!report) {
    throw new Error("missing report payload from test runtime");
  }
  if (code !== 0) {
    // Let report determine failure counts, but keep non-zero child exits visible.
    process.stderr.write(chalk.dim(`child process exited with code ${code}\n`));
  }
  return report;
}

function collectRunStats(reports: unknown[]): RunStats {
  const stats: RunStats = {
    passedFiles: 0,
    failedFiles: 0,
    passedSuites: 0,
    failedSuites: 0,
    passedTests: 0,
    failedTests: 0,
    time: 0.0,
    failedEntries: [],
  };

  for (const fileReport of reports) {
    readFileReport(stats, fileReport);
  }
  return stats;
}

function readFileReport(stats: RunStats, fileReport: unknown): void {
  const suites = Array.isArray(fileReport) ? (fileReport as unknown[]) : [];
  let fileFailed = false;
  for (const suite of suites) {
    const suiteFailed = readSuite(stats, suite);
    if (suiteFailed) fileFailed = true;
  }
  if (fileFailed) stats.failedFiles++;
  else stats.passedFiles++;
}

function readSuite(stats: RunStats, suite: unknown): boolean {
  const suiteAny = suite as Record<string, unknown>;
  let suiteFailed = String(suiteAny.verdict ?? "none") == "fail";
  if (suiteFailed) stats.failedSuites++;
  else stats.passedSuites++;

  const time = suiteAny.time as Record<string, unknown> | undefined;
  const start = Number(time?.start ?? 0);
  const end = Number(time?.end ?? 0);
  stats.time += end - start;

  const subSuites = Array.isArray(suiteAny.suites)
    ? (suiteAny.suites as unknown[])
    : [];
  for (const subSuite of subSuites) {
    if (readSuite(stats, subSuite)) suiteFailed = true;
  }

  const tests = Array.isArray(suiteAny.tests)
    ? (suiteAny.tests as Record<string, unknown>[])
    : [];
  for (const test of tests) {
    if (String(test.verdict ?? "none") == "fail") {
      suiteFailed = true;
      stats.failedTests++;
    } else {
      stats.passedTests++;
    }
  }

  if (suiteFailed) stats.failedEntries.push(suite);
  return suiteFailed;
}

async function loadReporter(
  reporterPath: string | undefined,
  configPath: string,
  context: ReporterContext,
): Promise<TestReporter> {
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
    throw new Error(
      `could not load reporter "${reporterPath}": ${String(error)}`,
    );
  }
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
