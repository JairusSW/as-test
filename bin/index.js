#!/usr/bin/env node
import chalk from "chalk";
import { build } from "./commands/build.js";
import { createRunReporter, run } from "./commands/run.js";
import { executeBuildCommand } from "./commands/build.js";
import { executeRunCommand } from "./commands/run.js";
import { executeTestCommand } from "./commands/test.js";
import { executeFuzzCommand } from "./commands/fuzz.js";
import { executeInitCommand } from "./commands/init.js";
import { executeDoctorCommand } from "./commands/doctor.js";
import { fuzz } from "./commands/fuzz-core.js";
import { applyMode, formatTime, getCliVersion, loadConfig, resolveModeNames, } from "./util.js";
import * as path from "path";
import { spawnSync } from "child_process";
import { glob } from "glob";
import { createInterface } from "readline";
import { existsSync } from "fs";
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "fuzz", "init", "doctor"];
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
        const normalizedCommand = command ?? "";
        if (shouldShowCommandHelp(_args, normalizedCommand)) {
            printCommandHelp(normalizedCommand);
        }
        else if (command === "build") {
            executeBuildCommand(_args, configPath, selectedModes, {
                resolveCommandArgs,
                resolveListFlags,
                resolveFeatureToggles,
                resolveExecutionModes,
                listExecutionPlan,
                runBuildModes,
            }).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "run") {
            executeRunCommand(_args, flags, configPath, selectedModes, {
                resolveCommandArgs,
                resolveListFlags,
                resolveFeatureToggles,
                resolveExecutionModes,
                listExecutionPlan,
                runRuntimeModes,
            }).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "test") {
            executeTestCommand(_args, flags, configPath, selectedModes, {
                resolveCommandArgs,
                resolveListFlags,
                resolveFeatureToggles,
                resolveFuzzOverrides,
                resolveExecutionModes,
                listExecutionPlan,
                runTestModes,
            }).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "fuzz") {
            executeFuzzCommand(_args, configPath, selectedModes, {
                resolveCommandArgs,
                resolveListFlags,
                resolveExecutionModes,
                listExecutionPlan,
                runFuzzModes,
            }).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "init") {
            executeInitCommand(_args, {
                resolveCommandTokens,
            }).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "doctor") {
            executeDoctorCommand(configPath, selectedModes).catch((error) => {
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
        chalk.bold.blueBright("fuzz") +
        "    " +
        chalk.dim("<name>|<path-or-glob>") +
        "  " +
        "Build and run fuzz targets" +
        "\n");
    console.log("  " +
        chalk.bold.magentaBright("init") +
        "    " +
        chalk.dim("<./dir>") +
        "                " +
        "Initialize an empty testing template");
    console.log("  " +
        chalk.bold.magentaBright("doctor") +
        "  " +
        chalk.dim("<--mode x>") +
        "             " +
        "Validate environment/config/runtime setup");
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
        "            " +
        "Enable as-test feature (coverage|try-as)");
    console.log("   " +
        chalk.bold.blue("--disable <feature>") +
        "           " +
        "Disable as-test feature (coverage|try-as)");
    console.log("   " +
        chalk.bold.blue("--verbose") +
        "                     " +
        "Print each suite start/end line");
    console.log("   " +
        chalk.bold.blue("--fuzz") +
        "                        " +
        "When used with test, also run configured fuzz targets");
    console.log("   " +
        chalk.bold.blue("--reporter <name|path>") +
        "        " +
        "Use built-in reporter (default|tap) or custom module path");
    console.log("   " +
        chalk.bold.blue("--list") +
        "                        " +
        "Preview resolved files/modes/artifacts without running");
    console.log("   " +
        chalk.bold.blue("--list-modes") +
        "                  " +
        "Preview configured and selected mode names");
    console.log("   " + chalk.bold.blue("--help, -h") + "                    Show help");
    console.log("");
    console.log(chalk.dim("If your using this, consider dropping a star, it would help a lot!") + "\n");
    console.log("View the repo:                   " +
        chalk.magenta("https://github.com/JairusSW/as-test"));
    // console.log(
    //   "View the docs:                   " +
    //     chalk.blue("https://docs.jairus.dev/as-test"),
    // );
}
function isHelpFlag(value) {
    return value == "--help" || value == "-h";
}
function shouldShowCommandHelp(rawArgs, command) {
    if (!command.length)
        return false;
    const commandIndex = rawArgs.indexOf(command);
    if (commandIndex == -1)
        return false;
    for (let i = 0; i < rawArgs.length; i++) {
        if (i == commandIndex)
            continue;
        if (!isHelpFlag(rawArgs[i]))
            continue;
        return true;
    }
    return false;
}
function printCommandHelp(command) {
    if (command == "build") {
        process.stdout.write(chalk.bold("Usage: ast build [selectors...] [flags]\n\n"));
        process.stdout.write("Compile selected specs into wasm artifacts.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --config <path>          Use a specific config file\n");
        process.stdout.write("  --mode <name[,name...]>  Run one or multiple named config modes\n");
        process.stdout.write("  --enable <feature>       Enable build feature (coverage|try-as)\n");
        process.stdout.write("  --disable <feature>      Disable build feature (coverage|try-as)\n");
        process.stdout.write("  --list                   Preview resolved files/artifacts without building\n");
        process.stdout.write("  --list-modes             Preview configured and selected mode names\n");
        process.stdout.write("  --help, -h               Show this help\n");
        return;
    }
    if (command == "run") {
        process.stdout.write(chalk.bold("Usage: ast run [selectors...] [flags]\n\n"));
        process.stdout.write("Run compiled specs with the configured runtime.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --config <path>          Use a specific config file\n");
        process.stdout.write("  --mode <name[,name...]>  Run one or multiple named config modes\n");
        process.stdout.write("  --update-snapshots       Create/update snapshot files on mismatch\n");
        process.stdout.write("  --no-snapshot            Disable snapshot assertions for this run\n");
        process.stdout.write("  --show-coverage          Print uncovered coverage point details\n");
        process.stdout.write("  --enable <feature>       Enable feature (coverage|try-as)\n");
        process.stdout.write("  --disable <feature>      Disable feature (coverage|try-as)\n");
        process.stdout.write("  --reporter <name|path>   Use built-in reporter (default|tap) or custom module path\n");
        process.stdout.write("  --tap                    Shortcut for --reporter tap\n");
        process.stdout.write("  --verbose                Keep expanded suite/test lines and live updates\n");
        process.stdout.write("  --clean                  Disable in-place TTY updates; print final lines only\n");
        process.stdout.write("  --list                   Preview resolved files/artifacts/runtime without running\n");
        process.stdout.write("  --list-modes             Preview configured and selected mode names\n");
        process.stdout.write("  --help, -h               Show this help\n");
        return;
    }
    if (command == "test") {
        process.stdout.write(chalk.bold("Usage: ast test [selectors...] [flags]\n\n"));
        process.stdout.write("Build selected specs, run them, and print a final summary.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --config <path>          Use a specific config file\n");
        process.stdout.write("  --mode <name[,name...]>  Run one or multiple named config modes\n");
        process.stdout.write("  --update-snapshots       Create/update snapshot files on mismatch\n");
        process.stdout.write("  --no-snapshot            Disable snapshot assertions for this run\n");
        process.stdout.write("  --show-coverage          Print uncovered coverage point details\n");
        process.stdout.write("  --enable <feature>       Enable feature (coverage|try-as)\n");
        process.stdout.write("  --disable <feature>      Disable feature (coverage|try-as)\n");
        process.stdout.write("  --fuzz                   Run fuzz targets after the normal test pass\n");
        process.stdout.write("  --fuzz-runs <n>          Override fuzz iteration count for this run\n");
        process.stdout.write("  --fuzz-seed <n>          Override fuzz seed for this run\n");
        process.stdout.write("  --reporter <name|path>   Use built-in reporter (default|tap) or custom module path\n");
        process.stdout.write("  --tap                    Shortcut for --reporter tap\n");
        process.stdout.write("  --verbose                Keep expanded suite/test lines and live updates\n");
        process.stdout.write("  --clean                  Disable in-place TTY updates; print final lines only\n");
        process.stdout.write("  --list                   Preview resolved files/artifacts/runtime without running\n");
        process.stdout.write("  --list-modes             Preview configured and selected mode names\n");
        process.stdout.write("  --help, -h               Show this help\n");
        return;
    }
    if (command == "fuzz") {
        process.stdout.write(chalk.bold("Usage: ast fuzz [selectors...] [flags]\n\n"));
        process.stdout.write("Build selected fuzz targets with bindings and execute them with generated inputs.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --config <path>          Use a specific config file\n");
        process.stdout.write("  --mode <name[,name...]>  Run one or multiple named config modes\n");
        process.stdout.write("  --runs <n>               Override fuzz iteration count\n");
        process.stdout.write("  --seed <n>               Override fuzz seed\n");
        process.stdout.write("  --list                   Preview resolved fuzz files without running\n");
        process.stdout.write("  --list-modes             Preview configured and selected mode names\n");
        process.stdout.write("  --help, -h               Show this help\n");
        return;
    }
    if (command == "init") {
        process.stdout.write(chalk.bold("Usage: ast init [dir] [flags]\n\n"));
        process.stdout.write("Initialize as-test config, default runners, and example specs.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --target <wasi|bindings|web>            Set build target\n");
        process.stdout.write("  --example <minimal|full|none>           Set example template\n");
        process.stdout.write("  --install                               Install dependencies after scaffolding\n");
        process.stdout.write("  --yes, -y                               Non-interactive setup with defaults\n");
        process.stdout.write("  --force                                 Overwrite managed files\n");
        process.stdout.write("  --dir <path>                            Target output directory\n");
        process.stdout.write("  --help, -h                              Show this help\n");
        return;
    }
    if (command == "doctor") {
        process.stdout.write(chalk.bold("Usage: ast doctor [flags]\n\n"));
        process.stdout.write("Validate config, dependencies, runtime command, and spec discovery.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --config <path>          Use a specific config file\n");
        process.stdout.write("  --mode <name[,name...]>  Run checks for one or multiple named modes\n");
        process.stdout.write("  --help, -h               Show this help\n");
        return;
    }
    info();
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
        if (arg == "--fuzz") {
            continue;
        }
        if (arg == "--enable" || arg == "--disable") {
            i++;
            continue;
        }
        if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
            continue;
        }
        if (arg == "--runs" ||
            arg == "--seed" ||
            arg == "--fuzz-runs" ||
            arg == "--fuzz-seed") {
            i++;
            continue;
        }
        if (arg.startsWith("--runs=") ||
            arg.startsWith("--seed=") ||
            arg.startsWith("--fuzz-runs=") ||
            arg.startsWith("--fuzz-seed=")) {
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
function resolveFuzzOverrides(rawArgs, command) {
    const out = {};
    let seenCommand = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (!seenCommand) {
            if (arg == command)
                seenCommand = true;
            continue;
        }
        const direct = command == "fuzz"
            ? {
                runs: "--runs",
                seed: "--seed",
            }
            : {
                runs: "--fuzz-runs",
                seed: "--fuzz-seed",
            };
        const runs = parseNumberFlag(rawArgs, i, direct.runs);
        if (runs) {
            out.runs = runs.number;
            if (runs.consumeNext)
                i++;
            continue;
        }
        const seed = parseNumberFlag(rawArgs, i, direct.seed);
        if (seed) {
            out.seed = seed.number;
            if (seed.consumeNext)
                i++;
            continue;
        }
    }
    return out;
}
function resolveListFlags(rawArgs, command) {
    const out = {
        list: false,
        listModes: false,
    };
    if (command !== "build" &&
        command !== "run" &&
        command !== "test" &&
        command !== "fuzz") {
        return out;
    }
    let seenCommand = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (!seenCommand) {
            if (arg == command)
                seenCommand = true;
            continue;
        }
        if (arg == "--list")
            out.list = true;
        if (arg == "--list-modes")
            out.listModes = true;
    }
    return out;
}
function parseNumberFlag(rawArgs, index, flag) {
    const arg = rawArgs[index];
    if (arg == flag) {
        const next = rawArgs[index + 1];
        if (!next || next.startsWith("-")) {
            throw new Error(`${flag} requires a numeric value`);
        }
        return {
            key: flag,
            number: parseIntegerFlag(flag, next),
            consumeNext: true,
        };
    }
    if (arg.startsWith(`${flag}=`)) {
        return {
            key: flag,
            number: parseIntegerFlag(flag, arg.slice(flag.length + 1)),
            consumeNext: false,
        };
    }
    return null;
}
function parseStringFlag(rawArgs, index, flag) {
    const arg = rawArgs[index];
    if (arg == flag) {
        const next = rawArgs[index + 1];
        if (!next || next.startsWith("-")) {
            throw new Error(`${flag} requires a value`);
        }
        return { key: flag, value: next, consumeNext: true };
    }
    if (arg.startsWith(`${flag}=`)) {
        const value = arg.slice(flag.length + 1);
        if (!value.length) {
            throw new Error(`${flag} requires a value`);
        }
        return { key: flag, value, consumeNext: false };
    }
    return null;
}
function parseIntegerFlag(flag, value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${flag} requires a non-negative integer`);
    }
    return Math.floor(parsed);
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
async function runTestSequential(runFlags, configPath, selectors, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal, allowNoSpecFiles = false, modeName, reporterOverride, emitRunComplete = true) {
    const files = await resolveSelectedFiles(configPath, selectors);
    if (!files.length) {
        if (!allowNoSpecFiles) {
            throw await buildNoTestFilesMatchedError(configPath, selectors);
        }
    }
    const reporterSession = await createRunReporter(configPath, undefined, modeName);
    const reporter = reporterOverride ?? reporterSession.reporter;
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
    const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
    for (const file of files) {
        await build(configPath, [file], modeName, buildFeatureToggles);
        const artifactKey = resolvePerFileArtifactKey(file, duplicateSpecBasenames);
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
    if (emitRunComplete) {
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
        reporter.flush?.();
    }
    return {
        failed,
        summary: {
            snapshotSummary: summary.snapshotSummary,
            coverageSummary: summary.coverageSummary,
            stats: summary.stats,
            reports: summary.reports,
        },
    };
}
async function runBuildModes(configPath, selectors, modes, buildFeatureToggles) {
    for (const modeName of modes) {
        await build(configPath, selectors, modeName, buildFeatureToggles);
    }
}
async function runRuntimeModes(runFlags, configPath, selectors, modes) {
    await ensureWebBrowsersReady(configPath, modes);
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
        throw await buildNoTestFilesMatchedError(configPath, selectors);
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
    const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
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
                const artifactKey = resolvePerFileArtifactKey(file, duplicateSpecBasenames);
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
async function runTestModes(runFlags, configPath, selectors, modes, buildFeatureToggles, fuzzEnabled, fuzzOverrides) {
    await ensureWebBrowsersReady(configPath, modes);
    const modeSummaryTotal = resolveConfiguredModeTotal(configPath);
    const fileSummaryTotal = await resolveConfiguredFileTotal(configPath, selectors);
    if (modes.length > 1) {
        const failed = await runTestMatrix(runFlags, configPath, selectors, modes, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal, fuzzEnabled, fuzzOverrides);
        process.exit(failed ? 1 : 0);
        return;
    }
    let failed = false;
    for (const modeName of modes) {
        const reporterSession = await createRunReporter(configPath, undefined, modeName);
        const modeResult = await runTestSequential(runFlags, configPath, selectors, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal, fuzzEnabled, modeName, reporterSession.reporter, !fuzzEnabled);
        if (modeResult.failed)
            failed = true;
        if (fuzzEnabled) {
            const fuzzResults = await fuzz(configPath, selectors, modeName, fuzzOverrides);
            reporterSession.reporter.onFuzzComplete?.(buildFuzzCompleteEvent(fuzzResults, modeName));
            if (fuzzResults.some(hasFuzzFailures))
                failed = true;
            reporterSession.reporter.onRunComplete?.({
                clean: runFlags.clean,
                snapshotEnabled: runFlags.snapshot !== false,
                showCoverage: runFlags.showCoverage,
                snapshotSummary: modeResult.summary.snapshotSummary,
                coverageSummary: modeResult.summary.coverageSummary,
                stats: modeResult.summary.stats,
                reports: modeResult.summary.reports,
                fuzzSummary: summarizeFuzzResults(fuzzResults),
                modeSummary: buildSingleModeSummary(modeResult.summary.stats, modeResult.summary.snapshotSummary, modeSummaryTotal),
            });
            reporterSession.reporter.flush?.();
        }
    }
    process.exit(failed ? 1 : 0);
}
async function runTestMatrix(runFlags, configPath, selectors, modes, buildFeatureToggles, modeSummaryTotal, fileSummaryTotal, fuzzEnabled, fuzzOverrides) {
    const files = await resolveSelectedFiles(configPath, selectors);
    if (!files.length) {
        if (!fuzzEnabled) {
            throw await buildNoTestFilesMatchedError(configPath, selectors);
        }
        const fuzzFiles = await resolveSelectedFuzzFiles(configPath, selectors);
        if (!fuzzFiles.length) {
            throw await buildNoTestFilesMatchedError(configPath, selectors, true);
        }
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
    const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
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
                const artifactKey = resolvePerFileArtifactKey(file, duplicateSpecBasenames);
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
    let failed = allResults.some((result) => result.failed);
    if (fuzzEnabled) {
        const fuzzResults = [];
        for (const modeName of modes) {
            fuzzResults.push(...(await fuzz(configPath, selectors, modeName, fuzzOverrides)));
        }
        reporter.onFuzzComplete?.(buildFuzzCompleteEvent(fuzzResults));
        if (fuzzResults.some(hasFuzzFailures))
            failed = true;
    }
    reporter.flush?.();
    return failed;
}
async function runFuzzModes(configPath, selectors, modes, rawArgs) {
    const overrides = resolveFuzzOverrides(rawArgs, "fuzz");
    let failed = false;
    for (const modeName of modes) {
        const reporterSession = await createRunReporter(configPath, undefined, modeName);
        const results = await fuzz(configPath, selectors, modeName, overrides);
        reporterSession.reporter.onFuzzComplete?.(buildFuzzCompleteEvent(results, modeName));
        reporterSession.reporter.flush?.();
        if (results.some(hasFuzzFailures))
            failed = true;
    }
    process.exit(failed ? 1 : 0);
}
function hasFuzzFailures(result) {
    if (result.crashes > 0)
        return true;
    return result.fuzzers.some((fuzzer) => fuzzer.failed > 0);
}
function buildFuzzCompleteEvent(results, modeName) {
    return {
        modeName: modeName ?? "default",
        results,
        executions: results.reduce((sum, item) => sum + item.runs, 0),
        crashes: results.reduce((sum, item) => sum + item.crashes, 0),
        failedTargets: results.reduce((sum, item) => sum + (hasFuzzFailures(item) ? 1 : 0), 0),
        time: results.reduce((sum, item) => sum + item.time, 0),
    };
}
function summarizeFuzzResults(results) {
    return {
        failed: results.reduce((sum, item) => sum + item.fuzzers.filter((fuzzer) => fuzzer.failed > 0).length, 0),
        crashed: results.reduce((sum, item) => sum + item.crashes, 0),
        total: results.length,
        runs: results.reduce((sum, item) => sum + item.runs, 0),
    };
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
    const suffix = showPerModeTimes
        ? ` ${chalk.dim(`(${modes.join(",")})`)}`
        : "";
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
    const suffix = showPerModeTimes
        ? ` ${chalk.dim(`(${modes.join(",")})`)}`
        : "";
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
        total += Number.isFinite(result.stats.time)
            ? Math.max(0, result.stats.time)
            : 0;
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
async function resolveConfiguredFileTotal(configPath, selectors = []) {
    const files = await resolveSelectedFiles(configPath, selectors);
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
async function resolveSelectedFiles(configPath, selectors, warn = true) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, warn);
    const patterns = resolveInputPatterns(config.input, selectors);
    const matches = await glob(patterns);
    const specs = matches.filter((file) => file.endsWith(".spec.ts"));
    return [...new Set(specs)].sort((a, b) => a.localeCompare(b));
}
async function resolveSelectedFuzzFiles(configPath, selectors) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, false);
    const patterns = resolveFuzzPatterns(config.fuzz.input, selectors);
    const matches = await glob(patterns);
    const fuzzFiles = matches.filter((file) => file.endsWith(".fuzz.ts"));
    return [...new Set(fuzzFiles)].sort((a, b) => a.localeCompare(b));
}
async function buildNoTestFilesMatchedError(configPath, selectors, includeFuzz = false) {
    const scope = selectors.length > 0 ? selectors.join(", ") : "configured input patterns";
    const lines = [`No test files matched: ${scope}`];
    const configuredFiles = await resolveSelectedFiles(configPath, [], false);
    const configuredFuzzFiles = includeFuzz
        ? await resolveSelectedFuzzFiles(configPath, [])
        : [];
    if (!selectors.length) {
        lines.push('No specs were discovered from configured input patterns. Check "input" in config or run "ast doctor".');
        return new Error(lines.join("\n"));
    }
    const suggestions = suggestClosestSuites(selectors, includeFuzz ? [...configuredFiles, ...configuredFuzzFiles] : configuredFiles);
    if (suggestions.length) {
        lines.push(`Closest suite names: ${suggestions.join(", ")}`);
    }
    if (configuredFiles.length) {
        const sample = configuredFiles
            .slice(0, 5)
            .map((file) => path.basename(file))
            .join(", ");
        lines.push(`Configured specs (${configuredFiles.length}): ${sample}${configuredFiles.length > 5 ? ", ..." : ""}`);
    }
    else {
        lines.push('No specs were discovered from configured input patterns. Check "input" in config.');
    }
    if (includeFuzz && configuredFuzzFiles.length) {
        const sample = configuredFuzzFiles
            .slice(0, 5)
            .map((file) => path.basename(file))
            .join(", ");
        lines.push(`Configured fuzzers (${configuredFuzzFiles.length}): ${sample}${configuredFuzzFiles.length > 5 ? ", ..." : ""}`);
    }
    lines.push('Run "ast test --list" to inspect resolved files.');
    return new Error(lines.join("\n"));
}
function suggestClosestSuites(selectors, files) {
    const suites = [
        ...new Set(files.map((file) => stripSuiteSuffix(path.basename(file)))),
    ];
    if (!suites.length)
        return [];
    const out = new Set();
    for (const selector of expandSelectors(selectors)) {
        if (!isBareSuiteSelector(selector))
            continue;
        const query = stripSuiteSuffix(path.basename(selector));
        const closest = resolveClosestSuiteName(query, suites);
        if (closest)
            out.add(closest);
    }
    return [...out].slice(0, 3);
}
function resolveClosestSuiteName(value, candidates) {
    if (!value.length)
        return null;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const lowered = value.toLowerCase();
    for (const candidate of candidates) {
        if (candidate == value)
            return null;
        const normalized = candidate.toLowerCase();
        if (normalized.startsWith(lowered) || normalized.includes(lowered)) {
            return candidate;
        }
        const distance = levenshteinDistance(lowered, normalized);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    if (best && bestDistance <= 3)
        return best;
    return null;
}
function levenshteinDistance(left, right) {
    if (left == right)
        return 0;
    if (!left.length)
        return right.length;
    if (!right.length)
        return left.length;
    const matrix = [];
    for (let i = 0; i <= left.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= right.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] == right[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[left.length][right.length];
}
function resolveInputPatterns(configured, selectors) {
    const configuredInputs = Array.isArray(configured)
        ? configured
        : [configured];
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
function resolveFuzzPatterns(configured, selectors) {
    const configuredInputs = Array.isArray(configured)
        ? configured
        : [configured];
    if (!selectors.length)
        return configuredInputs;
    const patterns = new Set();
    for (const selector of expandSelectors(selectors)) {
        if (!selector)
            continue;
        if (isBareSuiteSelector(selector)) {
            const base = selector.replace(/\.fuzz\.ts$/, "").replace(/\.ts$/, "");
            for (const configuredInput of configuredInputs) {
                patterns.add(path.join(path.dirname(configuredInput), `${base}.fuzz.ts`));
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
function resolveDuplicateSpecBasenames(files) {
    const counts = new Map();
    for (const file of files) {
        const base = path.basename(file);
        counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    const duplicates = new Set();
    for (const [base, count] of counts) {
        if (count > 1)
            duplicates.add(base);
    }
    return duplicates;
}
function resolvePerFileArtifactKey(file, duplicateSpecBasenames) {
    const base = path.basename(file);
    let raw = base;
    if (duplicateSpecBasenames.has(base)) {
        const disambiguator = resolvePerFileDisambiguator(file);
        if (disambiguator.length) {
            raw = `${base}.${disambiguator}`;
        }
    }
    return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function resolvePerFileDisambiguator(file) {
    const relDir = path.dirname(path.relative(process.cwd(), file));
    if (!relDir.length || relDir == ".")
        return "";
    return relDir
        .replace(/[\\/]+/g, "__")
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .replace(/^_+|_+$/g, "");
}
function resolveArtifactFileNameForPreview(file, target, modeName, duplicateSpecBasenames) {
    const base = path
        .basename(file)
        .replace(/\.spec\.ts$/, "")
        .replace(/\.ts$/, "");
    const legacy = !modeName
        ? `${path.basename(file).replace(".ts", ".wasm")}`
        : `${base}.${modeName}.${target}.wasm`;
    if (!duplicateSpecBasenames.has(path.basename(file))) {
        return legacy;
    }
    const disambiguator = resolvePerFileDisambiguator(file);
    if (!disambiguator.length) {
        return legacy;
    }
    const ext = path.extname(legacy);
    const stem = ext.length ? legacy.slice(0, -ext.length) : legacy;
    return `${stem}.${disambiguator}${ext}`;
}
async function ensureWebBrowsersReady(configPath, modes) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, true);
    const missing = [];
    for (const modeName of modes) {
        const applied = applyMode(config, modeName);
        const active = applied.config;
        if (active.buildOptions.target != "web")
            continue;
        const resolved = resolveBrowserSelection();
        if (!resolved) {
            missing.push({ modeName });
            continue;
        }
        process.env.BROWSER = resolved.browser;
    }
    if (!missing.length)
        return;
    await handleMissingWebBrowsers(missing);
}
function resolveBrowserSelection() {
    const envBrowser = process.env.BROWSER?.trim() ?? "";
    if (envBrowser.length && hasExecutable(envBrowser)) {
        return { browser: envBrowser };
    }
    const candidates = [
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
        "chrome",
        "msedge",
        "firefox",
    ];
    for (const candidate of candidates) {
        if (hasExecutable(candidate)) {
            return { browser: candidate };
        }
    }
    const playwrightFallback = resolvePlaywrightBrowserExecutable("chromium") ??
        resolvePlaywrightBrowserExecutable("firefox");
    if (playwrightFallback) {
        return { browser: playwrightFallback };
    }
    return null;
}
async function handleMissingWebBrowsers(missing) {
    const scope = missing
        .map((entry) => entry.modeName ?? "default")
        .join(", ");
    const details = "no web-capable browser was found in PATH, BROWSER, or Playwright cache";
    if (!canPromptForWebInstall()) {
        throw new Error(`web target requires a browser for mode(s) ${scope}; ${details}. Export BROWSER or install one with "npx -y playwright install chromium".`);
    }
    process.stdout.write(chalk.bold.blue("◇  Browser Setup Needed") +
        "\n" +
        `│  ${details}\n` +
        "│\n");
    const choice = await promptLine("Install Chromium with Playwright now? [Y/n] ");
    const normalized = choice.trim().toLowerCase();
    if (normalized == "n" || normalized == "no") {
        throw new Error('browser install skipped. Export BROWSER or install one with "npx -y playwright install chromium", then rerun.');
    }
    if (normalized != "" && normalized != "y" && normalized != "yes") {
        throw new Error(`invalid answer "${choice}". Expected yes or no.`);
    }
    const selected = "chromium";
    process.stdout.write(chalk.dim(`installing ${selected} via Playwright...\n`));
    const install = spawnSync("npx", ["-y", "playwright", "install", selected], {
        stdio: "inherit",
        shell: false,
    });
    if (install.status !== 0) {
        throw new Error(`Playwright browser install failed for ${selected}`);
    }
    const browserPath = resolvePlaywrightBrowserExecutable(selected);
    if (!browserPath) {
        throw new Error(`Playwright installed ${selected}, but as-test could not locate the browser executable`);
    }
    process.env.BROWSER = browserPath;
}
function canPromptForWebInstall() {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
function promptLine(question) {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}
function resolvePlaywrightBrowserExecutable(browser) {
    const cacheRoot = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
    if (!cacheRoot.length || !existsSync(cacheRoot))
        return null;
    const map = {
        chromium: ["chromium-*/chrome-linux64/chrome"],
        chrome: ["chromium-*/chrome-linux64/chrome"],
        firefox: ["firefox-*/firefox/firefox"],
    };
    const patterns = map[browser] ?? [];
    for (const pattern of patterns) {
        const matches = glob.sync(path.join(cacheRoot, pattern)).sort();
        if (matches.length)
            return matches[matches.length - 1];
    }
    return null;
}
function hasExecutable(command) {
    if (!command.length)
        return false;
    if (command.includes("/") || command.includes("\\")) {
        return existsSync(command);
    }
    const pathValue = process.env.PATH ?? "";
    const suffixes = process.platform == "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
    for (const base of pathValue.split(path.delimiter)) {
        if (!base.length)
            continue;
        for (const suffix of suffixes) {
            if (existsSync(path.join(base, command + suffix)))
                return true;
        }
    }
    return false;
}
async function listExecutionPlan(command, configPath, selectors, modes, listFlags, fuzzEnabled = false) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, true);
    const configuredModes = Object.keys(config.modes);
    const configuredModeLabels = configuredModes.length
        ? configuredModes
        : ["default"];
    const selectedModeLabels = modes.map((modeName) => modeName ?? "default");
    const unknownModes = modes.filter((modeName) => Boolean(modeName && !configuredModes.includes(modeName)));
    if (unknownModes.length) {
        throw new Error(`unknown mode "${unknownModes[0]}". Available modes: ${configuredModes.join(", ") || "(none)"}`);
    }
    process.stdout.write(chalk.bold.blueBright("as-test plan") + "\n");
    process.stdout.write(chalk.dim(`command: ${command}`) + "\n");
    process.stdout.write(chalk.dim(`config: ${resolvedConfigPath}`) + "\n");
    process.stdout.write(chalk.dim(`selectors: ${selectors.length ? selectors.join(", ") : "(configured input patterns)"}`) + "\n\n");
    if (listFlags.listModes) {
        process.stdout.write(chalk.bold("Configured modes:\n"));
        for (const modeName of configuredModeLabels) {
            process.stdout.write(`  - ${modeName}\n`);
        }
        process.stdout.write(chalk.bold("\nSelected modes:\n"));
        for (const modeName of selectedModeLabels) {
            process.stdout.write(`  - ${modeName}\n`);
        }
        process.stdout.write("\n");
    }
    if (!listFlags.list)
        return;
    const specFiles = command == "fuzz" ? [] : await resolveSelectedFiles(configPath, selectors);
    const fuzzFiles = command == "fuzz"
        ? await resolveSelectedFuzzFiles(configPath, selectors)
        : command == "test" && fuzzEnabled
            ? await resolveSelectedFuzzFiles(configPath, selectors)
            : [];
    if (!specFiles.length && !fuzzFiles.length) {
        const scope = selectors.length > 0 ? selectors.join(", ") : "configured input patterns";
        throw new Error(command == "fuzz"
            ? `No fuzz files matched: ${scope}`
            : `No test files matched: ${scope}`);
    }
    const duplicateSpecBasenames = resolveDuplicateSpecBasenames(specFiles);
    const duplicateFuzzBasenames = resolveDuplicateSpecBasenames(fuzzFiles);
    if (specFiles.length) {
        process.stdout.write(chalk.bold("Resolved files:\n"));
        for (const file of specFiles) {
            process.stdout.write(`  - ${file}\n`);
        }
        process.stdout.write("\n");
    }
    if (fuzzFiles.length && command == "test") {
        process.stdout.write(chalk.bold("Resolved fuzz files:\n"));
        for (const file of fuzzFiles) {
            process.stdout.write(`  - ${file}\n`);
        }
        process.stdout.write("\n");
    }
    if (command == "fuzz" && fuzzFiles.length) {
        process.stdout.write(chalk.bold("Resolved files:\n"));
        for (const file of fuzzFiles) {
            process.stdout.write(`  - ${file}\n`);
        }
        process.stdout.write("\n");
    }
    for (const modeName of modes) {
        const applied = applyMode(config, modeName);
        const active = applied.config;
        const modeLabel = modeName ?? "default";
        process.stdout.write(chalk.bold(`Mode: ${modeLabel}\n`));
        process.stdout.write(`  target: ${command == "fuzz" ? "bindings" : active.buildOptions.target}\n`);
        process.stdout.write(`  outDir: ${active.outDir}\n`);
        if (command == "run" || command == "test") {
            process.stdout.write(`  runtime: ${active.runOptions.runtime.cmd}\n`);
        }
        const envOverrides = {
            ...config.env,
            ...(modeName ? (config.modes[modeName]?.env ?? {}) : {}),
            ...(command == "build"
                ? active.buildOptions.env
                : command == "run" || command == "test"
                    ? active.runOptions.env
                    : {}),
        };
        const envKeys = Object.keys(envOverrides);
        process.stdout.write(`  env overrides: ${envKeys.length}${envKeys.length ? ` (${envKeys.join(", ")})` : ""}\n`);
        if (specFiles.length) {
            process.stdout.write("  artifacts:\n");
            for (const file of specFiles) {
                const artifactName = resolveArtifactFileNameForPreview(file, active.buildOptions.target, modeName, duplicateSpecBasenames);
                process.stdout.write(`    - ${path.join(active.outDir, artifactName)}\n`);
            }
        }
        if (fuzzFiles.length && command == "test") {
            process.stdout.write("  fuzz artifacts:\n");
            for (const file of fuzzFiles) {
                const artifactName = resolveArtifactFileNameForPreview(file, "bindings", modeName, duplicateFuzzBasenames);
                process.stdout.write(`    - ${path.join(active.outDir, artifactName)}\n`);
            }
        }
        else if (command == "fuzz") {
            process.stdout.write("  artifacts:\n");
            for (const file of fuzzFiles) {
                const artifactName = resolveArtifactFileNameForPreview(file, "bindings", modeName, duplicateFuzzBasenames);
                process.stdout.write(`    - ${path.join(active.outDir, artifactName)}\n`);
            }
        }
        process.stdout.write("\n");
    }
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
        coverageSummary.enabled =
            coverageSummary.enabled || result.coverageSummary.enabled;
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
