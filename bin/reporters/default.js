import chalk from "chalk";
import { diff } from "typer-diff";
import { readFileSync } from "fs";
import * as path from "path";
import { formatTime } from "../util.js";
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
        this.hasRenderedTestFiles = false;
    }
    canRewriteLine() {
        return (!this.cleanMode &&
            Boolean(this.context.stdout.isTTY));
    }
    badgeRunning() {
        return chalk.bgBlackBright.white(" .... ");
    }
    badgeFromVerdict(verdict) {
        if (verdict == "ok")
            return chalk.bgGreenBright.black(" PASS ");
        if (verdict == "fail")
            return chalk.bgRed.white(" FAIL ");
        return chalk.bgBlackBright.white(" SKIP ");
    }
    clearRenderedBlock() {
        if (!this.renderedLines || !this.canRewriteLine())
            return;
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
        if (!lines.length)
            return;
        this.context.stdout.write(lines.join("\n"));
        this.renderedLines = lines.length;
    }
    renderLiveState() {
        if (!this.canRewriteLine() || !this.currentFile)
            return;
        const lines = [`${this.badgeRunning()} ${this.currentFile}`];
        for (const suite of this.openSuites) {
            lines.push(`${"  ".repeat(suite.depth + 1)}${this.badgeRunning()} ${suite.description}`);
        }
        this.drawLiveBlock(lines);
    }
    renderVerboseState(fileEnd) {
        if (!this.canRewriteLine() || !this.currentFile)
            return;
        const lines = [
            fileEnd
                ? this.renderFileResult(fileEnd)
                : `${this.badgeRunning()} ${this.currentFile}`,
        ];
        for (const suite of this.verboseSuites) {
            const badge = suite.verdict == "running"
                ? this.badgeRunning()
                : this.badgeFromVerdict(suite.verdict);
            lines.push(`${"  ".repeat(suite.depth + 1)}${badge} ${suite.description}`);
        }
        this.drawLiveBlock(lines);
    }
    setVerboseSuiteVerdict(depth, description, verdict) {
        for (let i = this.verboseSuites.length - 1; i >= 0; i--) {
            const suite = this.verboseSuites[i];
            if (suite.depth == depth &&
                (!description.length || suite.description == description) &&
                suite.verdict == "running") {
                if (description.length)
                    suite.description = description;
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
        if (!this.canRewriteLine() || !this.currentFile)
            return;
        const lines = [`${this.badgeRunning()} ${this.currentFile}`];
        for (let i = 0; i < depth; i++) {
            const suite = this.openSuites[i];
            if (!suite)
                continue;
            lines.push(`${"  ".repeat(suite.depth + 1)}${this.badgeRunning()} ${suite.description}`);
        }
        lines.push(`${"  ".repeat(depth + 1)}${this.badgeFromVerdict(verdict)} ${description}`);
        this.drawLiveBlock(lines);
    }
    renderFileResult(event) {
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
    onRunStart(event) {
        this.verboseMode = Boolean(event.verbose);
        this.cleanMode = Boolean(event.clean);
        this.hasRenderedTestFiles = false;
    }
    onFileStart(event) {
        this.currentFile = event.file;
        this.openSuites = [];
        this.verboseSuites = [];
        this.fileHasWarning = false;
        if (this.cleanMode)
            return;
        if (this.verboseMode && this.canRewriteLine()) {
            this.renderVerboseState();
            return;
        }
        if (this.verboseMode || !this.canRewriteLine()) {
            this.context.stdout.write(`${this.badgeRunning()} ${event.file}\n`);
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
        if (this.cleanMode)
            return;
        const depth = Math.max(event.depth, 0);
        if (this.verboseMode && this.canRewriteLine()) {
            if (this.currentFile !== event.file)
                return;
            this.verboseSuites.push({
                depth,
                description: event.description,
                verdict: "running",
            });
            this.renderVerboseState();
            return;
        }
        if (this.verboseMode || !this.canRewriteLine()) {
            this.context.stdout.write(`${"  ".repeat(depth + 1)}${this.badgeRunning()} ${event.description}\n`);
            return;
        }
        if (this.currentFile !== event.file)
            return;
        this.collapseToDepth(depth);
        this.openSuites.push({ depth, description: event.description });
        this.renderLiveState();
    }
    onSuiteEnd(event) {
        if (this.cleanMode)
            return;
        const depth = Math.max(event.depth, 0);
        const verdict = String(event.verdict ?? "none");
        if (this.verboseMode && this.canRewriteLine()) {
            if (this.currentFile !== event.file)
                return;
            this.setVerboseSuiteVerdict(depth, event.description, verdict);
            this.renderVerboseState();
            return;
        }
        if (this.verboseMode || !this.canRewriteLine()) {
            this.context.stdout.write(`${"  ".repeat(depth + 1)}${this.badgeFromVerdict(verdict)} ${event.description}\n`);
            return;
        }
        if (this.currentFile !== event.file)
            return;
        this.collapseToDepth(depth + 1);
        const current = this.openSuites[depth];
        const description = event.description || current?.description || "suite";
        if (!current) {
            this.openSuites.push({ depth, description });
        }
        else {
            current.description = description;
        }
        this.renderSuiteCompleteFrame(depth, description, verdict);
        this.collapseToDepth(depth);
        this.renderLiveState();
    }
    onAssertionFail(_event) { }
    onSnapshotMissing(event) {
        this.fileHasWarning = true;
        const warnLine = `${chalk.bgYellow.black(" WARN ")} missing snapshot for ${chalk.dim(event.key)}.\n`;
        if (!this.canRewriteLine() || !this.currentFile) {
            this.context.stdout.write(warnLine);
            return;
        }
        this.clearRenderedBlock();
        this.context.stdout.write(warnLine);
        if (this.verboseMode) {
            this.renderVerboseState();
        }
        else {
            this.renderLiveState();
        }
    }
    onRunComplete(event) {
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
        renderTotals(event.stats, event);
    }
    onFuzzComplete(event) {
        if (this.hasRenderedTestFiles) {
            this.context.stdout.write("\n");
        }
        renderFuzzSummary(this.context, event);
    }
}
function renderFuzzSummary(context, event) {
    for (const result of event.results) {
        const itemFailed = result.crashes > 0 || result.fuzzers.some((fuzzer) => fuzzer.failed > 0);
        const itemBadge = itemFailed
            ? chalk.bgRed.white(" FAIL ")
            : chalk.bgGreenBright.black(" PASS ");
        const detail = `${formatTime(result.time)} seed: ${result.seed}`;
        const crashSuffix = result.crashFiles.length > 0
            ? ` ${chalk.dim(`-> ${result.crashFiles[0]}`)}`
            : "";
        context.stdout.write(`${itemBadge} ${path.basename(result.file)} ${chalk.dim(detail)}${crashSuffix}\n`);
    }
    const renderedFailures = renderFailedFuzzers(event.results);
    if (!renderedFailures) {
        context.stdout.write("\n");
    }
}
function renderFailedFuzzers(results) {
    let rendered = false;
    for (const result of results) {
        const relativeFile = toRelativeResultPath(result.file);
        const repro = buildFuzzReproCommand(relativeFile, result.seed);
        if (result.crashes > 0 && !result.fuzzers.length) {
            if (!rendered) {
                console.log("");
                rendered = true;
            }
            console.log(`${chalk.bgRed(" FAIL ")} ${chalk.dim(path.basename(result.file))} ${chalk.dim("(crash)")}`);
            console.log(`${chalk.dim("Runs:")} ${chalk.bold(String(result.runs))} configured`);
            console.log(`${chalk.dim("Seed:")} ${chalk.bold(String(result.seed))}`);
            console.log(`${chalk.dim("Repro:")} ${chalk.bold(repro)}`);
            if (result.crashFiles.length) {
                console.log(`${chalk.dim("Crash:")} ${chalk.bold(result.crashFiles[0])}`);
            }
            console.log("");
            continue;
        }
        for (const fuzzer of result.fuzzers) {
            if (fuzzer.failed <= 0 && fuzzer.crashed <= 0)
                continue;
            if (!rendered) {
                console.log("");
                rendered = true;
            }
            console.log(`${chalk.bgRed(" FAIL ")} ${formatFuzzFailureTitle(result.file, fuzzer.name)}`);
            if (fuzzer.failure?.message?.length) {
                console.log(chalk.dim(`Message: ${fuzzer.failure.message}`));
            }
            console.log(chalk.dim(`Runs: ${fuzzer.passed + fuzzer.failed + fuzzer.crashed} completed (${fuzzer.passed} passed, ${fuzzer.failed} failed, ${fuzzer.crashed} crashed)`));
            console.log(chalk.dim(`Repro: ${repro}`));
            console.log(chalk.dim(`Seed: ${result.seed}`));
            if (result.crashFiles.length) {
                console.log(chalk.dim(`Crash: ${result.crashFiles[0]}`));
            }
            console.log("");
        }
    }
    return rendered;
}
function buildFuzzReproCommand(file, seed) {
    return `ast fuzz ${file} --seed ${seed}`;
}
function toRelativeResultPath(file) {
    const relative = path.relative(process.cwd(), path.resolve(process.cwd(), file));
    return relative.length ? relative : file;
}
function formatFuzzFailureTitle(file, name) {
    const location = findFuzzLocation(file, name);
    const suffix = location
        ? ` (${path.basename(file)}:${location})`
        : ` (${path.basename(file)})`;
    return `${chalk.dim(name)}${chalk.dim(suffix)}`;
}
function findFuzzLocation(file, name) {
    try {
        const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
        const patterns = [`fuzz("${name}"`, `fuzz('${name}'`];
        let index = -1;
        for (const pattern of patterns) {
            index = source.indexOf(pattern);
            if (index != -1)
                break;
        }
        if (index == -1)
            return null;
        let line = 1;
        let column = 1;
        for (let i = 0; i < index; i++) {
            if (source.charCodeAt(i) == 10) {
                line++;
                column = 1;
            }
            else {
                column++;
            }
        }
        return `${line}:${column}`;
    }
    catch {
        return null;
    }
}
function renderFailedSuites(failedEntries) {
    if (!failedEntries.length)
        return;
    console.log("");
    const printed = new Set();
    for (const failed of failedEntries) {
        const failedAny = failed;
        if (!failedAny?.file)
            continue;
        const file = String(failedAny.file);
        collectSuiteFailures(failed, file, [], printed);
    }
}
function collectSuiteFailures(suite, file, path, printed) {
    const suiteAny = suite;
    const nextPath = [...path, String(suiteAny.description ?? "unknown")];
    const tests = Array.isArray(suiteAny.tests)
        ? suiteAny.tests
        : [];
    for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        if (test.verdict != "fail")
            continue;
        const assertionIndex = i + 1;
        const title = `${nextPath.join(" > ")}#${assertionIndex}`;
        const loc = String(test.location ?? "");
        const where = loc.length ? `${file}:${loc}` : file;
        const dedupeKey = `${file}::${title}::${String(test.left)}::${String(test.right)}`;
        if (printed.has(dedupeKey))
            continue;
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
        console.log(`${chalk.bgRed(" FAIL ")} ${chalk.dim(title)} ${chalk.dim("(" + where + ")")}`);
        console.log(`${chalk.dim("(expected) ->")} ${expected}`);
        console.log(`${chalk.dim("(received) ->")} ${chalk.dim(left)}\n`);
    }
    const suites = Array.isArray(suiteAny.suites)
        ? suiteAny.suites
        : [];
    for (const sub of suites) {
        collectSuiteFailures(sub, file, nextPath, printed);
    }
}
function renderSnapshotSummary(snapshotSummary) {
    console.log("");
    console.log(`${chalk.bold("Snapshots:")} ${chalk.greenBright(snapshotSummary.matched)} matched, ${chalk.blueBright(snapshotSummary.created)} created, ${chalk.blueBright(snapshotSummary.updated)} updated, ${snapshotSummary.failed ? chalk.red(snapshotSummary.failed) : chalk.greenBright("0")} failed`);
}
function renderTotals(stats, event) {
    console.log("");
    process.stdout.write(chalk.bold("Files:  "));
    process.stdout.write(stats.failedFiles
        ? chalk.bold.red(stats.failedFiles + " failed")
        : chalk.bold.greenBright("0 failed"));
    process.stdout.write(", " +
        (stats.skippedFiles
            ? chalk.gray(stats.skippedFiles + " skipped")
            : chalk.gray("0 skipped")));
    process.stdout.write(", " +
        (stats.failedFiles + stats.passedFiles + stats.skippedFiles) +
        " total\n");
    process.stdout.write(chalk.bold("Suites: "));
    process.stdout.write(stats.failedSuites
        ? chalk.bold.red(stats.failedSuites + " failed")
        : chalk.bold.greenBright("0 failed"));
    process.stdout.write(", " +
        (stats.skippedSuites
            ? chalk.gray(stats.skippedSuites + " skipped")
            : chalk.gray("0 skipped")));
    process.stdout.write(", " +
        (stats.failedSuites + stats.passedSuites + stats.skippedSuites) +
        " total\n");
    process.stdout.write(chalk.bold("Tests:  "));
    process.stdout.write(stats.failedTests
        ? chalk.bold.red(stats.failedTests + " failed")
        : chalk.bold.greenBright("0 failed"));
    process.stdout.write(", " +
        (stats.skippedTests
            ? chalk.gray(stats.skippedTests + " skipped")
            : chalk.gray("0 skipped")));
    process.stdout.write(", " + (stats.failedTests + stats.passedTests + stats.skippedTests) + " total\n");
    if (event.modeSummary) {
        renderModeSummary(event.modeSummary);
    }
    if (event.fuzzSummary) {
        renderFuzzTotals(event.fuzzSummary);
    }
    process.stdout.write(chalk.bold("Time:   ") + formatTime(stats.time) + "\n");
}
function renderModeSummary(summary) {
    process.stdout.write(chalk.bold("Modes:  "));
    process.stdout.write(summary.failed
        ? chalk.bold.red(summary.failed + " failed")
        : chalk.bold.greenBright("0 failed"));
    process.stdout.write(", " +
        (summary.skipped
            ? chalk.gray(summary.skipped + " skipped")
            : chalk.gray("0 skipped")));
    process.stdout.write(", " + summary.total + " total\n");
}
function renderFuzzTotals(summary) {
    process.stdout.write(chalk.bold("Fuzz:   "));
    process.stdout.write(summary.failed
        ? chalk.bold.red(summary.failed + " failed")
        : chalk.bold.greenBright("0 failed"));
    process.stdout.write(", " +
        (summary.crashed
            ? chalk.bold.red(summary.crashed + " crashed")
            : chalk.gray("0 crashed")));
    process.stdout.write(", " + summary.total + " total\n");
}
function renderCoverageSummary(summary) {
    const pct = summary.total
        ? ((summary.covered * 100) / summary.total).toFixed(2)
        : "100.00";
    const color = Number(pct) >= 90
        ? chalk.greenBright
        : Number(pct) >= 75
            ? chalk.yellowBright
            : chalk.redBright;
    console.log("");
    console.log(`${chalk.bold("Coverage:")} ${color(pct + "%")} ${chalk.dim(`(${summary.covered}/${summary.total} points, ${summary.uncovered} uncovered)`)}`);
}
function renderCoveragePoints(files) {
    console.log("");
    console.log(chalk.bold("Coverage Points:"));
    const sortedFiles = [...files].sort((a, b) => a.file.localeCompare(b.file));
    for (const file of sortedFiles) {
        const points = [...file.points].sort((a, b) => {
            if (a.line != b.line)
                return a.line - b.line;
            if (a.column != b.column)
                return a.column - b.column;
            return a.type.localeCompare(b.type);
        });
        for (const point of points) {
            if (point.executed)
                continue;
            console.log(`${chalk.bgRed(" MISS ")} ${chalk.dim(`${point.file}:${point.line}:${point.column}`)} ${chalk.dim(point.type)}`);
        }
    }
}
