#!/usr/bin/env node
import chalk from "chalk";
import { build } from "./build.js";
import { createRunReporter, run } from "./run.js";
import { init } from "./init.js";
import { getCliVersion, loadConfig, resolveModeNames } from "./util.js";
import * as path from "path";
import { glob } from "glob";
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "init"];
const version = getCliVersion();
const configPath = resolveConfigPath(_args);
const selectedModes = resolveModeNames(_args);
for (const arg of _args) {
    if (arg.startsWith("-"))
        flags.push(arg);
    else
        args.push(arg);
}
if (!args.length) {
    if (flags.includes("--version") || flags.includes("-v")) {
        console.log("as-test v" + version.toString());
    }
    else {
        info();
    }
}
else if (COMMANDS.includes(args[0])) {
    try {
        const command = args.shift();
        const commandArgs = resolveCommandArgs(_args, command ?? "");
        const featureToggles = resolveFeatureToggles(_args, command ?? "");
        const buildFeatureToggles = {
            tryAs: featureToggles.tryAs,
            coverage: featureToggles.coverage,
        };
        const runFlags = {
            snapshot: !flags.includes("--no-snapshot"),
            updateSnapshots: flags.includes("--update-snapshots"),
            clean: flags.includes("--clean"),
            showCoverage: flags.includes("--show-coverage"),
            verbose: flags.includes("--verbose"),
            coverage: featureToggles.coverage,
        };
        if (command === "build") {
            const modeTargets = resolveExecutionModes(configPath, selectedModes);
            runBuildModes(configPath, commandArgs, modeTargets, buildFeatureToggles).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "run") {
            const modeTargets = resolveExecutionModes(configPath, selectedModes);
            runRuntimeModes(runFlags, configPath, commandArgs, modeTargets).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "test") {
            const modeTargets = resolveExecutionModes(configPath, selectedModes);
            runTestModes(runFlags, configPath, commandArgs, modeTargets, buildFeatureToggles).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "init") {
            const commandTokens = resolveCommandTokens(_args, command ?? "");
            init(commandTokens).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
    }
    catch (error) {
        printCliError(error);
        process.exit(1);
    }
}
else {
    console.log(chalk.bgRed(" ERROR ") +
        chalk.dim(":") +
        " " +
        chalk.bold("Unknown command: ") +
        args[0]);
}
function info() {
    console.log(chalk.bold.blueBright("as-test") +
        " is a testing framework for AssemblyScript. " +
        chalk.dim("(v" + version + ")") +
        "\n");
    console.log(chalk.bold("Usage: as-test") +
        " " +
        chalk.dim("<command>") +
        " " +
        chalk.bold.blueBright("[...flags]") +
        " " +
        chalk.bold("[...args]") +
        " " +
        chalk.dim("(alias: ast)") +
        "\n");
    console.log(chalk.bold("Commands:"));
    console.log("  " +
        chalk.bold.blueBright("run") +
        "     " +
        chalk.dim("<./**/*.spec.ts>") +
        "       " +
        "Run unit tests with selected runtime");
    console.log("  " +
        chalk.bold.blueBright("build") +
        "   " +
        chalk.dim("<./**/*.spec.ts>") +
        "       " +
        "Build unit tests and compile");
    console.log("  " +
        chalk.bold.blueBright("test") +
        "    " +
        chalk.dim("<name>|<path-or-glob>") +
        "  " +
        "Build and run unit tests with selected runtime" +
        "\n");
    console.log("  " +
        chalk.bold.magentaBright("init") +
        "    " +
        chalk.dim("<./dir>") +
        "                " +
        "Initialize an empty testing template");
    console.log("");
    console.log(chalk.bold("Flags:"));
    console.log("   " +
        chalk.bold.blue("--mode <name[,name...]>") +
        "       " +
        "Run one or multiple named config modes");
    console.log("   " +
        chalk.bold.blue("--config <path>") +
        "               " +
        "Use a specific config file");
    console.log("   " +
        chalk.bold.blue("--snapshot") +
        "                    " +
        "Snapshot assertions (enabled by default)");
    console.log("   " +
        chalk.bold.blue("--update-snapshots") +
        "            " +
        "Create/update snapshot files on mismatch");
    console.log("   " +
        chalk.bold.blue("--no-snapshot") +
        "                 " +
        "Disable snapshot assertions for this run");
    console.log("   " +
        chalk.bold.blue("--show-coverage") +
        "               " +
        "Print all coverage points with line:column refs");
    console.log("   " +
        chalk.bold.blue("--enable <feature>") +
        "           " +
        "Enable as-test feature (coverage|try-as)");
    console.log("   " +
        chalk.bold.blue("--disable <feature>") +
        "          " +
        "Disable as-test feature (coverage|try-as)");
    console.log("   " +
        chalk.bold.blue("--verbose") +
        "                     " +
        "Print each suite start/end line");
    console.log("   " +
        chalk.bold.blue("--reporter <name|path>") +
        "        " +
        "Use built-in reporter (default|tap) or custom module path");
    console.log("");
    console.log(chalk.dim("If your using this, consider dropping a star, it would help a lot!") + "\n");
    console.log("View the repo:                   " +
        chalk.magenta("https://github.com/JairusSW/as-test"));
    // console.log(
    //   "View the docs:                   " +
    //     chalk.blue("https://docs.jairus.dev/as-test"),
    // );
}
function resolveConfigPath(rawArgs) {
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg == "--config") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                return path.resolve(process.cwd(), next);
            }
            return undefined;
        }
        if (arg.startsWith("--config=")) {
            const value = arg.slice("--config=".length);
            if (value.length) {
                return path.resolve(process.cwd(), value);
            }
            return undefined;
        }
    }
    return undefined;
}
function resolveCommandArgs(rawArgs, command) {
    const values = [];
    let seenCommand = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (!seenCommand) {
            if (arg == command)
                seenCommand = true;
            continue;
        }
        if (arg == "--config") {
            i++;
            continue;
        }
        if (arg == "--mode") {
            i++;
            continue;
        }
        if (arg.startsWith("--config=")) {
            continue;
        }
        if (arg.startsWith("--mode=")) {
            continue;
        }
        if (arg == "--reporter") {
            i++;
            continue;
        }
        if (arg.startsWith("--reporter=")) {
            continue;
        }
        if (arg == "--tap") {
            continue;
        }
        if (arg == "--enable" || arg == "--disable") {
            i++;
            continue;
        }
        if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
            continue;
        }
        if (arg.startsWith("-")) {
            continue;
        }
        values.push(arg);
    }
    return values;
}
function resolveFeatureToggles(rawArgs, command) {
    if (command !== "build" && command !== "run" && command !== "test")
        return {};
    const out = {};
    let seenCommand = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (!seenCommand) {
            if (arg == command)
                seenCommand = true;
            continue;
        }
        if (arg == "--enable" || arg == "--disable") {
            const enabled = arg == "--enable";
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                applyFeatureToggle(out, next, enabled);
                i++;
            }
            continue;
        }
        if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
            const enabled = arg.startsWith("--enable=");
            const eq = arg.indexOf("=");
            const value = arg.slice(eq + 1).trim();
            if (value.length) {
                applyFeatureToggle(out, value, enabled);
            }
        }
    }
    return out;
}
function applyFeatureToggle(out, rawFeature, enabled) {
    const key = rawFeature.trim().toLowerCase();
    if (key == "coverage") {
        out.coverage = enabled;
        return;
    }
    if (key == "try-as" || key == "try_as" || key == "tryas") {
        out.tryAs = enabled;
        return;
    }
    throw new Error(`unknown feature "${rawFeature}". Supported features: coverage, try-as`);
}
function resolveCommandTokens(rawArgs, command) {
    const values = [];
    let seenCommand = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (!seenCommand) {
            if (arg == command)
                seenCommand = true;
            continue;
        }
        values.push(arg);
    }
    return values;
}
async function runTestSequential(runFlags, configPath, selectors, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal, modeName) {
    const files = await resolveSelectedFiles(configPath, selectors);
    if (!files.length) {
        const scope = selectors.length > 0
            ? selectors.join(", ")
            : "configured input patterns";
        throw new Error(`No test files matched: ${scope}`);
    }
    const reporterSession = await createRunReporter(configPath, undefined, modeName);
    const reporter = reporterSession.reporter;
    const snapshotEnabled = runFlags.snapshot !== false;
    reporter.onRunStart?.({
        runtimeName: reporterSession.runtimeName,
        clean: runFlags.clean,
        verbose: runFlags.verbose,
        snapshotEnabled,
        updateSnapshots: runFlags.updateSnapshots,
    });
    const results = [];
    let failed = false;
    for (const file of files) {
        await build(configPath, [file], modeName, buildFeatureToggles);
        const artifactKey = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "_");
        const result = await run(runFlags, configPath, [file], false, {
            reporter,
            emitRunStart: false,
            emitRunComplete: false,
            logFileName: `test.${artifactKey}.log.json`,
            coverageFileName: `coverage.${artifactKey}.log.json`,
            modeName,
        });
        results.push(result);
        if (result?.failed)
            failed = true;
    }
    const summary = aggregateRunResults(results);
    summary.stats = applyConfiguredFileTotalToStats(summary.stats, fileSummaryTotal);
    reporter.onRunComplete?.({
        clean: runFlags.clean,
        snapshotEnabled,
        showCoverage: runFlags.showCoverage,
        snapshotSummary: summary.snapshotSummary,
        coverageSummary: summary.coverageSummary,
        stats: summary.stats,
        reports: summary.reports,
        modeSummary: buildSingleModeSummary(summary.stats, summary.snapshotSummary, modeSummaryTotal),
    });
    return failed;
}
async function runBuildModes(configPath, selectors, modes, buildFeatureToggles) {
    for (const modeName of modes) {
        await build(configPath, selectors, modeName, buildFeatureToggles);
    }
}
async function runRuntimeModes(runFlags, configPath, selectors, modes) {
    const modeSummaryTotal = resolveConfiguredModeTotal(configPath);
    const fileSummaryTotal = await resolveConfiguredFileTotal(configPath);
    if (modes.length > 1) {
        const failed = await runRuntimeMatrix(runFlags, configPath, selectors, modes, modeSummaryTotal, fileSummaryTotal);
        process.exit(failed ? 1 : 0);
        return;
    }
    let failed = false;
    for (const modeName of modes) {
        const result = await run(runFlags, configPath, selectors, false, {
            modeName,
            modeSummaryTotal,
            modeSummaryExecuted: 1,
            fileSummaryTotal,
        });
        if (result.failed)
            failed = true;
    }
    process.exit(failed ? 1 : 0);
}
async function runRuntimeMatrix(runFlags, configPath, selectors, modes, modeSummaryTotal, fileSummaryTotal) {
    const files = await resolveSelectedFiles(configPath, selectors);
    if (!files.length) {
        const scope = selectors.length > 0
            ? selectors.join(", ")
            : "configured input patterns";
        throw new Error(`No test files matched: ${scope}`);
    }
    const reporterSession = await createRunReporter(configPath);
    const reporter = reporterSession.reporter;
    const snapshotEnabled = runFlags.snapshot !== false;
    reporter.onRunStart?.({
        runtimeName: reporterSession.runtimeName,
        clean: runFlags.clean,
        verbose: runFlags.verbose,
        snapshotEnabled,
        updateSnapshots: runFlags.updateSnapshots,
    });
    const silentReporter = {};
    const allResults = [];
    const modeLabels = modes.map((modeName) => modeName ?? "default");
    const showPerModeTimes = Boolean(runFlags.verbose);
    const liveMatrix = reporterSession.reporterKind == "default" && canRewriteStdout();
    const modeState = modes.map(() => ({
        failed: false,
        passed: false,
    }));
    const fileState = files.map(() => ({
        failed: false,
        passed: false,
    }));
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        const fileName = path.basename(file);
        const fileResults = [];
        const modeTimes = modes.map(() => "...");
        if (liveMatrix) {
            renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
        }
        for (let i = 0; i < modes.length; i++) {
            const modeName = modes[i];
            try {
                const artifactKey = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
                const result = await run(runFlags, configPath, [file], false, {
                    reporter: silentReporter,
                    reporterKind: "default",
                    emitRunStart: false,
                    emitRunComplete: false,
                    logFileName: `run.${artifactKey}.log.json`,
                    coverageFileName: `coverage.${artifactKey}.log.json`,
                    modeName,
                });
                modeTimes[i] = formatMatrixModeTime(result.stats.time);
                if (liveMatrix) {
                    renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
                }
                if (result.failed) {
                    modeState[i].failed = true;
                }
                else if (result.stats.passedFiles > 0) {
                    modeState[i].passed = true;
                }
                fileResults.push(result);
                allResults.push(result);
            }
            catch (error) {
                clearLiveLine();
                throw error;
            }
        }
        renderMatrixFileResult(fileName, modeLabels, fileResults, modeTimes, liveMatrix, showPerModeTimes);
        const verdict = resolveMatrixVerdict(fileResults);
        if (verdict == "fail") {
            fileState[fileIndex].failed = true;
        }
        else if (verdict == "ok") {
            fileState[fileIndex].passed = true;
        }
    }
    const summary = aggregateRunResults(allResults);
    summary.stats = applyMatrixFileSummaryToStats(summary.stats, fileState, fileSummaryTotal);
    reporter.onRunComplete?.({
        clean: runFlags.clean,
        snapshotEnabled,
        showCoverage: runFlags.showCoverage,
        snapshotSummary: summary.snapshotSummary,
        coverageSummary: summary.coverageSummary,
        stats: summary.stats,
        reports: summary.reports,
        modeSummary: buildModeSummary(modeState, modeSummaryTotal),
    });
    return allResults.some((result) => result.failed);
}
async function runTestModes(runFlags, configPath, selectors, modes, buildFeatureToggles) {
    const modeSummaryTotal = resolveConfiguredModeTotal(configPath);
    const fileSummaryTotal = await resolveConfiguredFileTotal(configPath);
    if (modes.length > 1) {
        const failed = await runTestMatrix(runFlags, configPath, selectors, modes, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal);
        process.exit(failed ? 1 : 0);
        return;
    }
    let failed = false;
    for (const modeName of modes) {
        const modeFailed = await runTestSequential(runFlags, configPath, selectors, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal, modeName);
        if (modeFailed)
            failed = true;
    }
    process.exit(failed ? 1 : 0);
}
async function runTestMatrix(runFlags, configPath, selectors, modes, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal) {
    const files = await resolveSelectedFiles(configPath, selectors);
    if (!files.length) {
        const scope = selectors.length > 0
            ? selectors.join(", ")
            : "configured input patterns";
        throw new Error(`No test files matched: ${scope}`);
    }
    const reporterSession = await createRunReporter(configPath);
    const reporter = reporterSession.reporter;
    const snapshotEnabled = runFlags.snapshot !== false;
    reporter.onRunStart?.({
        runtimeName: reporterSession.runtimeName,
        clean: runFlags.clean,
        verbose: runFlags.verbose,
        snapshotEnabled,
        updateSnapshots: runFlags.updateSnapshots,
    });
    const silentReporter = {};
    const allResults = [];
    const modeLabels = modes.map((modeName) => modeName ?? "default");
    const showPerModeTimes = Boolean(runFlags.verbose);
    const liveMatrix = reporterSession.reporterKind == "default" && canRewriteStdout();
    const modeState = modes.map(() => ({
        failed: false,
        passed: false,
    }));
    const fileState = files.map(() => ({
        failed: false,
        passed: false,
    }));
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        const fileName = path.basename(file);
        const fileResults = [];
        const modeTimes = modes.map(() => "...");
        if (liveMatrix) {
            renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
        }
        for (let i = 0; i < modes.length; i++) {
            const modeName = modes[i];
            try {
                await build(configPath, [file], modeName, buildFeatureToggles);
                const artifactKey = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
                const result = await run(runFlags, configPath, [file], false, {
                    reporter: silentReporter,
                    reporterKind: "default",
                    emitRunStart: false,
                    emitRunComplete: false,
                    logFileName: `test.${artifactKey}.log.json`,
                    coverageFileName: `coverage.${artifactKey}.log.json`,
                    modeName,
                });
                modeTimes[i] = formatMatrixModeTime(result.stats.time);
                if (liveMatrix) {
                    renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
                }
                if (result.failed) {
                    modeState[i].failed = true;
                }
                else if (result.stats.passedFiles > 0) {
                    modeState[i].passed = true;
                }
                fileResults.push(result);
                allResults.push(result);
            }
            catch (error) {
                clearLiveLine();
                throw error;
            }
        }
        renderMatrixFileResult(fileName, modeLabels, fileResults, modeTimes, liveMatrix, showPerModeTimes);
        const verdict = resolveMatrixVerdict(fileResults);
        if (verdict == "fail") {
            fileState[fileIndex].failed = true;
        }
        else if (verdict == "ok") {
            fileState[fileIndex].passed = true;
        }
    }
    const summary = aggregateRunResults(allResults);
    summary.stats = applyMatrixFileSummaryToStats(summary.stats, fileState, fileSummaryTotal);
    reporter.onRunComplete?.({
        clean: runFlags.clean,
        snapshotEnabled,
        showCoverage: runFlags.showCoverage,
        snapshotSummary: summary.snapshotSummary,
        coverageSummary: summary.coverageSummary,
        stats: summary.stats,
        reports: summary.reports,
        modeSummary: buildModeSummary(modeState, modeSummaryTotal),
    });
    return allResults.some((result) => result.failed);
}
function renderMatrixFileResult(file, modes, results, modeTimes, liveMatrix, showPerModeTimes) {
    const verdict = resolveMatrixVerdict(results);
    const badge = verdict == "fail"
        ? chalk.bgRed.white(" FAIL ")
        : verdict == "ok"
            ? chalk.bgGreenBright.black(" PASS ")
            : chalk.bgBlackBright.white(" SKIP ");
    const avg = formatMatrixAverageTime(results);
    const timingText = showPerModeTimes ? modeTimes.join(",") : avg;
    const suffix = showPerModeTimes ? ` ${chalk.dim(`(${modes.join(",")})`)}` : "";
    const line = `${badge} ${file} ${chalk.dim(timingText)}${suffix}`;
    if (liveMatrix)
        clearLiveLine();
    process.stdout.write(line + "\n");
}
function resolveMatrixVerdict(results) {
    if (results.some((result) => result.failed))
        return "fail";
    const hasPass = results.some((result) => result.stats.passedFiles > 0);
    if (hasPass)
        return "ok";
    return "skip";
}
function canRewriteStdout() {
    return Boolean(process.stdout.isTTY);
}
function clearLiveLine() {
    if (!canRewriteStdout())
        return;
    process.stdout.write("\r\x1b[2K");
}
function renderMatrixLiveLine(file, modes, modeTimes, showPerModeTimes) {
    if (!canRewriteStdout())
        return;
    const timingText = showPerModeTimes ? modeTimes.join(",") : "...";
    const suffix = showPerModeTimes ? ` ${chalk.dim(`(${modes.join(",")})`)}` : "";
    const line = `${chalk.bgBlackBright.white(" .... ")} ${file} ${chalk.dim(timingText)}${suffix}`;
    process.stdout.write(`\r\x1b[2K${line}`);
}
function formatMatrixModeTime(ms) {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    return `${safeMs.toFixed(1)}ms`;
}
function formatMatrixAverageTime(results) {
    if (!results.length)
        return "0.0ms";
    let total = 0;
    for (const result of results) {
        total += Number.isFinite(result.stats.time) ? Math.max(0, result.stats.time) : 0;
    }
    return `${(total / results.length).toFixed(1)}ms`;
}
function buildModeSummary(modeState, totalModes) {
    const total = Math.max(totalModes, modeState.length, 1);
    let skipped = Math.max(0, total - modeState.length);
    let failed = 0;
    for (const mode of modeState) {
        if (mode.failed) {
            failed++;
        }
        else if (!mode.passed) {
            skipped++;
        }
    }
    return {
        failed,
        skipped,
        total,
    };
}
function buildSingleModeSummary(stats, snapshotSummary, totalModes) {
    const total = Math.max(totalModes, 1);
    const failed = stats.failedFiles > 0 || snapshotSummary.failed > 0 ? 1 : 0;
    const skippedInExecuted = failed ? 0 : stats.passedFiles > 0 ? 0 : 1;
    return {
        failed,
        skipped: Math.max(0, total - 1) + skippedInExecuted,
        total,
    };
}
function applyConfiguredFileTotalToStats(stats, fileSummaryTotal) {
    const total = Math.max(fileSummaryTotal, 0);
    const executed = stats.failedFiles + stats.passedFiles + stats.skippedFiles;
    const unexecuted = Math.max(0, total - executed);
    return {
        ...stats,
        skippedFiles: stats.skippedFiles + unexecuted,
    };
}
function applyMatrixFileSummaryToStats(stats, fileState, fileSummaryTotal) {
    let failedFiles = 0;
    let passedFiles = 0;
    let skippedFiles = 0;
    for (const file of fileState) {
        if (file.failed)
            failedFiles++;
        else if (file.passed)
            passedFiles++;
        else
            skippedFiles++;
    }
    const total = Math.max(fileSummaryTotal, fileState.length, 0);
    const unexecuted = Math.max(0, total - fileState.length);
    return {
        ...stats,
        failedFiles,
        passedFiles,
        skippedFiles: skippedFiles + unexecuted,
    };
}
function resolveConfiguredModeTotal(configPath) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, false);
    const configuredModes = Object.keys(config.modes).length;
    return configuredModes || 1;
}
async function resolveConfiguredFileTotal(configPath) {
    const files = await resolveSelectedFiles(configPath, []);
    return files.length;
}
function resolveExecutionModes(configPath, selectedModes) {
    if (selectedModes.length)
        return selectedModes;
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, false);
    const configuredModes = Object.keys(config.modes);
    if (!configuredModes.length)
        return [undefined];
    return configuredModes;
}
async function resolveSelectedFiles(configPath, selectors) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, true);
    const patterns = resolveInputPatterns(config.input, selectors);
    const matches = await glob(patterns);
    const specs = matches.filter((file) => file.endsWith(".spec.ts"));
    return [...new Set(specs)].sort((a, b) => a.localeCompare(b));
}
function resolveInputPatterns(configured, selectors) {
    const configuredInputs = Array.isArray(configured) ? configured : [configured];
    if (!selectors.length)
        return configuredInputs;
    const patterns = new Set();
    for (const selector of expandSelectors(selectors)) {
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
function expandSelectors(selectors) {
    const expanded = [];
    for (const selector of selectors) {
        if (!selector)
            continue;
        if (!shouldSplitSelector(selector)) {
            expanded.push(selector);
            continue;
        }
        for (const token of selector.split(",")) {
            const trimmed = token.trim();
            if (!trimmed.length)
                continue;
            expanded.push(trimmed);
        }
    }
    return expanded;
}
function shouldSplitSelector(selector) {
    return (selector.includes(",") &&
        !selector.includes("/") &&
        !selector.includes("\\") &&
        !/[*?[\]{}]/.test(selector));
}
function isBareSuiteSelector(selector) {
    return (!selector.includes("/") &&
        !selector.includes("\\") &&
        !/[*?[\]{}]/.test(selector));
}
function stripSuiteSuffix(selector) {
    return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}
function aggregateRunResults(results) {
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
        time: 0,
        failedEntries: [],
    };
    const snapshotSummary = {
        matched: 0,
        created: 0,
        updated: 0,
        failed: 0,
    };
    const coverageSummary = {
        enabled: false,
        showPoints: false,
        total: 0,
        covered: 0,
        uncovered: 0,
        percent: 100,
        files: [],
    };
    const uniqueCoveragePoints = new Map();
    let fallbackCoverageTotal = 0;
    let fallbackCoverageCovered = 0;
    let fallbackCoverageUncovered = 0;
    const fallbackCoverageFiles = [];
    const reports = [];
    for (const result of results) {
        stats.passedFiles += result.stats.passedFiles;
        stats.failedFiles += result.stats.failedFiles;
        stats.skippedFiles += result.stats.skippedFiles;
        stats.passedSuites += result.stats.passedSuites;
        stats.failedSuites += result.stats.failedSuites;
        stats.skippedSuites += result.stats.skippedSuites;
        stats.passedTests += result.stats.passedTests;
        stats.failedTests += result.stats.failedTests;
        stats.skippedTests += result.stats.skippedTests;
        stats.time += result.stats.time;
        stats.failedEntries.push(...result.stats.failedEntries);
        snapshotSummary.matched += result.snapshotSummary.matched;
        snapshotSummary.created += result.snapshotSummary.created;
        snapshotSummary.updated += result.snapshotSummary.updated;
        snapshotSummary.failed += result.snapshotSummary.failed;
        coverageSummary.enabled = coverageSummary.enabled || result.coverageSummary.enabled;
        coverageSummary.showPoints =
            coverageSummary.showPoints || result.coverageSummary.showPoints;
        for (const fileCoverage of result.coverageSummary.files) {
            if (fileCoverage.points.length > 0) {
                for (const point of fileCoverage.points) {
                    const key = `${point.file}::${point.hash}`;
                    const existing = uniqueCoveragePoints.get(key);
                    if (!existing) {
                        uniqueCoveragePoints.set(key, { ...point });
                    }
                    else if (point.executed) {
                        existing.executed = true;
                    }
                }
            }
            else {
                fallbackCoverageTotal += fileCoverage.total;
                fallbackCoverageCovered += fileCoverage.covered;
                fallbackCoverageUncovered += fileCoverage.uncovered;
                fallbackCoverageFiles.push(fileCoverage);
            }
        }
        reports.push(...result.reports);
    }
    if (uniqueCoveragePoints.size > 0) {
        const byFile = new Map();
        for (const point of uniqueCoveragePoints.values()) {
            if (!byFile.has(point.file))
                byFile.set(point.file, []);
            byFile.get(point.file).push(point);
        }
        const sortedFiles = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
        for (const file of sortedFiles) {
            const points = byFile.get(file);
            points.sort((a, b) => {
                if (a.line !== b.line)
                    return a.line - b.line;
                if (a.column !== b.column)
                    return a.column - b.column;
                if (a.type !== b.type)
                    return a.type.localeCompare(b.type);
                return a.hash.localeCompare(b.hash);
            });
            let covered = 0;
            for (const point of points) {
                coverageSummary.total++;
                if (point.executed) {
                    coverageSummary.covered++;
                    covered++;
                }
                else {
                    coverageSummary.uncovered++;
                }
            }
            const total = points.length;
            coverageSummary.files.push({
                file,
                total,
                covered,
                uncovered: total - covered,
                percent: total ? (covered * 100) / total : 100,
                points,
            });
        }
    }
    else {
        coverageSummary.total = fallbackCoverageTotal;
        coverageSummary.covered = fallbackCoverageCovered;
        coverageSummary.uncovered = fallbackCoverageUncovered;
        coverageSummary.files = fallbackCoverageFiles;
    }
    coverageSummary.percent = coverageSummary.total
        ? (coverageSummary.covered * 100) / coverageSummary.total
        : 100;
    return { stats, snapshotSummary, coverageSummary, reports };
}
function printCliError(error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + "\n");
}
