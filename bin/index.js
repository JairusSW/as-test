#!/usr/bin/env node
import chalk from "chalk";
import {
  build,
  BuildFailureError,
  flushModeWarnings,
  formatInvocation as formatBuildInvocation,
  getBuildInvocationPreview,
  getBuildReuseInfo,
  warnOnUnknownModeReferences,
} from "./commands/build.js";
import { createRenderer, resetCollectedLogs, run } from "./commands/run.js";
import { executeBuildCommand } from "./commands/build.js";
import { executeRunCommand } from "./commands/run.js";
import { executeTestCommand } from "./commands/test.js";
import { executeFuzzCommand } from "./commands/fuzz.js";
import { executeInitCommand } from "./commands/init.js";
import { executeDoctorCommand } from "./commands/doctor.js";
import { executeCleanCommand } from "./commands/clean.js";
import { fuzz } from "./commands/fuzz-core.js";
import {
  applyMode,
  formatTime,
  formatSpecDisplayPath,
  getDefaultModeNames,
  getCliVersion,
  loadConfig,
  resolveArtifactPath,
  resolveModeNames,
  resolveSnapshotPath,
  resolveSpecRelativePath,
} from "./util.js";
import { normalizeFeatureName } from "./types.js";
import * as path from "path";
import { spawnSync } from "child_process";
import { glob } from "glob";
import { createInterface } from "readline";
import { existsSync, watch as fsWatch } from "fs";
import { minimatch } from "minimatch";
import { availableParallelism, cpus } from "os";
import { SilentRenderer } from "./render/renderer.js";
import { BuildWorkerPool } from "./build-worker-pool.js";
import { PersistentWebSessionHost } from "./commands/web-session.js";
import { buildRecorderStorage } from "./commands/build-core.js";
import { DependencyGraph } from "./dependency-graph.js";
import { BuildCache, cacheStorage, resolveCacheDir } from "./build-cache.js";
import { resolveCacheSettings } from "./util.js";
import { resolveSpecFiles, emitSelectorWarnings } from "./selectors.js";
// Expand short flag aliases to their long forms up front so every downstream
// `--long` check (and resolveConfigPath/resolveModeNames below) works without
// per-site handling. Supports `-m value`, `-m=value`. -v/-h/-w keep their own
// existing handling. The map lives in the function to dodge top-level TDZ.
function expandShorthands(argv) {
  const SHORT_FLAGS = {
    "-c": "--config",
    "-m": "--mode",
    "-p": "--parallel",
    "-e": "--enable",
  };
  return argv.map((arg) => {
    if (SHORT_FLAGS[arg]) return SHORT_FLAGS[arg];
    const eq = arg.indexOf("=");
    if (eq > 1 && !arg.startsWith("--")) {
      const long = SHORT_FLAGS[arg.slice(0, eq)];
      if (long) return long + arg.slice(eq);
    }
    return arg;
  });
}
const _args = expandShorthands(process.argv.slice(2));
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "fuzz", "init", "doctor", "clean"];
const version = getCliVersion();
const configPath = resolveConfigPath(_args);
const selectedModes = resolveModeNames(_args);
// When `--changed` is active this holds the set of absolute spec paths to keep
// (their source or a recorded dependency changed in git). null = no filtering.
// Declared before the command dispatch so it is initialized when the (hoisted)
// resolveSelectedFiles/activateChangedFilter run.
let changedSpecFilter = null;
for (const arg of _args) {
  if (arg.startsWith("-")) flags.push(arg);
  else args.push(arg);
}
if (!args.length) {
  if (flags.includes("--version") || flags.includes("-v")) {
    console.log(version.toString());
  } else {
    info();
  }
} else if (COMMANDS.includes(args[0])) {
  try {
    const command = args.shift();
    const normalizedCommand = command ?? "";
    const showCommandHelp = shouldShowCommandHelp(_args, normalizedCommand);
    if (!showCommandHelp) warnUnknownFlags(_args, normalizedCommand);
    if (showCommandHelp) {
      printCommandHelp(normalizedCommand);
    } else if (command === "build") {
      executeBuildCommand(_args, configPath, selectedModes, {
        resolveCommandArgs,
        resolveListFlags,
        resolveFeatureToggles,
        resolveBuildParallelJobs,
        resolveExecutionModes,
        listExecutionPlan,
        runBuildModes,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "run") {
      executeRunCommand(_args, flags, configPath, selectedModes, {
        resolveCommandArgs,
        resolveSuiteSelectors,
        resolveListFlags,
        resolveFeatureToggles,
        resolveParallelJobs,
        resolveBrowserOverride,
        resolveShowCoverageMode,
        resolveExecutionModes,
        listExecutionPlan,
        runRuntimeModes,
        activateChangedFilter,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "test") {
      executeTestCommand(_args, flags, configPath, selectedModes, {
        resolveCommandArgs,
        resolveSuiteSelectors,
        resolveFuzzerSelectors,
        resolveListFlags,
        resolveFeatureToggles,
        resolveParallelJobs,
        resolveBrowserOverride,
        resolveShowCoverageMode,
        resolveFuzzOverrides,
        resolveExecutionModes,
        listExecutionPlan,
        runTestModes,
        activateChangedFilter,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "fuzz") {
      executeFuzzCommand(_args, configPath, selectedModes, {
        resolveCommandArgs,
        resolveFuzzerSelectors,
        resolveListFlags,
        resolveJobs,
        resolveExecutionModes,
        listExecutionPlan,
        runFuzzModes,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "init") {
      executeInitCommand(_args, {
        resolveCommandTokens,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "doctor") {
      executeDoctorCommand(configPath, selectedModes).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "clean") {
      executeCleanCommand(
        _args,
        configPath,
        selectedModes,
        resolveExecutionModes,
      ).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    }
  } catch (error) {
    printCliError(error);
    process.exit(1);
  }
} else {
  console.log(
    chalk.bgRed(" ERROR ") +
      chalk.dim(":") +
      " " +
      chalk.bold("Unknown command: ") +
      args[0],
  );
}
function info() {
  console.log(
    chalk.bold.blueBright("as-test") +
      " is a testing framework for AssemblyScript. " +
      chalk.dim("(v" + version + ")") +
      "\n",
  );
  console.log(
    chalk.bold("Usage: as-test") +
      " " +
      chalk.dim("<command>") +
      " " +
      chalk.bold.blueBright("[...flags]") +
      " " +
      chalk.bold("[...args]") +
      " " +
      chalk.dim("(alias: ast)") +
      "\n",
  );
  console.log(chalk.bold("Commands:"));
  console.log(
    "  " +
      chalk.bold.blueBright("run") +
      "     " +
      chalk.dim("<./**/*.spec.ts>") +
      "       " +
      "Run unit tests with selected runtime",
  );
  console.log(
    "  " +
      chalk.bold.blueBright("build") +
      "   " +
      chalk.dim("<./**/*.spec.ts>") +
      "       " +
      "Build unit tests and compile",
  );
  console.log(
    "  " +
      chalk.bold.blueBright("test") +
      "    " +
      chalk.dim("<name>|<path-or-glob>") +
      "  " +
      "Build and run unit tests with selected runtime" +
      "\n",
  );
  console.log(
    "  " +
      chalk.bold.blueBright("fuzz") +
      "    " +
      chalk.dim("<name>|<path-or-glob>") +
      "  " +
      "Build and run fuzz targets" +
      "\n",
  );
  console.log(
    "  " +
      chalk.bold.magentaBright("init") +
      "    " +
      chalk.dim("<./dir>") +
      "                " +
      "Initialize an empty testing template",
  );
  console.log(
    "  " +
      chalk.bold.magentaBright("doctor") +
      "  " +
      chalk.dim("<--mode x>") +
      "             " +
      "Validate environment/config/runtime setup",
  );
  console.log(
    "  " +
      chalk.bold.magentaBright("clean") +
      "   " +
      chalk.dim("<--mode x>") +
      "             " +
      "Remove build, crash, and log outputs",
  );
  console.log("");
  console.log(chalk.bold("Flags:"));
  console.log(
    "  " +
      chalk.bold.blue("--version, -v") +
      "                  " +
      "Print current cli version",
  );
  console.log(
    "  " +
      chalk.bold.blue("--help, -h") +
      "                     Show help menu",
  );
  console.log("");
  console.log(
    chalk.dim(
      "If this tool provides value, please consider sponsoring my open-source work! https://github.com/sponsors/JairusSW",
    ) + "\n",
  );
  console.log(
    "View the docs:                   " +
      chalk.blue("https://docs.jairus.dev/as-test"),
  );
  console.log(
    "View the repo:                   " +
      chalk.blue("https://github.com/JairusSW/as-test"),
  );
}
function isHelpFlag(value) {
  return value == "--help" || value == "-h";
}
function shouldShowCommandHelp(rawArgs, command) {
  if (!command.length) return false;
  const commandIndex = rawArgs.indexOf(command);
  if (commandIndex == -1) return false;
  for (let i = 0; i < rawArgs.length; i++) {
    if (i == commandIndex) continue;
    if (!isHelpFlag(rawArgs[i])) continue;
    return true;
  }
  return false;
}
function printCommandHelp(command) {
  if (command == "build") {
    process.stdout.write(
      chalk.bold("Usage: ast build [selectors...] [flags]\n\n"),
    );
    process.stdout.write("Compile selected specs into wasm artifacts.\n\n");
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --mode <name[,name...]>  Run one or multiple named config modes\n",
    );
    process.stdout.write(
      "  --enable <list>          Enable features, comma-separated (e.g. coverage,try-as,simd)\n",
    );
    process.stdout.write(
      "  --disable <list>         Disable features, comma-separated\n",
    );
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --jobs <n>               Run files through an ordered worker pool\n",
    );
    process.stdout.write(
      "  --build-jobs <n>         Limit concurrent build tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --list                   Preview resolved files/artifacts without building\n",
    );
    process.stdout.write(
      "  --list-modes             Preview configured and selected mode names\n",
    );
    process.stdout.write("  --help, -h               Show this help\n");
    return;
  }
  if (command == "run") {
    process.stdout.write(
      chalk.bold("Usage: ast run [selectors...] [flags]\n\n"),
    );
    process.stdout.write("Run compiled specs with the configured runtime.\n\n");
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --mode <name[,name...]>  Run one or multiple named config modes\n",
    );
    process.stdout.write(
      "  --browser <name|path>    Use chrome, chromium, firefox, webkit, or an executable path for web modes\n",
    );
    process.stdout.write(
      "  --parallel              Run files through an ordered worker pool using an automatic worker count\n",
    );
    process.stdout.write(
      "  --jobs <n>               Run files through an ordered worker pool\n",
    );
    process.stdout.write(
      "  --build-jobs <n>         Limit concurrent build tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --run-jobs <n>           Limit concurrent run tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --create-snapshots       Create missing snapshot entries\n",
    );
    process.stdout.write(
      "  --overwrite-snapshots    Overwrite existing snapshot entries on mismatch\n",
    );
    process.stdout.write(
      "  --no-snapshot            Disable snapshot assertions for this run\n",
    );
    process.stdout.write(
      "  --show-coverage[=all]    Print uncovered coverage point details; use =all to expand nested gaps\n",
    );
    process.stdout.write(
      "  --suite <name[,name...]> Filter results to matching suite names or suite slug paths\n",
    );
    process.stdout.write("  --suites <name[,name...]> Alias for --suite\n");
    process.stdout.write(
      "  --enable <list>          Enable features, comma-separated (e.g. coverage,try-as,simd)\n",
    );
    process.stdout.write(
      "  --disable <list>         Disable features, comma-separated\n",
    );
    process.stdout.write(
      "  --verbose                Keep expanded suite/test lines and live updates\n",
    );
    process.stdout.write(
      "  --clean                  Disable in-place TTY updates; print final lines only\n",
    );
    process.stdout.write(
      "  --list                   Preview resolved files/artifacts/runtime without running\n",
    );
    process.stdout.write(
      "  --list-modes             Preview configured and selected mode names\n",
    );
    process.stdout.write(
      "  --changed                Run only specs whose source or dependencies changed in git\n",
    );
    process.stdout.write("  --help, -h               Show this help\n");
    process.stdout.write(
      "\n  Shorthands: -m --mode, -p --parallel, -c --config, -e --enable\n",
    );
    return;
  }
  if (command == "test") {
    process.stdout.write(
      chalk.bold("Usage: ast test [selectors...] [flags]\n\n"),
    );
    process.stdout.write(
      "Build selected specs, run them, and print a final summary.\n\n",
    );
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --mode <name[,name...]>  Run one or multiple named config modes\n",
    );
    process.stdout.write(
      "  --enable <list>          Enable features, comma-separated (e.g. coverage,try-as,simd)\n",
    );
    process.stdout.write(
      "  --disable <list>         Disable features, comma-separated\n",
    );
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --browser <name|path>    Use chrome, chromium, firefox, webkit, or an executable path for web modes\n",
    );
    process.stdout.write(
      "  --create-snapshots       Create missing snapshot entries\n",
    );
    process.stdout.write(
      "  --overwrite-snapshots    Overwrite existing snapshot entries on mismatch\n",
    );
    process.stdout.write(
      "  --no-snapshot            Disable snapshot assertions for this run\n",
    );
    process.stdout.write(
      "  --show-coverage[=all]    Print uncovered coverage point details; use =all to expand nested gaps\n",
    );
    process.stdout.write(
      "  --suite <name[,name...]> Filter results to matching suite names or suite slug paths\n",
    );
    process.stdout.write("  --suites <name[,name...]> Alias for --suite\n");
    process.stdout.write(
      "  --fuzz                   Run fuzz targets after the normal test pass\n",
    );
    process.stdout.write(
      "  --fuzz-runs <value>      Override fuzz iteration count, e.g. 500, 1.5x, +10%, +100000\n",
    );
    process.stdout.write(
      "  --fuzz-seed <n>          Pin fuzz seed for this run (default uses random seed)\n",
    );
    process.stdout.write(
      "  --parallel              Run files through an ordered worker pool using an automatic worker count\n",
    );
    process.stdout.write(
      "  --jobs <n>               Run files through an ordered worker pool\n",
    );
    process.stdout.write(
      "  --build-jobs <n>         Limit concurrent build tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --run-jobs <n>           Limit concurrent run tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --verbose                Keep expanded suite/test lines and live updates\n",
    );
    process.stdout.write(
      "  --clean                  Disable in-place TTY updates; print final lines only\n",
    );
    process.stdout.write(
      "  --list                   Preview resolved files/artifacts/runtime without running\n",
    );
    process.stdout.write(
      "  --list-modes             Preview configured and selected mode names\n",
    );
    process.stdout.write(
      "  --watch, -w              Re-run on source or spec changes\n",
    );
    process.stdout.write(
      "  --cache                  Skip recompiling/rerunning specs unchanged since the last run\n",
    );
    process.stdout.write(
      "  --no-cache               Ignore the cache for this run (overrides config)\n",
    );
    process.stdout.write(
      "  --changed                Run only specs whose source or dependencies changed in git\n",
    );
    process.stdout.write("  --help, -h               Show this help\n");
    process.stdout.write(
      "\n  Shorthands: -m --mode, -p --parallel, -c --config, -e --enable\n",
    );
    return;
  }
  if (command == "fuzz") {
    process.stdout.write(
      chalk.bold("Usage: ast fuzz [selectors...] [flags]\n\n"),
    );
    process.stdout.write(
      "Build selected fuzz targets with bindings and execute them with generated inputs.\n\n",
    );
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --mode <name[,name...]>  Run one or multiple named config modes\n",
    );
    process.stdout.write(
      "  --runs <value>           Override fuzz iteration count, e.g. 500, 1.5x, +10%, +100000\n",
    );
    process.stdout.write(
      "  --seed <n>               Pin fuzz seed (default uses random seed)\n",
    );
    process.stdout.write(
      "  --fuzzer <name[,name...]> Filter results to matching fuzz target names\n",
    );
    process.stdout.write("  --fuzzers <name[,name...]> Alias for --fuzzer\n");
    process.stdout.write("  --suite <name[,name...]> Alias for --fuzzer\n");
    process.stdout.write("  --suites <name[,name...]> Alias for --fuzzer\n");
    process.stdout.write(
      "  --jobs <n>               Run files through an ordered worker pool\n",
    );
    process.stdout.write(
      "  --build-jobs <n>         Limit concurrent build tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --run-jobs <n>           Limit concurrent run tasks (defaults to --jobs)\n",
    );
    process.stdout.write(
      "  --list                   Preview resolved fuzz files without running\n",
    );
    process.stdout.write(
      "  --list-modes             Preview configured and selected mode names\n",
    );
    process.stdout.write("  --help, -h               Show this help\n");
    return;
  }
  if (command == "init") {
    process.stdout.write(chalk.bold("Usage: ast init [dir] [flags]\n\n"));
    process.stdout.write(
      "Initialize as-test config, default runners, and example specs.\n\n",
    );
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --target <wasi|bindings|web>            Set build target\n",
    );
    process.stdout.write(
      "  --example <minimal|full|none>           Set example template\n",
    );
    process.stdout.write(
      "  --enable <list>                         Enable features, comma-separated (coverage,try-as)\n",
    );
    process.stdout.write(
      "  --disable <list>                        Disable features, comma-separated\n",
    );
    process.stdout.write(
      "  --install                               Install dependencies after scaffolding\n",
    );
    process.stdout.write(
      "  --yes, -y                               Non-interactive setup with defaults\n",
    );
    process.stdout.write(
      "  --force                                 Overwrite managed files\n",
    );
    process.stdout.write(
      "  --dir <path>                            Target output directory\n",
    );
    process.stdout.write(
      "  --help, -h                              Show this help\n",
    );
    return;
  }
  if (command == "doctor") {
    process.stdout.write(chalk.bold("Usage: ast doctor [flags]\n\n"));
    process.stdout.write(
      "Validate config, dependencies, runtime command, and spec discovery.\n\n",
    );
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --mode <name[,name...]>  Run checks for one or multiple named modes\n",
    );
    process.stdout.write("  --help, -h               Show this help\n");
    return;
  }
  if (command == "clean") {
    process.stdout.write(chalk.bold("Usage: ast clean [flags]\n\n"));
    process.stdout.write(
      "Remove configured build outputs, crash reports, and logs.\n\n",
    );
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --mode <name[,name...]>  Clean one or multiple named modes\n",
    );
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
// Surface obvious typos (e.g. `--vebose`, `--coverag`) instead of silently
// ignoring them. Only the run/build/test/fuzz commands share this flag set;
// init/doctor/clean have their own and are skipped. Lenient by design — the
// union of every flag these commands accept — so a valid flag never warns.
// The set is built inside the function because this runs at top-level dispatch,
// before a module-scope const would be initialized.
function warnUnknownFlags(rawArgs, command) {
  if (!["run", "build", "test", "fuzz"].includes(command)) return;
  const KNOWN_FLAGS = new Set([
    // global
    "--version",
    "-v",
    "--help",
    "-h",
    "--config",
    "--mode",
    "--show-warnings",
    // features / selection
    "--enable",
    "--disable",
    "--suite",
    "--suites",
    "--fuzzer",
    "--fuzzers",
    // execution
    "--parallel",
    "--jobs",
    "--build-jobs",
    "--run-jobs",
    "--watch",
    "-w",
    "--browser",
    "--headless",
    "--dry-run",
    // output / snapshots / coverage / cache
    "--verbose",
    "--clean",
    "--list",
    "--list-modes",
    "--show-logs",
    "--create-snapshots",
    "--overwrite-snapshots",
    "--no-snapshot",
    "--show-coverage",
    "--cache",
    "--no-cache",
    "--changed",
    // fuzz
    "--fuzz",
    "--fuzz-runs",
    "--fuzz-seed",
    "--runs",
    "--seed",
  ]);
  let seenCommand = false;
  const warned = new Set();
  for (const arg of rawArgs) {
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    // Positionals and value tokens (e.g. the `node:wasi` after `--mode`) don't
    // start with `-`, so they're never treated as flags.
    if (!arg.startsWith("-") || arg == "-") continue;
    const name = arg.split("=", 1)[0];
    if (KNOWN_FLAGS.has(name) || warned.has(name)) continue;
    warned.add(name);
    process.stderr.write(
      `${chalk.yellow.bold("WARN")} unknown flag "${name}" — run "ast ${command} --help" to see available flags\n`,
    );
  }
}
function resolveCommandArgs(rawArgs, command) {
  const values = [];
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
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
    if (
      arg == "--suite" ||
      arg == "--suites" ||
      arg == "--fuzzer" ||
      arg == "--fuzzers"
    ) {
      i++;
      continue;
    }
    if (
      arg.startsWith("--suite=") ||
      arg.startsWith("--suites=") ||
      arg.startsWith("--fuzzer=") ||
      arg.startsWith("--fuzzers=")
    ) {
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
    if (
      arg == "--runs" ||
      arg == "--seed" ||
      arg == "--jobs" ||
      arg == "--build-jobs" ||
      arg == "--run-jobs" ||
      arg == "--browser" ||
      arg == "--show-coverage" ||
      arg == "--fuzz-runs" ||
      arg == "--fuzz-seed"
    ) {
      if (arg == "--show-coverage") {
        const next = rawArgs[i + 1];
        if (next == "all") i++;
        continue;
      }
      i++;
      continue;
    }
    if (arg == "--parallel") {
      continue;
    }
    if (arg == "--watch" || arg == "-w") {
      continue;
    }
    if (
      arg.startsWith("--runs=") ||
      arg.startsWith("--seed=") ||
      arg.startsWith("--jobs=") ||
      arg.startsWith("--build-jobs=") ||
      arg.startsWith("--run-jobs=") ||
      arg.startsWith("--browser=") ||
      arg.startsWith("--show-coverage=") ||
      arg.startsWith("--fuzz-runs=") ||
      arg.startsWith("--fuzz-seed=")
    ) {
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
    return { featureOverrides: {} };
  const out = { featureOverrides: {} };
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--enable" || arg == "--disable") {
      const enabled = arg == "--enable";
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("-")) {
        for (const name of splitFeatureList(next)) {
          applyFeatureToggle(out, name, enabled);
        }
        i++;
      }
      continue;
    }
    if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
      const enabled = arg.startsWith("--enable=");
      const eq = arg.indexOf("=");
      const value = arg.slice(eq + 1);
      for (const name of splitFeatureList(value)) {
        applyFeatureToggle(out, name, enabled);
      }
    }
  }
  if (out.coverage === undefined && hasShowCoverageFlag(rawArgs, command)) {
    out.coverage = true;
  }
  return out;
}
function hasShowCoverageFlag(rawArgs, command) {
  let seenCommand = false;
  for (const arg of rawArgs) {
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--show-coverage" || arg.startsWith("--show-coverage=")) {
      return true;
    }
  }
  return false;
}
function resolveFuzzOverrides(rawArgs, command) {
  const out = {};
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    const direct =
      command == "fuzz"
        ? {
            runs: "--runs",
            seed: "--seed",
          }
        : {
            runs: "--fuzz-runs",
            seed: "--fuzz-seed",
          };
    const runs = parseFuzzRunsFlag(rawArgs, i, direct.runs);
    if (runs) {
      out.runs = runs.absoluteRuns;
      out.runsOverride = runs.override;
      if (runs.consumeNext) i++;
      continue;
    }
    const seed = parseNumberFlag(rawArgs, i, direct.seed);
    if (seed) {
      out.seed = seed.number;
      if (seed.consumeNext) i++;
      continue;
    }
  }
  return out;
}
function resolveSuiteSelectors(rawArgs, command) {
  return resolveNamedSelectors(rawArgs, command, ["--suite", "--suites"]);
}
function resolveFuzzerSelectors(rawArgs, command) {
  const flags =
    command == "fuzz"
      ? ["--fuzzer", "--fuzzers", "--suite", "--suites"]
      : ["--fuzzer", "--fuzzers"];
  return resolveNamedSelectors(rawArgs, command, flags);
}
function resolveNamedSelectors(rawArgs, command, flags) {
  const out = [];
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    let parsed = null;
    for (const flag of flags) {
      parsed = parseStringFlag(rawArgs, i, flag);
      if (parsed) break;
    }
    if (!parsed) continue;
    appendNamedSelectorTokens(out, parsed.value);
    if (parsed.consumeNext) i++;
  }
  return [...new Set(out)];
}
function appendNamedSelectorTokens(out, value) {
  for (const token of value.split(",")) {
    const normalized = token.trim();
    if (!normalized.length) continue;
    out.push(normalized);
  }
}
function parseFuzzRunsFlag(rawArgs, index, flag) {
  const arg = rawArgs[index];
  let value = "";
  let consumeNext = false;
  if (arg == flag) {
    const next = rawArgs[index + 1];
    if (!next || !next.length) {
      throw new Error(
        `${flag} requires a value such as 500, 1.5x, +10%, or +100000`,
      );
    }
    value = next;
    consumeNext = true;
  } else if (arg.startsWith(`${flag}=`)) {
    value = arg.slice(flag.length + 1);
    if (!value.length) {
      throw new Error(
        `${flag} requires a value such as 500, 1.5x, +10%, or +100000`,
      );
    }
  } else {
    return null;
  }
  const parsed = parseFuzzRunsValue(flag, value.trim());
  return {
    key: flag,
    absoluteRuns: parsed.kind == "set" ? parsed.value : undefined,
    override: parsed,
    consumeNext,
  };
}
function parseFuzzRunsValue(flag, value) {
  if (/^\d+$/.test(value)) {
    const parsed = parseIntegerFlag(flag, value);
    return { kind: "set", value: parsed };
  }
  if (/^[+-]\d+$/.test(value)) {
    const delta = Number(value);
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      throw new Error(`${flag} additive run override must be an integer`);
    }
    return { kind: "add", value: delta };
  }
  if (/^\d+(?:\.\d+)?x$/i.test(value)) {
    const factor = Number(value.slice(0, -1));
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`${flag} multiplier must be greater than 0`);
    }
    return { kind: "scale", value: factor };
  }
  if (/^[+-]\d+(?:\.\d+)?%$/.test(value)) {
    const percent = Number(value.slice(0, -1));
    if (!Number.isFinite(percent)) {
      throw new Error(`${flag} percentage must be numeric`);
    }
    return { kind: "percent-add", value: percent };
  }
  throw new Error(
    `${flag} must be a run count or expression such as 500, 1.5x, +10%, or +100000`,
  );
}
function resolveListFlags(rawArgs, command) {
  const out = {
    list: false,
    listModes: false,
  };
  if (
    command !== "build" &&
    command !== "run" &&
    command !== "test" &&
    command !== "fuzz"
  ) {
    return out;
  }
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--list") out.list = true;
    if (arg == "--list-modes") out.listModes = true;
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
function resolveBrowserOverride(rawArgs, command) {
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    const parsed = parseStringFlag(rawArgs, i, "--browser");
    if (!parsed) continue;
    return parsed.value.trim() || undefined;
  }
  return undefined;
}
function resolveShowCoverageMode(rawArgs, command) {
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--show-coverage") {
      const next = rawArgs[i + 1];
      if (next == "all") return "all";
      return "collapsed";
    }
    if (arg.startsWith("--show-coverage=")) {
      const value = arg.slice("--show-coverage=".length).trim();
      if (!value.length) {
        throw new Error("--show-coverage requires a value when using =");
      }
      if (value != "all") {
        throw new Error(
          `--show-coverage only supports "all" when given a value`,
        );
      }
      return "all";
    }
  }
  return undefined;
}
function resolveJobs(rawArgs, command) {
  let seenCommand = false;
  let parallel = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--parallel") {
      parallel = true;
      continue;
    }
    const parsed = parseNumberFlag(rawArgs, i, "--jobs");
    if (!parsed) continue;
    if (parsed.number < 1) {
      throw new Error("--jobs requires a positive integer");
    }
    return parsed.number;
  }
  return parallel ? 0 : 1;
}
function resolveBuildParallelJobs(rawArgs) {
  const baseJobs = resolveJobs(rawArgs, "build");
  let buildJobs = baseJobs;
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == "build") seenCommand = true;
      continue;
    }
    const buildParsed = parseNumberFlag(rawArgs, i, "--build-jobs");
    if (buildParsed) {
      if (buildParsed.number < 1) {
        throw new Error("--build-jobs requires a positive integer");
      }
      buildJobs = buildParsed.number;
      continue;
    }
  }
  const jobs = Math.max(baseJobs, buildJobs);
  return { jobs, buildJobs };
}
function resolveParallelJobs(rawArgs, command) {
  const baseJobs = resolveJobs(rawArgs, command);
  let buildJobs = baseJobs;
  let runJobs = baseJobs;
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    const buildParsed = parseNumberFlag(rawArgs, i, "--build-jobs");
    if (buildParsed) {
      if (buildParsed.number < 1) {
        throw new Error("--build-jobs requires a positive integer");
      }
      buildJobs = buildParsed.number;
      continue;
    }
    const runParsed = parseNumberFlag(rawArgs, i, "--run-jobs");
    if (runParsed) {
      if (runParsed.number < 1) {
        throw new Error("--run-jobs requires a positive integer");
      }
      runJobs = runParsed.number;
      continue;
    }
  }
  const jobs = Math.max(baseJobs, buildJobs, runJobs);
  return { jobs, buildJobs, runJobs };
}
function resolveFuzzParallelJobs(rawArgs) {
  const baseJobs = resolveJobs(rawArgs, "fuzz");
  let buildJobs = baseJobs;
  let runJobs = baseJobs;
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == "fuzz") seenCommand = true;
      continue;
    }
    const buildParsed = parseNumberFlag(rawArgs, i, "--build-jobs");
    if (buildParsed) {
      if (buildParsed.number < 1) {
        throw new Error("--build-jobs requires a positive integer");
      }
      buildJobs = buildParsed.number;
      continue;
    }
    const runParsed = parseNumberFlag(rawArgs, i, "--run-jobs");
    if (runParsed) {
      if (runParsed.number < 1) {
        throw new Error("--run-jobs requires a positive integer");
      }
      runJobs = runParsed.number;
      continue;
    }
  }
  const jobs = Math.max(baseJobs, buildJobs, runJobs);
  return { jobs, buildJobs, runJobs };
}
function resolveEffectiveParallelJobs(settings, totalFiles) {
  if (settings.jobs > 0) {
    return {
      jobs: Math.max(settings.jobs, settings.buildJobs, settings.runJobs),
      buildJobs: settings.buildJobs > 0 ? settings.buildJobs : settings.jobs,
      runJobs: settings.runJobs > 0 ? settings.runJobs : settings.jobs,
    };
  }
  const autoJobs = resolveAutoJobs(totalFiles);
  return {
    jobs: Math.max(autoJobs, settings.buildJobs, settings.runJobs),
    buildJobs: settings.buildJobs > 0 ? settings.buildJobs : autoJobs,
    runJobs: settings.runJobs > 0 ? settings.runJobs : autoJobs,
  };
}
function resolveAutoJobs(totalFiles) {
  const cpuCount =
    typeof availableParallelism == "function"
      ? availableParallelism()
      : cpus().length;
  const cpuBudget = Math.max(1, cpuCount - 1);
  if (totalFiles <= 1) return 1;
  if (totalFiles <= 4) return Math.min(2, cpuBudget, totalFiles);
  if (totalFiles <= 12) return Math.min(3, cpuBudget);
  if (totalFiles <= 32) return Math.min(4, cpuBudget);
  return Math.min(Math.max(4, Math.ceil(totalFiles / 12)), cpuBudget);
}
function createBufferedStream() {
  const chunks = [];
  return {
    isTTY: false,
    write(chunk) {
      chunks.push(
        typeof chunk == "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    },
    read() {
      return chunks.join("");
    },
  };
}
function createBufferedRenderer(configPath, modeName) {
  const stream = createBufferedStream();
  const session = createRenderer(configPath, modeName, {
    stdout: stream,
    stderr: stream,
  });
  return {
    renderer: session.renderer,
    runtimeName: session.runtimeName,
    output: () => stream.read(),
  };
}
async function runOrderedPool(items, jobs, worker) {
  const width = Math.max(1, jobs);
  let nextIndex = 0;
  let firstError = null;
  async function runWorker() {
    while (true) {
      if (firstError != null) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        if (firstError == null) firstError = error;
        return;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, () => runWorker()),
  );
  if (firstError != null) throw firstError;
}
function createAsyncLimiter(limit) {
  const width = Math.max(1, limit);
  let active = 0;
  const queue = [];
  return async function withLimit(task) {
    if (active >= width) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}
function canRewriteParallelQueue() {
  return Boolean(process.stdout.isTTY);
}
class ParallelQueueDisplay {
  constructor(showStartLines) {
    this.showStartLines = showStartLines;
    this.active = new Map();
    this.renderedLines = 0;
    this.enabled = showStartLines && canRewriteParallelQueue();
  }
  start(file) {
    const token = Symbol(file);
    if (!this.enabled) return token;
    const line = `${chalk.bgBlackBright.white(" .... ")} ${file}`;
    this.clear();
    this.active.set(token, line);
    this.render();
    return token;
  }
  // Print each spec's output the moment it finishes — first come, first served.
  // Files complete out of order under --parallel (a cache replay finishes
  // instantly while a fresh build is still running); we emit results in
  // completion order rather than holding them back to match resolution order.
  complete(token, output) {
    this.active.delete(token);
    if (this.enabled) this.clear();
    process.stdout.write(output);
    if (this.enabled) this.render();
  }
  flush() {
    if (this.enabled) this.clear();
  }
  clear() {
    if (!this.renderedLines) return;
    for (let i = 0; i < this.renderedLines; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < this.renderedLines - 1) process.stdout.write("\x1b[1A");
    }
    this.renderedLines = 0;
  }
  render() {
    if (!this.enabled) return;
    const lines = Array.from(this.active.values());
    if (!lines.length) return;
    process.stdout.write(lines.join("\n"));
    this.renderedLines = lines.length;
  }
}
function renderQueuedFileStart(display, file) {
  return display.start(file);
}
function parseIntegerFlag(flag, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return Math.floor(parsed);
}
function splitFeatureList(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
function applyFeatureToggle(out, rawFeature, enabled) {
  const key = normalizeFeatureName(rawFeature);
  if (!key.length) {
    throw new Error(
      `empty feature name passed to ${enabled ? "--enable" : "--disable"}`,
    );
  }
  if (key == "coverage") {
    out.coverage = enabled;
    return;
  }
  out.featureOverrides[key] = enabled;
}
function resolveCommandTokens(rawArgs, command) {
  const values = [];
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    values.push(arg);
  }
  return values;
}
async function buildFileForMode(args) {
  // If the caller has an active buildRecorderStorage context (e.g. the watch
  // loop), forward reads from the pool's worker process back into the same
  // recorder so the dependency graph still gets populated under --parallel.
  const recorder = buildRecorderStorage.getStore();
  if (args.buildPool) {
    // The non-pool branch delegates to build(), which owns the cache logic.
    // The pool builds in child processes, so handle the cache here: skip when
    // fresh, else collect the worker's reported reads and record them.
    const cacheCtx = cacheStorage.getStore();
    const reuse = cacheCtx
      ? await getBuildReuseInfo(
          args.configPath,
          args.file,
          args.modeName,
          args.buildFeatureToggles,
        )
      : null;
    if (
      cacheCtx &&
      reuse &&
      cacheCtx.cache.isBuildFresh(args.modeName, args.file, {
        signature: reuse.signature,
        coverageEnabled: reuse.coverageEnabled,
      })
    ) {
      return;
    }
    const reads = cacheCtx && reuse ? new Set() : null;
    const buildInvocation = await getBuildInvocationPreview(
      args.configPath,
      args.file,
      args.modeName,
      args.buildFeatureToggles,
    );
    await args.buildPool.buildFileMode({
      configPath: args.configPath,
      file: args.file,
      modeName: args.modeName,
      buildCommand: formatBuildInvocation(buildInvocation),
      featureToggles: args.buildFeatureToggles,
      onReads:
        recorder || reads
          ? (entries) => {
              for (const r of entries) {
                recorder?.record(r.mode, r.spec, r.file);
                reads?.add(r.file);
              }
            }
          : undefined,
    });
    if (cacheCtx && reuse && reads) {
      cacheCtx.cache.recordBuild(args.modeName, args.file, {
        signature: reuse.signature,
        outFile: reuse.outFile,
        deps: reads,
        coverageEnabled: reuse.coverageEnabled,
      });
    }
  } else {
    await build(
      args.configPath,
      [args.file],
      args.modeName,
      args.buildFeatureToggles,
    );
  }
}
async function runTestSequential(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  buildFeatureToggles,
  modeSummaryTotal,
  fileSummaryTotal,
  allowNoSpecFiles = false,
  modeName,
  rendererOverride,
  webSession = null,
  emitRunComplete = true,
  onSpecOutcome,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    if (!allowNoSpecFiles) {
      throw await buildNoTestFilesMatchedError(configPath, selectors);
    }
  }
  const renderSession = createRenderer(configPath, modeName);
  const renderer = rendererOverride ?? renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const results = [];
  let failed = false;
  const buildIntervals = [];
  const inputPatterns = await loadInputPatterns(configPath);
  for (const file of files) {
    const buildStartedAt = Date.now();
    let result;
    try {
      await build(configPath, [file], modeName, buildFeatureToggles);
      buildIntervals.push({ start: buildStartedAt, end: Date.now() });
      const buildInvocation = await getBuildInvocationPreview(
        configPath,
        file,
        modeName,
        buildFeatureToggles,
      );
      const artifactKey = resolveArtifactStem(file, inputPatterns);
      result = await run(runFlags, configPath, [file], false, {
        renderer,
        webSession,
        suiteSelectors,
        emitRunStart: false,
        emitRunComplete: false,
        logFileName: `test.${artifactKey}.log.json`,
        coverageFileName: `${artifactKey}.log.json`,
        buildCommand: formatBuildInvocation(buildInvocation),
        modeName,
      });
    } catch (error) {
      const buildFailure = getBuildFailureErrorLike(error);
      if (!buildFailure) throw error;
      result = createBuildFailureRunResult(buildFailure);
    }
    results.push(result);
    if (result?.failed) failed = true;
    onSpecOutcome?.({ file, mode: modeName, failed: !!result?.failed });
  }
  const summary = aggregateRunResults(results);
  summary.stats = applyConfiguredFileTotalToStats(
    summary.stats,
    fileSummaryTotal,
  );
  if (emitRunComplete) {
    renderer.onRunComplete?.({
      clean: runFlags.clean,
      snapshotEnabled,
      showCoverage: runFlags.showCoverage,
      showCoverageAll: runFlags.showCoverageAll,
      verbose: runFlags.verbose,
      buildTime: getMergedIntervalDuration(buildIntervals),
      snapshotSummary: summary.snapshotSummary,
      coverageSummary: summary.coverageSummary,
      stats: summary.stats,
      reports: summary.reports,
      showLogs: runFlags.showLogs,
      logSummary: summary.logSummary,
      modeSummary: buildSingleModeSummary(
        summary.stats,
        summary.snapshotSummary,
        modeSummaryTotal,
      ),
    });
    flushModeWarnings(process.argv.includes("--show-warnings"));
  }
  return {
    failed,
    summary: {
      buildTime: getMergedIntervalDuration(buildIntervals),
      snapshotSummary: summary.snapshotSummary,
      coverageSummary: summary.coverageSummary,
      stats: summary.stats,
      reports: summary.reports,
      logSummary: summary.logSummary,
    },
  };
}
async function runBuildModes(
  configPath,
  selectors,
  modes,
  buildFeatureToggles,
  parallel,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const effective = resolveEffectiveParallelJobs(
    {
      jobs: parallel.jobs,
      buildJobs: parallel.buildJobs,
      runJobs: parallel.buildJobs,
    },
    files.length,
  );
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const loadedConfig = loadConfig(resolvedConfigPath, true);
  const allStartedAt = Date.now();
  let builtCount = 0;
  for (const modeName of modes) {
    const startedAt = Date.now();
    if (effective.buildJobs > 1) {
      const pool = new BuildWorkerPool(effective.buildJobs);
      try {
        await runOrderedPool(files, effective.buildJobs, async (file) => {
          await buildFileForMode({
            configPath,
            file,
            modeName,
            buildFeatureToggles,
            buildPool: pool,
          });
        });
      } finally {
        await pool.close();
      }
    } else {
      for (const file of files) {
        await buildFileForMode({
          configPath,
          file,
          modeName,
          buildFeatureToggles,
        });
      }
    }
    builtCount += files.length;
    const active = applyMode(loadedConfig, modeName).config;
    process.stdout.write(
      `${chalk.bgGreenBright.black(" BUILT ")} ${modeName ?? "default"} ${chalk.dim(`(${active.buildOptions.target})`)} ${files.length} file(s) -> ${active.outDir} ${chalk.dim(formatTime(Date.now() - startedAt))}\n`,
    );
  }
  process.stdout.write(
    `${chalk.bold("Summary:")} built ${builtCount} file(s) across ${modes.length || 1} mode(s) in ${formatTime(Date.now() - allStartedAt)}\n`,
  );
}
async function runRuntimeModes(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  modes,
) {
  await ensureWebBrowsersReady(configPath, modes, runFlags.browser);
  const modeSummaryTotal = Math.max(modes.length, 1);
  const fileSummaryTotal = await resolveConfiguredFileTotal(configPath);
  let effectiveRunFlags = {
    ...runFlags,
    ...resolveEffectiveParallelJobs(runFlags, fileSummaryTotal),
  };
  if (await usesHeadfulWebMode(configPath, modes)) {
    effectiveRunFlags = {
      ...effectiveRunFlags,
      jobs: 1,
      runJobs: 1,
    };
  }
  if (effectiveRunFlags.jobs > 1) {
    if (modes.length > 1) {
      const failed = await runRuntimeMatrixParallel(
        effectiveRunFlags,
        configPath,
        selectors,
        suiteSelectors,
        modes,
        modeSummaryTotal,
        fileSummaryTotal,
      );
      process.exit(failed ? 1 : 0);
      return;
    }
    let failed = false;
    for (const modeName of modes) {
      const result = await runRuntimeSingleParallel(
        effectiveRunFlags,
        configPath,
        selectors,
        suiteSelectors,
        modeName,
        modeSummaryTotal,
        fileSummaryTotal,
      );
      if (result) failed = true;
    }
    process.exit(failed ? 1 : 0);
    return;
  }
  if (modes.length > 1) {
    const failed = await runRuntimeMatrix(
      effectiveRunFlags,
      configPath,
      selectors,
      suiteSelectors,
      modes,
      modeSummaryTotal,
      fileSummaryTotal,
    );
    process.exit(failed ? 1 : 0);
    return;
  }
  let failed = false;
  const buildCommandsByFile = await previewBuildCommands(
    configPath,
    selectors,
    modes[0],
    {},
  );
  for (const modeName of modes) {
    const result = await run(effectiveRunFlags, configPath, selectors, false, {
      modeName,
      suiteSelectors,
      modeSummaryTotal,
      modeSummaryExecuted: 1,
      fileSummaryTotal,
      buildCommandsByFile,
    });
    if (result.failed) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
async function usesHeadfulWebMode(configPath, modes) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const loaded = loadConfig(resolvedConfigPath, true);
  for (const modeName of modes) {
    const active = applyMode(loaded, modeName).config;
    if (!usesWebBrowser(active)) continue;
    const runtimeCmd =
      active.runOptions.runtime.cmd?.trim() ||
      (active.buildOptions.target == "web"
        ? "node .as-test/runners/default.web.js"
        : "");
    if (!runtimeCmd.includes("--headless")) {
      return true;
    }
  }
  return false;
}
async function createSharedHeadfulWebSession(configPath, modes) {
  return (await usesHeadfulWebMode(configPath, modes))
    ? await PersistentWebSessionHost.start(false)
    : null;
}
async function runRuntimeMatrix(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  modes,
  modeSummaryTotal,
  fileSummaryTotal,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const renderSession = createRenderer(configPath);
  const renderer = renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const silentRenderer = new SilentRenderer();
  const allResults = [];
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const liveMatrix = canRewriteStdout();
  const modeState = modes.map(() => ({
    failed: false,
    passed: false,
  }));
  const fileState = files.map(() => ({
    failed: false,
    passed: false,
  }));
  const inputPatterns = await loadInputPatterns(configPath);
  const buildIntervals = [];
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const fileName = formatSpecDisplayPath(file);
    const fileResults = [];
    const modeTimes = modes.map(() => "...");
    if (liveMatrix) {
      renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
    }
    for (let i = 0; i < modes.length; i++) {
      const modeName = modes[i];
      try {
        const buildInvocation = await getBuildInvocationPreview(
          configPath,
          file,
          modeName,
          {},
        );
        const artifactKey = resolveArtifactStem(file, inputPatterns);
        const result = await run(runFlags, configPath, [file], false, {
          renderer: silentRenderer,
          suiteSelectors,
          emitRunStart: false,
          emitRunComplete: false,
          logFileName: `run.${artifactKey}.log.json`,
          coverageFileName: `${artifactKey}.log.json`,
          buildCommand: formatBuildInvocation(buildInvocation),
          modeName,
        });
        modeTimes[i] = formatMatrixModeTime(result.stats.time);
        if (liveMatrix) {
          renderMatrixLiveLine(
            fileName,
            modeLabels,
            modeTimes,
            showPerModeTimes,
          );
        }
        if (result.failed) {
          modeState[i].failed = true;
        } else if (result.stats.passedFiles > 0) {
          modeState[i].passed = true;
        }
        fileResults.push(result);
        allResults.push(result);
      } catch (error) {
        clearLiveLine();
        throw error;
      }
    }
    renderMatrixFileResult(
      fileName,
      modeLabels,
      fileResults,
      modeTimes,
      liveMatrix,
      showPerModeTimes,
    );
    const verdict = resolveMatrixVerdict(fileResults);
    if (verdict == "fail") {
      fileState[fileIndex].failed = true;
    } else if (verdict == "ok") {
      fileState[fileIndex].passed = true;
    }
  }
  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  renderer.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    showCoverageAll: runFlags.showCoverageAll,
    verbose: runFlags.verbose,
    buildTime: 0,
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    showLogs: runFlags.showLogs,
    logSummary: summary.logSummary,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  return allResults.some((result) => result.failed);
}
async function runTestModesCore(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  fuzzerSelectors,
  modes,
  buildFeatureToggles,
  fuzzEnabled,
  fuzzOverrides,
  onSpecOutcome,
) {
  await ensureWebBrowsersReady(configPath, modes, runFlags.browser);
  const modeSummaryTotal = Math.max(modes.length, 1);
  const fileSummaryTotal = await resolveConfiguredFileTotal(
    configPath,
    selectors,
  );
  let effectiveRunFlags = {
    ...runFlags,
    ...resolveEffectiveParallelJobs(runFlags, fileSummaryTotal),
  };
  if (await usesHeadfulWebMode(configPath, modes)) {
    effectiveRunFlags = {
      ...effectiveRunFlags,
      jobs: 1,
      runJobs: 1,
    };
  }
  if (effectiveRunFlags.jobs > 1) {
    if (modes.length > 1) {
      const failed = await runTestMatrixParallel(
        effectiveRunFlags,
        configPath,
        selectors,
        suiteSelectors,
        fuzzerSelectors,
        modes,
        buildFeatureToggles,
        modeSummaryTotal,
        fileSummaryTotal,
        fuzzEnabled,
        fuzzOverrides,
        onSpecOutcome,
      );
      return failed;
    }
    let failed = false;
    for (const modeName of modes) {
      const modeFailed = await runTestSingleParallel(
        effectiveRunFlags,
        configPath,
        selectors,
        suiteSelectors,
        fuzzerSelectors,
        buildFeatureToggles,
        modeSummaryTotal,
        fileSummaryTotal,
        fuzzEnabled,
        fuzzOverrides,
        modeName,
        onSpecOutcome,
      );
      if (modeFailed) failed = true;
    }
    return failed;
  }
  if (modes.length > 1) {
    const failed = await runTestMatrix(
      effectiveRunFlags,
      configPath,
      selectors,
      suiteSelectors,
      fuzzerSelectors,
      modes,
      buildFeatureToggles,
      modeSummaryTotal,
      fileSummaryTotal,
      fuzzEnabled,
      fuzzOverrides,
      onSpecOutcome,
    );
    return failed;
  }
  let failed = false;
  const sharedWebSession = await createSharedHeadfulWebSession(
    configPath,
    modes,
  );
  try {
    for (const modeName of modes) {
      const renderSession = createRenderer(configPath, modeName);
      const modeResult = await runTestSequential(
        effectiveRunFlags,
        configPath,
        selectors,
        suiteSelectors,
        buildFeatureToggles,
        modeSummaryTotal,
        fileSummaryTotal,
        fuzzEnabled,
        modeName,
        renderSession.renderer,
        sharedWebSession,
        !fuzzEnabled,
        onSpecOutcome,
      );
      if (modeResult.failed) failed = true;
      if (fuzzEnabled) {
        process.stdout.write("\n");
        const fuzzResults = await runFuzzMatrixResults(
          configPath,
          selectors,
          fuzzerSelectors,
          [modeName],
          fuzzOverrides,
          renderSession.renderer,
        );
        if (fuzzResults.some(hasFuzzFailures)) failed = true;
        renderSession.renderer.onRunComplete?.({
          clean: runFlags.clean,
          snapshotEnabled: effectiveRunFlags.snapshot !== false,
          showCoverage: effectiveRunFlags.showCoverage,
          showCoverageAll: effectiveRunFlags.showCoverageAll,
          verbose: effectiveRunFlags.verbose,
          buildTime:
            modeResult.summary.buildTime +
            getMergedIntervalDuration(collectFuzzBuildIntervals(fuzzResults)),
          snapshotSummary: modeResult.summary.snapshotSummary,
          coverageSummary: modeResult.summary.coverageSummary,
          stats: modeResult.summary.stats,
          reports: modeResult.summary.reports,
          showLogs: effectiveRunFlags.showLogs,
          logSummary: modeResult.summary.logSummary,
          fuzzSummary: summarizeFuzzExecutions(fuzzResults),
          modeSummary: buildSingleModeSummary(
            modeResult.summary.stats,
            modeResult.summary.snapshotSummary,
            modeSummaryTotal,
          ),
        });
        flushModeWarnings(process.argv.includes("--show-warnings"));
      }
    }
  } finally {
    await sharedWebSession?.close();
  }
  return failed;
}
async function runTestModes(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  fuzzerSelectors,
  modes,
  buildFeatureToggles,
  fuzzEnabled,
  fuzzOverrides,
) {
  if (runFlags.watch) {
    await runWatchLoop(
      runFlags,
      configPath,
      selectors,
      suiteSelectors,
      fuzzerSelectors,
      modes,
      buildFeatureToggles,
      fuzzEnabled,
      fuzzOverrides,
    );
    return;
  }
  // Opt-in incremental cache for the whole non-watch run (watch keeps its own
  // in-memory dependency graph). Fuzzing is non-deterministic, so never cache.
  const baseConfig = loadConfig(
    configPath ?? path.join(process.cwd(), "./as-test.config.json"),
  );
  const { mode: cacheMode, maxTimeMs } = resolveCacheSettings(
    baseConfig.cache,
    {
      cache: runFlags.cache,
      noCache: runFlags.noCache,
    },
  );
  const cacheEnabled = cacheMode !== "off" && !fuzzEnabled;
  if (!cacheEnabled) {
    const failed = await runTestModesCore(
      runFlags,
      configPath,
      selectors,
      suiteSelectors,
      fuzzerSelectors,
      modes,
      buildFeatureToggles,
      fuzzEnabled,
      fuzzOverrides,
    );
    process.exit(failed ? 1 : 0);
  }
  const cacheDir = resolveCacheDir(baseConfig.outDir);
  const cache = BuildCache.load(cacheDir, getCliVersion(), { maxTimeMs });
  // Replay (Tier 2) is unsafe while writing snapshots — those mutate .snap, so
  // a replayed snapshot summary would be wrong. Build-skip still applies.
  const replay =
    cacheMode === "full" &&
    !runFlags.createSnapshots &&
    !runFlags.overwriteSnapshots;
  // Only prune entries on a full run: a selector-scoped run (`ast test foo`)
  // resolves a subset, so pruning to it would wipe every other spec's entry.
  let liveKeys = null;
  if (!selectors.length) {
    const files = await resolveSelectedFiles(configPath, [], false);
    liveKeys = new Set();
    for (const modeName of modes) {
      for (const file of files) liveKeys.add(cache.keyFor(modeName, file));
    }
  }
  let failed = false;
  try {
    failed = await cacheStorage.run({ cache, replay }, () =>
      runTestModesCore(
        runFlags,
        configPath,
        selectors,
        suiteSelectors,
        fuzzerSelectors,
        modes,
        buildFeatureToggles,
        fuzzEnabled,
        fuzzOverrides,
      ),
    );
  } finally {
    if (liveKeys) cache.prune(liveKeys);
    cache.save();
  }
  process.exit(failed ? 1 : 0);
}
async function runWatchLoop(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  fuzzerSelectors,
  modes,
  buildFeatureToggles,
  fuzzEnabled,
  fuzzOverrides,
) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const absConfigPath = path.resolve(resolvedConfigPath);
  let config = loadConfig(resolvedConfigPath, false);
  // Persistent incremental cache, honored under --watch too (the dependency
  // graph above only governs which specs re-run; the cache skips recompiling /
  // replays unchanged ones, which makes the initial watch run and "run all"
  // fast). Resolved from flags+config; toggleable live with `c`.
  const initialCache = resolveCacheSettings(config.cache, {
    cache: runFlags.cache,
    noCache: runFlags.noCache,
  });
  let cacheMode = fuzzEnabled ? "off" : initialCache.mode;
  const cacheMaxTimeMs = initialCache.maxTimeMs;
  // The mode `c` toggles back on to (the configured mode, or "full" if the
  // cache started off).
  const cacheToggleMode =
    initialCache.mode === "off" ? "full" : initialCache.mode;
  // Wraps a run in the cache context (fresh per run so `now`/maxTime are
  // current), unless the cache is off. Entry-pruning is intentionally skipped
  // under watch — scoped re-runs resolve only a subset of specs, so pruning to
  // them would wipe the rest of the cache.
  async function withCache(fn) {
    if (cacheMode === "off") {
      await fn();
      return;
    }
    const cacheDir = resolveCacheDir(config.outDir);
    const cache = BuildCache.load(cacheDir, getCliVersion(), {
      maxTimeMs: cacheMaxTimeMs,
    });
    const replay =
      cacheMode === "full" &&
      !runFlags.createSnapshots &&
      !runFlags.overwriteSnapshots;
    try {
      await cacheStorage.run({ cache, replay }, fn);
    } finally {
      cache.save();
    }
  }
  // Respect the user's parallelism flags. Worker-pool builds forward their
  // file-read records back through IPC (see BuildWorkerPool / build-worker
  // and buildFileForMode), so the dependency graph stays correct under
  // --parallel as well.
  const watchRunFlags = { ...runFlags };
  const graph = new DependencyGraph();
  let graphPopulated = false;
  // Sticky failure tracker: each entry is "this (spec, mode) was last seen
  // failing." Only updated for (spec, mode) pairs that actually re-ran this
  // iteration, so a spec the watch loop skipped stays visible at the bottom
  // until it passes again. `space` retries this exact set.
  const failingSpecs = new Map();
  function recordSpecOutcome(file, mode, failed) {
    const abs = path.resolve(file);
    const modes = failingSpecs.get(abs) ?? new Set();
    if (failed) {
      modes.add(mode);
      failingSpecs.set(abs, modes);
      return;
    }
    if (!modes.size) return;
    modes.delete(mode);
    if (modes.size === 0) failingSpecs.delete(abs);
  }
  let isRunning = false;
  let pendingTrigger = null;
  let debounceTimer = null;
  // Toggled with `w`. When false, file changes are remembered in
  // `changedWhilePaused` but not auto-run — the user invokes runs manually
  // (`a` / space). Resuming re-runs everything if anything changed meanwhile.
  let autoRun = true;
  const changedWhilePaused = new Set();
  // Keyed by absolute directory path so attachWatcherFor is idempotent;
  // makes it safe to re-scan & top up watchers after every iteration without
  // double-attaching to the same dir.
  const attachedDirWatchers = new Map();
  let configFileWatcher = null;
  function describeAffected(specs) {
    const list = Array.from(specs).map((s) => path.relative(process.cwd(), s));
    if (list.length <= 3) return list.join(", ");
    return `${list.slice(0, 3).join(", ")} (+${list.length - 3} more)`;
  }
  function watchFooter() {
    if (!autoRun) {
      const pending = changedWhilePaused.size
        ? ` (${changedWhilePaused.size} change(s) pending)`
        : "";
      return chalk.dim(
        `Auto-run paused${pending}. ` +
          chalk.bold("space") +
          " = retry failing, " +
          chalk.bold("a") +
          " = re-run all, " +
          chalk.bold("w") +
          " = resume, " +
          chalk.bold("c") +
          ` = cache (${cacheMode === "off" ? "off" : "on"}), ` +
          chalk.bold("ctrl+c") +
          " = stop.\n",
      );
    }
    return chalk.dim(
      "Watching for changes. " +
        chalk.bold("space") +
        " = retry failing, " +
        chalk.bold("a") +
        " = re-run all, " +
        chalk.bold("w") +
        " = pause, " +
        chalk.bold("c") +
        ` = cache (${cacheMode === "off" ? "off" : "on"}), ` +
        chalk.bold("ctrl+c") +
        " = stop.\n",
    );
  }
  // Rewrites the footer line in place (the cursor sits one line below it after
  // every doRun / prior rewrite), so toggling w/c updates the hint without
  // accumulating new lines in scrollback. Falls back to a plain write when not
  // on a rewritable TTY.
  function rewriteFooter() {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[1A\r\x1b[2K" + watchFooter());
    } else {
      process.stdout.write(watchFooter());
    }
  }
  function writeWatchHeader(headline, detail) {
    // Preserve scrollback — never `console.clear()`. A blank line plus a
    // dim rule visually delimits each iteration so prior output stays
    // readable above.
    process.stdout.write(
      "\n" +
        chalk.dim("─".repeat(Math.max(24, process.stdout.columns ?? 60))) +
        "\n" +
        chalk.dim(`[${new Date().toLocaleTimeString()}] `) +
        chalk.yellow(headline) +
        (detail ? chalk.bold(detail) : "") +
        "\n",
    );
  }
  // Render the sticky "currently failing" pin. Renders nothing when empty so
  // happy paths stay visually clean. Mode tags shown only when the user has
  // configured >1 mode; in the single-mode case the bare path is enough.
  function renderFailingSpecs() {
    if (failingSpecs.size === 0) return "";
    const multiMode = modes.length > 1;
    const entries = Array.from(failingSpecs.entries()).map(([abs, modeSet]) => {
      const rel = path.relative(process.cwd(), abs);
      const tags = multiMode
        ? Array.from(modeSet, (m) => m ?? "default").sort()
        : [];
      return { rel, tags };
    });
    entries.sort((a, b) => a.rel.localeCompare(b.rel));
    const MAX_LINES = 8;
    const shown = entries.slice(0, MAX_LINES);
    const overflow = entries.length - shown.length;
    const lines = [];
    lines.push(chalk.red.bold(`Currently failing (${failingSpecs.size}):`));
    for (const { rel, tags } of shown) {
      const tagSuffix = tags.length ? chalk.dim(`  [${tags.join(", ")}]`) : "";
      lines.push(`  ${chalk.gray(rel)}${tagSuffix}`);
    }
    if (overflow > 0) {
      lines.push(chalk.dim(`  (+${overflow} more)`));
    }
    return lines.join("\n") + "\n\n";
  }
  async function doRun(trigger) {
    let runSelectors = selectors;
    let scopedRun = false;
    if (trigger.kind === "manual-rerun") {
      if (failingSpecs.size === 0) {
        // Nothing to retry; stay silent so we don't pollute scrollback.
        return;
      }
      const failingPaths = new Set(failingSpecs.keys());
      writeWatchHeader("Retrying failing specs");
      process.stdout.write(
        chalk.dim(`Retrying ${failingPaths.size} failing spec(s): `) +
          chalk.bold(describeAffected(failingPaths)) +
          "\n",
      );
      runSelectors = Array.from(failingPaths).map((spec) =>
        path.relative(process.cwd(), spec),
      );
      scopedRun = true;
    } else if (trigger.kind === "manual-runall") {
      writeWatchHeader("Re-running all specs");
    } else if (trigger.kind === "change") {
      const absChanged = path.resolve(trigger.file);
      if (absChanged === absConfigPath) {
        writeWatchHeader("Change detected: ", trigger.file);
        process.stdout.write(
          chalk.dim("Config changed; reloading and rebuilding everything.\n"),
        );
        try {
          config = loadConfig(resolvedConfigPath, false);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          process.stderr.write(
            chalk.red("Failed to reload config: ") + msg + "\n",
          );
        }
        graph.clear();
        graphPopulated = false;
        failingSpecs.clear();
        // The previous config's input/snapshotDir may no longer be relevant;
        // drop every dir watcher and re-derive from the fresh config so we
        // don't leak watchers for dirs we no longer care about.
        closeDirWatchers();
        refreshWatchedDirs();
      } else if (graphPopulated) {
        const affected = new Set(graph.specsAffectedBy(absChanged));
        // A new .spec.ts file the graph hasn't seen yet should still be
        // built and run. Cheapest heuristic without re-globbing: treat any
        // .spec.ts under cwd that we don't already know as a candidate.
        if (
          affected.size === 0 &&
          /\.spec\.ts$/i.test(absChanged) &&
          existsSync(absChanged) &&
          !graph.knownSpecs().has(absChanged)
        ) {
          affected.add(absChanged);
        }
        if (affected.size === 0) {
          // Nothing depends on this file; skip silently so scrollback isn't
          // littered with no-op events for unrelated edits.
          return;
        }
        writeWatchHeader("Change detected: ", trigger.file);
        process.stdout.write(
          chalk.dim(`Rebuilding ${affected.size} affected spec(s): `) +
            chalk.bold(describeAffected(affected)) +
            "\n",
        );
        runSelectors = Array.from(affected).map((spec) =>
          path.relative(process.cwd(), spec),
        );
        scopedRun = true;
      } else {
        // Change arrived before the graph was populated (e.g. queued during
        // the initial run). Run everything; surface the header so the user
        // knows the iteration was caused by the edit.
        writeWatchHeader("Change detected: ", trigger.file);
      }
    }
    process.stdout.write("\n");
    // A full re-run starts the aggregated-log collector fresh and clears any
    // changes tracked while paused (they're now covered). Scoped reruns keep
    // prior specs' logs (each re-run spec's entry is replaced in place), so
    // latest.log stays complete instead of collapsing to just the rerun.
    if (!scopedRun) {
      resetCollectedLogs();
      changedWhilePaused.clear();
    }
    const collected = [];
    const recorder = {
      record: (mode, specFile, absPath) => {
        collected.push({ mode, spec: specFile, file: absPath });
      },
    };
    try {
      await withCache(() =>
        buildRecorderStorage.run(recorder, async () => {
          await runTestModesCore(
            watchRunFlags,
            configPath,
            runSelectors,
            suiteSelectors,
            fuzzerSelectors,
            modes,
            buildFeatureToggles,
            fuzzEnabled,
            fuzzOverrides,
            (outcome) =>
              recordSpecOutcome(outcome.file, outcome.mode, outcome.failed),
          );
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(chalk.red("Error: ") + message + "\n");
    }
    // Bucket reads by (mode, spec) then merge into the graph. Skipped specs
    // (those not touched this run) keep their prior entries — important for
    // scoped reruns and for builds that fail before any reads happen.
    const bySpec = new Map();
    for (const entry of collected) {
      const key = `${entry.mode ?? ""} ${entry.spec}`;
      let bucket = bySpec.get(key);
      if (!bucket) {
        bucket = { mode: entry.mode, spec: entry.spec, files: new Set() };
        bySpec.set(key, bucket);
      }
      bucket.files.add(entry.file);
    }
    for (const bucket of bySpec.values()) {
      if (config.snapshotDir) {
        bucket.files.add(
          resolveSnapshotPath(bucket.spec, config.snapshotDir, config.input),
        );
      }
      graph.recordBuild(bucket.spec, bucket.mode, bucket.files);
    }
    // Only mark populated after a full (unscoped) run that recorded at least
    // one spec — that way we never trust a scoped run to validate the full
    // dependency picture.
    if (!scopedRun && bySpec.size > 0) {
      graphPopulated = true;
    }
    // Top up watchers after every iteration so newly-created dirs (the
    // snapshot dir on first run, dirs introduced by config edits, etc.) get
    // monitored without restarting the loop.
    refreshWatchedDirs();
    attachConfigWatcher();
    process.stdout.write("\n" + renderFailingSpecs() + watchFooter());
  }
  function attachWatcherFor(absDir, recursive) {
    if (attachedDirWatchers.has(absDir)) return;
    if (!existsSync(absDir)) return;
    try {
      const w = fsWatch(absDir, { recursive }, (_evt, filename) => {
        if (!filename) return;
        const full = path.join(absDir, filename);
        if (shouldIgnoreWatchPath(full, config)) return;
        scheduleRerun(path.relative(process.cwd(), full));
      });
      attachedDirWatchers.set(absDir, w);
    } catch {
      // some dirs (or filesystems) can't be watched recursively; skip.
    }
  }
  // Called after every iteration so dirs created lazily (snapshotDir on
  // first run, dirs introduced by config reload, etc.) get watchers.
  function refreshWatchedDirs() {
    const cwd = process.cwd();
    for (const dir of resolveWatchDirectories(config, modes)) {
      attachWatcherFor(dir, true);
    }
    for (const file of graph.allRecordedFiles()) {
      const rel = path.relative(cwd, file);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (rel.startsWith("node_modules") || rel.startsWith(".git")) continue;
      attachWatcherFor(path.dirname(file), false);
    }
  }
  function attachConfigWatcher() {
    if (configFileWatcher) return;
    if (!existsSync(resolvedConfigPath)) return;
    try {
      configFileWatcher = fsWatch(resolvedConfigPath, () => {
        scheduleRerun(path.relative(process.cwd(), resolvedConfigPath));
      });
    } catch {
      // ignore — fs.watch on a single file isn't supported everywhere.
    }
  }
  function closeDirWatchers() {
    for (const w of attachedDirWatchers.values()) w.close();
    attachedDirWatchers.clear();
  }
  function closeAllWatchers() {
    closeDirWatchers();
    if (configFileWatcher) {
      configFileWatcher.close();
      configFileWatcher = null;
    }
  }
  async function triggerRerun() {
    const trigger = pendingTrigger ?? { kind: "initial" };
    pendingTrigger = null;
    isRunning = true;
    try {
      await doRun(trigger);
    } finally {
      isRunning = false;
      if (pendingTrigger) {
        void triggerRerun();
      }
    }
  }
  function scheduleTrigger(next, delayMs) {
    // Manual triggers preempt any pending change-trigger; if a manual one is
    // already pending, leave it (latest wins regardless).
    pendingTrigger = next;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (isRunning) return;
      void triggerRerun();
    }, delayMs);
  }
  function scheduleRerun(filename) {
    if (!autoRun) {
      // Manual mode: remember the edit (for the footer + resume) but don't run.
      changedWhilePaused.add(path.resolve(filename));
      return;
    }
    scheduleTrigger({ kind: "change", file: filename }, 150);
  }
  function scheduleManualRerun(kind) {
    scheduleTrigger({ kind }, 0);
  }
  // Attach watchers before the initial run so file events that happen during
  // the run are queued for the next iteration.
  refreshWatchedDirs();
  attachConfigWatcher();
  // Initial run populates the graph as a side effect of recording every read.
  await doRun({ kind: "initial" });
  const stdin = process.stdin;
  let rawModeEnabled = false;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    try {
      stdin.setRawMode(true);
      rawModeEnabled = true;
      stdin.resume();
      stdin.on("data", (chunk) => {
        // A held key (or any chord with multiple bytes) arrives as a single
        // chunk; we only need to honour the first actionable byte. Without
        // this guard, holding `space` would schedule a fresh rerun for every
        // byte in the chunk.
        for (const byte of chunk) {
          if (byte === 0x03) {
            if (rawModeEnabled) stdin.setRawMode(false);
            closeAllWatchers();
            // Exit non-zero if the last run left anything failing, or if a run
            // is still in flight (an interrupted run counts as a failure), so
            // quitting a red watch session still fails CI / shell pipelines.
            process.exit(isRunning || failingSpecs.size ? 1 : 0);
          }
          if (isRunning) break;
          if (byte === 0x77 || byte === 0x57) {
            // `w` — toggle auto-run / manual mode. Resuming with edits pending
            // kicks off a run (which prints its own header); otherwise just
            // refresh the footer in place.
            autoRun = !autoRun;
            if (autoRun && changedWhilePaused.size > 0) {
              scheduleManualRerun("manual-runall");
            } else {
              rewriteFooter();
            }
            break;
          }
          if (byte === 0x20 || byte === 0x0d || byte === 0x0a) {
            scheduleManualRerun("manual-rerun");
            break;
          }
          if (byte === 0x61 || byte === 0x41) {
            scheduleManualRerun("manual-runall");
            break;
          }
          if (byte === 0x63 || byte === 0x43) {
            // `c` — toggle the incremental cache for subsequent runs. No-op
            // while fuzzing (the cache is unsafe there). Updates the footer in
            // place to reflect the new state.
            if (fuzzEnabled) break;
            cacheMode = cacheMode === "off" ? cacheToggleMode : "off";
            rewriteFooter();
            break;
          }
        }
      });
    } catch {
      // some terminals don't support raw mode (e.g. piped stdin); just fall
      // back to SIGINT-only behavior.
    }
  }
  process.on("SIGINT", () => {
    if (rawModeEnabled) stdin.setRawMode(false);
    closeAllWatchers();
    // Mirror the raw-mode ctrl+c path: a failing or in-flight run exits 1.
    process.exit(isRunning || failingSpecs.size ? 1 : 0);
  });
  // Keep the process alive
  await new Promise(() => {});
}
// Union of every glob the user has declared as a spec/fuzz source —
// top-level plus each mode override. We watch only directories derived from
// these so unrelated files (e.g. CLI source while developing as-test itself)
// don't trigger spurious iterations.
function collectInputPatterns(config, modes) {
  const out = new Set();
  for (const p of config.input) out.add(p);
  for (const p of config.fuzz.input) out.add(p);
  for (const modeName of modes) {
    if (!modeName) continue;
    let merged;
    try {
      merged = applyMode(config, modeName);
    } catch {
      continue;
    }
    for (const p of merged.config.input) out.add(p);
    for (const p of merged.config.fuzz.input) out.add(p);
  }
  return [...out];
}
function resolveWatchDirectories(config, modes) {
  const cwd = process.cwd();
  const dirs = new Set();
  const patterns = collectInputPatterns(config, modes);
  for (const pattern of patterns) {
    // `!`-prefixed entries are exclusions, not include sources — their
    // "base" would be `!` (which never exists), causing the walk-up loop
    // to land on cwd and watch the whole repo.
    if (pattern.startsWith("!")) continue;
    const starIdx = pattern.indexOf("*");
    const base = starIdx >= 0 ? pattern.slice(0, starIdx) : pattern;
    let dir = path.resolve(cwd, base);
    while (!existsSync(dir) && dir !== path.dirname(dir)) {
      dir = path.dirname(dir);
    }
    if (existsSync(dir)) dirs.add(dir);
  }
  const snapshotDir = path.resolve(cwd, config.snapshotDir);
  if (existsSync(snapshotDir)) dirs.add(snapshotDir);
  return [...dirs];
}
// Returns true if `rel` (a cwd-relative path with `/` separators) matches any
// `!`-prefixed pattern from the supplied input arrays. Lets users opt out of
// watch events for files they've already excluded from their spec/fuzz globs
// — no separate watch config needed.
function matchesAnyExclusion(rel, inputs) {
  const normalized = rel.split(path.sep).join("/");
  for (const input of inputs) {
    if (!input) continue;
    const patterns = Array.isArray(input) ? input : [input];
    for (const raw of patterns) {
      if (typeof raw != "string" || !raw.startsWith("!")) continue;
      const pattern = raw.slice(1);
      if (!pattern.length) continue;
      if (minimatch(normalized, pattern, { dot: true, matchBase: true })) {
        return true;
      }
    }
  }
  return false;
}
function shouldIgnoreWatchPath(filePath, config) {
  const cwd = process.cwd();
  const rel = path.relative(cwd, filePath);
  if (rel.startsWith("node_modules") || rel.startsWith(".git")) return true;
  // Dotfiles (.swp, .DS_Store, …) are always noise.
  const base = path.basename(rel);
  if (base.startsWith(".")) return true;
  // Respect `!`-prefixed glob negations in the user's existing input arrays.
  // Files the user already excluded from their spec/fuzz globs are also out
  // of scope for watch — no separate "watch.ignore" config needed.
  if (matchesAnyExclusion(rel, [config.input, config.fuzz?.input])) {
    return true;
  }
  const outRel = path.normalize(
    path.relative(cwd, path.resolve(cwd, config.outDir)),
  );
  const snapRel = path.normalize(
    path.relative(cwd, path.resolve(cwd, config.snapshotDir)),
  );
  const underSnap = rel === snapRel || rel.startsWith(snapRel + path.sep);
  const underOut = rel === outRel || rel.startsWith(outRel + path.sep);
  // Snapshots often live under outDir (default ./.as-test/snapshots); they
  // are dependencies of their specs, so we keep watching them even when the
  // rest of the output tree is ignored.
  if (underOut && !underSnap) return true;
  if (
    !rel.endsWith(".ts") &&
    !rel.endsWith(".snap") &&
    !rel.endsWith("as-test.config.json")
  ) {
    return true;
  }
  return false;
}
async function runTestMatrix(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  fuzzerSelectors,
  modes,
  buildFeatureToggles,
  modeSummaryTotal,
  fileSummaryTotal,
  fuzzEnabled,
  fuzzOverrides,
  onSpecOutcome,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (files.length && configPath) {
    try {
      const loaded = loadConfig(configPath, false);
      warnOnUnknownModeReferences(files, loaded.modes ?? {});
    } catch {
      // Best-effort: never fail the run on a scan error.
    }
  }
  if (!files.length) {
    if (!fuzzEnabled) {
      throw await buildNoTestFilesMatchedError(configPath, selectors);
    }
    const fuzzFiles = await resolveSelectedFuzzFiles(
      configPath,
      selectors,
      modes,
    );
    if (!fuzzFiles.length) {
      throw await buildNoTestFilesMatchedError(configPath, selectors, true);
    }
  }
  const renderSession = createRenderer(configPath);
  const renderer = renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const silentRenderer = new SilentRenderer();
  const allResults = [];
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const liveMatrix = canRewriteStdout();
  const modeState = modes.map(() => ({
    failed: false,
    passed: false,
  }));
  const fileState = files.map(() => ({
    failed: false,
    passed: false,
  }));
  const inputPatterns = await loadInputPatterns(configPath);
  const buildIntervals = [];
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const fileName = formatSpecDisplayPath(file);
    const fileResults = [];
    const modeTimes = modes.map(() => "...");
    if (liveMatrix) {
      renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
    }
    for (let i = 0; i < modes.length; i++) {
      const modeName = modes[i];
      let result;
      try {
        const buildStartedAt = Date.now();
        await buildFileForMode({
          configPath,
          file,
          modeName,
          buildFeatureToggles,
        });
        buildIntervals.push({ start: buildStartedAt, end: Date.now() });
        const buildInvocation = await getBuildInvocationPreview(
          configPath,
          file,
          modeName,
          buildFeatureToggles,
        );
        const artifactKey = resolveArtifactStem(file, inputPatterns);
        result = await run(runFlags, configPath, [file], false, {
          renderer: silentRenderer,
          emitRunStart: false,
          emitRunComplete: false,
          logFileName: `test.${artifactKey}.log.json`,
          coverageFileName: `${artifactKey}.log.json`,
          buildCommand: formatBuildInvocation(buildInvocation),
          modeName,
        });
      } catch (error) {
        const buildFailure = getBuildFailureErrorLike(error);
        if (!buildFailure) {
          clearLiveLine();
          throw error;
        }
        result = createBuildFailureRunResult(buildFailure);
      }
      modeTimes[i] = formatMatrixModeTime(result.stats.time);
      if (liveMatrix) {
        renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
      }
      if (result.failed) {
        modeState[i].failed = true;
      } else if (result.stats.passedFiles > 0) {
        modeState[i].passed = true;
      }
      fileResults.push(result);
      allResults.push(result);
      onSpecOutcome?.({ file, mode: modeName, failed: result.failed });
    }
    renderMatrixFileResult(
      fileName,
      modeLabels,
      fileResults,
      modeTimes,
      liveMatrix,
      showPerModeTimes,
    );
    const verdict = resolveMatrixVerdict(fileResults);
    if (verdict == "fail") {
      fileState[fileIndex].failed = true;
    } else if (verdict == "ok") {
      fileState[fileIndex].passed = true;
    }
  }
  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  let failed = allResults.some((result) => result.failed);
  let fuzzSummary;
  if (fuzzEnabled) {
    process.stdout.write("\n");
    const fuzzResults = await runFuzzMatrixResults(
      configPath,
      selectors,
      fuzzerSelectors,
      modes,
      fuzzOverrides,
      renderer,
    );
    if (fuzzResults.some(hasFuzzFailures)) failed = true;
    fuzzSummary = summarizeFuzzExecutions(fuzzResults);
    buildIntervals.push(...collectFuzzBuildIntervals(fuzzResults));
  }
  renderer.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    showCoverageAll: runFlags.showCoverageAll,
    verbose: runFlags.verbose,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    showLogs: runFlags.showLogs,
    logSummary: summary.logSummary,
    fuzzSummary,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  flushModeWarnings(process.argv.includes("--show-warnings"));
  return failed;
}
async function runFuzzModes(
  configPath,
  selectors,
  fuzzerSelectors,
  modes,
  rawArgs,
) {
  const overrides = resolveFuzzOverrides(rawArgs, "fuzz");
  const parallelSettings = resolveFuzzParallelJobs(rawArgs);
  const clean = rawArgs.includes("--clean");
  const fuzzFiles = await resolveSelectedFuzzFiles(
    configPath,
    selectors,
    modes,
  );
  const { jobs, buildJobs, runJobs } = resolveEffectiveParallelJobs(
    parallelSettings,
    fuzzFiles.length,
  );
  if (jobs > 1) {
    const results = await runFuzzMatrixResultsParallel(
      configPath,
      selectors,
      fuzzerSelectors,
      modes,
      overrides,
      jobs,
      buildJobs,
      runJobs,
      clean,
    );
    const renderSession = createRenderer(configPath);
    renderSession.renderer.onFuzzComplete?.(
      buildFuzzCompleteEvent(results, modes),
    );
    process.exit(results.some(hasFuzzFailures) ? 1 : 0);
    return;
  }
  const renderSession = createRenderer(configPath);
  const results = await runFuzzMatrixResults(
    configPath,
    selectors,
    fuzzerSelectors,
    modes,
    overrides,
    renderSession.renderer,
  );
  renderSession.renderer.onFuzzComplete?.(
    buildFuzzCompleteEvent(results, modes),
  );
  process.exit(results.some(hasFuzzFailures) ? 1 : 0);
}
async function runRuntimeSingleParallel(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  modeName,
  modeSummaryTotal,
  fileSummaryTotal,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const renderSession = createRenderer(configPath, modeName);
  const renderer = renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const buildCommandsByFile = await previewBuildCommands(
    configPath,
    selectors,
    modeName,
    {},
  );
  const results = new Array(files.length);
  const useQueueDisplay = true;
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const runLimit = createAsyncLimiter(runFlags.runJobs);
  const poolWidth = Math.max(runFlags.buildJobs, runFlags.runJobs);
  await runOrderedPool(files, poolWidth, async (file, index) => {
    const token = useQueueDisplay
      ? renderQueuedFileStart(queueDisplay, formatSpecDisplayPath(file))
      : null;
    const buffered = useQueueDisplay
      ? createBufferedRenderer(configPath, modeName)
      : null;
    let result;
    try {
      result = await runLimit(() =>
        run({ ...runFlags, clean: true }, configPath, [file], false, {
          renderer: buffered?.renderer,
          modeName,
          suiteSelectors,
          emitRunComplete: false,
          fileSummaryTotal: 1,
          modeSummaryTotal,
          modeSummaryExecuted: 1,
          buildCommandsByFile: { [file]: buildCommandsByFile[file] ?? "" },
        }),
      );
    } catch (error) {
      const buildFailure = getBuildFailureErrorLike(error);
      if (!buildFailure) throw error;
      result = createBuildFailureRunResult(buildFailure);
    }
    results[index] = result;
    if (buffered && token != null) {
      queueDisplay.complete(token, buffered.output());
    }
  });
  queueDisplay.flush();
  const summary = aggregateRunResults(results);
  summary.stats = applyConfiguredFileTotalToStats(
    summary.stats,
    fileSummaryTotal,
  );
  renderer.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    showCoverageAll: runFlags.showCoverageAll,
    verbose: runFlags.verbose,
    buildTime: 0,
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    showLogs: runFlags.showLogs,
    logSummary: summary.logSummary,
    modeSummary: buildSingleModeSummary(
      summary.stats,
      summary.snapshotSummary,
      modeSummaryTotal,
    ),
  });
  flushModeWarnings(process.argv.includes("--show-warnings"));
  return results.some((result) => result.failed);
}
async function runRuntimeMatrixParallel(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  modes,
  modeSummaryTotal,
  fileSummaryTotal,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const renderSession = createRenderer(configPath);
  const renderer = renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const silentRenderer = new SilentRenderer();
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const inputPatterns = await loadInputPatterns(configPath);
  const ordered = new Array(files.length);
  const useQueueDisplay = true;
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const poolWidth = Math.max(
    runFlags.jobs,
    runFlags.buildJobs,
    runFlags.runJobs,
  );
  const buildPool = new BuildWorkerPool(runFlags.buildJobs);
  const buildIntervals = [];
  try {
    await runOrderedPool(files, poolWidth, async (file, fileIndex) => {
      const fileName = formatSpecDisplayPath(file);
      const token = useQueueDisplay
        ? renderQueuedFileStart(queueDisplay, fileName)
        : null;
      const fileResults = [];
      const modeTimes = modes.map(() => "...");
      for (let i = 0; i < modes.length; i++) {
        const modeName = modes[i];
        let result;
        try {
          const buildStartedAt = Date.now();
          await buildFileForMode({
            configPath,
            file,
            modeName,
            buildFeatureToggles: {},
            buildPool,
          });
          buildIntervals.push({ start: buildStartedAt, end: Date.now() });
          const buildInvocation = await getBuildInvocationPreview(
            configPath,
            file,
            modeName,
            {},
          );
          const artifactKey = resolveArtifactStem(file, inputPatterns);
          result = await run(runFlags, configPath, [file], false, {
            renderer: silentRenderer,
            suiteSelectors,
            emitRunStart: false,
            emitRunComplete: false,
            logFileName: `run.${artifactKey}.log.json`,
            coverageFileName: `${artifactKey}.log.json`,
            buildCommand: formatBuildInvocation(buildInvocation),
            modeName,
          });
        } catch (error) {
          const buildFailure = getBuildFailureErrorLike(error);
          if (!buildFailure) throw error;
          result = createBuildFailureRunResult(buildFailure);
        }
        modeTimes[i] = formatMatrixModeTime(result.stats.time);
        fileResults.push(result);
      }
      ordered[fileIndex] = { fileName, fileResults, modeTimes };
      if (token != null) {
        queueDisplay.complete(
          token,
          formatMatrixFileResultLine(
            fileName,
            modeLabels,
            fileResults,
            modeTimes,
            showPerModeTimes,
          ) + "\n",
        );
      }
    });
  } finally {
    await buildPool.close();
  }
  queueDisplay.flush();
  const allResults = [];
  const modeState = modes.map(() => ({ failed: false, passed: false }));
  const fileState = files.map(() => ({ failed: false, passed: false }));
  for (let fileIndex = 0; fileIndex < ordered.length; fileIndex++) {
    const fileResults = ordered[fileIndex].fileResults;
    for (let i = 0; i < fileResults.length; i++) {
      const result = fileResults[i];
      allResults.push(result);
      if (result.failed) modeState[i].failed = true;
      else if (result.stats.passedFiles > 0) modeState[i].passed = true;
    }
    const verdict = resolveMatrixVerdict(fileResults);
    if (verdict == "fail") fileState[fileIndex].failed = true;
    else if (verdict == "ok") fileState[fileIndex].passed = true;
  }
  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  renderer.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    showCoverageAll: runFlags.showCoverageAll,
    verbose: runFlags.verbose,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    showLogs: runFlags.showLogs,
    logSummary: summary.logSummary,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  flushModeWarnings(process.argv.includes("--show-warnings"));
  return allResults.some((result) => result.failed);
}
async function runTestSingleParallel(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  fuzzerSelectors,
  buildFeatureToggles,
  modeSummaryTotal,
  fileSummaryTotal,
  fuzzEnabled,
  fuzzOverrides,
  modeName,
  onSpecOutcome,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length && !fuzzEnabled) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const renderSession = createRenderer(configPath, modeName);
  const renderer = renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const inputPatterns = await loadInputPatterns(configPath);
  const results = new Array(files.length);
  const useQueueDisplay = true;
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const poolWidth = Math.max(
    runFlags.jobs,
    runFlags.buildJobs,
    runFlags.runJobs,
  );
  const buildIntervals = [];
  if (files.length) {
    const buildPool = new BuildWorkerPool(runFlags.buildJobs);
    try {
      await runOrderedPool(files, poolWidth, async (file, index) => {
        const token = useQueueDisplay
          ? renderQueuedFileStart(queueDisplay, formatSpecDisplayPath(file))
          : null;
        const buffered = useQueueDisplay
          ? createBufferedRenderer(configPath, modeName)
          : null;
        let result;
        try {
          const buildStartedAt = Date.now();
          await buildFileForMode({
            configPath,
            file,
            modeName,
            buildFeatureToggles,
            buildPool,
          });
          buildIntervals.push({ start: buildStartedAt, end: Date.now() });
          const buildInvocation = await getBuildInvocationPreview(
            configPath,
            file,
            modeName,
            buildFeatureToggles,
          );
          const artifactKey = resolveArtifactStem(file, inputPatterns);
          result = await run(
            { ...runFlags, clean: true },
            configPath,
            [file],
            false,
            {
              renderer: buffered?.renderer,
              suiteSelectors,
              emitRunComplete: false,
              logFileName: `test.${artifactKey}.log.json`,
              coverageFileName: `${artifactKey}.log.json`,
              buildCommand: formatBuildInvocation(buildInvocation),
              modeName,
            },
          );
        } catch (error) {
          const buildFailure = getBuildFailureErrorLike(error);
          if (!buildFailure) throw error;
          result = createBuildFailureRunResult(buildFailure);
        }
        results[index] = result;
        onSpecOutcome?.({ file, mode: modeName, failed: result.failed });
        if (buffered && token != null) {
          queueDisplay.complete(token, buffered.output());
        }
      });
    } finally {
      await buildPool.close();
    }
  }
  queueDisplay.flush();
  const runResults = results.filter(Boolean);
  const summary = aggregateRunResults(runResults);
  summary.stats = applyConfiguredFileTotalToStats(
    summary.stats,
    fileSummaryTotal,
  );
  let failed = runResults.some((result) => result.failed);
  let fuzzSummary;
  if (fuzzEnabled) {
    process.stdout.write("\n");
    const fuzzResults = await runFuzzMatrixResultsParallel(
      configPath,
      selectors,
      fuzzerSelectors,
      [modeName],
      fuzzOverrides,
      runFlags.jobs,
      runFlags.buildJobs,
      runFlags.runJobs,
      runFlags.clean,
    );
    if (fuzzResults.some(hasFuzzFailures)) failed = true;
    fuzzSummary = summarizeFuzzExecutions(fuzzResults);
    buildIntervals.push(...collectFuzzBuildIntervals(fuzzResults));
  }
  renderer.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    showCoverageAll: runFlags.showCoverageAll,
    verbose: runFlags.verbose,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    showLogs: runFlags.showLogs,
    logSummary: summary.logSummary,
    fuzzSummary,
    modeSummary: buildSingleModeSummary(
      summary.stats,
      summary.snapshotSummary,
      modeSummaryTotal,
    ),
  });
  flushModeWarnings(process.argv.includes("--show-warnings"));
  return failed;
}
async function runTestMatrixParallel(
  runFlags,
  configPath,
  selectors,
  suiteSelectors,
  fuzzerSelectors,
  modes,
  buildFeatureToggles,
  modeSummaryTotal,
  fileSummaryTotal,
  fuzzEnabled,
  fuzzOverrides,
  onSpecOutcome,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (files.length && configPath) {
    try {
      const loaded = loadConfig(configPath, false);
      warnOnUnknownModeReferences(files, loaded.modes ?? {});
    } catch {
      // Best-effort: never fail the run on a scan error.
    }
  }
  if (!files.length) {
    if (!fuzzEnabled) {
      throw await buildNoTestFilesMatchedError(configPath, selectors);
    }
    const fuzzFiles = await resolveSelectedFuzzFiles(
      configPath,
      selectors,
      modes,
    );
    if (!fuzzFiles.length) {
      throw await buildNoTestFilesMatchedError(configPath, selectors, true);
    }
  }
  const renderSession = createRenderer(configPath);
  const renderer = renderSession.renderer;
  const snapshotEnabled = runFlags.snapshot !== false;
  renderer.onRunStart?.({
    runtimeName: renderSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    showLogs: runFlags.showLogs,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const silentRenderer = new SilentRenderer();
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const inputPatterns = await loadInputPatterns(configPath);
  const ordered = new Array(files.length);
  const useQueueDisplay = true;
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const poolWidth = Math.max(
    runFlags.jobs,
    runFlags.buildJobs,
    runFlags.runJobs,
  );
  const buildPool = new BuildWorkerPool(runFlags.buildJobs);
  const buildIntervals = [];
  try {
    await runOrderedPool(files, poolWidth, async (file, fileIndex) => {
      const fileName = formatSpecDisplayPath(file);
      const token = useQueueDisplay
        ? renderQueuedFileStart(queueDisplay, fileName)
        : null;
      const fileResults = [];
      const modeTimes = modes.map(() => "...");
      for (let i = 0; i < modes.length; i++) {
        const modeName = modes[i];
        let result;
        try {
          const buildStartedAt = Date.now();
          await buildFileForMode({
            configPath,
            file,
            modeName,
            buildFeatureToggles,
            buildPool,
          });
          buildIntervals.push({ start: buildStartedAt, end: Date.now() });
          const buildInvocation = await getBuildInvocationPreview(
            configPath,
            file,
            modeName,
            buildFeatureToggles,
          );
          const artifactKey = resolveArtifactStem(file, inputPatterns);
          result = await run(runFlags, configPath, [file], false, {
            renderer: silentRenderer,
            suiteSelectors,
            emitRunStart: false,
            emitRunComplete: false,
            logFileName: `test.${artifactKey}.log.json`,
            coverageFileName: `${artifactKey}.log.json`,
            buildCommand: formatBuildInvocation(buildInvocation),
            modeName,
          });
        } catch (error) {
          const buildFailure = getBuildFailureErrorLike(error);
          if (!buildFailure) throw error;
          result = createBuildFailureRunResult(buildFailure);
        }
        modeTimes[i] = formatMatrixModeTime(result.stats.time);
        fileResults.push(result);
        onSpecOutcome?.({ file, mode: modeName, failed: result.failed });
      }
      ordered[fileIndex] = { fileName, fileResults, modeTimes };
      if (token != null) {
        queueDisplay.complete(
          token,
          formatMatrixFileResultLine(
            fileName,
            modeLabels,
            fileResults,
            modeTimes,
            showPerModeTimes,
          ) + "\n",
        );
      }
    });
  } finally {
    await buildPool.close();
  }
  queueDisplay.flush();
  const allResults = [];
  const modeState = modes.map(() => ({ failed: false, passed: false }));
  const fileState = files.map(() => ({ failed: false, passed: false }));
  for (let fileIndex = 0; fileIndex < ordered.length; fileIndex++) {
    const entry = ordered[fileIndex];
    for (let i = 0; i < entry.fileResults.length; i++) {
      const result = entry.fileResults[i];
      allResults.push(result);
      if (result.failed) modeState[i].failed = true;
      else if (result.stats.passedFiles > 0) modeState[i].passed = true;
    }
    const verdict = resolveMatrixVerdict(entry.fileResults);
    if (verdict == "fail") fileState[fileIndex].failed = true;
    else if (verdict == "ok") fileState[fileIndex].passed = true;
  }
  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  let failed = allResults.some((result) => result.failed);
  let fuzzSummary;
  if (fuzzEnabled) {
    process.stdout.write("\n");
    const fuzzResults = await runFuzzMatrixResultsParallel(
      configPath,
      selectors,
      fuzzerSelectors,
      modes,
      fuzzOverrides,
      runFlags.jobs,
      runFlags.buildJobs,
      runFlags.runJobs,
      runFlags.clean,
    );
    if (fuzzResults.some(hasFuzzFailures)) failed = true;
    fuzzSummary = summarizeFuzzExecutions(fuzzResults);
    buildIntervals.push(...collectFuzzBuildIntervals(fuzzResults));
  }
  renderer.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    showCoverageAll: runFlags.showCoverageAll,
    verbose: runFlags.verbose,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    showLogs: runFlags.showLogs,
    logSummary: summary.logSummary,
    fuzzSummary,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  flushModeWarnings(process.argv.includes("--show-warnings"));
  return failed;
}
async function runFuzzMatrixResultsParallel(
  configPath,
  selectors,
  fuzzerSelectors,
  modes,
  overrides,
  jobs,
  buildJobs,
  runJobs,
  clean,
) {
  const filesByMode = new Map();
  for (const modeName of modes) {
    filesByMode.set(
      modeName,
      await resolveSelectedFuzzFiles(configPath, selectors, [modeName]),
    );
  }
  const files = [...new Set([...filesByMode.values()].flat())].sort((a, b) =>
    a.localeCompare(b),
  );
  if (!files.length) {
    throw new Error(
      `No fuzz files matched: ${selectors.length ? selectors.join(", ") : "configured input patterns"}`,
    );
  }
  const ordered = new Array(files.length);
  const queueDisplay = new ParallelQueueDisplay(!clean);
  const poolWidth = Math.max(jobs, buildJobs, runJobs);
  await runOrderedPool(files, poolWidth, async (file, index) => {
    const token = renderQueuedFileStart(queueDisplay, path.basename(file));
    const fileResults = [];
    for (const modeName of modes) {
      if (!(filesByMode.get(modeName)?.includes(file) ?? false)) continue;
      const modeResults = await fuzz(
        configPath,
        [file],
        modeName,
        overrides,
        fuzzerSelectors,
      );
      fileResults.push(...modeResults);
    }
    ordered[index] = fileResults;
    const buffered = createBufferedRenderer(configPath);
    buffered.renderer.onFuzzFileComplete?.({ file, results: fileResults });
    queueDisplay.complete(token, buffered.output());
  });
  queueDisplay.flush();
  return ordered.flat();
}
async function runFuzzMatrixResults(
  configPath,
  selectors,
  fuzzerSelectors,
  modes,
  overrides,
  renderer,
) {
  const results = [];
  for (const modeName of modes) {
    const files = await resolveSelectedFuzzFiles(configPath, selectors, [
      modeName,
    ]);
    if (!files.length) {
      continue;
    }
    for (const file of files) {
      const fileResults = [];
      const modeResults = await fuzz(
        configPath,
        [file],
        modeName,
        overrides,
        fuzzerSelectors,
      );
      fileResults.push(...modeResults);
      results.push(...modeResults);
      renderer?.onFuzzFileComplete?.({ file, results: fileResults });
    }
  }
  if (!results.length) {
    throw new Error(
      `No fuzz files matched: ${selectors.length ? selectors.join(", ") : "configured input patterns"}`,
    );
  }
  return results;
}
function hasFuzzFailures(result) {
  if (result.crashes > 0) return true;
  return result.fuzzers.some((fuzzer) => fuzzer.failed > 0);
}
function buildFuzzCompleteEvent(results, modes) {
  return {
    results,
    time: results.reduce((sum, item) => sum + item.time, 0),
    buildTime: getMergedIntervalDuration(collectFuzzBuildIntervals(results)),
    fuzzingSummary: summarizeFuzzExecutions(results),
    suiteSummary: summarizeFuzzSuites(results),
    modeSummary: summarizeFuzzModes(results, modes),
  };
}
function collectFuzzBuildIntervals(results) {
  return results.map((result) => ({
    start: result.buildStartedAt,
    end: result.buildFinishedAt,
  }));
}
function getMergedIntervalDuration(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals
    .map((interval) => ({
      start: Math.min(interval.start, interval.end),
      end: Math.max(interval.start, interval.end),
    }))
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const interval = sorted[i];
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  total += currentEnd - currentStart;
  return total;
}
function summarizeFuzzExecutions(results) {
  return {
    failed: results.reduce(
      (sum, item) =>
        sum +
        item.fuzzers.reduce(
          (inner, fuzzer) => inner + fuzzer.failed + fuzzer.crashed,
          0,
        ),
      0,
    ),
    skipped: results.reduce(
      (sum, item) =>
        sum + item.fuzzers.reduce((inner, fuzzer) => inner + fuzzer.skipped, 0),
      0,
    ),
    total: results.reduce(
      (sum, item) =>
        sum + item.fuzzers.reduce((inner, fuzzer) => inner + fuzzer.runs, 0),
      0,
    ),
  };
}
function summarizeFuzzSuites(results) {
  return {
    failed: results.reduce(
      (sum, item) =>
        sum +
        item.fuzzers.filter((fuzzer) => fuzzer.failed > 0 || fuzzer.crashed > 0)
          .length,
      0,
    ),
    skipped: results.reduce(
      (sum, item) =>
        sum + item.fuzzers.filter((fuzzer) => fuzzer.skipped > 0).length,
      0,
    ),
    total: results.reduce((sum, item) => sum + item.fuzzers.length, 0),
  };
}
function summarizeFuzzModes(results, modes) {
  const total = Math.max(modes.length, 1);
  const state = new Map();
  for (const modeName of modes) {
    state.set(modeName ?? "default", { failed: false, passed: false });
  }
  for (const result of results) {
    const current = state.get(result.modeName) ?? {
      failed: false,
      passed: false,
    };
    if (hasFuzzFailures(result)) current.failed = true;
    else if (!isSkippedFuzzResult(result)) current.passed = true;
    state.set(result.modeName, current);
  }
  let failed = 0;
  let skipped = 0;
  for (const mode of state.values()) {
    if (mode.failed) failed++;
    else if (!mode.passed) skipped++;
  }
  return { failed, skipped, total };
}
function isSkippedFuzzResult(result) {
  return (
    result.crashes == 0 &&
    result.fuzzers.length > 0 &&
    result.fuzzers.every((fuzzer) => fuzzer.skipped > 0)
  );
}
function renderMatrixFileResult(
  file,
  modes,
  results,
  modeTimes,
  liveMatrix,
  showPerModeTimes,
) {
  const line = formatMatrixFileResultLine(
    file,
    modes,
    results,
    modeTimes,
    showPerModeTimes,
  );
  if (liveMatrix) clearLiveLine();
  process.stdout.write(line + "\n");
}
function formatMatrixFileResultLine(
  file,
  modes,
  results,
  modeTimes,
  showPerModeTimes,
) {
  const verdict = resolveMatrixVerdict(results);
  // A file whose every mode was replayed from cache is de-emphasized: dim-grey
  // badge + filename, and "(cache)" in place of the timing.
  const cached =
    results.length > 0 &&
    results.every(
      (r) => r.reports.length > 0 && r.reports.every((rep) => rep.cached),
    );
  if (cached) {
    const badge =
      verdict == "fail"
        ? chalk.bgRed.white(" FAIL ")
        : verdict == "ok"
          ? chalk.bgGreenBright.white(" PASS ")
          : chalk.bgBlackBright.white(" SKIP ");
    return `${badge} ${chalk.dim(file)} ${chalk.dim("(cache)")}`;
  }
  const badge =
    verdict == "fail"
      ? chalk.bgRed.white(" FAIL ")
      : verdict == "ok"
        ? chalk.bgGreenBright.black(" PASS ")
        : chalk.bgBlackBright.white(" SKIP ");
  const avg = formatMatrixAverageTime(results);
  const timingText = showPerModeTimes ? modeTimes.join(",") : avg;
  const failedModes = results
    .map((result, index) => (result.failed ? modes[index] : null))
    .filter((mode) => Boolean(mode));
  const suffix = showPerModeTimes
    ? ` ${chalk.dim(`(${modes.join(",")})`)}`
    : failedModes.length
      ? ` ${chalk.dim(`(failed: ${failedModes.join(", ")})`)}`
      : "";
  return `${badge} ${file} ${chalk.dim(timingText)}${suffix}`;
}
function resolveMatrixVerdict(results) {
  if (results.some((result) => result.failed)) return "fail";
  const hasPass = results.some((result) => result.stats.passedFiles > 0);
  if (hasPass) return "ok";
  return "skip";
}
function canRewriteStdout() {
  return Boolean(process.stdout.isTTY);
}
function clearLiveLine() {
  if (!canRewriteStdout()) return;
  process.stdout.write("\r\x1b[2K");
}
function renderMatrixLiveLine(file, modes, modeTimes, showPerModeTimes) {
  if (!canRewriteStdout()) return;
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
  if (!results.length) return "0.0ms";
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
    } else if (!mode.passed) {
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
function createBuildFailureRunResult(error) {
  const message = formatBuildFailureMessage(error);
  const report = {
    file: error.file,
    modeName: error.mode,
    suites: [
      {
        file: error.file,
        description: formatSpecDisplayPath(error.file),
        depth: 0,
        kind: "build-error",
        verdict: "fail",
        time: {
          start: 0,
          end: 0,
        },
        suites: [],
        logs: [],
        tests: [
          {
            order: 0,
            type: "build-error",
            verdict: "fail",
            left: null,
            right: null,
            instr: "build failed before the test could run",
            message,
            location: "",
          },
        ],
        modeName: error.mode,
        buildCommand: formatBuildInvocation(error.invocation),
        runCommand: "",
      },
    ],
    coverage: {
      total: 0,
      covered: 0,
      uncovered: 0,
      percent: 100,
      points: [],
    },
    runCommand: "",
    buildCommand: formatBuildInvocation(error.invocation),
    snapshotSummary: {
      matched: 0,
      created: 0,
      updated: 0,
      failed: 0,
    },
  };
  return {
    failed: true,
    buildTime: 0,
    stats: {
      passedFiles: 0,
      failedFiles: 1,
      skippedFiles: 0,
      passedSuites: 0,
      failedSuites: 1,
      skippedSuites: 0,
      passedTests: 0,
      failedTests: 1,
      skippedTests: 0,
      time: 0,
      failedEntries: [
        {
          ...report.suites[0],
          file: error.file,
          modeName: error.mode,
          buildCommand: report.buildCommand,
          runCommand: "",
        },
      ],
    },
    snapshotSummary: report.snapshotSummary,
    coverageSummary: {
      enabled: false,
      showPoints: false,
      total: 0,
      covered: 0,
      uncovered: 0,
      percent: 100,
      files: [],
    },
    reports: [report],
    logSummary: { count: 0, file: null, groups: [], text: "" },
  };
}
function formatBuildFailureMessage(error) {
  const parts = [];
  const stderr = error.stderr.trim();
  const stdout = error.stdout.trim();
  if (stderr.length) {
    parts.push(`stderr:\n${stderr}`);
  }
  if (stdout.length) {
    parts.push(`stdout:\n${stdout}`);
  }
  if (error.crashLogPath.length) {
    parts.push(`Crash log:\n${error.crashLogPath}`);
  }
  return parts.join("\n\n") || "build failed with no compiler output";
}
function getBuildFailureErrorLike(error) {
  if (error instanceof BuildFailureError) {
    return error;
  }
  if (!error || typeof error != "object") {
    return null;
  }
  const candidate = error;
  if (candidate.name != "BuildFailureError") {
    return null;
  }
  if (
    typeof candidate.file != "string" ||
    typeof candidate.mode != "string" ||
    typeof candidate.stdout != "string" ||
    typeof candidate.stderr != "string" ||
    typeof candidate.crashLogPath != "string" ||
    !candidate.invocation ||
    typeof candidate.invocation != "object" ||
    typeof candidate.invocation.command != "string" ||
    !Array.isArray(candidate.invocation.args)
  ) {
    return null;
  }
  return candidate;
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
    if (file.failed) failedFiles++;
    else if (file.passed) passedFiles++;
    else skippedFiles++;
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
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, false);
  const configuredModes = Object.keys(config.modes).length;
  return configuredModes || 1;
}
async function resolveConfiguredFileTotal(configPath, selectors = []) {
  const files = await resolveSelectedFiles(configPath, selectors);
  return files.length;
}
async function previewBuildCommands(
  configPath,
  selectors,
  modeName,
  featureToggles,
) {
  const files = await resolveSelectedFiles(configPath, selectors);
  const out = {};
  for (const file of files) {
    const invocation = await getBuildInvocationPreview(
      configPath,
      file,
      modeName,
      featureToggles,
    );
    out[file] = formatBuildInvocation(invocation);
  }
  return out;
}
function resolveExecutionModes(configPath, selectedModes) {
  if (selectedModes.length) return selectedModes;
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, false);
  const hasDeclaredModes = Object.keys(config.modes).length > 0;
  if (!hasDeclaredModes) return [undefined];
  return getDefaultModeNames(config);
}
// Collect files changed in the git working tree: tracked changes vs HEAD plus
// untracked-but-not-ignored files, as absolute paths. Returns null when git is
// unavailable or this isn't a repository.
function gitChangedFiles() {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (root.status !== 0) return null;
  const gitRoot = root.stdout.trim();
  if (!gitRoot.length) return null;
  const changed = new Set();
  const collect = (args) => {
    const result = spawnSync("git", args, { cwd: gitRoot, encoding: "utf8" });
    if (result.status !== 0) return;
    for (const line of result.stdout.split("\n")) {
      const rel = line.trim();
      if (rel.length) changed.add(path.resolve(gitRoot, rel));
    }
  };
  collect(["diff", "--name-only", "HEAD"]);
  collect(["ls-files", "--others", "--exclude-standard"]);
  return changed;
}
// Compute the `--changed` spec set: specs whose own file changed, plus specs
// whose recorded build dependencies changed (so editing a shared helper re-runs
// its dependents). Falls back to spec-file-only matching when no cache exists.
async function activateChangedFilter(configPath) {
  const changed = gitChangedFiles();
  if (!changed) {
    process.stderr.write(
      `${chalk.yellow.bold("WARN")} --changed: not a git repository (or git unavailable); running all specs\n`,
    );
    changedSpecFilter = null;
    return;
  }
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath);
  const { files } = await resolveSpecFiles(config.input, []);
  const keep = new Set();
  for (const file of files) {
    if (!file.endsWith(".spec.ts")) continue;
    const abs = path.resolve(file);
    if (changed.has(abs)) keep.add(abs);
  }
  try {
    const cache = BuildCache.load(
      resolveCacheDir(config.outDir),
      getCliVersion(),
    );
    for (const spec of cache.specsAffectedBy(changed)) {
      keep.add(path.resolve(spec));
    }
  } catch {
    // No or unreadable cache — direct spec-change matching still applies.
  }
  changedSpecFilter = keep;
}
async function resolveSelectedFiles(configPath, selectors, warn = true) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, warn);
  const { files, warnings } = await resolveSpecFiles(config.input, selectors);
  if (warn) emitSelectorWarnings(warnings);
  let specs = files.filter((file) => file.endsWith(".spec.ts"));
  if (changedSpecFilter) {
    const filter = changedSpecFilter;
    specs = specs.filter((file) => filter.has(path.resolve(file)));
  }
  return [...new Set(specs)].sort((a, b) => a.localeCompare(b));
}
async function resolveSelectedFuzzFiles(
  configPath,
  selectors,
  modes = [undefined],
) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const files = new Set();
  for (const modeName of modes) {
    const loaded = loadConfig(resolvedConfigPath, false);
    const applied = applyMode(loaded, modeName);
    const config = applied.config;
    const patterns = resolveFuzzPatterns(config.fuzz.input, selectors);
    const matches = await glob(patterns);
    for (const file of matches) {
      if (file.endsWith(".fuzz.ts")) files.add(file);
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}
async function resolveSelectedTestInputs(configPath, selectors) {
  const [specs, fuzz] = await Promise.all([
    resolveSelectedFiles(configPath, selectors),
    resolveSelectedFuzzFiles(configPath, selectors),
  ]);
  return { specs, fuzz };
}
async function buildNoTestFilesMatchedError(
  configPath,
  selectors,
  includeFuzz = false,
) {
  const scope =
    selectors.length > 0 ? selectors.join(", ") : "configured input patterns";
  const lines = [`No test files matched: ${scope}`];
  const configuredFiles = await resolveSelectedFiles(configPath, [], false);
  const configuredFuzzFiles = includeFuzz
    ? await resolveSelectedFuzzFiles(configPath, [])
    : [];
  if (!selectors.length) {
    lines.push(
      'No specs were discovered from configured input patterns. Check "input" in config or run "ast doctor".',
    );
    return new Error(lines.join("\n"));
  }
  const suggestions = suggestClosestSuites(
    selectors,
    includeFuzz
      ? [...configuredFiles, ...configuredFuzzFiles]
      : configuredFiles,
  );
  if (suggestions.length) {
    lines.push(`Closest suite names: ${suggestions.join(", ")}`);
  }
  if (configuredFiles.length) {
    const sample = configuredFiles
      .slice(0, 5)
      .map((file) => formatSpecDisplayPath(file))
      .join(", ");
    lines.push(
      `Configured specs (${configuredFiles.length}): ${sample}${configuredFiles.length > 5 ? ", ..." : ""}`,
    );
  } else {
    lines.push(
      'No specs were discovered from configured input patterns. Check "input" in config.',
    );
  }
  if (includeFuzz && configuredFuzzFiles.length) {
    const sample = configuredFuzzFiles
      .slice(0, 5)
      .map((file) => path.basename(file))
      .join(", ");
    lines.push(
      `Configured fuzzers (${configuredFuzzFiles.length}): ${sample}${configuredFuzzFiles.length > 5 ? ", ..." : ""}`,
    );
  }
  lines.push('Run "ast test --list" to inspect resolved files.');
  return new Error(lines.join("\n"));
}
function suggestClosestSuites(selectors, files) {
  const suites = [
    ...new Set(files.map((file) => stripSuiteSuffix(path.basename(file)))),
  ];
  if (!suites.length) return [];
  const out = new Set();
  for (const selector of expandSelectors(selectors)) {
    if (!isBareSuiteSelector(selector)) continue;
    const query = stripSuiteSuffix(path.basename(selector));
    const closest = resolveClosestSuiteName(query, suites);
    if (closest) out.add(closest);
  }
  return [...out].slice(0, 3);
}
function resolveClosestSuiteName(value, candidates) {
  if (!value.length) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const lowered = value.toLowerCase();
  for (const candidate of candidates) {
    if (candidate == value) return null;
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
  if (best && bestDistance <= 3) return best;
  return null;
}
function levenshteinDistance(left, right) {
  if (left == right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
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
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[left.length][right.length];
}
function resolveFuzzPatterns(configured, selectors) {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;
  const patterns = new Set();
  for (const selector of expandSelectors(selectors)) {
    if (!selector) continue;
    if (isBareSuiteSelector(selector)) {
      const base = selector.replace(/\.fuzz\.ts$/, "").replace(/\.ts$/, "");
      for (const configuredInput of configuredInputs) {
        patterns.add(
          path.join(path.dirname(configuredInput), `${base}.fuzz.ts`),
        );
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
    if (!selector) continue;
    if (!shouldSplitSelector(selector)) {
      expanded.push(selector);
      continue;
    }
    for (const token of selector.split(",")) {
      const trimmed = token.trim();
      if (!trimmed.length) continue;
      expanded.push(trimmed);
    }
  }
  return expanded;
}
function shouldSplitSelector(selector) {
  return (
    selector.includes(",") &&
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}
function isBareSuiteSelector(selector) {
  return (
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}
function stripSuiteSuffix(selector) {
  return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}
// Returns the spec relative path (under the configured input base) with the
// trailing ".ts" stripped, suitable for use as a stable per-file key for
// coverage and log filenames.
function resolveArtifactStem(file, inputPatterns) {
  return resolveSpecRelativePath(file, inputPatterns).replace(/\.ts$/i, "");
}
async function loadInputPatterns(configPath) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  return loadConfig(resolvedConfigPath, false).input;
}
async function loadFuzzInputPatterns(configPath) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  return loadConfig(resolvedConfigPath, false).fuzz.input;
}
async function ensureWebBrowsersReady(configPath, modes, browserOverride) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, true);
  const missing = [];
  for (const modeName of modes) {
    const applied = applyMode(config, modeName);
    const active = applied.config;
    if (!usesWebBrowser(active)) continue;
    const requestedBrowser =
      browserOverride?.trim() || active.runOptions.runtime.browser.trim();
    const resolved = resolveBrowserSelection(requestedBrowser);
    if (!resolved) {
      missing.push({ modeName, browser: requestedBrowser });
      continue;
    }
    active.runOptions.runtime.browser = resolved.browser;
    await ensurePlaywrightBrowserDepsReady(requestedBrowser, resolved.browser);
    process.env.BROWSER = resolved.browser;
  }
  if (!missing.length) return;
  await handleMissingWebBrowsers(missing);
}
function resolveBrowserSelection(requested = "") {
  if (requested.trim().length) {
    return resolveNamedBrowser(requested);
  }
  const envBrowser = process.env.BROWSER?.trim() ?? "";
  if (envBrowser.length) {
    return resolveNamedBrowser(envBrowser);
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
  const playwrightFallback =
    resolvePlaywrightBrowserExecutable("chromium") ??
    resolvePlaywrightBrowserExecutable("firefox");
  if (playwrightFallback) {
    return { browser: playwrightFallback };
  }
  return null;
}
function resolveNamedBrowser(browser) {
  const normalized = browser.trim().toLowerCase();
  if (!normalized.length) return null;
  if (
    browser.includes("/") ||
    browser.includes("\\") ||
    path.isAbsolute(browser)
  ) {
    return hasExecutable(browser) ? { browser } : null;
  }
  const aliases = {
    chromium: ["chromium", "chromium-browser"],
    chrome: [
      "google-chrome",
      "google-chrome-stable",
      "chrome",
      "chromium",
      "chromium-browser",
    ],
    firefox: ["firefox"],
    webkit: [],
  };
  const candidates = aliases[normalized] ?? [browser];
  for (const candidate of candidates) {
    if (hasExecutable(candidate)) {
      return { browser: candidate };
    }
  }
  const systemFallback = resolveSystemBrowserExecutable(normalized);
  if (systemFallback) {
    return { browser: systemFallback };
  }
  const playwrightFallback = resolvePlaywrightBrowserExecutable(normalized);
  if (playwrightFallback) {
    return { browser: playwrightFallback };
  }
  return null;
}
function usesWebBrowser(config) {
  return (
    config.buildOptions.target == "web" ||
    config.runOptions.runtime.browser.length > 0 ||
    config.runOptions.runtime.cmd.includes("default.web.js")
  );
}
async function handleMissingWebBrowsers(missing) {
  const scope = missing
    .map((entry) =>
      entry.browser?.length
        ? `${entry.modeName ?? "default"} (${entry.browser})`
        : (entry.modeName ?? "default"),
    )
    .join(", ");
  const details =
    "no web-capable browser was found in PATH, BROWSER, or Playwright cache";
  const selected = choosePreferredBrowserInstall(missing);
  const installCommand =
    selected == "webkit"
      ? "npx -y playwright install webkit"
      : `npx -y playwright install ${selected}`;
  if (!canPromptForWebInstall()) {
    throw new Error(
      `web target requires a browser for mode(s) ${scope}; ${details}. Export BROWSER or install one with "${installCommand}".`,
    );
  }
  process.stdout.write(
    chalk.bold.blue("◇  Browser Setup Needed") +
      "\n" +
      `│  ${details}\n` +
      `│  requested browser: ${selected}\n` +
      "│\n",
  );
  const choice = await promptLine(
    `Install ${selected} with Playwright now? [Y/n] `,
  );
  const normalized = choice.trim().toLowerCase();
  if (normalized == "n" || normalized == "no") {
    throw new Error(
      `browser install skipped. Export BROWSER or install one with "${installCommand}", then rerun.`,
    );
  }
  if (normalized != "" && normalized != "y" && normalized != "yes") {
    throw new Error(`invalid answer "${choice}". Expected yes or no.`);
  }
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
    throw new Error(
      `Playwright installed ${selected}, but as-test could not locate the browser executable`,
    );
  }
  process.env.BROWSER = browserPath;
}
async function ensurePlaywrightBrowserDepsReady(
  requestedBrowser,
  resolvedBrowser,
) {
  if (process.platform != "linux") return;
  if (!isPlaywrightBrowserExecutable(resolvedBrowser)) return;
  const browser = normalizeBrowserInstallName(requestedBrowser);
  if (!browser) return;
  const dryRun = spawnSync(
    "npx",
    ["-y", "playwright", "install-deps", "--dry-run", browser],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  if (dryRun.status === 0) return;
  const installCommand = `npx -y playwright install-deps ${browser}`;
  const details = extractPlaywrightDepsSummary(dryRun).trim();
  if (!canPromptForWebInstall()) {
    throw new Error(
      [
        `Playwright ${browser} system dependencies are missing on Linux.`,
        details.length ? details : null,
        `Install them with "${installCommand}" and rerun.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  process.stdout.write(
    chalk.bold.blue("◇  Browser Deps Needed") +
      "\n" +
      `│  Playwright ${browser} needs Linux system packages before it can launch.\n` +
      (details.length
        ? `│\n${details
            .split("\n")
            .map((line) => `│  ${line}`)
            .join("\n")}\n`
        : "") +
      "│\n",
  );
  const choice = await promptLine(
    `Install Playwright ${browser} system dependencies now? [Y/n] `,
  );
  const normalized = choice.trim().toLowerCase();
  if (normalized == "n" || normalized == "no") {
    throw new Error(
      `browser dependency install skipped. Run "${installCommand}", then rerun.`,
    );
  }
  if (normalized != "" && normalized != "y" && normalized != "yes") {
    throw new Error(`invalid answer "${choice}". Expected yes or no.`);
  }
  process.stdout.write(
    chalk.dim(`installing Playwright ${browser} system dependencies...\n`),
  );
  const install = spawnSync(
    "npx",
    ["-y", "playwright", "install-deps", browser],
    {
      stdio: "inherit",
      shell: false,
    },
  );
  if (install.status !== 0) {
    throw new Error(
      `Playwright system dependency install failed for ${browser}`,
    );
  }
}
function choosePreferredBrowserInstall(missing) {
  for (const entry of missing) {
    const normalized = normalizeBrowserInstallName(entry.browser);
    if (normalized) return normalized;
  }
  return "chromium";
}
function normalizeBrowserInstallName(browser) {
  const normalized = browser?.trim().toLowerCase() ?? "";
  if (!normalized.length) return null;
  if (normalized == "firefox") return "firefox";
  if (normalized == "webkit") return "webkit";
  if (
    normalized == "chromium" ||
    normalized == "chrome" ||
    normalized == "google-chrome" ||
    normalized == "google-chrome-stable" ||
    normalized == "chromium-browser" ||
    normalized == "msedge"
  ) {
    return "chromium";
  }
  return null;
}
function isPlaywrightBrowserExecutable(browser) {
  const normalized = browser.trim().replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/ms-playwright/") ||
    normalized.endsWith("/pw_run.sh") ||
    normalized.endsWith("/playwright.exe")
  );
}
function extractPlaywrightDepsSummary(result) {
  const stdout =
    typeof result.stdout == "string"
      ? result.stdout
      : (result.stdout?.toString("utf8") ?? "");
  const stderr =
    typeof result.stderr == "string"
      ? result.stderr
      : (result.stderr?.toString("utf8") ?? "");
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
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
  const patterns = getPlaywrightBrowserPatterns(browser);
  if (!patterns.length) return null;
  for (const cacheRoot of getPlaywrightCacheRoots()) {
    if (!existsSync(cacheRoot)) continue;
    for (const pattern of patterns) {
      const matches = glob.sync(path.join(cacheRoot, pattern)).sort();
      if (matches.length) return matches[matches.length - 1];
    }
  }
  return null;
}
function getPlaywrightCacheRoots() {
  const roots = new Set();
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ?? "";
  if (configured.length && configured != "0") {
    roots.add(path.resolve(configured));
  }
  const home = process.env.HOME ?? "";
  if (process.platform == "darwin" && home.length) {
    roots.add(path.join(home, "Library", "Caches", "ms-playwright"));
  } else if (process.platform == "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim() ?? "";
    if (localAppData.length) {
      roots.add(path.join(localAppData, "ms-playwright"));
    }
    const userProfile = process.env.USERPROFILE?.trim() ?? "";
    if (userProfile.length) {
      roots.add(path.join(userProfile, "AppData", "Local", "ms-playwright"));
    }
  } else if (home.length) {
    roots.add(path.join(home, ".cache", "ms-playwright"));
  }
  return [...roots];
}
function getPlaywrightBrowserPatterns(browser) {
  if (process.platform == "darwin") {
    const macMap = {
      chromium: [
        "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
        "chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell",
      ],
      chrome: [
        "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
        "chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell",
      ],
      firefox: [
        "firefox-*/firefox/*.app/Contents/MacOS/firefox",
        "firefox-*/*.app/Contents/MacOS/firefox",
        "firefox-*/firefox/firefox",
      ],
      webkit: ["webkit-*/pw_run.sh"],
    };
    return macMap[browser] ?? [];
  }
  if (process.platform == "win32") {
    const winMap = {
      chromium: [
        "chromium-*/chrome-win/chrome.exe",
        "chromium-*/chrome-win64/chrome.exe",
        "chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe",
      ],
      chrome: [
        "chromium-*/chrome-win/chrome.exe",
        "chromium-*/chrome-win64/chrome.exe",
        "chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe",
      ],
      firefox: ["firefox-*/firefox/firefox.exe"],
      webkit: ["webkit-*/Playwright.exe"],
    };
    return winMap[browser] ?? [];
  }
  const linuxMap = {
    chromium: [
      "chromium-*/chrome-linux/chrome",
      "chromium-*/chrome-linux64/chrome",
      "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
    ],
    chrome: [
      "chromium-*/chrome-linux/chrome",
      "chromium-*/chrome-linux64/chrome",
      "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
    ],
    firefox: ["firefox-*/firefox/firefox"],
    webkit: ["webkit-*/pw_run.sh"],
  };
  return linuxMap[browser] ?? [];
}
function resolveSystemBrowserExecutable(browser) {
  if (process.platform == "darwin") {
    const home = process.env.HOME ?? "";
    const macSearchRoots = [
      "/Applications",
      home.length ? path.join(home, "Applications") : "",
    ].filter(Boolean);
    const macAppPaths = {
      chromium: [
        "Chromium.app/Contents/MacOS/Chromium",
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      ],
      chrome: [
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "Chromium.app/Contents/MacOS/Chromium",
      ],
      firefox: [
        "Firefox.app/Contents/MacOS/firefox",
        "Firefox Developer Edition.app/Contents/MacOS/firefox",
      ],
      msedge: ["Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      webkit: [],
    };
    for (const root of macSearchRoots) {
      for (const relativePath of macAppPaths[browser] ?? []) {
        const fullPath = path.join(root, relativePath);
        if (existsSync(fullPath)) return fullPath;
      }
    }
    return null;
  }
  if (process.platform == "win32") {
    const programFiles = process.env.ProgramFiles?.trim() ?? "";
    const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim() ?? "";
    const localAppData = process.env.LOCALAPPDATA?.trim() ?? "";
    const roots = [programFiles, programFilesX86, localAppData].filter(Boolean);
    const winPaths = {
      chromium: [
        "Chromium/Application/chrome.exe",
        "Google/Chrome/Application/chrome.exe",
      ],
      chrome: ["Google/Chrome/Application/chrome.exe"],
      firefox: ["Mozilla Firefox/firefox.exe"],
      msedge: ["Microsoft/Edge/Application/msedge.exe"],
      webkit: [],
    };
    for (const root of roots) {
      for (const relativePath of winPaths[browser] ?? []) {
        const fullPath = path.join(root, relativePath);
        if (existsSync(fullPath)) return fullPath;
      }
    }
  }
  return null;
}
function hasExecutable(command) {
  if (!command.length) return false;
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  const pathValue = process.env.PATH ?? "";
  const suffixes =
    process.platform == "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const base of pathValue.split(path.delimiter)) {
    if (!base.length) continue;
    for (const suffix of suffixes) {
      if (existsSync(path.join(base, command + suffix))) return true;
    }
  }
  return false;
}
async function listExecutionPlan(
  command,
  configPath,
  selectors,
  modes,
  listFlags,
  fuzzEnabled = false,
) {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, true);
  const configuredModes = Object.keys(config.modes);
  const defaultModes = getDefaultModeNames(config);
  const configuredModeLabels = configuredModes.length
    ? configuredModes
    : ["default"];
  const selectedModeLabels = modes.map((modeName) => modeName ?? "default");
  const unknownModes = modes.filter((modeName) =>
    Boolean(modeName && !configuredModes.includes(modeName)),
  );
  if (unknownModes.length) {
    throw new Error(
      `unknown mode "${unknownModes[0]}". Available modes: ${configuredModes.join(", ") || "(none)"}`,
    );
  }
  process.stdout.write(chalk.bold.blueBright("as-test plan") + "\n");
  process.stdout.write(chalk.dim(`command: ${command}`) + "\n");
  process.stdout.write(chalk.dim(`config: ${resolvedConfigPath}`) + "\n");
  process.stdout.write(
    chalk.dim(
      `selectors: ${selectors.length ? selectors.join(", ") : "(configured input patterns)"}`,
    ) + "\n\n",
  );
  if (listFlags.listModes) {
    process.stdout.write(chalk.bold("Configured modes:\n"));
    for (const modeName of configuredModeLabels) {
      if (modeName == "default") {
        process.stdout.write(`  - ${modeName}\n`);
        continue;
      }
      const mode = config.modes[modeName];
      const suffix = mode?.default === false ? " (manual)" : " (default)";
      process.stdout.write(`  - ${modeName}${suffix}\n`);
    }
    process.stdout.write(chalk.bold("\nSelected modes:\n"));
    for (const modeName of selectedModeLabels) {
      process.stdout.write(`  - ${modeName}\n`);
    }
    if (!modes.length && configuredModes.length) {
      process.stdout.write(chalk.bold("\nDefault-selected modes:\n"));
      if (defaultModes.length) {
        for (const modeName of defaultModes) {
          process.stdout.write(`  - ${modeName}\n`);
        }
      } else {
        process.stdout.write("  - default\n");
      }
      process.stdout.write("\n");
    }
  }
  if (!listFlags.list) return;
  const specFiles =
    command == "fuzz" ? [] : await resolveSelectedFiles(configPath, selectors);
  const fuzzFiles =
    command == "fuzz"
      ? await resolveSelectedFuzzFiles(configPath, selectors, modes)
      : command == "test" && fuzzEnabled
        ? await resolveSelectedFuzzFiles(configPath, selectors, modes)
        : [];
  const files = command == "fuzz" ? fuzzFiles : specFiles;
  if (!specFiles.length && !fuzzFiles.length) {
    const scope =
      selectors.length > 0 ? selectors.join(", ") : "configured input patterns";
    throw new Error(
      command == "fuzz"
        ? `No fuzz files matched: ${scope}`
        : `No test files matched: ${scope}`,
    );
  }
  const inputPatterns = await loadInputPatterns(configPath);
  const fuzzInputPatterns = await loadFuzzInputPatterns(configPath);
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
    process.stdout.write(
      `  target: ${command == "fuzz" ? "bindings" : active.buildOptions.target}\n`,
    );
    process.stdout.write(`  outDir: ${active.outDir}\n`);
    if (command == "run" || command == "test") {
      process.stdout.write(`  runtime: ${active.runOptions.runtime.cmd}\n`);
      if (usesWebBrowser(active)) {
        process.stdout.write(
          `  browser: ${active.runOptions.runtime.browser || "(auto)"}\n`,
        );
      }
    }
    const envOverrides = {
      ...active.env,
      ...(command == "build"
        ? active.buildOptions.env
        : command == "run" || command == "test"
          ? active.runOptions.env
          : {}),
    };
    const envKeys = Object.keys(envOverrides);
    process.stdout.write(
      `  env overrides: ${envKeys.length}${envKeys.length ? ` (${envKeys.join(", ")})` : ""}\n`,
    );
    if (specFiles.length) {
      process.stdout.write("  artifacts:\n");
      for (const file of specFiles) {
        const artifactName = resolveArtifactPath(file, inputPatterns);
        process.stdout.write(
          `    - ${path.join(active.outDir, artifactName)}\n`,
        );
      }
    }
    if (fuzzFiles.length && command == "test") {
      process.stdout.write("  fuzz artifacts:\n");
      for (const file of fuzzFiles) {
        const artifactName = resolveArtifactPath(file, fuzzInputPatterns);
        process.stdout.write(
          `    - ${path.join(active.outDir, artifactName)}\n`,
        );
      }
    } else if (command == "fuzz") {
      process.stdout.write("  artifacts:\n");
      for (const file of fuzzFiles) {
        const artifactName = resolveArtifactPath(file, fuzzInputPatterns);
        process.stdout.write(
          `    - ${path.join(active.outDir, artifactName)}\n`,
        );
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
  // run() rewrites the cumulative latest.log on every call and returns the
  // running total, so the result with the highest count is the most complete.
  let logSummary = { count: 0, file: null, groups: [], text: "" };
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
          } else if (point.executed) {
            existing.executed = true;
          }
        }
      } else {
        fallbackCoverageTotal += fileCoverage.total;
        fallbackCoverageCovered += fileCoverage.covered;
        fallbackCoverageUncovered += fileCoverage.uncovered;
        fallbackCoverageFiles.push(fileCoverage);
      }
    }
    reports.push(...result.reports);
    if (result.logSummary && result.logSummary.count >= logSummary.count) {
      logSummary = result.logSummary;
    }
  }
  // Per-mode breakdown: group results by modeName and deduplicate coverage points per mode.
  {
    const modePoints = new Map();
    for (const result of results) {
      const modeName = result.reports[0]?.modeName ?? "default";
      if (!modePoints.has(modeName)) modePoints.set(modeName, new Map());
      const modeMap = modePoints.get(modeName);
      for (const fileCoverage of result.coverageSummary.files) {
        for (const point of fileCoverage.points) {
          const key = `${point.file}::${point.hash}`;
          if (point.executed) {
            modeMap.set(key, true);
          } else if (!modeMap.has(key)) {
            modeMap.set(key, false);
          }
        }
      }
    }
    if (modePoints.size > 1) {
      const modeEntries = [...modePoints.entries()]
        .map(([name, modeMap]) => {
          let total = 0;
          let covered = 0;
          for (const executed of modeMap.values()) {
            total++;
            if (executed) covered++;
          }
          return total > 0
            ? { name, total, covered, percent: (covered * 100) / total }
            : null;
        })
        .filter((m) => m !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (modeEntries.length > 0) coverageSummary.byMode = modeEntries;
    }
  }
  if (uniqueCoveragePoints.size > 0) {
    const byFile = new Map();
    for (const point of uniqueCoveragePoints.values()) {
      if (!byFile.has(point.file)) byFile.set(point.file, []);
      byFile.get(point.file).push(point);
    }
    const sortedFiles = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      const points = byFile.get(file);
      points.sort((a, b) => {
        if (a.line !== b.line) return a.line - b.line;
        if (a.column !== b.column) return a.column - b.column;
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.hash.localeCompare(b.hash);
      });
      let covered = 0;
      for (const point of points) {
        coverageSummary.total++;
        if (point.executed) {
          coverageSummary.covered++;
          covered++;
        } else {
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
  } else {
    coverageSummary.total = fallbackCoverageTotal;
    coverageSummary.covered = fallbackCoverageCovered;
    coverageSummary.uncovered = fallbackCoverageUncovered;
    coverageSummary.files = fallbackCoverageFiles;
  }
  coverageSummary.percent = coverageSummary.total
    ? (coverageSummary.covered * 100) / coverageSummary.total
    : 100;
  return { stats, snapshotSummary, coverageSummary, reports, logSummary };
}
function printCliError(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
}
