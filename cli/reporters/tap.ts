import {
  ReporterContext,
  ReporterFactory,
  RunCompleteEvent,
  TestReporter,
} from "./types.js";
import * as path from "path";
import { mkdirSync, writeFileSync } from "fs";

type TapStatus = "ok" | "fail" | "skip";

export type TapReporterMode = "single-file" | "per-file";

export type TapReporterConfig = {
  mode?: TapReporterMode;
  outDir?: string;
  outFile?: string;
};

type TapReporterResolvedConfig = {
  mode: TapReporterMode;
  outDir: string;
  outFile: string;
};

type TapPoint = {
  name: string;
  status: TapStatus;
  file?: string;
  line?: number;
  column?: number;
  matcher?: string;
  expected?: string;
  actual?: string;
  message?: string;
  durationMs?: number;
};

type Location = {
  line?: number;
  column?: number;
};

export function createTapReporter(
  context: ReporterContext,
  config: TapReporterConfig = {},
): TestReporter {
  return new TapReporter(context, normalizeTapConfig(config));
}

export const createReporter: ReporterFactory = (
  context: ReporterContext,
): TestReporter => {
  return createTapReporter(context);
};

class TapReporter implements TestReporter {
  constructor(
    private readonly context: ReporterContext,
    private readonly config: TapReporterResolvedConfig,
  ) {}

  onRunComplete(event: RunCompleteEvent): void {
    const points = collectTapPoints(event.reports);
    const output = buildTapDocument(points);

    this.context.stdout.write(output);

    for (const point of points) {
      if (point.status != "fail") continue;
      emitGitHubAnnotation(this.context, point);
    }

    this.writeArtifacts(points, output);
  }

  private writeArtifacts(points: TapPoint[], output: string): void {
    if (this.config.mode == "per-file") {
      this.writePerFileArtifacts(points);
      return;
    }

    const outFile = path.resolve(process.cwd(), this.config.outFile);
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, output);
  }

  private writePerFileArtifacts(points: TapPoint[]): void {
    const groups = new Map<string, TapPoint[]>();

    for (const point of points) {
      const key = point.file?.length ? point.file : "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(point);
    }

    let unknownIndex = 0;
    const outDir = path.resolve(process.cwd(), this.config.outDir);
    mkdirSync(outDir, { recursive: true });

    for (const [fileKey, filePoints] of groups) {
      const fileName =
        fileKey == "unknown"
          ? `unknown-${++unknownIndex}.tap`
          : toTapFileName(fileKey);
      const outFile = path.join(outDir, fileName);
      writeFileSync(outFile, buildTapDocument(filePoints));
    }
  }
}

function normalizeTapConfig(config: TapReporterConfig): TapReporterResolvedConfig {
  const mode = config.mode == "per-file" ? "per-file" : "single-file";
  const outDir =
    typeof config.outDir == "string" && config.outDir.trim().length
      ? config.outDir.trim()
      : "./.as-test/reports";
  const outFile =
    typeof config.outFile == "string" && config.outFile.trim().length
      ? config.outFile.trim()
      : path.join(outDir, "report.tap");

  return {
    mode,
    outDir,
    outFile,
  };
}

function toTapFileName(file: string): string {
  const normalized = file
    .replace(/^[.\\/]+/, "")
    .replace(/[\\/]/g, "__")
    .replace(/\.[^.]+$/, "");
  return `${normalized}.tap`;
}

function buildTapDocument(points: TapPoint[]): string {
  const totals = {
    pass: 0,
    fail: 0,
    skip: 0,
  };
  const lines: string[] = [];

  lines.push("TAP version 13");
  lines.push(`1..${points.length}`);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const id = i + 1;
    const name = sanitizeTap(point.name.length ? point.name : `test ${id}`);

    if (point.status == "fail") {
      totals.fail++;
      lines.push(`not ok ${id} - ${name}`);
      lines.push(...buildFailDetails(point));
      continue;
    }

    if (point.status == "skip") {
      totals.skip++;
      lines.push(`ok ${id} - ${name} # SKIP`);
      continue;
    }

    totals.pass++;
    lines.push(`ok ${id} - ${name}`);
  }

  lines.push(`# tests ${points.length}`);
  lines.push(`# pass ${totals.pass}`);
  if (totals.skip) {
    lines.push(`# skip ${totals.skip}`);
  }
  lines.push(`# fail ${totals.fail}`);

  return lines.join("\n") + "\n";
}

function buildFailDetails(point: TapPoint): string[] {
  const lines = ["  ---", `  message: ${JSON.stringify(point.message ?? "assertion failed")}`];
  if (point.file) {
    lines.push(`  file: ${JSON.stringify(point.file)}`);
  }
  if (point.line) {
    lines.push(`  line: ${point.line}`);
  }
  if (point.column) {
    lines.push(`  column: ${point.column}`);
  }
  if (point.matcher) {
    lines.push(`  matcher: ${JSON.stringify(point.matcher)}`);
  }
  if (point.expected != null) {
    lines.push(`  expected: ${JSON.stringify(point.expected)}`);
  }
  if (point.actual != null) {
    lines.push(`  actual: ${JSON.stringify(point.actual)}`);
  }
  if (point.durationMs != null) {
    lines.push(`  duration_ms: ${Math.round(point.durationMs * 1000) / 1000}`);
  }
  lines.push("  ...");
  return lines;
}

function collectTapPoints(reports: unknown[]): TapPoint[] {
  const points: TapPoint[] = [];
  if (!Array.isArray(reports)) return points;

  for (const report of reports) {
    const reportAny = report as Record<string, unknown>;
    const file = String(reportAny.file ?? "");
    const suites = Array.isArray(reportAny.suites)
      ? (reportAny.suites as unknown[])
      : [];
    for (const suite of suites) {
      collectTapPointsFromSuite(suite, file, [], points);
    }
  }

  return points;
}

function collectTapPointsFromSuite(
  suite: unknown,
  file: string,
  pathStack: string[],
  points: TapPoint[],
): void {
  const suiteAny = suite as Record<string, unknown>;
  const description = String(suiteAny.description ?? "suite");
  const fullPath = [...pathStack, description];
  const localFile = suiteAny.file ? String(suiteAny.file) : file;
  const childSuites = Array.isArray(suiteAny.suites)
    ? (suiteAny.suites as unknown[])
    : [];
  const tests = Array.isArray(suiteAny.tests)
    ? (suiteAny.tests as Record<string, unknown>[])
    : [];
  const suiteKind = String(suiteAny.kind ?? "");
  const durationMs = suiteDuration(suiteAny.time);

  if (tests.length > 0) {
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i]!;
      const location = parseLocation(test.location);
      const name =
        tests.length > 1
          ? `${fullPath.join(" > ")} #${i + 1}`
          : fullPath.join(" > ");
      const status = normalizeStatus(test.verdict);
      const matcher = stringifyValue(test.instr);
      const expected = stringifyValue(test.right);
      const actual = stringifyValue(test.left);
      const message = buildFailureMessage(
        stringifyValue(test.message),
        matcher,
        expected,
        actual,
      );
      points.push({
        name,
        status,
        file: localFile,
        line: location.line,
        column: location.column,
        matcher,
        expected,
        actual,
        message,
        durationMs,
      });
    }
  } else if (
    childSuites.length == 0 &&
    (suiteKind == "test" ||
      suiteKind == "it" ||
      suiteKind == "xtest" ||
      suiteKind == "xit")
  ) {
    points.push({
      name: fullPath.join(" > "),
      status: normalizeStatus(suiteAny.verdict),
      file: localFile,
      durationMs,
    });
  }

  for (const child of childSuites) {
    collectTapPointsFromSuite(child, localFile, fullPath, points);
  }
}

function suiteDuration(value: unknown): number | undefined {
  const time = value as Record<string, unknown> | undefined;
  if (!time) return undefined;
  const start = Number(time.start ?? 0);
  const end = Number(time.end ?? 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return undefined;
  }
  return end - start;
}

function parseLocation(value: unknown): Location {
  const text = String(value ?? "").trim();
  if (!text.length) return {};
  const match = /^(\d+)(?::(\d+))?$/.exec(text);
  if (!match) return {};
  const line = Number(match[1]);
  const column = match[2] ? Number(match[2]) : undefined;
  return {
    line: Number.isFinite(line) && line > 0 ? line : undefined,
    column:
      typeof column == "number" && Number.isFinite(column) && column > 0
        ? column
        : undefined,
  };
}

function normalizeStatus(verdict: unknown): TapStatus {
  const value = String(verdict ?? "none");
  if (value == "fail") return "fail";
  if (value == "ok") return "ok";
  return "skip";
}

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value == "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildFailureMessage(
  message: string,
  matcher: string,
  expected: string,
  actual: string,
): string {
  if (message.length) return message;
  if (matcher.length && expected.length && actual.length) {
    return `${matcher} expected ${expected} but received ${actual}`;
  }
  if (matcher.length) return `${matcher} failed`;
  return "assertion failed";
}

function sanitizeTap(name: string): string {
  return name.replace(/\s+/g, " ").replace(/#/g, "\\#").trim();
}

function emitGitHubAnnotation(context: ReporterContext, point: TapPoint): void {
  if (process.env.GITHUB_ACTIONS != "true" || point.status != "fail") return;

  const properties: string[] = [];
  if (point.file) {
    properties.push(`file=${escapeGithubValue(point.file, true)}`);
  }
  if (point.line) {
    properties.push(`line=${point.line}`);
  }
  if (point.column) {
    properties.push(`col=${point.column}`);
  }
  properties.push(`title=${escapeGithubValue("as-test", true)}`);

  const message = point.message?.length ? point.message : "assertion failed";
  const detail = `${message} | test=${point.name}`;
  context.stdout.write(
    `::error ${properties.join(",")}::${escapeGithubValue(detail)}\n`,
  );
}

function escapeGithubValue(value: string, property: boolean = false): string {
  let output = value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");

  if (property) {
    output = output.replace(/:/g, "%3A").replace(/,/g, "%2C");
  }
  return output;
}
