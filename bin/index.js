#!/usr/bin/env node
import chalk from "chalk";
import { build } from "./build.js";
import { createRunReporter, run } from "./run.js";
import { init } from "./init.js";
import { doctor } from "./doctor.js";
import { applyMode, getCliVersion, loadConfig, resolveModeNames, } from "./util.js";
import * as path from "path";
import { glob } from "glob";
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "init", "doctor"];
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
            const commandArgs = resolveCommandArgs(_args, command);
            const listFlags = resolveListFlags(_args, command);
            const featureToggles = resolveFeatureToggles(_args, command);
            const buildFeatureToggles = {
                tryAs: featureToggles.tryAs,
                coverage: featureToggles.coverage,
            };
            const modeTargets = resolveExecutionModes(configPath, selectedModes);
            if (listFlags.list || listFlags.listModes) {
                listExecutionPlan("build", configPath, commandArgs, modeTargets, listFlags).catch((error) => {
                    printCliError(error);
                    process.exit(1);
                });
            }
            else {
                runBuildModes(configPath, commandArgs, modeTargets, buildFeatureToggles).catch((error) => {
                    printCliError(error);
                    process.exit(1);
                });
            }
        }
        else if (command === "run") {
            const commandArgs = resolveCommandArgs(_args, command);
            const listFlags = resolveListFlags(_args, command);
            const featureToggles = resolveFeatureToggles(_args, command);
            const runFlags = {
                snapshot: !flags.includes("--no-snapshot"),
                updateSnapshots: flags.includes("--update-snapshots"),
                clean: flags.includes("--clean"),
                showCoverage: flags.includes("--show-coverage"),
                verbose: flags.includes("--verbose"),
                coverage: featureToggles.coverage,
            };
            const modeTargets = resolveExecutionModes(configPath, selectedModes);
            if (listFlags.list || listFlags.listModes) {
                listExecutionPlan("run", configPath, commandArgs, modeTargets, listFlags).catch((error) => {
                    printCliError(error);
                    process.exit(1);
                });
            }
            else {
                runRuntimeModes(runFlags, configPath, commandArgs, modeTargets).catch((error) => {
                    printCliError(error);
                    process.exit(1);
                });
            }
        }
        else if (command === "test") {
            const commandArgs = resolveCommandArgs(_args, command);
            const listFlags = resolveListFlags(_args, command);
            const featureToggles = resolveFeatureToggles(_args, command);
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
            const modeTargets = resolveExecutionModes(configPath, selectedModes);
            if (listFlags.list || listFlags.listModes) {
                listExecutionPlan("test", configPath, commandArgs, modeTargets, listFlags).catch((error) => {
                    printCliError(error);
                    process.exit(1);
                });
            }
            else {
                runTestModes(runFlags, configPath, commandArgs, modeTargets, buildFeatureToggles).catch((error) => {
                    printCliError(error);
                    process.exit(1);
                });
            }
        }
        else if (command === "init") {
            const commandTokens = resolveCommandTokens(_args, command);
            init(commandTokens).catch((error) => {
                printCliError(error);
                process.exit(1);
            });
        }
        else if (command === "doctor") {
            doctor(configPath, selectedModes).catch((error) => {
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
        process.stdout.write("  --reporter <name|path>   Use built-in reporter (default|tap) or custom module path\n");
        process.stdout.write("  --tap                    Shortcut for --reporter tap\n");
        process.stdout.write("  --verbose                Keep expanded suite/test lines and live updates\n");
        process.stdout.write("  --clean                  Disable in-place TTY updates; print final lines only\n");
        process.stdout.write("  --list                   Preview resolved files/artifacts/runtime without running\n");
        process.stdout.write("  --list-modes             Preview configured and selected mode names\n");
        process.stdout.write("  --help, -h               Show this help\n");
        return;
    }
    if (command == "init") {
        process.stdout.write(chalk.bold("Usage: ast init [dir] [flags]\n\n"));
        process.stdout.write("Initialize as-test config, default runners, and example specs.\n\n");
        process.stdout.write(chalk.bold("Flags:\n"));
        process.stdout.write("  --target <wasi|bindings>                Set build target\n");
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
function resolveListFlags(rawArgs, command) {
    const out = {
        list: false,
        listModes: false,
    };
    if (command !== "build" && command !== "run" && command !== "test") {
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
        throw await buildNoTestFilesMatchedError(configPath, selectors);
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
async function resolveSelectedFiles(configPath, selectors, warn = true) {
    const resolvedConfigPath = configPath ?? path.join(process.cwd(), "./as-test.config.json");
    const config = loadConfig(resolvedConfigPath, warn);
    const patterns = resolveInputPatterns(config.input, selectors);
    const matches = await glob(patterns);
    const specs = matches.filter((file) => file.endsWith(".spec.ts"));
    return [...new Set(specs)].sort((a, b) => a.localeCompare(b));
}
async function buildNoTestFilesMatchedError(configPath, selectors) {
    const scope = selectors.length > 0 ? selectors.join(", ") : "configured input patterns";
    const lines = [`No test files matched: ${scope}`];
    const configuredFiles = await resolveSelectedFiles(configPath, [], false);
    if (!selectors.length) {
        lines.push('No specs were discovered from configured input patterns. Check "input" in config or run "ast doctor".');
        return new Error(lines.join("\n"));
    }
    const suggestions = suggestClosestSuites(selectors, configuredFiles);
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
async function listExecutionPlan(command, configPath, selectors, modes, listFlags) {
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
    const files = await resolveSelectedFiles(configPath, selectors);
    if (!files.length) {
        const scope = selectors.length > 0 ? selectors.join(", ") : "configured input patterns";
        throw new Error(`No test files matched: ${scope}`);
    }
    const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
    process.stdout.write(chalk.bold("Resolved files:\n"));
    for (const file of files) {
        process.stdout.write(`  - ${file}\n`);
    }
    process.stdout.write("\n");
    for (const modeName of modes) {
        const applied = applyMode(config, modeName);
        const active = applied.config;
        const modeLabel = modeName ?? "default";
        process.stdout.write(chalk.bold(`Mode: ${modeLabel}\n`));
        process.stdout.write(`  target: ${active.buildOptions.target}\n`);
        process.stdout.write(`  outDir: ${active.outDir}\n`);
        if (command != "build") {
            process.stdout.write(`  runtime: ${active.runOptions.runtime.cmd}\n`);
        }
        const envOverrides = modeName
            ? (config.modes[modeName]?.env ?? {})
            : config.env;
        const envKeys = Object.keys(envOverrides);
        process.stdout.write(`  env overrides: ${envKeys.length}${envKeys.length ? ` (${envKeys.join(", ")})` : ""}\n`);
        process.stdout.write("  artifacts:\n");
        for (const file of files) {
            const artifactName = resolveArtifactFileNameForPreview(file, active.buildOptions.target, modeName, duplicateSpecBasenames);
            process.stdout.write(`    - ${path.join(active.outDir, artifactName)}\n`);
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
