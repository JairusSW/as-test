import chalk from "chalk";
import { diff } from "typer-diff";
import { formatTime } from "../util.js";
export const createReporter = (context) => {
    return new DefaultReporter(context);
};
class DefaultReporter {
    constructor(context) {
        this.context = context;
    }
    onRunStart(event) {
        if (event.clean)
            return;
        this.context.stdout.write(chalk.dim("Running tests using " + event.runtimeName + "") + "\n");
        if (event.snapshotEnabled) {
            this.context.stdout.write(chalk.bgBlue(" SNAPSHOT ") +
                ` ${chalk.dim(event.updateSnapshots ? "update mode enabled" : "read-only mode")}\n\n`);
        }
    }
    onFileStart(_event) { }
    onFileEnd(event) {
        const verdict = event.verdict ?? "none";
        if (verdict == "ok") {
            this.context.stdout.write(`${chalk.bgGreenBright(" PASS ")} ${event.file} ${chalk.dim(event.time ?? "")}\n`);
        }
        else if (verdict == "fail") {
            this.context.stdout.write(`${chalk.bgRed(" FAIL ")} ${event.file} ${chalk.dim(event.time ?? "")}\n`);
        }
        else {
            this.context.stdout.write(`${chalk.bgBlackBright(" SKIP ")} ${event.file} ${chalk.dim(event.time ?? "")}\n`);
        }
    }
    onSuiteStart(_event) { }
    onSuiteEnd(_event) { }
    onAssertionFail(_event) { }
    onSnapshotMissing(event) {
        this.context.stdout.write(`${chalk.bgYellow.black(" WARN ")} missing snapshot for ${chalk.dim(event.key)}. Re-run with ${chalk.bold("--update-snapshots")} to create it.\n`);
    }
    onRunComplete(event) {
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
    if (stats.failedFiles) {
        process.stdout.write(chalk.bold.red(stats.failedFiles + " failed"));
    }
    else {
        process.stdout.write(chalk.bold.greenBright("0 failed"));
    }
    process.stdout.write(", " + (stats.failedFiles + stats.passedFiles) + " total\n");
    process.stdout.write(chalk.bold("Suites: "));
    if (stats.failedSuites) {
        process.stdout.write(chalk.bold.red(stats.failedSuites + " failed"));
    }
    else {
        process.stdout.write(chalk.bold.greenBright("0 failed"));
    }
    process.stdout.write(", " + (stats.failedSuites + stats.passedSuites) + " total\n");
    process.stdout.write(chalk.bold("Tests:  "));
    if (stats.failedTests) {
        process.stdout.write(chalk.bold.red(stats.failedTests + " failed"));
    }
    else {
        process.stdout.write(chalk.bold.greenBright("0 failed"));
    }
    process.stdout.write(", " + (stats.failedTests + stats.passedTests) + " total\n");
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
