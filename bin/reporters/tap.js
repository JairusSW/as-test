export const createReporter = (context) => {
    return new TapReporter(context);
};
class TapReporter {
    constructor(context) {
        this.context = context;
    }
    onRunComplete(event) {
        const points = collectTapPoints(event.reports);
        const totals = {
            pass: 0,
            fail: 0,
            skip: 0,
        };
        this.context.stdout.write("TAP version 13\n");
        this.context.stdout.write(`1..${points.length}\n`);
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const id = i + 1;
            const name = sanitizeTap(point.name.length ? point.name : `test ${id}`);
            if (point.status == "fail") {
                totals.fail++;
                this.context.stdout.write(`not ok ${id} - ${name}\n`);
                this.writeFailDetails(point);
                emitGitHubAnnotation(this.context, point);
                continue;
            }
            if (point.status == "skip") {
                totals.skip++;
                this.context.stdout.write(`ok ${id} - ${name} # SKIP\n`);
                continue;
            }
            totals.pass++;
            this.context.stdout.write(`ok ${id} - ${name}\n`);
        }
        this.context.stdout.write(`# tests ${points.length}\n`);
        this.context.stdout.write(`# pass ${totals.pass}\n`);
        if (totals.skip) {
            this.context.stdout.write(`# skip ${totals.skip}\n`);
        }
        this.context.stdout.write(`# fail ${totals.fail}\n`);
    }
    writeFailDetails(point) {
        this.context.stdout.write("  ---\n");
        this.context.stdout.write(`  message: ${JSON.stringify(point.message ?? "assertion failed")}\n`);
        if (point.file) {
            this.context.stdout.write(`  file: ${JSON.stringify(point.file)}\n`);
        }
        if (point.line) {
            this.context.stdout.write(`  line: ${point.line}\n`);
        }
        if (point.column) {
            this.context.stdout.write(`  column: ${point.column}\n`);
        }
        if (point.matcher) {
            this.context.stdout.write(`  matcher: ${JSON.stringify(point.matcher)}\n`);
        }
        if (point.expected != null) {
            this.context.stdout.write(`  expected: ${JSON.stringify(point.expected)}\n`);
        }
        if (point.actual != null) {
            this.context.stdout.write(`  actual: ${JSON.stringify(point.actual)}\n`);
        }
        if (point.durationMs != null) {
            this.context.stdout.write(`  duration_ms: ${Math.round(point.durationMs * 1000) / 1000}\n`);
        }
        this.context.stdout.write("  ...\n");
    }
}
function collectTapPoints(reports) {
    const points = [];
    if (!Array.isArray(reports))
        return points;
    for (const report of reports) {
        const reportAny = report;
        const file = String(reportAny.file ?? "");
        const suites = Array.isArray(reportAny.suites)
            ? reportAny.suites
            : [];
        for (const suite of suites) {
            collectTapPointsFromSuite(suite, file, [], points);
        }
    }
    return points;
}
function collectTapPointsFromSuite(suite, file, path, points) {
    const suiteAny = suite;
    const description = String(suiteAny.description ?? "suite");
    const fullPath = [...path, description];
    const localFile = suiteAny.file ? String(suiteAny.file) : file;
    const childSuites = Array.isArray(suiteAny.suites)
        ? suiteAny.suites
        : [];
    const tests = Array.isArray(suiteAny.tests)
        ? suiteAny.tests
        : [];
    const suiteKind = String(suiteAny.kind ?? "");
    const durationMs = suiteDuration(suiteAny.time);
    if (tests.length > 0) {
        for (let i = 0; i < tests.length; i++) {
            const test = tests[i];
            const location = parseLocation(test.location);
            const name = tests.length > 1
                ? `${fullPath.join(" > ")} #${i + 1}`
                : fullPath.join(" > ");
            const status = normalizeStatus(test.verdict);
            const matcher = stringifyValue(test.instr);
            const expected = stringifyValue(test.right);
            const actual = stringifyValue(test.left);
            const message = buildFailureMessage(stringifyValue(test.message), matcher, expected, actual);
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
    }
    else if (childSuites.length == 0 &&
        (suiteKind == "test" ||
            suiteKind == "it" ||
            suiteKind == "xtest" ||
            suiteKind == "xit")) {
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
function suiteDuration(value) {
    const time = value;
    if (!time)
        return undefined;
    const start = Number(time.start ?? 0);
    const end = Number(time.end ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return undefined;
    }
    return end - start;
}
function parseLocation(value) {
    const text = String(value ?? "").trim();
    if (!text.length)
        return {};
    const match = /^(\d+)(?::(\d+))?$/.exec(text);
    if (!match)
        return {};
    const line = Number(match[1]);
    const column = match[2] ? Number(match[2]) : undefined;
    return {
        line: Number.isFinite(line) && line > 0 ? line : undefined,
        column: typeof column == "number" && Number.isFinite(column) && column > 0
            ? column
            : undefined,
    };
}
function normalizeStatus(verdict) {
    const value = String(verdict ?? "none");
    if (value == "fail")
        return "fail";
    if (value == "ok")
        return "ok";
    return "skip";
}
function stringifyValue(value) {
    if (value == null)
        return "";
    if (typeof value == "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function buildFailureMessage(message, matcher, expected, actual) {
    if (message.length)
        return message;
    if (matcher.length && expected.length && actual.length) {
        return `${matcher} expected ${expected} but received ${actual}`;
    }
    if (matcher.length)
        return `${matcher} failed`;
    return "assertion failed";
}
function sanitizeTap(name) {
    return name.replace(/\s+/g, " ").replace(/#/g, "\\#").trim();
}
function emitGitHubAnnotation(context, point) {
    if (process.env.GITHUB_ACTIONS != "true" || point.status != "fail")
        return;
    const properties = [];
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
    context.stderr.write(`::error ${properties.join(",")}::${escapeGithubValue(detail)}\n`);
}
function escapeGithubValue(value, property = false) {
    let output = value
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
    if (property) {
        output = output.replace(/:/g, "%3A").replace(/,/g, "%2C");
    }
    return output;
}
