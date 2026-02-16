import chalk from "chalk";
import { spawn } from "child_process";
import { glob } from "glob";
import { getExec, loadConfig } from "./util.js";
import * as path from "path";
import { pathToFileURL } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createReporter as createDefaultReporter } from "./reporters/default.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
var MessageType;
(function (MessageType) {
    MessageType[MessageType["OPEN"] = 0] = "OPEN";
    MessageType[MessageType["CLOSE"] = 1] = "CLOSE";
    MessageType[MessageType["CALL"] = 2] = "CALL";
    MessageType[MessageType["DATA"] = 3] = "DATA";
})(MessageType || (MessageType = {}));
class Channel {
    constructor(input, output) {
        this.input = input;
        this.output = output;
        this.buffer = Buffer.alloc(0);
        this.input.on("data", (chunk) => this.onData(chunk));
    }
    send(type, payload) {
        const body = payload ?? Buffer.alloc(0);
        const header = Buffer.alloc(Channel.HEADER_SIZE);
        Channel.MAGIC.copy(header, 0);
        header.writeUInt8(type, 4);
        header.writeUInt32LE(body.length, 5);
        this.output.write(Buffer.concat([header, body]));
    }
    sendJSON(type, msg) {
        this.send(type, Buffer.from(JSON.stringify(msg), "utf8"));
    }
    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            if (this.buffer.length === 0)
                return;
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
            if (this.buffer.length < Channel.HEADER_SIZE)
                return;
            const type = this.buffer.readUInt8(4);
            const length = this.buffer.readUInt32LE(5);
            const frameSize = Channel.HEADER_SIZE + length;
            if (this.buffer.length < frameSize)
                return;
            const payload = this.buffer.subarray(Channel.HEADER_SIZE, frameSize);
            this.buffer = this.buffer.subarray(frameSize);
            this.handleFrame(type, payload);
        }
    }
    handleFrame(type, payload) {
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
    onPassthrough(_data) { }
    onOpen() { }
    onClose() { }
    onCall(_msg) { }
    onDataMessage(_data) { }
}
Channel.MAGIC = Buffer.from("WIPC");
Channel.HEADER_SIZE = 9;
class SnapshotStore {
    constructor(specFile, snapshotDir) {
        this.dirty = false;
        this.created = 0;
        this.updated = 0;
        this.matched = 0;
        this.failed = 0;
        this.warnedMissing = new Set();
        const base = path.basename(specFile, ".ts");
        const dir = path.join(process.cwd(), snapshotDir);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        this.filePath = path.join(dir, `${base}.snap.json`);
        this.data = existsSync(this.filePath)
            ? JSON.parse(readFileSync(this.filePath, "utf8"))
            : {};
    }
    assert(key, actual, allowSnapshot, updateSnapshots) {
        if (!allowSnapshot)
            return { ok: true, expected: actual, warnMissing: false };
        if (!(key in this.data)) {
            if (!updateSnapshots) {
                this.failed++;
                const warnMissing = !this.warnedMissing.has(key);
                if (warnMissing)
                    this.warnedMissing.add(key);
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
        const expected = this.data[key];
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
    flush() {
        if (!this.dirty)
            return;
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }
}
export async function run(flags = {}, configPath = DEFAULT_CONFIG_PATH, selectors = [], shouldExit = true, options = {}) {
    const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
    const reports = [];
    const config = loadConfig(resolvedConfigPath);
    const inputPatterns = resolveInputPatterns(config.input, selectors);
    const inputFiles = await glob(inputPatterns);
    const snapshotEnabled = flags.snapshot !== false;
    const updateSnapshots = Boolean(flags.updateSnapshots);
    const cleanOutput = Boolean(flags.clean);
    const showCoverage = Boolean(flags.showCoverage);
    const coverage = resolveCoverageOptions(config.coverage);
    const coverageEnabled = coverage.enabled;
    const coverageDir = config.coverageDir ?? "./.as-test/coverage";
    const runtimeCommand = resolveRuntimeCommand(getConfiguredRuntimeCmd(config), config.buildOptions.target);
    const reporter = options.reporter ??
        (await loadReporter(config.runOptions.reporter, resolvedConfigPath, {
            stdout: process.stdout,
            stderr: process.stderr,
        }));
    const command = runtimeCommand.split(" ")[0];
    const execPath = getExec(command);
    if (!execPath) {
        const message = `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${command} in PATH variable!`;
        if (shouldExit) {
            console.log(message);
            process.exit(1);
        }
        throw new Error(message);
    }
    if (options.emitRunStart !== false) {
        reporter.onRunStart?.({
            runtimeName: runtimeNameFromCommand(runtimeCommand),
            clean: cleanOutput,
            snapshotEnabled,
            updateSnapshots,
        });
    }
    if (showCoverage && !coverageEnabled) {
        process.stderr.write(chalk.dim("coverage point output requested with --show-coverage, but coverage is disabled\n"));
    }
    const snapshotSummary = {
        matched: 0,
        created: 0,
        updated: 0,
        failed: 0,
    };
    for (let i = 0; i < inputFiles.length; i++) {
        const file = inputFiles[i];
        const outFile = path.join(config.outDir, file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm"));
        const fileBase = file
            .slice(file.lastIndexOf("/") + 1)
            .replace(".ts", "")
            .replace(".spec", "");
        let cmd = runtimeCommand.replace(command, execPath);
        cmd = cmd.replace("<name>", fileBase);
        if (config.buildOptions.target == "bindings" && !cmd.includes("<file>")) {
            cmd = cmd.replace("<file>", outFile
                .replace("build", "tests")
                .replace(".spec", "")
                .replace(".wasm", ".run.js"));
        }
        else {
            cmd = cmd.replace("<file>", outFile);
        }
        const snapshotStore = new SnapshotStore(file, config.snapshotDir);
        const report = await runProcess(cmd, snapshotStore, snapshotEnabled, updateSnapshots, reporter);
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
        const logReports = reports.map((report) => ({
            file: report.file,
            suites: report.suites,
        }));
        writeFileSync(path.join(process.cwd(), config.logs, options.logFileName ?? "test.log.json"), JSON.stringify(logReports, null, 2));
    }
    const stats = collectRunStats(reports.map((report) => report.suites));
    const coverageSummary = collectCoverageSummary(reports, coverageEnabled, showCoverage, coverage);
    if (coverageEnabled &&
        coverageDir &&
        coverageDir != "none" &&
        coverageSummary.files.length > 0) {
        const resolvedCoverageDir = path.join(process.cwd(), coverageDir);
        if (!existsSync(resolvedCoverageDir)) {
            mkdirSync(resolvedCoverageDir, { recursive: true });
        }
        writeFileSync(path.join(resolvedCoverageDir, options.coverageFileName ?? "coverage.log.json"), JSON.stringify(coverageSummary, null, 2));
    }
    if (options.emitRunComplete !== false) {
        reporter.onRunComplete?.({
            clean: cleanOutput,
            snapshotEnabled,
            showCoverage,
            snapshotSummary,
            coverageSummary,
            stats,
            reports,
        });
    }
    const failed = Boolean(stats.failedFiles || snapshotSummary.failed);
    if (shouldExit) {
        process.exit(failed ? 1 : 0);
    }
    return {
        failed,
        stats,
        snapshotSummary,
        coverageSummary,
        reports,
    };
}
function resolveRuntimeCommand(runtimeRun, target) {
    if (target != "wasi")
        return runtimeRun;
    const preferredPath = "./.as-test/runners/default.wasi.js";
    const legacyPaths = ["./bin/wasi-run.js", "./.as-test/wasi/wasi.run.js"];
    if (runtimeRun.includes(preferredPath)) {
        const resolvedPreferredPath = path.join(process.cwd(), preferredPath);
        if (existsSync(resolvedPreferredPath))
            return runtimeRun;
        throw new Error(`could not locate WASI runner at ${preferredPath}. Run "ast init --target wasi --force --yes" to scaffold the local runner.`);
    }
    for (const legacyPath of legacyPaths) {
        if (!runtimeRun.includes(legacyPath))
            continue;
        const resolvedLegacyPath = path.join(process.cwd(), legacyPath);
        if (existsSync(resolvedLegacyPath))
            return runtimeRun;
        const resolvedPreferredPath = path.join(process.cwd(), preferredPath);
        if (existsSync(resolvedPreferredPath)) {
            process.stderr.write(chalk.dim(`legacy WASI runtime path detected (${legacyPath}); using ${preferredPath}\n`));
            return runtimeRun.replace(legacyPath, preferredPath);
        }
        throw new Error(`could not locate WASI runner. Expected ${legacyPath} or ${preferredPath}. Run "ast init --target wasi --force --yes" to scaffold the local runner.`);
    }
    return runtimeRun;
}
function getConfiguredRuntimeCmd(config) {
    const runtime = config.runOptions.runtime;
    if (runtime.cmd && runtime.cmd.length)
        return runtime.cmd;
    if (runtime.run && runtime.run.length)
        return runtime.run;
    throw new Error(`runtime command is missing. Set "runOptions.runtime.cmd" in as-test.config.json`);
}
function runtimeNameFromCommand(command) {
    const token = command.trim().split(/\s+/)[0];
    return token && token.length ? token : "runtime";
}
function resolveInputPatterns(configured, selectors) {
    const configuredInputs = Array.isArray(configured) ? configured : [configured];
    if (!selectors.length)
        return configuredInputs;
    const patterns = new Set();
    for (const selector of selectors) {
        if (!selector)
            continue;
        if (isBareSuiteSelector(selector)) {
            const base = stripSuiteSuffix(selector);
            for (const configuredInput of configuredInputs) {
                patterns.add(path.join(path.dirname(configuredInput), `${base}.spec.ts`));
            }
            continue;
        }
        patterns.add(selector);
    }
    return [...patterns];
}
function isBareSuiteSelector(selector) {
    return (!selector.includes("/") &&
        !selector.includes("\\") &&
        !/[*?[\]{}]/.test(selector));
}
function stripSuiteSuffix(selector) {
    return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}
function normalizeReport(raw) {
    if (Array.isArray(raw)) {
        return {
            suites: raw,
            coverage: {
                total: 0,
                covered: 0,
                uncovered: 0,
                percent: 100,
                points: [],
            },
        };
    }
    const value = raw;
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
    const suites = Array.isArray(value.suites) ? value.suites : [];
    const coverage = normalizeCoverage(value.coverage);
    return { suites, coverage };
}
function normalizeCoverage(value) {
    const raw = value;
    const total = Number(raw?.total ?? 0);
    const uncovered = Number(raw?.uncovered ?? 0);
    const covered = raw?.covered != null ? Number(raw.covered) : Math.max(total - uncovered, 0);
    const percent = raw?.percent != null
        ? Number(raw.percent)
        : total
            ? (covered * 100) / total
            : 100;
    const pointsRaw = Array.isArray(raw?.points)
        ? raw?.points
        : [];
    const points = pointsRaw
        .map((point) => {
        const p = point;
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
function collectCoverageSummary(reports, enabled, showPoints, coverage) {
    const summary = {
        enabled,
        showPoints,
        total: 0,
        covered: 0,
        uncovered: 0,
        percent: 100,
        files: [],
    };
    const uniquePoints = new Map();
    const hasDetailedPoints = reports.some((report) => report.coverage.points.length > 0);
    for (const report of reports) {
        for (const point of report.coverage.points) {
            if (isIgnoredCoverageFile(point.file, coverage))
                continue;
            const key = `${point.file}::${point.hash}`;
            const existing = uniquePoints.get(key);
            if (!existing) {
                uniquePoints.set(key, { ...point });
            }
            else if (point.executed) {
                existing.executed = true;
            }
        }
    }
    if (uniquePoints.size > 0) {
        const byFile = new Map();
        for (const point of uniquePoints.values()) {
            if (!byFile.has(point.file))
                byFile.set(point.file, []);
            byFile.get(point.file).push(point);
            summary.total++;
            if (point.executed)
                summary.covered++;
            else
                summary.uncovered++;
        }
        for (const [file, points] of byFile.entries()) {
            let covered = 0;
            for (const point of points) {
                if (point.executed)
                    covered++;
            }
            const total = points.length;
            if (!total)
                continue;
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
    }
    else if (!hasDetailedPoints) {
        // Compatibility fallback for reports without detailed point payloads.
        for (const report of reports) {
            if (isIgnoredCoverageFile(report.file, coverage))
                continue;
            if (report.coverage.total <= 0)
                continue;
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
    summary.percent = summary.total
        ? (summary.covered * 100) / summary.total
        : 100;
    return summary;
}
function isIgnoredCoverageFile(file, coverage) {
    const normalized = file.replace(/\\/g, "/");
    if (!isAllowedCoverageSourceFile(normalized))
        return true;
    if (normalized.startsWith("node_modules/"))
        return true;
    if (normalized.includes("/node_modules/"))
        return true;
    if (isAssemblyScriptStdlibFile(normalized))
        return true;
    if (!coverage.includeSpecs && normalized.endsWith(".spec.ts"))
        return true;
    return false;
}
function isAllowedCoverageSourceFile(file) {
    const lower = file.toLowerCase();
    return lower.endsWith(".ts") || lower.endsWith(".as");
}
function isAssemblyScriptStdlibFile(file) {
    if (file.startsWith("~lib/"))
        return true;
    if (file.includes("/~lib/"))
        return true;
    if (file.startsWith("assemblyscript/std/"))
        return true;
    if (file.includes("/assemblyscript/std/"))
        return true;
    return false;
}
function resolveCoverageOptions(raw) {
    if (typeof raw == "boolean") {
        return {
            enabled: raw,
            includeSpecs: false,
        };
    }
    if (raw && typeof raw == "object") {
        const obj = raw;
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
async function runProcess(cmd, snapshots, snapshotEnabled, updateSnapshots, reporter) {
    const child = spawn(cmd, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
    });
    let report = null;
    let parseError = null;
    let stderrBuffer = "";
    let suppressTraceWarningLine = false;
    child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString("utf8");
        let newline = stderrBuffer.indexOf("\n");
        while (newline >= 0) {
            const line = stderrBuffer.slice(0, newline + 1);
            stderrBuffer = stderrBuffer.slice(newline + 1);
            if (shouldSuppressWasiWarningLine(line, suppressTraceWarningLine)) {
                suppressTraceWarningLine = true;
            }
            else {
                suppressTraceWarningLine = false;
                process.stderr.write(line);
            }
            newline = stderrBuffer.indexOf("\n");
        }
    });
    class TestChannel extends Channel {
        onPassthrough(data) {
            process.stdout.write(data);
        }
        onCall(msg) {
            const event = msg;
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
                const result = snapshots.assert(key, actual, snapshotEnabled, updateSnapshots);
                if (result.warnMissing) {
                    reporter.onSnapshotMissing?.({ key });
                }
                this.send(MessageType.CALL, Buffer.from(`${result.ok ? "1" : "0"}\n${result.expected}`, "utf8"));
                return;
            }
            this.sendJSON(MessageType.CALL, { ok: true, expected: "" });
        }
        onDataMessage(data) {
            try {
                report = JSON.parse(data.toString("utf8"));
            }
            catch (error) {
                parseError = String(error);
            }
        }
    }
    const _channel = new TestChannel(child.stdout, child.stdin);
    const code = await new Promise((resolve) => {
        child.on("close", (exitCode) => resolve(exitCode ?? 1));
    });
    if (stderrBuffer.length) {
        if (!shouldSuppressWasiWarningLine(stderrBuffer, suppressTraceWarningLine)) {
            process.stderr.write(stderrBuffer);
        }
    }
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
function shouldSuppressWasiWarningLine(line, suppressTraceWarningLine) {
    if (line.includes("ExperimentalWarning: WASI is an experimental feature")) {
        return true;
    }
    if (suppressTraceWarningLine && line.includes("--trace-warnings")) {
        return true;
    }
    return false;
}
function collectRunStats(reports) {
    const stats = {
        passedFiles: 0,
        failedFiles: 0,
        skippedFiles: 0,
        passedSuites: 0,
        failedSuites: 0,
        skippedSuites: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        time: 0.0,
        failedEntries: [],
    };
    for (const fileReport of reports) {
        readFileReport(stats, fileReport);
    }
    return stats;
}
function readFileReport(stats, fileReport) {
    const suites = Array.isArray(fileReport) ? fileReport : [];
    let fileVerdict = "none";
    for (const suite of suites) {
        fileVerdict = mergeVerdict(fileVerdict, readSuite(stats, suite));
    }
    if (fileVerdict == "fail") {
        stats.failedFiles++;
    }
    else if (fileVerdict == "ok") {
        stats.passedFiles++;
    }
    else {
        stats.skippedFiles++;
    }
}
function readSuite(stats, suite) {
    const suiteAny = suite;
    let verdict = normalizeVerdict(suiteAny.verdict);
    const time = suiteAny.time;
    const start = Number(time?.start ?? 0);
    const end = Number(time?.end ?? 0);
    stats.time += end - start;
    const subSuites = Array.isArray(suiteAny.suites)
        ? suiteAny.suites
        : [];
    for (const subSuite of subSuites) {
        verdict = mergeVerdict(verdict, readSuite(stats, subSuite));
    }
    const tests = Array.isArray(suiteAny.tests)
        ? suiteAny.tests
        : [];
    for (const test of tests) {
        const testVerdict = normalizeVerdict(test.verdict);
        verdict = mergeVerdict(verdict, testVerdict);
        if (testVerdict == "fail") {
            stats.failedTests++;
        }
        else if (testVerdict == "ok") {
            stats.passedTests++;
        }
        else {
            stats.skippedTests++;
        }
    }
    if (verdict == "fail") {
        stats.failedSuites++;
        stats.failedEntries.push(suite);
    }
    else if (verdict == "ok") {
        stats.passedSuites++;
    }
    else {
        stats.skippedSuites++;
    }
    return verdict;
}
function normalizeVerdict(value) {
    const verdict = String(value ?? "none");
    if (verdict == "fail")
        return "fail";
    if (verdict == "ok")
        return "ok";
    if (verdict == "skip")
        return "skip";
    return "none";
}
function mergeVerdict(current, next) {
    if (current == "fail" || next == "fail")
        return "fail";
    if (current == "ok" || next == "ok")
        return "ok";
    if (current == "skip" || next == "skip")
        return "skip";
    return "none";
}
export async function createRunReporter(configPath = DEFAULT_CONFIG_PATH) {
    const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
    const config = loadConfig(resolvedConfigPath);
    const reporter = await loadReporter(config.runOptions.reporter, resolvedConfigPath, {
        stdout: process.stdout,
        stderr: process.stderr,
    });
    const runtimeCommand = resolveRuntimeCommand(getConfiguredRuntimeCmd(config), config.buildOptions.target);
    return {
        reporter,
        runtimeName: runtimeNameFromCommand(runtimeCommand),
        resolvedConfigPath,
    };
}
async function loadReporter(reporterPath, configPath, context) {
    if (!reporterPath) {
        return createDefaultReporter(context);
    }
    const resolved = path.isAbsolute(reporterPath)
        ? reporterPath
        : path.resolve(path.dirname(configPath), reporterPath);
    try {
        const mod = (await import(pathToFileURL(resolved).href));
        const factory = resolveReporterFactory(mod);
        return factory(context);
    }
    catch (error) {
        const reporterError = new Error(`could not load reporter "${reporterPath}": ${String(error)}`);
        reporterError.cause = error;
        throw reporterError;
    }
}
function resolveReporterFactory(mod) {
    const fromNamed = mod.createReporter;
    if (typeof fromNamed == "function") {
        return fromNamed;
    }
    const fromDefault = mod.default;
    if (typeof fromDefault == "function") {
        return fromDefault;
    }
    if (fromDefault &&
        typeof fromDefault == "object" &&
        "createReporter" in fromDefault) {
        const nested = fromDefault.createReporter;
        if (typeof nested == "function") {
            return nested;
        }
    }
    throw new Error(`reporter module must export a factory as "createReporter" or default`);
}
