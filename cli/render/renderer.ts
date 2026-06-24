import chalk from "chalk";
import { diff } from "typer-diff";
import { readFileSync } from "fs";
import * as path from "path";
import { formatSpecDisplayPath, formatTime } from "../util.js";
import { describeCoveragePoint } from "../coverage-points.js";
import {
  FuzzCompleteEvent,
  FuzzFileCompleteEvent,
  FuzzResult,
  LogEvent,
  ProgressEvent,
  RenderContext,
  RealtimeFailureEvent,
  RunCompleteEvent,
  RunStartEvent,
  SnapshotMissingEvent,
  SnapshotSummary,
  WarningEvent,
} from "./types.js";

// The single built-in console renderer. There is no pluggable reporter layer —
// run-core/index drive this class directly. `SilentRenderer` (below) is the
// no-op variant used where a run must produce no live output (matrix paths that
// format their own result lines).
export class TestRenderer {
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
  private showLogsMode = false;
  private hasRenderedTestFiles = false;
  private hasRenderedFuzzFiles = false;

  constructor(private readonly context: RenderContext) {}

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
    const lines = [
      `${this.badgeRunning()} ${formatSpecDisplayPath(this.currentFile)}`,
    ];
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
        : `${this.badgeRunning()} ${formatSpecDisplayPath(this.currentFile)}`,
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
    const name = formatSpecDisplayPath(event.file);
    // A replayed (cached) result is de-emphasized: badge, filename, and tag are
    // all dimmed so freshly-run specs stand out from unchanged ones.
    if (event.cached) {
      // Replayed-from-cache: keep the coloured verdict badge (white text) so it
      // stays scannable, but dim the filename and show "(cache)" in place of the
      // timing so freshly-run specs still stand out.
      const badge =
        verdict == "fail"
          ? chalk.bgRed.white(" FAIL ")
          : verdict == "ok"
            ? chalk.bgGreenBright.white(" PASS ")
            : chalk.bgBlackBright.white(" SKIP ");
      return `${badge} ${chalk.dim(name)} ${chalk.dim("(cache)")}`;
    }
    if (verdict == "fail")
      return `${chalk.bgRed.white(" FAIL ")} ${name}${time}`;
    if (this.fileHasWarning)
      return `${chalk.bgYellow.black(" WARN ")} ${name}${time}`;
    if (verdict == "ok")
      return `${chalk.bgGreenBright.black(" PASS ")} ${name}${time}`;
    return `${chalk.bgBlackBright.white(" SKIP ")} ${name}${time}`;
  }

  onRunStart(event: RunStartEvent): void {
    this.verboseMode = Boolean(event.verbose);
    this.cleanMode = Boolean(event.clean);
    this.showLogsMode = Boolean(event.showLogs);
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
        this.context.stdout.write(
          `${this.badgeRunning()} ${formatSpecDisplayPath(event.file)}\n`,
        );
        return;
      }
      this.clearRenderedBlock();
      this.context.stdout.write(
        `${this.badgeRunning()} ${formatSpecDisplayPath(event.file)}`,
      );
      this.renderedLines = 1;
      return;
    }
    if (!this.canRewriteLine()) {
      this.context.stdout.write(
        `${this.badgeRunning()} ${formatSpecDisplayPath(event.file)}\n`,
      );
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

  onWarning(event: WarningEvent): void {
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

  onLog(event: LogEvent): void {
    if (this.cleanMode) return;
    // With --show-logs we print one clean grouped block at the end instead of
    // streaming inline, so suppress the inline emit here.
    if (this.showLogsMode) return;
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
      renderCoverageSummary(
        event.coverageSummary,
        event.showCoverage,
        Boolean(event.verbose),
      );
      if (event.showCoverage && event.coverageSummary.uncovered) {
        renderCoveragePoints(
          event.coverageSummary.files,
          Boolean(event.verbose || event.showCoverageAll),
        );
      }
    }
    renderTotals(event.stats, event);
    this.renderLogs(event);
  }

  // After the totals: either point the user at the aggregated log file (default)
  // or, with --show-logs, print the captured logs (the same cross-mode-deduped
  // body that was written to latest.log). Skipped in clean mode. When logs were
  // already streamed inline (verbose or a non-TTY stream), we only re-point at
  // the file rather than printing them twice.
  private renderLogs(event: RunCompleteEvent): void {
    if (this.cleanMode) return;
    const summary = event.logSummary;
    if (!summary || summary.count <= 0) return;
    const out = this.context.stdout;
    const plural = summary.count === 1 ? "" : "s";

    // --show-logs: print the clean, cross-mode-deduped block (inline streaming
    // was suppressed in onLog). Otherwise just point at the aggregated file —
    // unless logs were already streamed inline (verbose / non-TTY).
    if (event.showLogs && summary.text) {
      out.write(`\n${chalk.bold(`Logs (${summary.count})`)}\n\n`);
      out.write(
        summary.text.endsWith("\n") ? summary.text : `${summary.text}\n`,
      );
      return;
    }

    const shownInline = this.verboseMode || !this.canRewriteLine();
    const where = summary.file ? ` → ${chalk.cyan(summary.file)}` : "";
    out.write(`\n${summary.count} log${plural} captured${where}\n`);
    if (!shownInline && summary.file) {
      out.write(`${chalk.dim("  run with --show-logs to print them")}\n`);
    }
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
  context: RenderContext,
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
    `${itemBadge} ${formatSpecDisplayPath(file)} ${chalk.dim(detail)}${crashSuffix}\n`,
  );
  renderFailedFuzzers(groupFuzzResultsByFile(results));
}

function renderFuzzSummary(
  context: RenderContext,
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
        modeResult.fuzzers[0]?.selector,
      );

      if (modeResult.crashes > 0 && !modeResult.fuzzers.length) {
        if (!rendered) {
          console.log("");
          rendered = true;
        }
        console.log(
          `${chalk.bgRed(" FAIL ")} ${chalk.dim(formatSpecDisplayPath(modeResult.file))} ${chalk.dim("(crash)")}`,
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
        const fuzzerRepro = buildFuzzReproCommand(
          relativeFile,
          modeResult.seed,
          modeResult.modeName,
          fuzzer.selector,
        );

        console.log(
          `${chalk.bgRed(" FAIL ")} ${formatFuzzFailureTitle(
            modeResult.file,
            fuzzer.name,
          )}`,
        );
        if (fuzzer.failure) {
          renderAssertionFailureDetails(
            fuzzer.failure.left,
            fuzzer.failure.right,
            fuzzer.failure.message,
          );
        }
        console.log(chalk.dim(`Mode: ${modeResult.modeName}`));
        console.log(
          chalk.dim(
            `Runs: ${fuzzer.passed + fuzzer.failed + fuzzer.crashed} completed (${fuzzer.passed} passed, ${fuzzer.failed} failed, ${fuzzer.crashed} crashed)`,
          ),
        );
        console.log(chalk.dim(`Repro: ${fuzzerRepro}`));
        console.log(chalk.dim(`Seed: ${modeResult.seed}`));
        if (fuzzer.failures?.length) {
          console.log(
            chalk.dim(`Failing seeds: ${formatFailingSeeds(fuzzer)}`),
          );
          for (const failure of fuzzer.failures) {
            console.log(
              chalk.dim(
                `Repro ${failure.run + 1}: ${buildFuzzReproCommand(relativeFile, failure.seed, modeResult.modeName, fuzzer.selector, 1)}`,
              ),
            );
            if (failure.input) {
              console.log(
                chalk.dim(
                  `Input ${failure.run + 1}: ${JSON.stringify(failure.input)}`,
                ),
              );
            }
          }
        }
        if (fuzzer.crashFile?.length) {
          console.log(chalk.dim(`Crash: ${fuzzer.crashFile}`));
        } else if (modeResult.crashFiles.length) {
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
  fuzzer?: string,
  runs?: number,
): string {
  const modeArg = modeName != "default" ? ` --mode ${modeName}` : "";
  const fuzzerArg = fuzzer?.length ? ` --fuzzer ${fuzzer}` : "";
  const runsArg = typeof runs == "number" ? ` --runs ${runs}` : "";
  return `ast fuzz ${file}${modeArg}${fuzzerArg} --seed ${seed}${runsArg}`;
}

function formatFailingSeeds(fuzzer: FuzzResult["fuzzers"][number]): string {
  return (fuzzer.failures ?? [])
    .map((failure) => String(failure.seed))
    .join(", ");
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
    ? ` (${formatSpecDisplayPath(file)}:${location})`
    : ` (${formatSpecDisplayPath(file)})`;
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
  const grouped = new Map<string, FailureDisplay>();
  for (const failed of failedEntries) {
    const failedAny = failed as Record<string, unknown>;
    if (!failedAny?.file) continue;
    const file = String(failedAny.file);
    collectSuiteFailures(failed, file, [], grouped);
  }
  for (const failure of grouped.values()) {
    renderCollectedFailure(failure);
  }
}

type FailureDisplay = {
  title: string;
  where: string;
  file: string;
  suitePath: string;
  left: unknown;
  right: unknown;
  message: string;
  isRuntimeError: boolean;
  isBuildError: boolean;
  modes: Set<string>;
  runCommands: Map<string, string>;
  buildCommands: Map<string, string>;
};

function collectSuiteFailures(
  suite: unknown,
  file: string,
  path: string[],
  grouped: Map<string, FailureDisplay>,
  inheritedModeName: string = "",
): void {
  const suiteAny = suite as Record<string, unknown>;
  const nextPath = [...path, String(suiteAny.description ?? "unknown")];
  const modeName = String(suiteAny.modeName ?? inheritedModeName);
  const isRuntimeErrorSuite = String(suiteAny.kind ?? "") == "runtime-error";
  const isBuildErrorSuite = String(suiteAny.kind ?? "") == "build-error";
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
    const suitePath = String(suiteAny.path ?? "");
    const message = String(test.message ?? "");
    const left = test.left;
    const right = test.right;
    const dedupeKey = `${file}::${title}::${String(left)}::${String(right)}::${message}`;
    let failure = grouped.get(dedupeKey);
    if (!failure) {
      failure = {
        title,
        where,
        file,
        suitePath,
        left,
        right,
        message,
        isRuntimeError:
          isRuntimeErrorSuite || String(test.type ?? "") == "runtime-error",
        isBuildError:
          isBuildErrorSuite || String(test.type ?? "") == "build-error",
        modes: new Set<string>(),
        runCommands: new Map<string, string>(),
        buildCommands: new Map<string, string>(),
      };
      grouped.set(dedupeKey, failure);
    }
    if (modeName.length) {
      failure.modes.add(modeName);
    }
    const runCommand = String(suiteAny.runCommand ?? "");
    if (modeName.length && runCommand.length) {
      failure.runCommands.set(modeName, runCommand);
    }
    const buildCommand = String(suiteAny.buildCommand ?? "");
    if (modeName.length && buildCommand.length) {
      failure.buildCommands.set(modeName, buildCommand);
    }
  }

  const suites = Array.isArray(suiteAny.suites)
    ? (suiteAny.suites as unknown[])
    : [];
  for (const sub of suites) {
    collectSuiteFailures(sub, file, nextPath, grouped, modeName);
  }
}

function renderCollectedFailure(failure: FailureDisplay): void {
  console.log(
    `${chalk.bgRed(" FAIL ")} ${chalk.dim(failure.title)} ${chalk.dim("(" + failure.where + ")")}`,
  );
  const modes = [...failure.modes].filter(Boolean).sort();
  if (failure.isBuildError) {
    renderBuildFailureDetails(failure, modes);
  } else if (failure.isRuntimeError) {
    renderRuntimeFailureDetails(failure, modes);
  } else {
    if (modes.length == 1) {
      console.log(chalk.dim(`Mode: ${modes[0]}`));
    } else if (modes.length > 1) {
      console.log(chalk.dim(`Modes: ${modes.join(", ")}`));
    }

    const relativeFile = toRelativeResultPath(failure.file);
    const repro =
      failure.suitePath.length && modes.length == 1
        ? buildSuiteReproCommand(relativeFile, failure.suitePath, modes[0])
        : buildFileReproCommand(relativeFile, modes);
    console.log(chalk.dim(`Repro: ${repro}`));

    renderModeCommands("Build", failure.buildCommands, modes);
    renderModeCommands("Run", failure.runCommands, modes);
  }
  renderAssertionFailureDetails(failure.left, failure.right, failure.message);
}

function renderBuildFailureDetails(
  failure: FailureDisplay,
  modes: string[],
): void {
  console.log("");
  console.log(chalk.bold(" Oops! Looks like the test failed to build!"));
  console.log(
    chalk.dim(
      " Here's some details and reproduction instructions if that helps:",
    ),
  );
  console.log("");
  console.log(chalk.dim(` Mode(s): ${modes.join(", ") || "default"}`));
  console.log("");
  console.log(chalk.dim(" To reproduce, run the following commands:"));
  for (const mode of modes.length ? modes : ["default"]) {
    console.log(chalk.dim(` Mode: ${mode}`));
    const buildCommand = failure.buildCommands.get(mode);
    if (buildCommand?.length) {
      console.log(chalk.dim(`  Build: ${buildCommand}`));
    }
  }
  console.log("");
  console.log(chalk.dim(" Here's a log dump too:"));
}

function renderRuntimeFailureDetails(
  failure: FailureDisplay,
  modes: string[],
): void {
  console.log("");
  console.log(chalk.bold(" Oops! Looks like the runtime crashed!"));
  console.log(
    chalk.dim(
      " Here's some details and reproduction instructions if that helps:",
    ),
  );
  console.log("");
  console.log(chalk.dim(` Mode(s): ${modes.join(", ") || "default"}`));
  console.log("");
  console.log(chalk.dim(" To reproduce, run the following commands:"));
  for (const mode of modes.length ? modes : ["default"]) {
    console.log(chalk.dim(` Mode: ${mode}`));
    const buildCommand = failure.buildCommands.get(mode);
    if (buildCommand?.length) {
      console.log(chalk.dim(`  Build: ${buildCommand}`));
    }
    const runCommand = buildRuntimeReproRunCommand(
      failure.runCommands.get(mode) ?? "",
      buildCommand ?? "",
    );
    if (runCommand.length) {
      console.log(chalk.dim(`  Run: ${runCommand}`));
    }
  }
  console.log("");
  console.log(chalk.dim(" Here's a log dump too:"));
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

function buildFileReproCommand(file: string, modes: string[]): string {
  const normalizedModes = modes.filter(Boolean).sort();
  if (normalizedModes.length == 1 && normalizedModes[0] != "default") {
    return `ast run ${file} --mode ${normalizedModes[0]}`;
  }
  if (
    normalizedModes.length > 1 &&
    normalizedModes.every((mode) => mode != "default")
  ) {
    return `ast run ${file} --mode ${normalizedModes.join(",")}`;
  }
  return `ast run ${file}`;
}

function renderModeCommands(
  label: string,
  commands: Map<string, string>,
  modes: string[],
): void {
  if (!commands.size) return;
  const uniqueCommands = new Set([...commands.values()].filter(Boolean));
  if (uniqueCommands.size == 1) {
    console.log(chalk.dim(`${label}: ${[...uniqueCommands][0]}`));
    return;
  }
  console.log(chalk.dim(`${label} commands:`));
  for (const mode of modes) {
    const command = commands.get(mode);
    if (!command) continue;
    console.log(chalk.dim(`  [${mode}] ${command}`));
  }
}

function buildRuntimeReproRunCommand(
  runCommand: string,
  buildCommand: string,
): string {
  if (!runCommand.length) return "";
  const artifactPath = extractBuildArtifactPath(buildCommand);
  if (!artifactPath) {
    return runCommand;
  }
  if (runCommand.includes(".as-test/runners/default.")) {
    return `${runCommand} ${artifactPath}`;
  }
  return runCommand;
}

function extractBuildArtifactPath(buildCommand: string): string | null {
  const outMatch = buildCommand.match(
    /(?:^|\s)(?:-o|--outFile)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/,
  );
  return outMatch?.[1] ?? outMatch?.[2] ?? outMatch?.[3] ?? null;
}

function normalizeFailureMessage(message: string): string {
  return message.replace(/\r\n/g, "\n").trim();
}

function renderAssertionFailureDetails(
  leftRaw: unknown,
  rightRaw: unknown,
  messageRaw: unknown,
): void {
  const left = JSON.stringify(leftRaw);
  const right = JSON.stringify(rightRaw);
  const message = String(messageRaw ?? "");
  if (left == "null" && right == "null") {
    const normalizedMessage = normalizeFailureMessage(message);
    if (normalizedMessage.length) {
      console.log("");
      for (const line of normalizedMessage.split("\n")) {
        console.log(chalk.dim(line));
      }
    } else {
      console.log("");
      console.log(chalk.dim("runtime error"));
    }
    return;
  }

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
  console.log(`${chalk.dim("(expected) ->")} ${expected}`);
  console.log(`${chalk.dim("(received) ->")} ${chalk.dim(left)}\n`);
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
  const cacheSummary = computeCacheSummary(event.reports);
  const layout = createSummaryLayout([
    event.fuzzSummary,
    // "cached" and "failed" are the same length, so the cache summary aligns in
    // the shared first column.
    cacheSummary
      ? {
          failed: cacheSummary.cached,
          skipped: cacheSummary.skipped,
          total: cacheSummary.total,
        }
      : undefined,
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
  if (cacheSummary) {
    renderCacheSummary(cacheSummary, layout);
  }

  process.stdout.write(
    chalk.bold("Time:".padEnd(9)) +
      formatTime(stats.time) +
      chalk.dim(` (${formatTime(event.buildTime)} build)`) +
      "\n",
  );
}

// When the cache is active, every report carries a `cached` flag (true =
// replayed from cache, false = freshly run). Returns the hit/miss split, or
// undefined when the cache is off (no report sets the flag) so no line shows.
function computeCacheSummary(
  reports: unknown[],
): { cached: number; skipped: number; total: number } | undefined {
  const flagged = reports.filter(
    (r): r is { cached: boolean } =>
      typeof (r as { cached?: unknown })?.cached === "boolean",
  );
  if (!flagged.length) return undefined;
  const cached = flagged.filter((r) => r.cached).length;
  return { cached, skipped: flagged.length - cached, total: flagged.length };
}

// Renders the "Cache:" line in the shared three-column layout (cached / skipped
// / total) so it lines up with Files/Suites/Tests/Modes.
function renderCacheSummary(
  summary: { cached: number; skipped: number; total: number },
  layout: SummaryLayout,
): void {
  const cachedText = `${summary.cached} cached`;
  const skippedText = `${summary.skipped} skipped`;
  const totalText = `${summary.total} total`;
  process.stdout.write(chalk.bold("Cache:".padEnd(9)));
  process.stdout.write(
    chalk.bold.greenBright(cachedText.padStart(layout.failedWidth)),
  );
  process.stdout.write(", ");
  process.stdout.write(chalk.gray(skippedText.padStart(layout.skippedWidth)));
  process.stdout.write(", ");
  process.stdout.write(totalText.padStart(layout.totalWidth) + "\n");
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
    chalk.bold("Time:".padEnd(9)) +
      formatTime(event.time) +
      chalk.dim(` (${formatTime(event.buildTime)} build)`) +
      "\n",
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

function renderCoverageSummary(
  summary: {
    files: {
      file: string;
      total: number;
      covered: number;
      uncovered: number;
      percent: number;
      points?: {
        hash: string;
        file: string;
        line: number;
        column: number;
        type: string;
        executed: boolean;
      }[];
    }[];
    total: number;
    covered: number;
    uncovered: number;
    percent: number;
    byMode?: {
      name: string;
      total: number;
      covered: number;
      percent: number;
    }[];
  },
  showCoverage: boolean,
  verbose: boolean,
): void {
  console.log("");
  const shouldShowCoverageHint =
    !showCoverage && summary.total > 0 && summary.uncovered > 0;
  const coverageHeading = shouldShowCoverageHint
    ? "Coverage (run with --show-coverage to display uncovered points)"
    : "Coverage";
  console.log(chalk.bold(coverageHeading));

  if (!summary.files.length || summary.total <= 0) {
    console.log(
      `  ${chalk.dim("No eligible source files were tracked for coverage.")}`,
    );
    return;
  }

  const pct = summary.total
    ? ((summary.covered * 100) / summary.total).toFixed(2)
    : "100.00";
  const missingLabel =
    summary.uncovered == 1
      ? "1 point missing"
      : `${summary.uncovered} points missing`;
  const fileLabel =
    summary.files.length == 1 ? "1 file" : `${summary.files.length} files`;
  const color = coverageColor(Number(pct));
  console.log(
    `  ${color(pct + "%")} ${renderCoverageBar(summary.percent)} ${chalk.dim(`(${summary.covered}/${summary.total} covered, ${missingLabel}, ${fileLabel})`)}`,
  );

  const ranked = [...summary.files].sort((a, b) => {
    if (a.percent != b.percent) return a.percent - b.percent;
    if (a.uncovered != b.uncovered) return b.uncovered - a.uncovered;
    return a.file.localeCompare(b.file);
  });
  console.log(chalk.bold("  File Breakdown"));
  const displayed = ranked.slice(0, 8);
  const fileNameWidth = displayed.reduce(
    (max, file) => Math.max(max, toRelativeResultPath(file.file).length),
    0,
  );
  for (const file of displayed) {
    const filePct = file.total
      ? ((file.covered * 100) / file.total).toFixed(2)
      : "100.00";
    const fileColor = coverageColor(Number(filePct));
    const suffix =
      file.uncovered > 0 ? `${file.uncovered} missing` : "fully covered";
    console.log(
      `    ${fileColor(filePct.padStart(6) + "%")}  ${toRelativeResultPath(file.file).padEnd(fileNameWidth)} ${chalk.dim(`${file.covered}/${file.total} covered, ${suffix}`)}`,
    );
  }
  if (ranked.length > 8) {
    console.log(chalk.dim(`    ... ${ranked.length - 8} more files`));
  }

  if (verbose && summary.byMode && summary.byMode.length > 0) {
    console.log(chalk.bold("  Mode Breakdown"));
    const modeNameWidth = summary.byMode.reduce(
      (max, m) => Math.max(max, m.name.length),
      0,
    );
    for (const mode of summary.byMode) {
      const modePct = mode.total
        ? ((mode.covered * 100) / mode.total).toFixed(2)
        : "100.00";
      const modeColor = coverageColor(Number(modePct));
      console.log(
        `    ${mode.name.padEnd(modeNameWidth)}  ${modeColor(modePct.padStart(6) + "%")} ${renderCoverageBar(mode.percent)} ${chalk.dim(`(${mode.covered}/${mode.total})`)}`,
      );
    }
  }

  if (verbose) {
    const allPoints = summary.files.flatMap((f) => f.points ?? []);
    if (allPoints.length > 0) {
      renderCoverageTypeBreakdown(allPoints);
      renderUncoveredFunctions(allPoints);
    }
  }
}

function renderCoveragePoints(
  files: {
    file: string;
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
  }[],
  expandNested: boolean,
): void {
  console.log("");
  console.log(chalk.bold("Coverage Gaps"));
  const sortedFiles = [...files].sort((a, b) => a.file.localeCompare(b.file));
  const missingPoints = sortedFiles.flatMap((file) =>
    file.points
      .filter((point) => !point.executed)
      .map((point) => ({
        ...point,
        displayType: describeCoveragePoint(
          point.file,
          point.line,
          point.column,
          point.type,
        ).displayType,
      })),
  );
  const layout = createCoverageGapLayout(missingPoints);
  let renderedFileCount = 0;
  let collapsedNestedPoints = 0;
  for (const file of sortedFiles) {
    const points = [...file.points].sort(compareCoverageGapPoints);
    const missing = points.filter((point) => !point.executed);
    if (!missing.length) continue;
    if (renderedFileCount > 0) {
      console.log("");
    }
    console.log(
      `  ${chalk.bold(toRelativeResultPath(file.file))} ${chalk.dim(`(${missing.length} uncovered)`)}`,
    );
    const pointsByHash = new Map(points.map((point) => [point.hash, point]));
    const childrenByParent = new Map<string, typeof points>();
    const roots: typeof points = [];

    for (const point of points) {
      const parentHash = point.parentHash ?? "";
      if (parentHash.length && pointsByHash.has(parentHash)) {
        const children = childrenByParent.get(parentHash) ?? [];
        children.push(point);
        childrenByParent.set(parentHash, children);
      } else {
        roots.push(point);
      }
    }

    const visibleRoots = roots.filter((point) =>
      shouldRenderCoveragePoint(point, childrenByParent),
    );
    for (let i = 0; i < visibleRoots.length; i++) {
      collapsedNestedPoints += renderCoveragePointTree(
        visibleRoots[i]!,
        childrenByParent,
        layout,
        [],
        i == visibleRoots.length - 1,
        expandNested,
      );
    }
    renderedFileCount++;
  }
  if (!expandNested && collapsedNestedPoints > 0) {
    console.log("");
    console.log(
      chalk.dim(
        "  Run with --show-coverage=all or --verbose to expand nested coverage gaps.",
      ),
    );
  }
}

function renderCoveragePointTree(
  point: {
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
  },
  childrenByParent: Map<
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
  >,
  layout: {
    typeWidth: number;
    locationWidth: number;
  },
  ancestorHasNext: boolean[],
  isLast: boolean,
  expandNested: boolean,
): number {
  const visibleChildren = [...(childrenByParent.get(point.hash) ?? [])]
    .filter((child) => shouldRenderCoveragePoint(child, childrenByParent))
    .sort(compareCoverageGapPoints);
  const nestedUncoveredCount = countNestedUncoveredPoints(
    visibleChildren,
    childrenByParent,
  );

  if (!point.executed) {
    // Uncovered Function/Method: collapse all children — every point inside is
    // trivially dead since the function was never called. Show the count inline.
    if (point.type === "Function" || point.type === "Method") {
      renderCoverageGapLine(
        point,
        layout,
        ancestorHasNext,
        isLast,
        nestedUncoveredCount,
      );
      return 0;
    }
    renderCoverageGapLine(point, layout, ancestorHasNext, isLast);
    if (nestedUncoveredCount > 0) {
      if (expandNested) {
        let rendered = 0;
        for (let i = 0; i < visibleChildren.length; i++) {
          rendered += renderCoveragePointTree(
            visibleChildren[i]!,
            childrenByParent,
            layout,
            [...ancestorHasNext, !isLast],
            i == visibleChildren.length - 1,
            expandNested,
          );
        }
        return 1 + rendered;
      }
      const treePrefix = buildCoverageTreePrefix(
        [...ancestorHasNext, !isLast],
        true,
      );
      console.log(
        `    ${treePrefix}${chalk.dim(`(+${nestedUncoveredCount} nested uncovered point${nestedUncoveredCount == 1 ? "" : "s"})`)}`,
      );
      return nestedUncoveredCount;
    }
    return 0;
  }

  if (nestedUncoveredCount <= 0) return 0;
  renderCoverageScopeHeader(point, layout, ancestorHasNext, isLast);
  let rendered = 0;
  for (let i = 0; i < visibleChildren.length; i++) {
    rendered += renderCoveragePointTree(
      visibleChildren[i]!,
      childrenByParent,
      layout,
      [...ancestorHasNext, !isLast],
      i == visibleChildren.length - 1,
      expandNested,
    );
  }
  return rendered;
}

function shouldRenderCoveragePoint(
  point: {
    hash: string;
    executed: boolean;
  },
  childrenByParent: Map<
    string,
    {
      hash: string;
      executed: boolean;
    }[]
  >,
): boolean {
  if (!point.executed) return true;
  return (
    countNestedUncoveredPoints(
      childrenByParent.get(point.hash) ?? [],
      childrenByParent,
    ) > 0
  );
}

function countNestedUncoveredPoints(
  points: {
    hash: string;
    executed: boolean;
  }[],
  childrenByParent: Map<
    string,
    {
      hash: string;
      executed: boolean;
    }[]
  >,
): number {
  let count = 0;
  for (const point of points) {
    if (!point.executed) count++;
    count += countNestedUncoveredPoints(
      childrenByParent.get(point.hash) ?? [],
      childrenByParent,
    );
  }
  return count;
}

function renderCoverageGapLine(
  point: {
    file: string;
    line: number;
    column: number;
    type: string;
  },
  layout: {
    typeWidth: number;
    locationWidth: number;
  },
  ancestorHasNext: boolean[],
  isLast: boolean,
  nestedCount: number = 0,
): void {
  const location = `${toRelativeResultPath(point.file)}:${point.line}:${point.column}`;
  const snippet = formatCoverageSnippet(
    point.file,
    point.line,
    point.column,
    point.type,
    ancestorHasNext.length,
  );
  const typeLabel = describeCoveragePoint(
    point.file,
    point.line,
    point.column,
    point.type,
  ).displayType.padEnd(layout.typeWidth + 6);
  const locationLabel = location.padEnd(layout.locationWidth + 6);
  const treePrefix = buildCoverageTreePrefix(ancestorHasNext, isLast);
  const meta = `${typeLabel}${locationLabel}`;
  const nestedSuffix =
    nestedCount > 0
      ? chalk.dim(
          ` — never called, ${nestedCount} point${nestedCount == 1 ? "" : "s"} inside`,
        )
      : "";
  console.log(`    ${treePrefix}${chalk.dim(meta)}  ${snippet}${nestedSuffix}`);
}

function renderCoverageScopeHeader(
  point: {
    file: string;
    line: number;
    column: number;
    type: string;
    scopeKind?: string;
    scopeName?: string;
  },
  layout: {
    typeWidth: number;
    locationWidth: number;
  },
  ancestorHasNext: boolean[],
  isLast: boolean,
): void {
  const descriptor = describeCoveragePoint(
    point.file,
    point.line,
    point.column,
    point.type,
  );
  const label = point.scopeKind || descriptor.displayType;
  const location = `${toRelativeResultPath(point.file)}:${point.line}:${point.column}`;
  const locationLabel = location.padEnd(layout.locationWidth + 6);
  const typeLabel = label.padEnd(layout.typeWidth + 6);
  const snippet = formatCoverageSnippet(
    point.file,
    point.line,
    point.column,
    point.type,
    ancestorHasNext.length,
  );
  const treePrefix = buildCoverageTreePrefix(ancestorHasNext, isLast);
  const meta = `${typeLabel}${locationLabel}`;
  console.log(`    ${treePrefix}${chalk.dim(meta)}  ${chalk.dim(snippet)}`);
}

function buildCoverageTreePrefix(
  ancestorHasNext: boolean[],
  isLast: boolean,
): string {
  let out = "";
  for (const hasNext of ancestorHasNext) {
    out += hasNext ? "│ " : "  ";
  }
  out += isLast ? "└─" : "├─";
  return chalk.dim(out);
}

function compareCoverageGapPoints(
  a: {
    hash: string;
    line: number;
    column: number;
    type: string;
    depth?: number;
  },
  b: {
    hash: string;
    line: number;
    column: number;
    type: string;
    depth?: number;
  },
): number {
  if (a.line != b.line) return a.line - b.line;
  if (a.column != b.column) return a.column - b.column;
  if ((a.depth ?? 0) != (b.depth ?? 0)) return (a.depth ?? 0) - (b.depth ?? 0);
  if (a.type != b.type) return a.type.localeCompare(b.type);
  return a.hash.localeCompare(b.hash);
}

function renderCoverageTypeBreakdown(
  points: { type: string; executed: boolean }[],
): void {
  const byType = new Map<string, { total: number; covered: number }>();
  for (const point of points) {
    const entry = byType.get(point.type) ?? { total: 0, covered: 0 };
    entry.total++;
    if (point.executed) entry.covered++;
    byType.set(point.type, entry);
  }
  const rows = [...byType.entries()]
    .map(([type, { total, covered }]) => ({
      type,
      total,
      covered,
      percent: total ? (covered * 100) / total : 100,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => {
      if (a.percent != b.percent) return a.percent - b.percent;
      return a.type.localeCompare(b.type);
    });
  if (!rows.length) return;
  console.log(chalk.bold("  Node Type Breakdown"));
  const typeWidth = rows.reduce((max, r) => Math.max(max, r.type.length), 0);
  for (const row of rows) {
    const pct = row.percent.toFixed(2);
    const color = coverageColor(Number(pct));
    console.log(
      `    ${row.type.padEnd(typeWidth)}  ${color(pct.padStart(6) + "%")} ${renderCoverageBar(row.percent)} ${chalk.dim(`(${row.covered}/${row.total})`)}`,
    );
  }
}

function renderUncoveredFunctions(
  points: {
    file: string;
    line: number;
    column: number;
    type: string;
    executed: boolean;
  }[],
): void {
  const uncovered = points.filter(
    (p) => !p.executed && (p.type === "Function" || p.type === "Method"),
  );
  if (!uncovered.length) return;
  console.log(chalk.bold("  Uncovered Functions"));
  const limit = Math.min(uncovered.length, 10);
  for (let i = 0; i < limit; i++) {
    const point = uncovered[i]!;
    const info = describeCoveragePoint(
      point.file,
      point.line,
      point.column,
      point.type,
    );
    const name =
      info.subjectName ??
      (info.visible.length ? info.visible.slice(0, 38) : point.type);
    const location = `${toRelativeResultPath(point.file)}:${point.line}`;
    console.log(`    ${chalk.dim(name.padEnd(40))}  ${chalk.dim(location)}`);
  }
  if (uncovered.length > limit) {
    console.log(chalk.dim(`    ... ${uncovered.length - limit} more`));
  }
}

function coverageColor(pct: number): typeof chalk {
  if (pct >= 90) return chalk.ansi256(46);
  if (pct >= 75) return chalk.ansi256(82);
  if (pct >= 50) return chalk.ansi256(214);
  return chalk.ansi256(196);
}

function renderCoverageBar(percent: number): string {
  const slots = 12;
  const filled = Math.max(
    0,
    Math.min(
      slots,
      Math.round((Math.max(0, Math.min(100, percent)) / 100) * slots),
    ),
  );
  return `[${"=".repeat(filled)}${"-".repeat(slots - filled)}]`;
}

function createCoverageGapLayout(
  points: {
    file: string;
    line: number;
    column: number;
    type: string;
    displayType: string;
  }[],
): {
  typeWidth: number;
  locationWidth: number;
} {
  return {
    typeWidth: Math.max(...points.map((point) => point.displayType.length), 5),
    locationWidth: Math.max(
      ...points.map(
        (point) =>
          `${toRelativeResultPath(point.file)}:${point.line}:${point.column}`
            .length,
      ),
      1,
    ),
  };
}

function formatCoverageSnippet(
  file: string,
  line: number,
  column: number,
  fallbackType: string,
  _depth: number,
): string {
  const descriptor = describeCoveragePoint(file, line, column, fallbackType);
  const visible = descriptor.visible;
  if (!visible.length) return "";

  const maxWidth = 72;
  const focus = Math.max(0, Math.min(visible.length - 1, descriptor.focus));

  if (visible.length <= maxWidth) {
    return styleCoverageSnippetWindow(
      visible,
      0,
      visible.length,
      focus,
      descriptor.highlightStart,
      descriptor.highlightEnd,
    );
  }

  const start = Math.max(
    0,
    Math.min(visible.length - maxWidth, focus - Math.floor(maxWidth / 2)),
  );
  const end = Math.min(visible.length, start + maxWidth);
  return styleCoverageSnippetWindow(
    visible,
    start,
    end,
    focus,
    descriptor.highlightStart,
    descriptor.highlightEnd,
  );
}

function styleCoverageSnippetWindow(
  visible: string,
  start: number,
  end: number,
  focus: number,
  highlightStart: number,
  highlightEnd: number,
): string {
  const prefix = start > 0 ? "..." : "";
  const suffix = end < visible.length ? "..." : "";
  const slice = visible.slice(start, end);
  const localFocus = Math.max(0, Math.min(slice.length - 1, focus - start));
  const localStart = Math.max(
    0,
    Math.min(slice.length, highlightStart - start),
  );
  const localEnd = Math.max(
    localStart + 1,
    Math.min(slice.length, highlightEnd - start),
  );

  if (!slice.length) return "";
  if (localStart >= slice.length) {
    return chalk.dim(`${prefix}${slice}${suffix}`);
  }

  const head = slice.slice(0, localStart);
  const body = slice.slice(localStart, localEnd || localStart + 1);
  const tail = slice.slice(localEnd || localStart + 1);
  return (
    chalk.dim(prefix + head) +
    chalk.dim.underline(body.length ? body : slice.charAt(localFocus)) +
    chalk.dim(tail + suffix)
  );
}

// A no-op renderer for runs that must emit nothing live — the parallel matrix
// path runs each (file, mode) silently and formats its own result lines. It
// extends TestRenderer (so it is assignable wherever a renderer is expected)
// and overrides every hook to do nothing.
export class SilentRenderer extends TestRenderer {
  constructor() {
    super({ stdout: process.stdout, stderr: process.stderr });
  }
  override onRunStart(): void {}
  override onFileStart(): void {}
  override onFileEnd(): void {}
  override onSuiteStart(): void {}
  override onSuiteEnd(): void {}
  override onAssertionFail(): void {}
  override onSnapshotMissing(): void {}
  override onWarning(): void {}
  override onLog(): void {}
  override onRunComplete(): void {}
  override onFuzzComplete(): void {}
  override onFuzzFileComplete(): void {}
}
