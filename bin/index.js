#!/usr/bin/env node
import chalk from "chalk";
import { build } from "./build.js";
import { createRunReporter, run } from "./run.js";
import { init } from "./init.js";
import { getCliVersion, loadConfig } from "./util.js";
import * as path from "path";
import { glob } from "glob";
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "init"];
const version = getCliVersion();
const configPath = resolveConfigPath(_args);
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
    const command = args.shift();
    const commandArgs = resolveCommandArgs(_args, command ?? "");
    const runFlags = {
        snapshot: !flags.includes("--no-snapshot"),
        updateSnapshots: flags.includes("--update-snapshots"),
        clean: flags.includes("--clean"),
        showCoverage: flags.includes("--show-coverage"),
        verbose: flags.includes("--verbose"),
    };
    if (command === "build") {
        build(configPath).catch((error) => {
            printCliError(error);
            process.exit(1);
        });
    }
    else if (command === "run") {
        run(runFlags, configPath).catch((error) => {
            printCliError(error);
            process.exit(1);
        });
    }
    else if (command === "test") {
        runTestSequential(runFlags, configPath, commandArgs).catch((error) => {
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
        chalk.bold.blue("--verbose") +
        "                     " +
        "Print each suite start/end line");
    console.log("   " +
        chalk.bold.blue("--tap") +
        "                         " +
        "Use built-in TAP v13 reporter");
    console.log("   " +
        chalk.bold.blue("--reporter <name|path>") +
        "       " +
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
        if (arg.startsWith("--config=")) {
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
        if (arg.startsWith("-")) {
            continue;
        }
        values.push(arg);
    }
    return values;
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
async function runTestSequential(runFlags, configPath, selectors) {
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
    const results = [];
    let failed = false;
    for (const file of files) {
        await build(configPath, [file]);
        const artifactKey = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "_");
        const result = await run(runFlags, configPath, [file], false, {
            reporter,
            emitRunStart: false,
            emitRunComplete: false,
            logFileName: `test.${artifactKey}.log.json`,
            coverageFileName: `coverage.${artifactKey}.log.json`,
        });
        results.push(result);
        if (result?.failed)
            failed = true;
    }
    const summary = aggregateRunResults(results);
    reporter.onRunComplete?.({
        clean: runFlags.clean,
        snapshotEnabled,
        showCoverage: runFlags.showCoverage,
        snapshotSummary: summary.snapshotSummary,
        coverageSummary: summary.coverageSummary,
        stats: summary.stats,
        reports: summary.reports,
    });
    process.exit(failed ? 1 : 0);
}
async function resolveSelectedFiles(configPath, selectors) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, true);
    const patterns = resolveInputPatterns(config.input, selectors);
    const matches = await glob(patterns);
    const specs = matches.filter((file) => file.endsWith(".spec.ts"));
    return [...new Set(specs)];
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
