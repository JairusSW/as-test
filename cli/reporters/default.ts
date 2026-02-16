import chalk from "chalk";
import { diff } from "typer-diff";
import { formatTime } from "../util.js";
import {
  ProgressEvent,
  ReporterContext,
  ReporterFactory,
  RealtimeFailureEvent,
  RunCompleteEvent,
  SnapshotMissingEvent,
  SnapshotSummary,
  TestReporter,
} from "./types.js";

export const createReporter: ReporterFactory = (
  context: ReporterContext,
): TestReporter => {
  return new DefaultReporter(context);
};

class DefaultReporter implements TestReporter {
  private currentFile: string | null = null;
  private openSuites: { depth: number; description: string }[] = [];
  private renderedLines = 0;
  private fileHasWarning = false;

  constructor(private readonly context: ReporterContext) {}

  private canRewriteLine(): boolean {
    return Boolean((this.context.stdout as { isTTY?: boolean }).isTTY);
  }

  private badgeRunning(): string {
    return chalk.bgBlackBright.white(" .... ");
  }

  private badgeFromVerdict(verdict: string): string {
    if (verdict == "ok") return chalk.bgGreenBright.black(" PASS ");
    if (verdict == "fail") return chalk.bgRed.white(" FAIL ");
    return chalk.bgBlackBright.white(" SKIP ");
  }

  private clearRenderedBlock(): void {
    if (!this.renderedLines || !this.canRewriteLine()) return;
    for (let i = 0; i < this.renderedLines; i++) {
      this.context.stdout.write("\r\x1b[2K");
      if (i < this.renderedLines - 1) {
        this.context.stdout.write("\x1b[1A");
      }
    }
    this.renderedLines = 0;
  }

  private drawLiveBlock(lines: string[]): void {
    this.clearRenderedBlock();
    if (!lines.length) return;
    this.context.stdout.write(lines.join("\n"));
    this.renderedLines = lines.length;
  }

  private renderLiveState(): void {
    if (!this.canRewriteLine() || !this.currentFile) return;
    const lines = [`${this.badgeRunning()} ${this.currentFile}`];
    for (const suite of this.openSuites) {
      lines.push(
        `${"  ".repeat(suite.depth + 1)}${this.badgeRunning()} ${suite.description}`,
      );
    }
    this.drawLiveBlock(lines);
  }

  private collapseToDepth(depth: number): void {
    while (this.openSuites.length > depth) {
      this.openSuites.pop();
    }
  }

  private renderSuiteCompleteFrame(
    depth: number,
    description: string,
    verdict: string,
  ): void {
    if (!this.canRewriteLine() || !this.currentFile) return;
    const lines = [`${this.badgeRunning()} ${this.currentFile}`];
    for (let i = 0; i < depth; i++) {
      const suite = this.openSuites[i];
      if (!suite) continue;
      lines.push(
        `${"  ".repeat(suite.depth + 1)}${this.badgeRunning()} ${suite.description}`,
      );
    }
    lines.push(
      `${"  ".repeat(depth + 1)}${this.badgeFromVerdict(verdict)} ${description}`,
    );
    this.drawLiveBlock(lines);
  }

  private renderFileResult(event: ProgressEvent): string {
    const verdict = event.verdict ?? "none";
    const time = event.time ? ` ${chalk.dim(event.time)}` : "";
    if (verdict == "fail") return `${chalk.bgRed.white(" FAIL ")} ${event.file}${time}`;
    if (this.fileHasWarning)
      return `${chalk.bgYellow.black(" WARN ")} ${event.file}${time}`;
    if (verdict == "ok") return `${chalk.bgGreenBright.black(" PASS ")} ${event.file}${time}`;
    return `${chalk.bgBlackBright.white(" SKIP ")} ${event.file}${time}`;
  }

  onRunStart(event: {
    runtimeName: string;
    clean: boolean;
    snapshotEnabled: boolean;
    updateSnapshots: boolean;
  }): void {
    if (event.clean) return;
    if (event.snapshotEnabled) {
      this.context.stdout.write(
        chalk.bgBlue(" SNAPSHOT ") +
          ` ${chalk.dim(event.updateSnapshots ? "update mode enabled" : "read-only mode")}\n\n`,
      );
    }
  }

  onFileStart(event: ProgressEvent): void {
    this.currentFile = event.file;
    this.openSuites = [];
    this.fileHasWarning = false;
    if (!this.canRewriteLine()) {
      this.context.stdout.write(`${this.badgeRunning()} ${event.file}\n`);
      return;
    }
    this.renderLiveState();
  }

  onFileEnd(event: ProgressEvent): void {
    const result = this.renderFileResult(event);
    this.clearRenderedBlock();
    this.context.stdout.write(`${result}\n`);
    this.currentFile = null;
    this.openSuites = [];
    this.fileHasWarning = false;
  }

  onSuiteStart(event: ProgressEvent): void {
    const depth = Math.max(event.depth, 0);
    if (!this.canRewriteLine()) {
      this.context.stdout.write(
        `${"  ".repeat(depth + 1)}${this.badgeRunning()} ${event.description}\n`,
      );
      return;
    }
    if (this.currentFile !== event.file) return;
    this.collapseToDepth(depth);
    this.openSuites.push({ depth, description: event.description });
    this.renderLiveState();
  }

  onSuiteEnd(event: ProgressEvent): void {
    const depth = Math.max(event.depth, 0);
    const verdict = String(event.verdict ?? "none");
    if (!this.canRewriteLine()) {
      this.context.stdout.write(
        `${"  ".repeat(depth + 1)}${this.badgeFromVerdict(verdict)} ${event.description}\n`,
      );
      return;
    }
    if (this.currentFile !== event.file) return;
    this.collapseToDepth(depth + 1);
    const current = this.openSuites[depth];
    const description = event.description || current?.description || "suite";
    if (!current) {
      this.openSuites.push({ depth, description });
    } else {
      current.description = description;
    }
    this.renderSuiteCompleteFrame(depth, description, verdict);
    this.collapseToDepth(depth);
    this.renderLiveState();
  }

  onAssertionFail(_event: RealtimeFailureEvent): void {}

  onSnapshotMissing(event: SnapshotMissingEvent): void {
    this.fileHasWarning = true;
    const warnLine = `${chalk.bgYellow.black(" WARN ")} missing snapshot for ${chalk.dim(event.key)}. Re-run with ${chalk.bold("--update-snapshots")} to create it.\n`;
    if (!this.canRewriteLine() || !this.currentFile) {
      this.context.stdout.write(warnLine);
      return;
    }
    this.clearRenderedBlock();
    this.context.stdout.write(warnLine);
    this.renderLiveState();
  }

  onRunComplete(event: RunCompleteEvent): void {
    this.clearRenderedBlock();
    if (!event.clean) {
      renderFailedSuites(event.stats.failedEntries);
    }
    if (event.snapshotEnabled) {
      renderSnapshotSummary(event.snapshotSummary);
    }
    if (event.coverageSummary.enabled) {
      renderCoverageSummary(event.coverageSummary);
      if (event.showCoverage && event.coverageSummary.uncovered) {
        renderCoveragePoints(event.coverageSummary.files);
      }
    }
    renderTotals(event.stats);
  }
}

function renderFailedSuites(failedEntries: unknown[]): void {
  if (!failedEntries.length) return;
  console.log("");
  const printed = new Set<string>();
  for (const failed of failedEntries) {
    const failedAny = failed as Record<string, unknown>;
    if (!failedAny?.file) continue;
    const file = String(failedAny.file);
    collectSuiteFailures(failed, file, [], printed);
  }
}

function collectSuiteFailures(
  suite: unknown,
  file: string,
  path: string[],
  printed: Set<string>,
): void {
  const suiteAny = suite as Record<string, unknown>;
  const nextPath = [...path, String(suiteAny.description ?? "unknown")];
  const tests = Array.isArray(suiteAny.tests)
    ? (suiteAny.tests as Record<string, unknown>[])
    : [];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i]!;
    if (test.verdict != "fail") continue;
    const assertionIndex = i + 1;
    const title = `${nextPath.join(" > ")}#${assertionIndex}`;
    const loc = String(test.location ?? "");
    const where = loc.length ? `${file}:${loc}` : file;
    const dedupeKey = `${file}::${title}::${String(test.left)}::${String(test.right)}`;
    if (printed.has(dedupeKey)) continue;
    printed.add(dedupeKey);

    const left = JSON.stringify(test.left);
    const right = JSON.stringify(test.right);
    const diffResult = diff(left, right);
    let expected = "";
    for (const res of diffResult.diff) {
      switch (res.type) {
        case "correct":
          expected += chalk.dim(res.value);
          break;
        case "extra":
          expected += chalk.red.strikethrough(res.value);
          break;
        case "missing":
          expected += chalk.bgBlack(res.value);
          break;
        case "wrong":
          expected += chalk.bgRed(res.value);
          break;
        case "untouched":
        case "spacer":
          break;
      }
    }

    console.log(
      `${chalk.bgRed(" FAIL ")} ${chalk.dim(title)} ${chalk.dim("(" + where + ")")}`,
    );
    console.log(`${chalk.dim("(expected) ->")} ${expected}`);
    console.log(`${chalk.dim("(received) ->")} ${chalk.dim(left)}\n`);
  }

  const suites = Array.isArray(suiteAny.suites)
    ? (suiteAny.suites as unknown[])
    : [];
  for (const sub of suites) {
    collectSuiteFailures(sub, file, nextPath, printed);
  }
}

function renderSnapshotSummary(snapshotSummary: SnapshotSummary): void {
  console.log("");
  console.log(
    `${chalk.bold("Snapshots:")} ${chalk.greenBright(snapshotSummary.matched)} matched, ${chalk.blueBright(snapshotSummary.created)} created, ${chalk.blueBright(snapshotSummary.updated)} updated, ${snapshotSummary.failed ? chalk.red(snapshotSummary.failed) : chalk.greenBright("0")} failed`,
  );
}

function renderTotals(stats: {
  failedFiles: number;
  passedFiles: number;
  skippedFiles: number;
  failedSuites: number;
  passedSuites: number;
  skippedSuites: number;
  failedTests: number;
  passedTests: number;
  skippedTests: number;
  time: number;
}): void {
  console.log("");
  process.stdout.write(chalk.bold("Files:  "));
  process.stdout.write(
    stats.failedFiles
      ? chalk.bold.red(stats.failedFiles + " failed")
      : chalk.bold.greenBright("0 failed"),
  );
  process.stdout.write(
    ", " +
      (stats.skippedFiles
        ? chalk.gray(stats.skippedFiles + " skipped")
        : chalk.gray("0 skipped")),
  );
  process.stdout.write(
    ", " +
      (stats.failedFiles + stats.passedFiles + stats.skippedFiles) +
      " total\n",
  );

  process.stdout.write(chalk.bold("Suites: "));
  process.stdout.write(
    stats.failedSuites
      ? chalk.bold.red(stats.failedSuites + " failed")
      : chalk.bold.greenBright("0 failed"),
  );
  process.stdout.write(
    ", " +
      (stats.skippedSuites
        ? chalk.gray(stats.skippedSuites + " skipped")
        : chalk.gray("0 skipped")),
  );
  process.stdout.write(
    ", " +
      (stats.failedSuites + stats.passedSuites + stats.skippedSuites) +
      " total\n",
  );

  process.stdout.write(chalk.bold("Tests:  "));
  process.stdout.write(
    stats.failedTests
      ? chalk.bold.red(stats.failedTests + " failed")
      : chalk.bold.greenBright("0 failed"),
  );
  process.stdout.write(
    ", " +
      (stats.skippedTests
        ? chalk.gray(stats.skippedTests + " skipped")
        : chalk.gray("0 skipped")),
  );
  process.stdout.write(
    ", " + (stats.failedTests + stats.passedTests + stats.skippedTests) + " total\n",
  );

  process.stdout.write(chalk.bold("Time:   ") + formatTime(stats.time) + "\n");
}

function renderCoverageSummary(summary: {
  total: number;
  covered: number;
  uncovered: number;
  percent: number;
}): void {
  const pct = summary.total
    ? ((summary.covered * 100) / summary.total).toFixed(2)
    : "100.00";
  const color =
    Number(pct) >= 90
      ? chalk.greenBright
      : Number(pct) >= 75
        ? chalk.yellowBright
        : chalk.redBright;
  console.log("");
  console.log(
    `${chalk.bold("Coverage:")} ${color(pct + "%")} ${chalk.dim(`(${summary.covered}/${summary.total} points, ${summary.uncovered} uncovered)${Number(pct) < 100.0 ? " run with --show-coverage to see details" : ""}`)}`,
  );
}

function renderCoveragePoints(
  files: {
    file: string;
    points: {
      file: string;
      line: number;
      column: number;
      type: string;
      executed: boolean;
    }[];
  }[],
): void {
  console.log("");
  console.log(chalk.bold("Coverage Points:"));
  const sortedFiles = [...files].sort((a, b) => a.file.localeCompare(b.file));
  for (const file of sortedFiles) {
    const points = [...file.points].sort((a, b) => {
      if (a.line != b.line) return a.line - b.line;
      if (a.column != b.column) return a.column - b.column;
      return a.type.localeCompare(b.type);
    });
    for (const point of points) {
      if (point.executed) continue;
      console.log(
        `${chalk.bgRed(" MISS ")} ${chalk.dim(`${point.file}:${point.line}:${point.column}`)} ${chalk.dim(point.type)}`,
      );
    }
  }
}
