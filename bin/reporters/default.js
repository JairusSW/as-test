import chalk from "chalk";
import { diff } from "typer-diff";
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
    }
    canRewriteLine() {
        return Boolean(this.context.stdout.isTTY);
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
        if (event.clean)
            return;
        if (event.snapshotEnabled) {
            this.context.stdout.write(chalk.bgBlue(" SNAPSHOT ") +
                ` ${chalk.dim(event.updateSnapshots ? "update mode enabled" : "read-only mode")}\n\n`);
        }
    }
    onFileStart(event) {
        this.currentFile = event.file;
        this.openSuites = [];
        this.verboseSuites = [];
        this.fileHasWarning = false;
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
        const warnLine = `${chalk.bgYellow.black(" WARN ")} missing snapshot for ${chalk.dim(event.key)}. Re-run with ${chalk.bold("--update-snapshots")} to create it.\n`;
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
        renderTotals(event.stats);
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
function renderTotals(stats) {
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
    process.stdout.write(chalk.bold("Time:   ") + formatTime(stats.time) + "\n");
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
    console.log(`${chalk.bold("Coverage:")} ${color(pct + "%")} ${chalk.dim(`(${summary.covered}/${summary.total} points, ${summary.uncovered} uncovered)${Number(pct) < 100.0 ? " run with --show-coverage to see details" : ""}`)}`);
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
