import chalk from "chalk";
import { diff } from "typer-diff";
import { readFileSync } from "fs";
import * as path from "path";
import { formatSpecDisplayPath, formatTime } from "../util.js";
import { describeCoveragePoint } from "../coverage-points.js";
export const createReporter = (context) => {
  return new DefaultReporter(context);
};
class DefaultReporter {
  constructor(context) {
    this.context = context;
    this.currentFile = null;
    this.openSuites = [];
    this.verboseSuites = [];
    this.renderedLines = 0;
    this.fileHasWarning = false;
    this.verboseMode = false;
    this.cleanMode = false;
    this.showLogsMode = false;
    this.hasRenderedTestFiles = false;
    this.hasRenderedFuzzFiles = false;
  }
  canRewriteLine() {
    return !this.cleanMode && Boolean(this.context.stdout.isTTY);
  }
  badgeRunning() {
    return chalk.bgBlackBright.white(" .... ");
  }
  badgeFromVerdict(verdict) {
    if (verdict == "ok") return chalk.bgGreenBright.black(" PASS ");
    if (verdict == "fail") return chalk.bgRed.white(" FAIL ");
    return chalk.bgBlackBright.white(" SKIP ");
  }
  clearRenderedBlock() {
    if (!this.renderedLines || !this.canRewriteLine()) return;
    for (let i = 0; i < this.renderedLines; i++) {
      this.context.stdout.write("\r\x1b[2K");
      if (i < this.renderedLines - 1) {
        this.context.stdout.write("\x1b[1A");
      }
    }
    this.renderedLines = 0;
  }
  drawLiveBlock(lines) {
    this.clearRenderedBlock();
    if (!lines.length) return;
    this.context.stdout.write(lines.join("\n"));
    this.renderedLines = lines.length;
  }
  renderLiveState() {
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
  renderVerboseState(fileEnd) {
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
  setVerboseSuiteVerdict(depth, description, verdict) {
    for (let i = this.verboseSuites.length - 1; i >= 0; i--) {
      const suite = this.verboseSuites[i];
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
  collapseToDepth(depth) {
    while (this.openSuites.length > depth) {
      this.openSuites.pop();
    }
  }
  renderSuiteCompleteFrame(depth, description, verdict) {
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
  renderFileResult(event) {
    const verdict = event.verdict ?? "none";
    const time = event.time ? ` ${chalk.dim(event.time)}` : "";
    const file = formatSpecDisplayPath(event.file);
    if (verdict == "fail")
      return `${chalk.bgRed.white(" FAIL ")} ${file}${time}`;
    if (this.fileHasWarning)
      return `${chalk.bgYellow.black(" WARN ")} ${file}${time}`;
    if (verdict == "ok")
      return `${chalk.bgGreenBright.black(" PASS ")} ${file}${time}`;
    return `${chalk.bgBlackBright.white(" SKIP ")} ${file}${time}`;
  }
  onRunStart(event) {
    this.verboseMode = Boolean(event.verbose);
    this.cleanMode = Boolean(event.clean);
    this.showLogsMode = Boolean(event.showLogs);
    this.hasRenderedTestFiles = false;
    this.hasRenderedFuzzFiles = false;
  }
  onFileStart(event) {
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
  onFileEnd(event) {
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
  onSuiteStart(event) {
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
  onSuiteEnd(event) {
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
  onAssertionFail(_event) {}
  onSnapshotMissing(event) {
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
  onWarning(event) {
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
  onLog(event) {
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
  onRunComplete(event) {
    this.clearRenderedBlock();
    if (!event.clean) {
      renderFailedSuites(event.stats.failedEntries);
    }
    if (event.snapshotEnabled) {
      renderSnapshotSummary(event.snapshotSummary, true);
    }
    if (event.coverageSummary.enabled) {
      renderCoverageSummary(event.coverageSummary, event.showCoverage);
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
  renderLogs(event) {
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
  onFuzzComplete(event) {
    renderFuzzSummary(this.context, event, this.hasRenderedTestFiles);
  }
  onFuzzFileComplete(event) {
    this.hasRenderedFuzzFiles = true;
    renderFuzzFileSummary(this.context, event.results);
  }
}
function renderFuzzFileSummary(context, results) {
  if (!results.length) return;
  const file = results[0].file;
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
function renderFuzzSummary(context, event, hasRenderedTestFiles) {
  context.stdout.write("\n");
  if (!hasRenderedTestFiles) {
    renderStandaloneFuzzTotals(event);
  }
}
function renderFailedFuzzers(results) {
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
          console.log(chalk.dim(`Crash: ${modeResult.crashFiles[0]}`));
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
          `${chalk.bgRed(" FAIL ")} ${formatFuzzFailureTitle(modeResult.file, fuzzer.name)}`,
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
          console.log(chalk.dim(`Crash: ${modeResult.crashFiles[0]}`));
        }
        console.log("");
      }
    }
  }
  return rendered;
}
function groupFuzzResultsByFile(results) {
  const grouped = new Map();
  for (const result of results) {
    const current = grouped.get(result.file) ?? [];
    current.push(result);
    grouped.set(result.file, current);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, modes]) => ({ file, modes }));
}
function firstFuzzCrashFile(results) {
  for (const result of results) {
    if (result.crashFiles.length) return result.crashFiles[0];
  }
  return null;
}
function averageFuzzModeTime(results) {
  if (!results.length) return 0;
  return results.reduce((sum, result) => sum + result.time, 0) / results.length;
}
function buildFuzzReproCommand(file, seed, modeName, fuzzer, runs) {
  const modeArg = modeName != "default" ? ` --mode ${modeName}` : "";
  const fuzzerArg = fuzzer?.length ? ` --fuzzer ${fuzzer}` : "";
  const runsArg = typeof runs == "number" ? ` --runs ${runs}` : "";
  return `ast fuzz ${file}${modeArg}${fuzzerArg} --seed ${seed}${runsArg}`;
}
function formatFailingSeeds(fuzzer) {
  return (fuzzer.failures ?? [])
    .map((failure) => String(failure.seed))
    .join(", ");
}
function toRelativeResultPath(file) {
  const relative = path.relative(
    process.cwd(),
    path.resolve(process.cwd(), file),
  );
  return relative.length ? relative : file;
}
function formatFuzzFailureTitle(file, name) {
  const location = findFuzzLocation(file, name);
  const suffix = location
    ? ` (${formatSpecDisplayPath(file)}:${location})`
    : ` (${formatSpecDisplayPath(file)})`;
  return `${chalk.dim(name)}${chalk.dim(suffix)}`;
}
function findFuzzLocation(file, name) {
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
function renderFailedSuites(failedEntries) {
  if (!failedEntries.length) return;
  console.log("");
  const grouped = new Map();
  for (const failed of failedEntries) {
    const failedAny = failed;
    if (!failedAny?.file) continue;
    const file = String(failedAny.file);
    collectSuiteFailures(failed, file, [], grouped);
  }
  for (const failure of grouped.values()) {
    renderCollectedFailure(failure);
  }
}
function collectSuiteFailures(
  suite,
  file,
  path,
  grouped,
  inheritedModeName = "",
) {
  const suiteAny = suite;
  const nextPath = [...path, String(suiteAny.description ?? "unknown")];
  const modeName = String(suiteAny.modeName ?? inheritedModeName);
  const isRuntimeErrorSuite = String(suiteAny.kind ?? "") == "runtime-error";
  const isBuildErrorSuite = String(suiteAny.kind ?? "") == "build-error";
  const tests = Array.isArray(suiteAny.tests) ? suiteAny.tests : [];
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
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
        modes: new Set(),
        runCommands: new Map(),
        buildCommands: new Map(),
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
  const suites = Array.isArray(suiteAny.suites) ? suiteAny.suites : [];
  for (const sub of suites) {
    collectSuiteFailures(sub, file, nextPath, grouped, modeName);
  }
}
function renderCollectedFailure(failure) {
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
function renderBuildFailureDetails(failure, modes) {
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
function renderRuntimeFailureDetails(failure, modes) {
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
function buildSuiteReproCommand(file, suitePath, modeName) {
  const modeArg =
    modeName && modeName != "default" ? ` --mode ${modeName}` : "";
  return `ast run ${file}${modeArg} --suite ${suitePath}`;
}
function buildFileReproCommand(file, modes) {
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
function renderModeCommands(label, commands, modes) {
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
function buildRuntimeReproRunCommand(runCommand, buildCommand) {
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
function extractBuildArtifactPath(buildCommand) {
  const outMatch = buildCommand.match(
    /(?:^|\s)(?:-o|--outFile)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/,
  );
  return outMatch?.[1] ?? outMatch?.[2] ?? outMatch?.[3] ?? null;
}
function normalizeFailureMessage(message) {
  return message.replace(/\r\n/g, "\n").trim();
}
function renderAssertionFailureDetails(leftRaw, rightRaw, messageRaw) {
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
function renderSnapshotSummary(snapshotSummary, leadingGap = true) {
  if (leadingGap) {
    console.log("");
  }
  console.log(
    `${chalk.bold("Snapshots:")} ${chalk.greenBright(snapshotSummary.matched)} matched, ${chalk.blueBright(snapshotSummary.created)} created, ${chalk.blueBright(snapshotSummary.updated)} updated, ${snapshotSummary.failed ? chalk.red(snapshotSummary.failed) : chalk.greenBright("0")} failed`,
  );
}
function renderTotals(stats, event) {
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
    chalk.bold("Time:".padEnd(9)) +
      formatTime(stats.time) +
      chalk.dim(` (${formatTime(event.buildTime)} build)`) +
      "\n",
  );
}
function renderModeSummary(summary, layout) {
  renderSummaryLine("Modes:", summary, layout);
}
function renderFuzzTotals(summary, layout) {
  renderSummaryLine("Fuzz:", summary, layout);
}
function renderStandaloneFuzzTotals(event) {
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
function createSummaryLayout(summaries) {
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
  label,
  summary,
  layout = {
    failedWidth: `${summary.failed} failed`.length,
    skippedWidth: `${summary.skipped} skipped`.length,
    totalWidth: `${summary.total} total`.length,
  },
) {
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
function renderCoverageSummary(summary, showCoverage) {
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
  const color =
    Number(pct) >= 90
      ? chalk.greenBright
      : Number(pct) >= 75
        ? chalk.yellowBright
        : chalk.redBright;
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
    const fileColor =
      Number(filePct) >= 90
        ? chalk.greenBright
        : Number(filePct) >= 75
          ? chalk.yellowBright
          : chalk.redBright;
    const suffix =
      file.uncovered > 0 ? `${file.uncovered} missing` : "fully covered";
    console.log(
      `  ${fileColor(filePct.padStart(6) + "%")}  ${toRelativeResultPath(file.file).padEnd(fileNameWidth)} ${chalk.dim(`${file.covered}/${file.total} covered, ${suffix}`)}`,
    );
  }
  if (ranked.length > 8) {
    console.log(chalk.dim(`  ... ${ranked.length - 8} more files`));
  }
}
function renderCoveragePoints(files, expandNested) {
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
    const childrenByParent = new Map();
    const roots = [];
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
        visibleRoots[i],
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
  point,
  childrenByParent,
  layout,
  ancestorHasNext,
  isLast,
  expandNested,
) {
  const visibleChildren = [...(childrenByParent.get(point.hash) ?? [])]
    .filter((child) => shouldRenderCoveragePoint(child, childrenByParent))
    .sort(compareCoverageGapPoints);
  const nestedUncoveredCount = countNestedUncoveredPoints(
    visibleChildren,
    childrenByParent,
  );
  if (!point.executed) {
    renderCoverageGapLine(point, layout, ancestorHasNext, isLast);
    if (nestedUncoveredCount > 0) {
      if (expandNested) {
        let rendered = 0;
        for (let i = 0; i < visibleChildren.length; i++) {
          rendered += renderCoveragePointTree(
            visibleChildren[i],
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
      visibleChildren[i],
      childrenByParent,
      layout,
      [...ancestorHasNext, !isLast],
      i == visibleChildren.length - 1,
      expandNested,
    );
  }
  return rendered;
}
function shouldRenderCoveragePoint(point, childrenByParent) {
  if (!point.executed) return true;
  return (
    countNestedUncoveredPoints(
      childrenByParent.get(point.hash) ?? [],
      childrenByParent,
    ) > 0
  );
}
function countNestedUncoveredPoints(points, childrenByParent) {
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
function renderCoverageGapLine(point, layout, ancestorHasNext, isLast) {
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
  console.log(`    ${treePrefix}${chalk.dim(meta)}  ${snippet}`);
}
function renderCoverageScopeHeader(point, layout, ancestorHasNext, isLast) {
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
function buildCoverageTreePrefix(ancestorHasNext, isLast) {
  let out = "";
  for (const hasNext of ancestorHasNext) {
    out += hasNext ? "│ " : "  ";
  }
  out += isLast ? "└─" : "├─";
  return chalk.dim(out);
}
function compareCoverageGapPoints(a, b) {
  if (a.line != b.line) return a.line - b.line;
  if (a.column != b.column) return a.column - b.column;
  if ((a.depth ?? 0) != (b.depth ?? 0)) return (a.depth ?? 0) - (b.depth ?? 0);
  if (a.type != b.type) return a.type.localeCompare(b.type);
  return a.hash.localeCompare(b.hash);
}
function renderCoverageBar(percent) {
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
function createCoverageGapLayout(points) {
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
function formatCoverageSnippet(file, line, column, fallbackType, _depth) {
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
  visible,
  start,
  end,
  focus,
  highlightStart,
  highlightEnd,
) {
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
