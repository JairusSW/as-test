import chalk from "chalk";
import { diff } from "typer-diff";
import { readFileSync } from "fs";
import * as path from "path";
import { formatTime } from "../util.js";
import {
  FuzzCompleteEvent,
  FuzzFileCompleteEvent,
  FuzzResult,
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
  private verboseSuites: {
    depth: number;
    description: string;
    verdict: string;
  }[] = [];
  private renderedLines = 0;
  private fileHasWarning = false;
  private verboseMode = false;
  private cleanMode = false;
  private hasRenderedTestFiles = false;
  private hasRenderedFuzzFiles = false;

  constructor(private readonly context: ReporterContext) {}

  private canRewriteLine(): boolean {
    return (
      !this.cleanMode &&
      Boolean((this.context.stdout as { isTTY?: boolean }).isTTY)
    );
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

  private renderVerboseState(fileEnd?: ProgressEvent): void {
    if (!this.canRewriteLine() || !this.currentFile) return;
    const lines = [
      fileEnd
        ? this.renderFileResult(fileEnd)
        : `${this.badgeRunning()} ${this.currentFile}`,
    ];
    for (const suite of this.verboseSuites) {
      const badge =
        suite.verdict == "running"
          ? this.badgeRunning()
          : this.badgeFromVerdict(suite.verdict);
      lines.push(
        `${"  ".repeat(suite.depth + 1)}${badge} ${suite.description}`,
      );
    }
    this.drawLiveBlock(lines);
  }

  private setVerboseSuiteVerdict(
    depth: number,
    description: string,
    verdict: string,
  ): void {
    for (let i = this.verboseSuites.length - 1; i >= 0; i--) {
      const suite = this.verboseSuites[i]!;
      if (
        suite.depth == depth &&
        (!description.length || suite.description == description) &&
        suite.verdict == "running"
      ) {
        if (description.length) suite.description = description;
        suite.verdict = verdict;
        return;
      }
    }
    this.verboseSuites.push({ depth, description, verdict });
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
    if (verdict == "fail")
      return `${chalk.bgRed.white(" FAIL ")} ${event.file}${time}`;
    if (this.fileHasWarning)
      return `${chalk.bgYellow.black(" WARN ")} ${event.file}${time}`;
    if (verdict == "ok")
      return `${chalk.bgGreenBright.black(" PASS ")} ${event.file}${time}`;
    return `${chalk.bgBlackBright.white(" SKIP ")} ${event.file}${time}`;
  }

  onRunStart(event: {
    runtimeName: string;
    clean: boolean;
    verbose: boolean;
    snapshotEnabled: boolean;
    createSnapshots: boolean;
  }): void {
    this.verboseMode = Boolean(event.verbose);
    this.cleanMode = Boolean(event.clean);
    this.hasRenderedTestFiles = false;
    this.hasRenderedFuzzFiles = false;
  }

  onFileStart(event: ProgressEvent): void {
    this.currentFile = event.file;
    this.openSuites = [];
    this.verboseSuites = [];
    this.fileHasWarning = false;
    if (this.cleanMode) return;
    if (this.verboseMode && this.canRewriteLine()) {
      this.renderVerboseState();
      return;
    }
    if (!this.verboseMode) {
      if (!this.canRewriteLine()) {
        this.context.stdout.write(`${this.badgeRunning()} ${event.file}\n`);
        return;
      }
      this.clearRenderedBlock();
      this.context.stdout.write(`${this.badgeRunning()} ${event.file}`);
      this.renderedLines = 1;
      return;
    }
    if (!this.canRewriteLine()) {
      this.context.stdout.write(`${this.badgeRunning()} ${event.file}\n`);
      return;
    }
    this.renderLiveState();
  }

  onFileEnd(event: ProgressEvent): void {
    this.hasRenderedTestFiles = true;
    if (this.verboseMode && this.canRewriteLine()) {
      this.renderVerboseState(event);
      this.context.stdout.write("\n");
      this.renderedLines = 0;
      this.currentFile = null;
      this.openSuites = [];
      this.verboseSuites = [];
      this.fileHasWarning = false;
      return;
    }

    const result = this.renderFileResult(event);
    this.clearRenderedBlock();
    this.context.stdout.write(`${result}\n`);
    this.currentFile = null;
    this.openSuites = [];
    this.verboseSuites = [];
    this.fileHasWarning = false;
  }

  onSuiteStart(event: ProgressEvent): void {
    if (this.cleanMode) return;
    if (!this.verboseMode) return;
    const depth = Math.max(event.depth, 0);
    if (this.verboseMode && this.canRewriteLine()) {
      if (this.currentFile !== event.file) return;
      this.verboseSuites.push({
        depth,
        description: event.description,
        verdict: "running",
      });
      this.renderVerboseState();
      return;
    }
    if (this.verboseMode || !this.canRewriteLine()) {
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
    if (this.cleanMode) return;
    if (!this.verboseMode) return;
    const depth = Math.max(event.depth, 0);
    const verdict = String(event.verdict ?? "none");
    if (this.verboseMode && this.canRewriteLine()) {
      if (this.currentFile !== event.file) return;
      this.setVerboseSuiteVerdict(depth, event.description, verdict);
      this.renderVerboseState();
      return;
    }
    if (this.verboseMode || !this.canRewriteLine()) {
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
    const warnLine = `${chalk.bgYellow.black(" WARN ")} missing snapshot for ${chalk.dim(event.key)}. Re-run with ${chalk.bold("--create-snapshots")} to create it.\n`;
    if (!this.canRewriteLine() || !this.currentFile) {
      this.context.stdout.write(warnLine);
      return;
    }
    this.clearRenderedBlock();
    this.context.stdout.write(warnLine);
    if (this.verboseMode) {
      this.renderVerboseState();
    } else {
      this.renderLiveState();
    }
  }

  onWarning(event: { message: string }): void {
    this.fileHasWarning = true;
    const warnLine = `${chalk.bgYellow.black(" WARN ")} ${event.message}\n`;
    if (!this.canRewriteLine() || !this.currentFile) {
      this.context.stdout.write(warnLine);
      return;
    }
    this.clearRenderedBlock();
    this.context.stdout.write(warnLine);
    if (this.verboseMode) {
      this.renderVerboseState();
    } else {
      this.renderLiveState();
    }
  }

  onLog(event: { depth: number; text: string }): void {
    if (this.cleanMode) return;
    if (this.verboseMode || !this.canRewriteLine()) {
      const depth = Math.max(event.depth, 0);
      this.context.stdout.write(
        `${"  ".repeat(depth + 1)}${chalk.dim("LOG")} ${event.text}\n`,
      );
    }
  }

  onRunComplete(event: RunCompleteEvent): void {
    this.clearRenderedBlock();
    if (!event.clean) {
      renderFailedSuites(event.stats.failedEntries);
    }
    if (event.snapshotEnabled) {
      renderSnapshotSummary(event.snapshotSummary, true);
    }
    if (event.coverageSummary.enabled) {
      renderCoverageSummary(event.coverageSummary);
      if (event.showCoverage && event.coverageSummary.uncovered) {
        renderCoveragePoints(event.coverageSummary.files);
      }
    }
    renderTotals(event.stats, event);
  }

  onFuzzComplete(event: FuzzCompleteEvent): void {
    renderFuzzSummary(this.context, event, this.hasRenderedTestFiles);
  }

  onFuzzFileComplete(event: FuzzFileCompleteEvent): void {
    this.hasRenderedFuzzFiles = true;
    renderFuzzFileSummary(this.context, event.results);
  }
}

function renderFuzzFileSummary(
  context: ReporterContext,
  results: FuzzResult[],
): void {
  if (!results.length) return;
  const file = results[0]!.file;
  const itemFailed = results.some(
    (mode) =>
      mode.crashes > 0 || mode.fuzzers.some((fuzzer) => fuzzer.failed > 0),
  );
  const itemSkipped =
    !itemFailed &&
    results.length > 0 &&
    results.every(
      (mode) =>
        mode.fuzzers.length > 0 &&
        mode.fuzzers.every((fuzzer) => fuzzer.skipped > 0),
    );
  const itemBadge = itemFailed
    ? chalk.bgRed.white(" FAIL ")
    : itemSkipped
      ? chalk.bgBlackBright.white(" SKIP ")
      : chalk.bgGreenBright.black(" PASS ");
  const detail = formatTime(averageFuzzModeTime(results));
  const crashFile = firstFuzzCrashFile(results);
  const crashSuffix =
    crashFile != null ? ` ${chalk.dim(`-> ${crashFile}`)}` : "";
  context.stdout.write(
    `${itemBadge} ${path.basename(file)} ${chalk.dim(detail)}${crashSuffix}\n`,
  );
  renderFailedFuzzers(groupFuzzResultsByFile(results));
}

function renderFuzzSummary(
  context: ReporterContext,
  event: FuzzCompleteEvent,
  hasRenderedTestFiles: boolean,
): void {
  context.stdout.write("\n");
  if (!hasRenderedTestFiles) {
    renderStandaloneFuzzTotals(event);
  }
}

function renderFailedFuzzers(
  results: ReturnType<typeof groupFuzzResultsByFile>,
): boolean {
  let rendered = false;
  for (const result of results) {
    for (const modeResult of result.modes) {
      const relativeFile = toRelativeResultPath(modeResult.file);
      const repro = buildFuzzReproCommand(
        relativeFile,
        modeResult.seed,
        modeResult.modeName,
      );

      if (modeResult.crashes > 0 && !modeResult.fuzzers.length) {
        if (!rendered) {
          console.log("");
          rendered = true;
        }
        console.log(
          `${chalk.bgRed(" FAIL ")} ${chalk.dim(path.basename(modeResult.file))} ${chalk.dim("(crash)")}`,
        );
        console.log(chalk.dim(`Mode: ${modeResult.modeName}`));
        console.log(chalk.dim(`Runs: ${modeResult.runs} configured`));
        console.log(chalk.dim(`Repro: ${repro}`));
        console.log(chalk.dim(`Seed: ${modeResult.seed}`));
        if (modeResult.crashFiles.length) {
          console.log(
            chalk.dim(`Crash: ${modeResult.crashFiles[0] as string}`),
          );
        }
        console.log("");
        continue;
      }

      for (const fuzzer of modeResult.fuzzers) {
        if (fuzzer.failed <= 0 && fuzzer.crashed <= 0) continue;
        if (!rendered) {
          console.log("");
          rendered = true;
        }

        console.log(
          `${chalk.bgRed(" FAIL ")} ${formatFuzzFailureTitle(
            modeResult.file,
            fuzzer.name,
          )}`,
        );
        if (fuzzer.failure?.message?.length) {
          console.log(chalk.dim(`Message: ${fuzzer.failure.message}`));
        }
        console.log(chalk.dim(`Mode: ${modeResult.modeName}`));
        console.log(
          chalk.dim(
            `Runs: ${fuzzer.passed + fuzzer.failed + fuzzer.crashed} completed (${fuzzer.passed} passed, ${fuzzer.failed} failed, ${fuzzer.crashed} crashed)`,
          ),
        );
        console.log(chalk.dim(`Repro: ${repro}`));
        console.log(chalk.dim(`Seed: ${modeResult.seed}`));
        if (modeResult.crashFiles.length) {
          console.log(
            chalk.dim(`Crash: ${modeResult.crashFiles[0] as string}`),
          );
        }
        console.log("");
      }
    }
  }
  return rendered;
}

function groupFuzzResultsByFile(results: FuzzCompleteEvent["results"]): {
  file: string;
  modes: FuzzCompleteEvent["results"];
}[] {
  const grouped = new Map<string, FuzzCompleteEvent["results"]>();
  for (const result of results) {
    const current = grouped.get(result.file) ?? [];
    current.push(result);
    grouped.set(result.file, current);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, modes]) => ({ file, modes }));
}

function firstFuzzCrashFile(
  results: FuzzCompleteEvent["results"],
): string | null {
  for (const result of results) {
    if (result.crashFiles.length) return result.crashFiles[0] as string;
  }
  return null;
}

function averageFuzzModeTime(results: FuzzCompleteEvent["results"]): number {
  if (!results.length) return 0;
  return results.reduce((sum, result) => sum + result.time, 0) / results.length;
}

function buildFuzzReproCommand(
  file: string,
  seed: number,
  modeName: string,
): string {
  const modeArg = modeName != "default" ? ` --mode ${modeName}` : "";
  return `ast fuzz ${file}${modeArg} --seed ${seed}`;
}

function toRelativeResultPath(file: string): string {
  const relative = path.relative(
    process.cwd(),
    path.resolve(process.cwd(), file),
  );
  return relative.length ? relative : file;
}

function formatFuzzFailureTitle(file: string, name: string): string {
  const location = findFuzzLocation(file, name);
  const suffix = location
    ? ` (${path.basename(file)}:${location})`
    : ` (${path.basename(file)})`;
  return `${chalk.dim(name)}${chalk.dim(suffix)}`;
}

function findFuzzLocation(file: string, name: string): string | null {
  try {
    const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
    const patterns = [`fuzz("${name}"`, `fuzz('${name}'`];
    patterns.push(`xfuzz("${name}"`, `xfuzz('${name}'`);
    let index = -1;
    for (const pattern of patterns) {
      index = source.indexOf(pattern);
      if (index != -1) break;
    }
    if (index == -1) return null;

    let line = 1;
    let column = 1;
    for (let i = 0; i < index; i++) {
      if (source.charCodeAt(i) == 10) {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return `${line}:${column}`;
  } catch {
    return null;
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
    const modeName = String(suiteAny.modeName ?? "");
    const dedupeKey = `${file}::${modeName}::${title}::${String(test.left)}::${String(test.right)}`;
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
    if (modeName.length) {
      console.log(chalk.dim(`Mode: ${modeName}`));
    }
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

function renderSnapshotSummary(
  snapshotSummary: SnapshotSummary,
  leadingGap: boolean = true,
): void {
  if (leadingGap) {
    console.log("");
  }
  console.log(
    `${chalk.bold("Snapshots:")} ${chalk.greenBright(snapshotSummary.matched)} matched, ${chalk.blueBright(snapshotSummary.created)} created, ${chalk.blueBright(snapshotSummary.updated)} updated, ${snapshotSummary.failed ? chalk.red(snapshotSummary.failed) : chalk.greenBright("0")} failed`,
  );
}

function renderTotals(
  stats: {
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
  },
  event: RunCompleteEvent,
): void {
  console.log("");
  const filesSummary = {
    failed: stats.failedFiles,
    skipped: stats.skippedFiles,
    total: stats.failedFiles + stats.passedFiles + stats.skippedFiles,
  };
  const suitesSummary = {
    failed: stats.failedSuites,
    skipped: stats.skippedSuites,
    total: stats.failedSuites + stats.passedSuites + stats.skippedSuites,
  };
  const testsSummary = {
    failed: stats.failedTests,
    skipped: stats.skippedTests,
    total: stats.failedTests + stats.passedTests + stats.skippedTests,
  };
  const layout = createSummaryLayout([
    event.fuzzSummary,
    filesSummary,
    suitesSummary,
    testsSummary,
    event.modeSummary,
  ]);
  if (event.fuzzSummary) {
    renderFuzzTotals(event.fuzzSummary, layout);
  }
  renderSummaryLine("Files:", filesSummary, layout);
  renderSummaryLine("Suites:", suitesSummary, layout);
  renderSummaryLine("Tests:", testsSummary, layout);

  if (event.modeSummary) {
    renderModeSummary(event.modeSummary, layout);
  }

  process.stdout.write(
    chalk.bold("Time:".padEnd(9)) + formatTime(stats.time) + "\n",
  );
}

function renderModeSummary(
  summary: {
    failed: number;
    skipped: number;
    total: number;
  },
  layout?: SummaryLayout,
): void {
  renderSummaryLine("Modes:", summary, layout);
}

function renderFuzzTotals(
  summary: {
    failed: number;
    skipped: number;
    total: number;
  },
  layout?: SummaryLayout,
): void {
  renderSummaryLine("Fuzz:", summary, layout);
}

function renderStandaloneFuzzTotals(event: FuzzCompleteEvent): void {
  console.log("");
  const layout = createSummaryLayout([
    event.fuzzingSummary,
    event.suiteSummary,
    event.modeSummary,
  ]);
  renderSummaryLine("Fuzz:", event.fuzzingSummary, layout);
  renderSummaryLine("Suites:", event.suiteSummary, layout);
  renderSummaryLine("Modes:", event.modeSummary, layout);
  process.stdout.write(
    chalk.bold("Time:".padEnd(9)) + formatTime(event.time) + "\n",
  );
}

type SummaryLayout = {
  failedWidth: number;
  skippedWidth: number;
  totalWidth: number;
};

function createSummaryLayout(
  summaries: Array<
    | {
        failed: number;
        skipped: number;
        total: number;
      }
    | undefined
  >,
): SummaryLayout {
  return {
    failedWidth: Math.max(
      ...summaries.map((summary) =>
        summary ? `${summary.failed} failed`.length : 0,
      ),
    ),
    skippedWidth: Math.max(
      ...summaries.map((summary) =>
        summary ? `${summary.skipped} skipped`.length : 0,
      ),
    ),
    totalWidth: Math.max(
      ...summaries.map((summary) =>
        summary ? `${summary.total} total`.length : 0,
      ),
    ),
  };
}

function renderSummaryLine(
  label: string,
  summary: {
    failed: number;
    skipped: number;
    total: number;
  },
  layout: SummaryLayout = {
    failedWidth: `${summary.failed} failed`.length,
    skippedWidth: `${summary.skipped} skipped`.length,
    totalWidth: `${summary.total} total`.length,
  },
): void {
  const failedText = `${summary.failed} failed`;
  const skippedText = `${summary.skipped} skipped`;
  const totalText = `${summary.total} total`;
  process.stdout.write(chalk.bold(label.padEnd(9)));
  process.stdout.write(
    summary.failed
      ? chalk.bold.red(failedText.padStart(layout.failedWidth))
      : chalk.bold.greenBright(failedText.padStart(layout.failedWidth)),
  );
  process.stdout.write(", ");
  process.stdout.write(chalk.gray(skippedText.padStart(layout.skippedWidth)));
  process.stdout.write(", ");
  process.stdout.write(totalText.padStart(layout.totalWidth) + "\n");
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
    `${chalk.bold("Coverage:")} ${color(pct + "%")} ${chalk.dim(`(${summary.covered}/${summary.total} points, ${summary.uncovered} uncovered)`)}`,
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
