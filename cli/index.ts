#!/usr/bin/env node

import chalk from "chalk";
import {
  build,
  BuildFeatureToggles,
  formatInvocation as formatBuildInvocation,
  getBuildInvocationPreview,
  getBuildReuseInfo,
} from "./commands/build.js";
import { createRunReporter, run, RunResult } from "./commands/run.js";
import { executeBuildCommand } from "./commands/build.js";
import { executeRunCommand } from "./commands/run.js";
import { executeTestCommand } from "./commands/test.js";
import { executeFuzzCommand } from "./commands/fuzz.js";
import { executeInitCommand } from "./commands/init.js";
import { executeDoctorCommand } from "./commands/doctor.js";
import { fuzz, FuzzOverrides } from "./commands/fuzz-core.js";
import {
  applyMode,
  formatTime,
  getCliVersion,
  loadConfig,
  resolveModeNames,
} from "./util.js";
import { Config } from "./types.js";
import * as path from "path";
import { spawnSync } from "child_process";
import { glob } from "glob";
import { createInterface } from "readline";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { availableParallelism, cpus } from "os";
import {
  CoverageSummary,
  FuzzCompleteEvent,
  FuzzResult,
  RunStats,
  TestReporter,
} from "./reporters/types.js";
import { BuildWorkerPool } from "./build-worker-pool.js";

const _args = process.argv.slice(2);
const flags: string[] = [];
const args: string[] = [];

const COMMANDS: string[] = ["run", "build", "test", "fuzz", "init", "doctor"];
type CliFeatureToggles = {
  coverage?: boolean;
  tryAs?: boolean;
};
type CliListFlags = {
  list: boolean;
  listModes: boolean;
};
type BuildReuseCache = Map<string, string>;

const version = getCliVersion();
const configPath = resolveConfigPath(_args);
const selectedModes = resolveModeNames(_args);

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
} else if (COMMANDS.includes(args[0]!)) {
  try {
    const command = args.shift();
    const normalizedCommand = command ?? "";
    if (shouldShowCommandHelp(_args, normalizedCommand)) {
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
        resolveListFlags,
        resolveFeatureToggles,
        resolveParallelJobs,
        resolveBrowserOverride,
        resolveReporterOverride,
        resolveExecutionModes,
        listExecutionPlan,
        runRuntimeModes,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "test") {
      executeTestCommand(_args, flags, configPath, selectedModes, {
        resolveCommandArgs,
        resolveListFlags,
        resolveFeatureToggles,
        resolveParallelJobs,
        resolveBrowserOverride,
        resolveReporterOverride,
        resolveFuzzOverrides,
        resolveExecutionModes,
        listExecutionPlan,
        runTestModes,
      }).catch((error) => {
        printCliError(error);
        process.exit(1);
      });
    } else if (command === "fuzz") {
      executeFuzzCommand(_args, configPath, selectedModes, {
        resolveCommandArgs,
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

function info(): void {
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
      "If this tool provides value, please consider sponsoring my open-source work! https://jairus.dev/sponsor",
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

function isHelpFlag(value: string): boolean {
  return value == "--help" || value == "-h";
}

function shouldShowCommandHelp(rawArgs: string[], command: string): boolean {
  if (!command.length) return false;
  const commandIndex = rawArgs.indexOf(command);
  if (commandIndex == -1) return false;
  for (let i = 0; i < rawArgs.length; i++) {
    if (i == commandIndex) continue;
    if (!isHelpFlag(rawArgs[i]!)) continue;
    return true;
  }
  return false;
}

function printCommandHelp(command: string): void {
  if (command == "build") {
    process.stdout.write(
      chalk.bold("Usage: ast build [selectors...] [flags]\n\n"),
    );
    process.stdout.write("Compile selected specs into wasm artifacts.\n\n");
    process.stdout.write(chalk.bold("Flags:\n"));
    process.stdout.write(
      "  --config <path>          Use a specific config file\n",
    );
    process.stdout.write(
      "  --mode <name[,name...]>  Run one or multiple named config modes\n",
    );
    process.stdout.write(
      "  --enable <feature>       Enable build feature (coverage|try-as)\n",
    );
    process.stdout.write(
      "  --disable <feature>      Disable build feature (coverage|try-as)\n",
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
      "  --show-coverage          Print uncovered coverage point details\n",
    );
    process.stdout.write(
      "  --enable <feature>       Enable feature (coverage|try-as)\n",
    );
    process.stdout.write(
      "  --disable <feature>      Disable feature (coverage|try-as)\n",
    );
    process.stdout.write(
      "  --reporter <name|path>   Use built-in reporter (default|tap) or custom module path\n",
    );
    process.stdout.write(
      "  --tap                    Shortcut for --reporter tap\n",
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
    process.stdout.write("  --help, -h               Show this help\n");
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
      "  --show-coverage          Print uncovered coverage point details\n",
    );
    process.stdout.write(
      "  --enable <feature>       Enable feature (coverage|try-as)\n",
    );
    process.stdout.write(
      "  --disable <feature>      Disable feature (coverage|try-as)\n",
    );
    process.stdout.write(
      "  --fuzz                   Run fuzz targets after the normal test pass\n",
    );
    process.stdout.write(
      "  --fuzz-runs <n>          Override fuzz iteration count for this run\n",
    );
    process.stdout.write(
      "  --fuzz-seed <n>          Override fuzz seed for this run\n",
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
      "  --reporter <name|path>   Use built-in reporter (default|tap) or custom module path\n",
    );
    process.stdout.write(
      "  --tap                    Shortcut for --reporter tap\n",
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
    process.stdout.write("  --help, -h               Show this help\n");
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
      "  --runs <n>               Override fuzz iteration count\n",
    );
    process.stdout.write("  --seed <n>               Override fuzz seed\n");
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

  info();
}

function resolveConfigPath(rawArgs: string[]): string | undefined {
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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

function resolveCommandArgs(rawArgs: string[], command: string): string[] {
  const values: string[] = [];
  let seenCommand = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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
    if (
      arg == "--runs" ||
      arg == "--seed" ||
      arg == "--jobs" ||
      arg == "--build-jobs" ||
      arg == "--run-jobs" ||
      arg == "--browser" ||
      arg == "--fuzz-runs" ||
      arg == "--fuzz-seed"
    ) {
      i++;
      continue;
    }
    if (arg == "--parallel") {
      continue;
    }
    if (
      arg.startsWith("--runs=") ||
      arg.startsWith("--seed=") ||
      arg.startsWith("--jobs=") ||
      arg.startsWith("--build-jobs=") ||
      arg.startsWith("--run-jobs=") ||
      arg.startsWith("--browser=") ||
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

function resolveFeatureToggles(
  rawArgs: string[],
  command: string,
): CliFeatureToggles {
  if (command !== "build" && command !== "run" && command !== "test") return {};

  const out: CliFeatureToggles = {};
  let seenCommand = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
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

function resolveFuzzOverrides(
  rawArgs: string[],
  command: "test" | "fuzz",
): FuzzOverrides {
  const out: FuzzOverrides = {};
  let seenCommand = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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
    const runs = parseNumberFlag(rawArgs, i, direct.runs);
    if (runs) {
      out.runs = runs.number;
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

function resolveListFlags(rawArgs: string[], command: string): CliListFlags {
  const out: CliListFlags = {
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
    const arg = rawArgs[i]!;
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--list") out.list = true;
    if (arg == "--list-modes") out.listModes = true;
  }
  return out;
}

function parseNumberFlag(
  rawArgs: string[],
  index: number,
  flag: string,
): { key: string; number: number; consumeNext: boolean } | null {
  const arg = rawArgs[index]!;
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

function parseStringFlag(
  rawArgs: string[],
  index: number,
  flag: string,
): { key: string; value: string; consumeNext: boolean } | null {
  const arg = rawArgs[index]!;
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

function resolveBrowserOverride(
  rawArgs: string[],
  command: "run" | "test",
): string | undefined {
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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

function resolveReporterOverride(
  rawArgs: string[],
  command: "run" | "test",
): string | undefined {
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    if (arg == "--reporter") {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("-")) {
        return next;
      }
      return undefined;
    }
    if (arg.startsWith("--reporter=")) {
      const value = arg.slice("--reporter=".length);
      return value.length ? value : undefined;
    }
    if (arg == "--tap") {
      return "tap";
    }
  }
  return undefined;
}

function resolveJobs(
  rawArgs: string[],
  command: "build" | "run" | "test" | "fuzz",
): number {
  let seenCommand = false;
  let parallel = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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

function resolveBuildParallelJobs(rawArgs: string[]): {
  jobs: number;
  buildJobs: number;
} {
  const baseJobs = resolveJobs(rawArgs, "build");
  let buildJobs = baseJobs;

  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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

function resolveParallelJobs(
  rawArgs: string[],
  command: "run" | "test",
): {
  jobs: number;
  buildJobs: number;
  runJobs: number;
} {
  const baseJobs = resolveJobs(rawArgs, command);
  let buildJobs = baseJobs;
  let runJobs = baseJobs;

  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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

function resolveFuzzParallelJobs(rawArgs: string[]): {
  jobs: number;
  buildJobs: number;
  runJobs: number;
} {
  const baseJobs = resolveJobs(rawArgs, "fuzz");
  let buildJobs = baseJobs;
  let runJobs = baseJobs;

  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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

function resolveEffectiveParallelJobs(
  settings: { jobs: number; buildJobs: number; runJobs: number },
  totalFiles: number,
): {
  jobs: number;
  buildJobs: number;
  runJobs: number;
} {
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

function resolveAutoJobs(totalFiles: number): number {
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

type BufferedStream = NodeJS.WritableStream & {
  isTTY?: boolean;
  read(): string;
};

function createBufferedStream(): BufferedStream {
  const chunks: string[] = [];
  return {
    isTTY: false,
    write(chunk: string | Uint8Array): boolean {
      chunks.push(
        typeof chunk == "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    },
    read(): string {
      return chunks.join("");
    },
  } as BufferedStream;
}

async function createBufferedReporter(
  configPath: string | undefined,
  reporterPath?: string,
  modeName?: string,
): Promise<{
  reporter: TestReporter;
  reporterKind: "default" | "tap" | "custom";
  runtimeName: string;
  output(): string;
}> {
  const stream = createBufferedStream();
  const session = await createRunReporter(configPath, reporterPath, modeName, {
    stdout: stream,
    stderr: stream,
  });
  return {
    reporter: session.reporter,
    reporterKind: session.reporterKind,
    runtimeName: session.runtimeName,
    output: () => stream.read(),
  };
}

async function runOrderedPool<T>(
  items: T[],
  jobs: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const width = Math.max(1, jobs);
  let nextIndex = 0;
  let firstError: unknown = null;

  async function runWorker(): Promise<void> {
    while (true) {
      if (firstError != null) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await worker(items[index]!, index);
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

function createAsyncLimiter(limit: number) {
  const width = Math.max(1, limit);
  let active = 0;
  const queue: Array<() => void> = [];

  return async function withLimit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= width) {
      await new Promise<void>((resolve) => queue.push(resolve));
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

function canRewriteParallelQueue(): boolean {
  return Boolean((process.stdout as { isTTY?: boolean }).isTTY);
}

class ParallelQueueDisplay {
  private readonly enabled: boolean;
  private readonly active = new Map<symbol, string>();
  private renderedLines = 0;

  constructor(private readonly showStartLines: boolean) {
    this.enabled = showStartLines && canRewriteParallelQueue();
  }

  start(file: string): symbol {
    const token = Symbol(file);
    if (!this.showStartLines) return token;
    const line = `${chalk.bgBlackBright.white(" .... ")} ${file}`;
    if (!this.enabled) return token;
    this.clear();
    this.active.set(token, line);
    this.render();
    return token;
  }

  complete(token: symbol, output: string): void {
    if (!this.showStartLines || !this.enabled) {
      process.stdout.write(output);
      return;
    }
    this.clear();
    process.stdout.write(output);
    this.active.delete(token);
    this.render();
  }

  flush(): void {
    if (!this.enabled) return;
    this.clear();
  }

  private clear(): void {
    if (!this.renderedLines) return;
    for (let i = 0; i < this.renderedLines; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < this.renderedLines - 1) process.stdout.write("\x1b[1A");
    }
    this.renderedLines = 0;
  }

  private render(): void {
    if (!this.enabled) return;
    const lines = Array.from(this.active.values());
    if (!lines.length) return;
    process.stdout.write(lines.join("\n"));
    this.renderedLines = lines.length;
  }
}

function renderQueuedFileStart(
  display: ParallelQueueDisplay,
  file: string,
): symbol {
  return display.start(file);
}

function parseIntegerFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return Math.floor(parsed);
}

function applyFeatureToggle(
  out: CliFeatureToggles,
  rawFeature: string,
  enabled: boolean,
): void {
  const key = rawFeature.trim().toLowerCase();
  if (key == "coverage") {
    out.coverage = enabled;
    return;
  }
  if (key == "try-as" || key == "try_as" || key == "tryas") {
    out.tryAs = enabled;
    return;
  }
  throw new Error(
    `unknown feature "${rawFeature}". Supported features: coverage, try-as`,
  );
}

function resolveCommandTokens(rawArgs: string[], command: string): string[] {
  const values: string[] = [];
  let seenCommand = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (!seenCommand) {
      if (arg == command) seenCommand = true;
      continue;
    }
    values.push(arg);
  }
  return values;
}

async function buildFileForMode(
  cache: BuildReuseCache,
  args: {
    configPath: string | undefined;
    file: string;
    modeName: string | undefined;
    buildFeatureToggles: BuildFeatureToggles;
    buildPool?: BuildWorkerPool;
  },
): Promise<boolean> {
  const reuse = await getBuildReuseInfo(
    args.configPath,
    args.file,
    args.modeName,
    args.buildFeatureToggles,
  );
  if (reuse) {
    const source = cache.get(reuse.signature);
    if (source && source != reuse.outFile && existsSync(source)) {
      mkdirSync(path.dirname(reuse.outFile), { recursive: true });
      copyFileSync(source, reuse.outFile);
      return true;
    }
  }

  if (args.buildPool) {
    await args.buildPool.buildFileMode({
      configPath: args.configPath,
      file: args.file,
      modeName: args.modeName,
      featureToggles: args.buildFeatureToggles,
    });
  } else {
    await build(
      args.configPath,
      [args.file],
      args.modeName,
      args.buildFeatureToggles,
    );
  }

  if (reuse) {
    cache.set(reuse.signature, reuse.outFile);
  }
  return false;
}

async function runTestSequential(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    coverage?: boolean;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  buildFeatureToggles: BuildFeatureToggles,
  modeSummaryTotal: number,
  fileSummaryTotal: number,
  allowNoSpecFiles: boolean = false,
  modeName?: string,
  reporterOverride?: TestReporter,
  emitRunComplete: boolean = true,
): Promise<{
  failed: boolean;
  summary: {
    buildTime: number;
    snapshotSummary: {
      matched: number;
      created: number;
      updated: number;
      failed: number;
    };
    coverageSummary: CoverageSummary;
    stats: RunStats;
    reports: unknown[];
  };
}> {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    if (!allowNoSpecFiles) {
      throw await buildNoTestFilesMatchedError(configPath, selectors);
    }
  }

  const reporterSession = await createRunReporter(
    configPath,
    runFlags.reporterPath,
    modeName,
  );
  const reporter = reporterOverride ?? reporterSession.reporter;
  const snapshotEnabled = runFlags.snapshot !== false;
  reporter.onRunStart?.({
    runtimeName: reporterSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });

  const results: RunResult[] = [];
  let failed = false;
  const buildIntervals: Array<{ start: number; end: number }> = [];
  const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
  for (const file of files) {
    const buildStartedAt = Date.now();
    await build(configPath, [file], modeName, buildFeatureToggles);
    buildIntervals.push({ start: buildStartedAt, end: Date.now() });
    const buildInvocation = await getBuildInvocationPreview(
      configPath,
      file,
      modeName,
      buildFeatureToggles,
    );
    const artifactKey = resolvePerFileArtifactKey(file, duplicateSpecBasenames);
    const result = await run(runFlags, configPath, [file], false, {
      reporter,
      emitRunStart: false,
      emitRunComplete: false,
      logFileName: `test.${artifactKey}.log.json`,
      coverageFileName: `coverage.${artifactKey}.log.json`,
      buildCommand: formatBuildInvocation(buildInvocation),
      modeName,
    });
    results.push(result);
    if (result?.failed) failed = true;
  }

  const summary = aggregateRunResults(results);
  summary.stats = applyConfiguredFileTotalToStats(
    summary.stats,
    fileSummaryTotal,
  );
  if (emitRunComplete) {
    reporter.onRunComplete?.({
      clean: runFlags.clean,
      snapshotEnabled,
      showCoverage: runFlags.showCoverage,
      buildTime: getMergedIntervalDuration(buildIntervals),
      snapshotSummary: summary.snapshotSummary,
      coverageSummary: summary.coverageSummary,
      stats: summary.stats,
      reports: summary.reports,
      modeSummary: buildSingleModeSummary(
        summary.stats,
        summary.snapshotSummary,
        modeSummaryTotal,
      ),
    });
    reporter.flush?.();
  }
  return {
    failed,
    summary: {
      buildTime: getMergedIntervalDuration(buildIntervals),
      snapshotSummary: summary.snapshotSummary,
      coverageSummary: summary.coverageSummary,
      stats: summary.stats,
      reports: summary.reports,
    },
  };
}

async function runBuildModes(
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  buildFeatureToggles: BuildFeatureToggles,
  parallel: {
    jobs: number;
    buildJobs: number;
  },
): Promise<void> {
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
  const buildReuseCache: BuildReuseCache = new Map();
  for (const modeName of modes) {
    const startedAt = Date.now();
    if (effective.buildJobs > 1) {
      const pool = new BuildWorkerPool(effective.buildJobs);
      try {
        await runOrderedPool(files, effective.buildJobs, async (file) => {
          await buildFileForMode(buildReuseCache, {
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
        await buildFileForMode(buildReuseCache, {
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
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    browser?: string;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
): Promise<void> {
  await ensureWebBrowsersReady(configPath, modes, runFlags.browser);
  const modeSummaryTotal = Math.max(modes.length, 1);
  const fileSummaryTotal = await resolveConfiguredFileTotal(configPath);
  const effectiveRunFlags = {
    ...runFlags,
    ...resolveEffectiveParallelJobs(runFlags, fileSummaryTotal),
  };
  if (effectiveRunFlags.jobs > 1) {
    if (modes.length > 1) {
      const failed = await runRuntimeMatrixParallel(
        effectiveRunFlags,
        configPath,
        selectors,
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
      reporterPath: effectiveRunFlags.reporterPath,
      modeName,
      modeSummaryTotal,
      modeSummaryExecuted: 1,
      fileSummaryTotal,
      buildCommandsByFile,
    });
    if (result.failed) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

async function runRuntimeMatrix(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  modeSummaryTotal: number,
  fileSummaryTotal: number,
): Promise<boolean> {
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
    createSnapshots: runFlags.createSnapshots,
  });

  const silentReporter: TestReporter = {};
  const allResults: RunResult[] = [];
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const liveMatrix =
    reporterSession.reporterKind == "default" && canRewriteStdout();
  const modeState = modes.map(() => ({
    failed: false,
    passed: false,
  }));
  const fileState = files.map(() => ({
    failed: false,
    passed: false,
  }));
  const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
  const buildIntervals: Array<{ start: number; end: number }> = [];
  const buildReuseCache: BuildReuseCache = new Map();

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]!;
    const fileName = path.basename(file);
    const fileResults: RunResult[] = [];
    const modeTimes = modes.map(() => "...");
    const buildReuseCache: BuildReuseCache = new Map();
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
        const artifactKey = resolvePerFileArtifactKey(
          file,
          duplicateSpecBasenames,
        );
        const result = await run(runFlags, configPath, [file], false, {
          reporter: silentReporter,
          reporterKind: "default",
          emitRunStart: false,
          emitRunComplete: false,
          logFileName: `run.${artifactKey}.log.json`,
          coverageFileName: `coverage.${artifactKey}.log.json`,
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
          modeState[i]!.failed = true;
        } else if (result.stats.passedFiles > 0) {
          modeState[i]!.passed = true;
        }
        fileResults.push(result);
        allResults.push(result);
      } catch (error) {
        clearLiveLine();
        throw error;
      }
    }
    if (reporterSession.reporterKind == "default") {
      renderMatrixFileResult(
        fileName,
        modeLabels,
        fileResults,
        modeTimes,
        liveMatrix,
        showPerModeTimes,
      );
    }
    const verdict = resolveMatrixVerdict(fileResults);
    if (verdict == "fail") {
      fileState[fileIndex]!.failed = true;
    } else if (verdict == "ok") {
      fileState[fileIndex]!.passed = true;
    }
  }

  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  reporter.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    buildTime: 0,
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  return allResults.some((result) => result.failed);
}

async function runTestModes(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    browser?: string;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  buildFeatureToggles: BuildFeatureToggles,
  fuzzEnabled: boolean,
  fuzzOverrides: FuzzOverrides,
): Promise<void> {
  await ensureWebBrowsersReady(configPath, modes, runFlags.browser);
  const modeSummaryTotal = Math.max(modes.length, 1);
  const fileSummaryTotal = await resolveConfiguredFileTotal(
    configPath,
    selectors,
  );
  const effectiveRunFlags = {
    ...runFlags,
    ...resolveEffectiveParallelJobs(runFlags, fileSummaryTotal),
  };
  if (effectiveRunFlags.jobs > 1) {
    if (modes.length > 1) {
      const failed = await runTestMatrixParallel(
        effectiveRunFlags,
        configPath,
        selectors,
        modes,
        buildFeatureToggles,
        modeSummaryTotal,
        fileSummaryTotal,
        fuzzEnabled,
        fuzzOverrides,
      );
      process.exit(failed ? 1 : 0);
      return;
    }
    let failed = false;
    for (const modeName of modes) {
      const modeFailed = await runTestSingleParallel(
        effectiveRunFlags,
        configPath,
        selectors,
        buildFeatureToggles,
        modeSummaryTotal,
        fileSummaryTotal,
        fuzzEnabled,
        fuzzOverrides,
        modeName,
      );
      if (modeFailed) failed = true;
    }
    process.exit(failed ? 1 : 0);
    return;
  }
  if (modes.length > 1) {
    const failed = await runTestMatrix(
      effectiveRunFlags,
      configPath,
      selectors,
      modes,
      buildFeatureToggles,
      modeSummaryTotal,
      fileSummaryTotal,
      fuzzEnabled,
      fuzzOverrides,
    );
    process.exit(failed ? 1 : 0);
    return;
  }

  let failed = false;
  for (const modeName of modes) {
    const reporterSession = await createRunReporter(
      configPath,
      effectiveRunFlags.reporterPath,
      modeName,
    );
    const modeResult = await runTestSequential(
      effectiveRunFlags,
      configPath,
      selectors,
      buildFeatureToggles,
      modeSummaryTotal,
      fileSummaryTotal,
      fuzzEnabled,
      modeName,
      reporterSession.reporter,
      !fuzzEnabled,
    );
    if (modeResult.failed) failed = true;
    if (fuzzEnabled) {
      if (reporterSession.reporterKind == "default") {
        process.stdout.write("\n");
      }
      const fuzzResults = await runFuzzMatrixResults(
        configPath,
        selectors,
        [modeName],
        fuzzOverrides,
        reporterSession.reporter,
      );
      if (fuzzResults.some(hasFuzzFailures)) failed = true;
      reporterSession.reporter.onRunComplete?.({
        clean: runFlags.clean,
        snapshotEnabled: effectiveRunFlags.snapshot !== false,
        showCoverage: effectiveRunFlags.showCoverage,
        buildTime:
          modeResult.summary.buildTime +
          getMergedIntervalDuration(collectFuzzBuildIntervals(fuzzResults)),
        snapshotSummary: modeResult.summary.snapshotSummary,
        coverageSummary: modeResult.summary.coverageSummary,
        stats: modeResult.summary.stats,
        reports: modeResult.summary.reports,
        fuzzSummary: summarizeFuzzExecutions(fuzzResults),
        modeSummary: buildSingleModeSummary(
          modeResult.summary.stats,
          modeResult.summary.snapshotSummary,
          modeSummaryTotal,
        ),
      });
      reporterSession.reporter.flush?.();
    }
  }
  process.exit(failed ? 1 : 0);
}

async function runTestMatrix(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  buildFeatureToggles: BuildFeatureToggles,
  modeSummaryTotal: number,
  fileSummaryTotal: number,
  fuzzEnabled: boolean,
  fuzzOverrides: FuzzOverrides,
): Promise<boolean> {
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
    createSnapshots: runFlags.createSnapshots,
  });

  const silentReporter: TestReporter = {};
  const allResults: RunResult[] = [];
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const liveMatrix =
    reporterSession.reporterKind == "default" && canRewriteStdout();
  const modeState = modes.map(() => ({
    failed: false,
    passed: false,
  }));
  const fileState = files.map(() => ({
    failed: false,
    passed: false,
  }));
  const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
  const buildIntervals: Array<{ start: number; end: number }> = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]!;
    const fileName = path.basename(file);
    const fileResults: RunResult[] = [];
    const modeTimes = modes.map(() => "...");
    const buildReuseCache: BuildReuseCache = new Map();
    if (liveMatrix) {
      renderMatrixLiveLine(fileName, modeLabels, modeTimes, showPerModeTimes);
    }
    for (let i = 0; i < modes.length; i++) {
      const modeName = modes[i];
      try {
        const buildStartedAt = Date.now();
        await buildFileForMode(buildReuseCache, {
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
        const artifactKey = resolvePerFileArtifactKey(
          file,
          duplicateSpecBasenames,
        );
        const result = await run(runFlags, configPath, [file], false, {
          reporter: silentReporter,
          reporterKind: "default",
          emitRunStart: false,
          emitRunComplete: false,
          logFileName: `test.${artifactKey}.log.json`,
          coverageFileName: `coverage.${artifactKey}.log.json`,
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
          modeState[i]!.failed = true;
        } else if (result.stats.passedFiles > 0) {
          modeState[i]!.passed = true;
        }
        fileResults.push(result);
        allResults.push(result);
      } catch (error) {
        clearLiveLine();
        throw error;
      }
    }
    if (reporterSession.reporterKind == "default") {
      renderMatrixFileResult(
        fileName,
        modeLabels,
        fileResults,
        modeTimes,
        liveMatrix,
        showPerModeTimes,
      );
    }
    const verdict = resolveMatrixVerdict(fileResults);
    if (verdict == "fail") {
      fileState[fileIndex]!.failed = true;
    } else if (verdict == "ok") {
      fileState[fileIndex]!.passed = true;
    }
  }

  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  let failed = allResults.some((result) => result.failed);
  let fuzzSummary:
    | {
        failed: number;
        skipped: number;
        total: number;
      }
    | undefined;
  if (fuzzEnabled) {
    if (reporterSession.reporterKind == "default") {
      process.stdout.write("\n");
    }
    const fuzzResults = await runFuzzMatrixResults(
      configPath,
      selectors,
      modes,
      fuzzOverrides,
      reporter,
    );
    if (fuzzResults.some(hasFuzzFailures)) failed = true;
    fuzzSummary = summarizeFuzzExecutions(fuzzResults);
    buildIntervals.push(...collectFuzzBuildIntervals(fuzzResults));
  }
  reporter.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    fuzzSummary,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  reporter.flush?.();
  return failed;
}

async function runFuzzModes(
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  rawArgs: string[],
): Promise<void> {
  const overrides = resolveFuzzOverrides(rawArgs, "fuzz");
  const parallelSettings = resolveFuzzParallelJobs(rawArgs);
  const clean = rawArgs.includes("--clean");
  const fuzzFiles = await resolveSelectedFuzzFiles(configPath, selectors);
  const { jobs, buildJobs, runJobs } = resolveEffectiveParallelJobs(
    parallelSettings,
    fuzzFiles.length,
  );
  if (jobs > 1) {
    const results = await runFuzzMatrixResultsParallel(
      configPath,
      selectors,
      modes,
      overrides,
      jobs,
      buildJobs,
      runJobs,
      clean,
    );
    const reporterSession = await createRunReporter(configPath);
    reporterSession.reporter.onFuzzComplete?.(
      buildFuzzCompleteEvent(results, modes),
    );
    reporterSession.reporter.flush?.();
    process.exit(results.some(hasFuzzFailures) ? 1 : 0);
    return;
  }
  const reporterSession = await createRunReporter(configPath);
  const results = await runFuzzMatrixResults(
    configPath,
    selectors,
    modes,
    overrides,
    reporterSession.reporter,
  );
  reporterSession.reporter.onFuzzComplete?.(
    buildFuzzCompleteEvent(results, modes),
  );
  reporterSession.reporter.flush?.();
  process.exit(results.some(hasFuzzFailures) ? 1 : 0);
}

async function runRuntimeSingleParallel(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    browser?: string;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modeName: string | undefined,
  modeSummaryTotal: number,
  fileSummaryTotal: number,
): Promise<boolean> {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const reporterSession = await createRunReporter(
    configPath,
    runFlags.reporterPath,
    modeName,
  );
  const reporter = reporterSession.reporter;
  const snapshotEnabled = runFlags.snapshot !== false;
  reporter.onRunStart?.({
    runtimeName: reporterSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const buildCommandsByFile = await previewBuildCommands(
    configPath,
    selectors,
    modeName,
    {},
  );
  const results = new Array<RunResult>(files.length);
  const useQueueDisplay = reporterSession.reporterKind == "default";
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const runLimit = createAsyncLimiter(runFlags.runJobs);
  const poolWidth = Math.max(runFlags.buildJobs, runFlags.runJobs);
  await runOrderedPool(files, poolWidth, async (file, index) => {
    const token = useQueueDisplay
      ? renderQueuedFileStart(queueDisplay, path.basename(file))
      : null;
    const buffered = useQueueDisplay
      ? await createBufferedReporter(
          configPath,
          runFlags.reporterPath,
          modeName,
        )
      : null;
    const result = await runLimit(() =>
      run({ ...runFlags, clean: true }, configPath, [file], false, {
        reporter: buffered?.reporter,
        reporterKind: buffered?.reporterKind,
        modeName,
        emitRunComplete: false,
        fileSummaryTotal: 1,
        modeSummaryTotal,
        modeSummaryExecuted: 1,
        buildCommandsByFile: { [file]: buildCommandsByFile[file] ?? "" },
      }),
    );
    buffered?.reporter.flush?.();
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
  reporter.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    buildTime: 0,
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    modeSummary: buildSingleModeSummary(
      summary.stats,
      summary.snapshotSummary,
      modeSummaryTotal,
    ),
  });
  reporter.flush?.();
  return results.some((result) => result.failed);
}

async function runRuntimeMatrixParallel(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  modeSummaryTotal: number,
  fileSummaryTotal: number,
): Promise<boolean> {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const reporterSession = await createRunReporter(
    configPath,
    runFlags.reporterPath,
  );
  const reporter = reporterSession.reporter;
  const snapshotEnabled = runFlags.snapshot !== false;
  reporter.onRunStart?.({
    runtimeName: reporterSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const silentReporter: TestReporter = {};
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
  const ordered = new Array<{
    fileName: string;
    fileResults: RunResult[];
    modeTimes: string[];
  }>(files.length);
  const useQueueDisplay = reporterSession.reporterKind == "default";
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const poolWidth = Math.max(
    runFlags.jobs,
    runFlags.buildJobs,
    runFlags.runJobs,
  );
  const buildPool = new BuildWorkerPool(runFlags.buildJobs);
  const buildIntervals: Array<{ start: number; end: number }> = [];
  try {
    await runOrderedPool(files, poolWidth, async (file, fileIndex) => {
      const fileName = path.basename(file);
      const token = useQueueDisplay
        ? renderQueuedFileStart(queueDisplay, fileName)
        : null;
      const fileResults: RunResult[] = [];
      const modeTimes = modes.map(() => "...");
      const buildReuseCache: BuildReuseCache = new Map();
      for (let i = 0; i < modes.length; i++) {
        const modeName = modes[i];
        const buildStartedAt = Date.now();
        await buildFileForMode(buildReuseCache, {
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
        const artifactKey = resolvePerFileArtifactKey(
          file,
          duplicateSpecBasenames,
        );
        const result = await run(runFlags, configPath, [file], false, {
          reporter: silentReporter,
          reporterKind: "default",
          emitRunStart: false,
          emitRunComplete: false,
          logFileName: `run.${artifactKey}.log.json`,
          coverageFileName: `coverage.${artifactKey}.log.json`,
          buildCommand: formatBuildInvocation(buildInvocation),
          modeName,
        });
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
  const allResults: RunResult[] = [];
  const modeState = modes.map(() => ({ failed: false, passed: false }));
  const fileState = files.map(() => ({ failed: false, passed: false }));
  for (let fileIndex = 0; fileIndex < ordered.length; fileIndex++) {
    const fileResults = ordered[fileIndex]!.fileResults;
    for (let i = 0; i < fileResults.length; i++) {
      const result = fileResults[i]!;
      allResults.push(result);
      if (result.failed) modeState[i]!.failed = true;
      else if (result.stats.passedFiles > 0) modeState[i]!.passed = true;
    }
    const verdict = resolveMatrixVerdict(fileResults);
    if (verdict == "fail") fileState[fileIndex]!.failed = true;
    else if (verdict == "ok") fileState[fileIndex]!.passed = true;
  }
  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  reporter.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  reporter.flush?.();
  return allResults.some((result) => result.failed);
}

async function runTestSingleParallel(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    browser?: string;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  buildFeatureToggles: BuildFeatureToggles,
  modeSummaryTotal: number,
  fileSummaryTotal: number,
  fuzzEnabled: boolean,
  fuzzOverrides: FuzzOverrides,
  modeName?: string,
): Promise<boolean> {
  const files = await resolveSelectedFiles(configPath, selectors);
  if (!files.length && !fuzzEnabled) {
    throw await buildNoTestFilesMatchedError(configPath, selectors);
  }
  const reporterSession = await createRunReporter(
    configPath,
    runFlags.reporterPath,
    modeName,
  );
  const reporter = reporterSession.reporter;
  const snapshotEnabled = runFlags.snapshot !== false;
  reporter.onRunStart?.({
    runtimeName: reporterSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
  const results = new Array<RunResult>(files.length);
  const useQueueDisplay = reporterSession.reporterKind == "default";
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const poolWidth = Math.max(
    runFlags.jobs,
    runFlags.buildJobs,
    runFlags.runJobs,
  );
  const buildIntervals: Array<{ start: number; end: number }> = [];
  if (files.length) {
    const buildPool = new BuildWorkerPool(runFlags.buildJobs);
    try {
      await runOrderedPool(files, poolWidth, async (file, index) => {
        const token = useQueueDisplay
          ? renderQueuedFileStart(queueDisplay, path.basename(file))
          : null;
        const buildStartedAt = Date.now();
        await buildFileForMode(new Map(), {
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
        const artifactKey = resolvePerFileArtifactKey(
          file,
          duplicateSpecBasenames,
        );
        const buffered = useQueueDisplay
          ? await createBufferedReporter(
              configPath,
              runFlags.reporterPath,
              modeName,
            )
          : null;
        const result = await run(
          { ...runFlags, clean: true },
          configPath,
          [file],
          false,
          {
            reporter: buffered?.reporter,
            reporterKind: buffered?.reporterKind,
            emitRunComplete: false,
            logFileName: `test.${artifactKey}.log.json`,
            coverageFileName: `coverage.${artifactKey}.log.json`,
            buildCommand: formatBuildInvocation(buildInvocation),
            modeName,
          },
        );
        buffered?.reporter.flush?.();
        results[index] = result;
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
  let fuzzSummary:
    | {
        failed: number;
        skipped: number;
        total: number;
      }
    | undefined;
  if (fuzzEnabled) {
    if (reporterSession.reporterKind == "default") {
      process.stdout.write("\n");
    }
    const fuzzResults = await runFuzzMatrixResultsParallel(
      configPath,
      selectors,
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
  reporter.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    fuzzSummary,
    modeSummary: buildSingleModeSummary(
      summary.stats,
      summary.snapshotSummary,
      modeSummaryTotal,
    ),
  });
  reporter.flush?.();
  return failed;
}

async function runTestMatrixParallel(
  runFlags: {
    snapshot: boolean;
    createSnapshots: boolean;
    overwriteSnapshots: boolean;
    clean: boolean;
    showCoverage: boolean;
    verbose: boolean;
    jobs: number;
    buildJobs: number;
    runJobs: number;
    coverage?: boolean;
    reporterPath?: string;
  },
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  buildFeatureToggles: BuildFeatureToggles,
  modeSummaryTotal: number,
  fileSummaryTotal: number,
  fuzzEnabled: boolean,
  fuzzOverrides: FuzzOverrides,
): Promise<boolean> {
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
  const reporterSession = await createRunReporter(
    configPath,
    runFlags.reporterPath,
  );
  const reporter = reporterSession.reporter;
  const snapshotEnabled = runFlags.snapshot !== false;
  reporter.onRunStart?.({
    runtimeName: reporterSession.runtimeName,
    clean: runFlags.clean,
    verbose: runFlags.verbose,
    snapshotEnabled,
    createSnapshots: runFlags.createSnapshots,
  });
  const silentReporter: TestReporter = {};
  const modeLabels = modes.map((modeName) => modeName ?? "default");
  const showPerModeTimes = Boolean(runFlags.verbose);
  const duplicateSpecBasenames = resolveDuplicateSpecBasenames(files);
  const ordered = new Array<{
    fileName: string;
    fileResults: RunResult[];
    modeTimes: string[];
  }>(files.length);
  const useQueueDisplay = reporterSession.reporterKind == "default";
  const queueDisplay = new ParallelQueueDisplay(
    useQueueDisplay && !runFlags.clean,
  );
  const poolWidth = Math.max(
    runFlags.jobs,
    runFlags.buildJobs,
    runFlags.runJobs,
  );
  const buildPool = new BuildWorkerPool(runFlags.buildJobs);
  const buildIntervals: Array<{ start: number; end: number }> = [];
  try {
    await runOrderedPool(files, poolWidth, async (file, fileIndex) => {
      const fileName = path.basename(file);
      const token = useQueueDisplay
        ? renderQueuedFileStart(queueDisplay, fileName)
        : null;
      const fileResults: RunResult[] = [];
      const modeTimes = modes.map(() => "...");
      const buildReuseCache: BuildReuseCache = new Map();
      for (let i = 0; i < modes.length; i++) {
        const modeName = modes[i];
        const buildStartedAt = Date.now();
        await buildFileForMode(buildReuseCache, {
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
        const artifactKey = resolvePerFileArtifactKey(
          file,
          duplicateSpecBasenames,
        );
        const result = await run(runFlags, configPath, [file], false, {
          reporter: silentReporter,
          reporterKind: "default",
          emitRunStart: false,
          emitRunComplete: false,
          logFileName: `test.${artifactKey}.log.json`,
          coverageFileName: `coverage.${artifactKey}.log.json`,
          buildCommand: formatBuildInvocation(buildInvocation),
          modeName,
        });
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
  const allResults: RunResult[] = [];
  const modeState = modes.map(() => ({ failed: false, passed: false }));
  const fileState = files.map(() => ({ failed: false, passed: false }));
  for (let fileIndex = 0; fileIndex < ordered.length; fileIndex++) {
    const entry = ordered[fileIndex]!;
    for (let i = 0; i < entry.fileResults.length; i++) {
      const result = entry.fileResults[i]!;
      allResults.push(result);
      if (result.failed) modeState[i]!.failed = true;
      else if (result.stats.passedFiles > 0) modeState[i]!.passed = true;
    }
    const verdict = resolveMatrixVerdict(entry.fileResults);
    if (verdict == "fail") fileState[fileIndex]!.failed = true;
    else if (verdict == "ok") fileState[fileIndex]!.passed = true;
  }
  const summary = aggregateRunResults(allResults);
  summary.stats = applyMatrixFileSummaryToStats(
    summary.stats,
    fileState,
    fileSummaryTotal,
  );
  let failed = allResults.some((result) => result.failed);
  let fuzzSummary:
    | {
        failed: number;
        skipped: number;
        total: number;
      }
    | undefined;
  if (fuzzEnabled) {
    if (reporterSession.reporterKind == "default") {
      process.stdout.write("\n");
    }
    const fuzzResults = await runFuzzMatrixResultsParallel(
      configPath,
      selectors,
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
  reporter.onRunComplete?.({
    clean: runFlags.clean,
    snapshotEnabled,
    showCoverage: runFlags.showCoverage,
    buildTime: getMergedIntervalDuration(buildIntervals),
    snapshotSummary: summary.snapshotSummary,
    coverageSummary: summary.coverageSummary,
    stats: summary.stats,
    reports: summary.reports,
    fuzzSummary,
    modeSummary: buildModeSummary(modeState, modeSummaryTotal),
  });
  reporter.flush?.();
  return failed;
}

async function runFuzzMatrixResultsParallel(
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  overrides: FuzzOverrides,
  jobs: number,
  buildJobs: number,
  runJobs: number,
  clean: boolean,
): Promise<FuzzResult[]> {
  const files = await resolveSelectedFuzzFiles(configPath, selectors);
  if (!files.length) {
    throw new Error(
      `No fuzz files matched: ${selectors.length ? selectors.join(", ") : "configured input patterns"}`,
    );
  }
  const ordered = new Array<FuzzResult[]>(files.length);
  const queueDisplay = new ParallelQueueDisplay(!clean);
  const poolWidth = Math.max(jobs, buildJobs, runJobs);
  await runOrderedPool(files, poolWidth, async (file, index) => {
    const token = renderQueuedFileStart(queueDisplay, path.basename(file));
    const fileResults: FuzzResult[] = [];
    for (const modeName of modes) {
      const modeResults = await fuzz(configPath, [file], modeName, overrides);
      fileResults.push(...modeResults);
    }
    ordered[index] = fileResults;
    const buffered = await createBufferedReporter(configPath);
    buffered.reporter.onFuzzFileComplete?.({ file, results: fileResults });
    buffered.reporter.flush?.();
    queueDisplay.complete(token, buffered.output());
  });
  queueDisplay.flush();
  return ordered.flat();
}

async function runFuzzMatrixResults(
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  overrides: FuzzOverrides,
  reporter?: TestReporter,
): Promise<FuzzResult[]> {
  const files = await resolveSelectedFuzzFiles(configPath, selectors);
  if (!files.length) {
    throw new Error(
      `No fuzz files matched: ${selectors.length ? selectors.join(", ") : "configured input patterns"}`,
    );
  }
  const results: FuzzResult[] = [];
  for (const file of files) {
    const fileResults: FuzzResult[] = [];
    for (const modeName of modes) {
      const modeResults = await fuzz(configPath, [file], modeName, overrides);
      fileResults.push(...modeResults);
      results.push(...modeResults);
    }
    reporter?.onFuzzFileComplete?.({ file, results: fileResults });
  }
  return results;
}

function hasFuzzFailures(result: FuzzResult): boolean {
  if (result.crashes > 0) return true;
  return result.fuzzers.some((fuzzer) => fuzzer.failed > 0);
}

function buildFuzzCompleteEvent(
  results: FuzzResult[],
  modes: (string | undefined)[],
): FuzzCompleteEvent {
  return {
    results,
    time: results.reduce((sum, item) => sum + item.time, 0),
    buildTime: getMergedIntervalDuration(collectFuzzBuildIntervals(results)),
    fuzzingSummary: summarizeFuzzExecutions(results),
    suiteSummary: summarizeFuzzSuites(results),
    modeSummary: summarizeFuzzModes(results, modes),
  };
}

function collectFuzzBuildIntervals(
  results: FuzzResult[],
): Array<{ start: number; end: number }> {
  return results.map((result) => ({
    start: result.buildStartedAt,
    end: result.buildFinishedAt,
  }));
}

function getMergedIntervalDuration(
  intervals: Array<{ start: number; end: number }>,
): number {
  if (!intervals.length) return 0;
  const sorted = intervals
    .map((interval) => ({
      start: Math.min(interval.start, interval.end),
      end: Math.max(interval.start, interval.end),
    }))
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let currentStart = sorted[0]!.start;
  let currentEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const interval = sorted[i]!;
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

function summarizeFuzzExecutions(results: FuzzResult[]): {
  failed: number;
  skipped: number;
  total: number;
} {
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

function summarizeFuzzSuites(results: FuzzResult[]): {
  failed: number;
  skipped: number;
  total: number;
} {
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

function summarizeFuzzModes(
  results: FuzzResult[],
  modes: (string | undefined)[],
): {
  failed: number;
  skipped: number;
  total: number;
} {
  const total = Math.max(modes.length, 1);
  const state = new Map<string, { failed: boolean; passed: boolean }>();
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

function isSkippedFuzzResult(result: FuzzResult): boolean {
  return (
    result.crashes == 0 &&
    result.fuzzers.length > 0 &&
    result.fuzzers.every((fuzzer) => fuzzer.skipped > 0)
  );
}

function renderMatrixFileResult(
  file: string,
  modes: string[],
  results: RunResult[],
  modeTimes: string[],
  liveMatrix: boolean,
  showPerModeTimes: boolean,
): void {
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
  file: string,
  modes: string[],
  results: RunResult[],
  modeTimes: string[],
  showPerModeTimes: boolean,
): string {
  const verdict = resolveMatrixVerdict(results);
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
    .filter((mode): mode is string => Boolean(mode));
  const suffix = showPerModeTimes
    ? ` ${chalk.dim(`(${modes.join(",")})`)}`
    : failedModes.length
      ? ` ${chalk.dim(`(failed: ${failedModes.join(", ")})`)}`
      : "";
  return `${badge} ${file} ${chalk.dim(timingText)}${suffix}`;
}

function resolveMatrixVerdict(results: RunResult[]): "fail" | "ok" | "skip" {
  if (results.some((result) => result.failed)) return "fail";
  const hasPass = results.some((result) => result.stats.passedFiles > 0);
  if (hasPass) return "ok";
  return "skip";
}

function canRewriteStdout(): boolean {
  return Boolean((process.stdout as { isTTY?: boolean }).isTTY);
}

function clearLiveLine(): void {
  if (!canRewriteStdout()) return;
  process.stdout.write("\r\x1b[2K");
}

function renderMatrixLiveLine(
  file: string,
  modes: string[],
  modeTimes: string[],
  showPerModeTimes: boolean,
): void {
  if (!canRewriteStdout()) return;
  const timingText = showPerModeTimes ? modeTimes.join(",") : "...";
  const suffix = showPerModeTimes
    ? ` ${chalk.dim(`(${modes.join(",")})`)}`
    : "";
  const line = `${chalk.bgBlackBright.white(" .... ")} ${file} ${chalk.dim(timingText)}${suffix}`;
  process.stdout.write(`\r\x1b[2K${line}`);
}

function formatMatrixModeTime(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return `${safeMs.toFixed(1)}ms`;
}

function formatMatrixAverageTime(results: RunResult[]): string {
  if (!results.length) return "0.0ms";
  let total = 0;
  for (const result of results) {
    total += Number.isFinite(result.stats.time)
      ? Math.max(0, result.stats.time)
      : 0;
  }
  return `${(total / results.length).toFixed(1)}ms`;
}

function buildModeSummary(
  modeState: {
    failed: boolean;
    passed: boolean;
  }[],
  totalModes: number,
): {
  failed: number;
  skipped: number;
  total: number;
} {
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

function buildSingleModeSummary(
  stats: RunStats,
  snapshotSummary: { failed: number },
  totalModes: number,
): {
  failed: number;
  skipped: number;
  total: number;
} {
  const total = Math.max(totalModes, 1);
  const failed = stats.failedFiles > 0 || snapshotSummary.failed > 0 ? 1 : 0;
  const skippedInExecuted = failed ? 0 : stats.passedFiles > 0 ? 0 : 1;
  return {
    failed,
    skipped: Math.max(0, total - 1) + skippedInExecuted,
    total,
  };
}

function applyConfiguredFileTotalToStats(
  stats: RunStats,
  fileSummaryTotal: number,
): RunStats {
  const total = Math.max(fileSummaryTotal, 0);
  const executed = stats.failedFiles + stats.passedFiles + stats.skippedFiles;
  const unexecuted = Math.max(0, total - executed);
  return {
    ...stats,
    skippedFiles: stats.skippedFiles + unexecuted,
  };
}

function applyMatrixFileSummaryToStats(
  stats: RunStats,
  fileState: {
    failed: boolean;
    passed: boolean;
  }[],
  fileSummaryTotal: number,
): RunStats {
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

function resolveConfiguredModeTotal(configPath: string | undefined): number {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, false);
  const configuredModes = Object.keys(config.modes).length;
  return configuredModes || 1;
}

async function resolveConfiguredFileTotal(
  configPath: string | undefined,
  selectors: string[] = [],
): Promise<number> {
  const files = await resolveSelectedFiles(configPath, selectors);
  return files.length;
}

async function previewBuildCommands(
  configPath: string | undefined,
  selectors: string[],
  modeName: string | undefined,
  featureToggles: BuildFeatureToggles,
): Promise<Record<string, string>> {
  const files = await resolveSelectedFiles(configPath, selectors);
  const out: Record<string, string> = {};
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

function resolveExecutionModes(
  configPath: string | undefined,
  selectedModes: string[],
): (string | undefined)[] {
  if (selectedModes.length) return selectedModes;
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, false);
  const configuredModes = Object.keys(config.modes);
  if (!configuredModes.length) return [undefined];
  return configuredModes;
}

async function resolveSelectedFiles(
  configPath: string | undefined,
  selectors: string[],
  warn: boolean = true,
): Promise<string[]> {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, warn);
  const patterns = resolveInputPatterns(config.input, selectors);
  const matches = await glob(patterns);
  const specs = matches.filter((file) => file.endsWith(".spec.ts"));
  return [...new Set(specs)].sort((a, b) => a.localeCompare(b));
}

async function resolveSelectedFuzzFiles(
  configPath: string | undefined,
  selectors: string[],
): Promise<string[]> {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, false);
  const patterns = resolveFuzzPatterns(config.fuzz.input, selectors);
  const matches = await glob(patterns);
  const fuzzFiles = matches.filter((file) => file.endsWith(".fuzz.ts"));
  return [...new Set(fuzzFiles)].sort((a, b) => a.localeCompare(b));
}

async function resolveSelectedTestInputs(
  configPath: string | undefined,
  selectors: string[],
): Promise<{
  specs: string[];
  fuzz: string[];
}> {
  const [specs, fuzz] = await Promise.all([
    resolveSelectedFiles(configPath, selectors),
    resolveSelectedFuzzFiles(configPath, selectors),
  ]);
  return { specs, fuzz };
}

async function buildNoTestFilesMatchedError(
  configPath: string | undefined,
  selectors: string[],
  includeFuzz: boolean = false,
): Promise<Error> {
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
      .map((file) => path.basename(file))
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

function suggestClosestSuites(selectors: string[], files: string[]): string[] {
  const suites = [
    ...new Set(files.map((file) => stripSuiteSuffix(path.basename(file)))),
  ];
  if (!suites.length) return [];
  const out = new Set<string>();
  for (const selector of expandSelectors(selectors)) {
    if (!isBareSuiteSelector(selector)) continue;
    const query = stripSuiteSuffix(path.basename(selector));
    const closest = resolveClosestSuiteName(query, suites);
    if (closest) out.add(closest);
  }
  return [...out].slice(0, 3);
}

function resolveClosestSuiteName(
  value: string,
  candidates: string[],
): string | null {
  if (!value.length) return null;
  let best: string | null = null;
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

function levenshteinDistance(left: string, right: string): number {
  if (left == right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= left.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= right.length; j++) {
    matrix[0]![j] = j;
  }
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] == right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[left.length]![right.length]!;
}

function resolveInputPatterns(
  configured: string[] | string,
  selectors: string[],
): string[] {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;

  const patterns = new Set<string>();
  for (const selector of expandSelectors(selectors)) {
    if (!selector) continue;
    if (isBareSuiteSelector(selector)) {
      const base = stripSuiteSuffix(selector);
      for (const configuredInput of configuredInputs) {
        patterns.add(
          path.join(path.dirname(configuredInput), `${base}.spec.ts`),
        );
      }
      continue;
    }
    patterns.add(selector);
  }
  return [...patterns];
}

function resolveFuzzPatterns(
  configured: string[] | string,
  selectors: string[],
): string[] {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;

  const patterns = new Set<string>();
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

function expandSelectors(selectors: string[]): string[] {
  const expanded: string[] = [];
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

function shouldSplitSelector(selector: string): boolean {
  return (
    selector.includes(",") &&
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}

function isBareSuiteSelector(selector: string): boolean {
  return (
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}

function stripSuiteSuffix(selector: string): string {
  return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}

function resolveDuplicateSpecBasenames(files: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const base = path.basename(file);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [base, count] of counts) {
    if (count > 1) duplicates.add(base);
  }
  return duplicates;
}

function resolvePerFileArtifactKey(
  file: string,
  duplicateSpecBasenames: Set<string>,
): string {
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

function resolvePerFileDisambiguator(file: string): string {
  const relDir = path.dirname(path.relative(process.cwd(), file));
  if (!relDir.length || relDir == ".") return "";
  return relDir
    .replace(/[\\/]+/g, "__")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveArtifactFileNameForPreview(
  file: string,
  target: string,
  modeName: string | undefined,
  duplicateSpecBasenames: Set<string>,
): string {
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

async function ensureWebBrowsersReady(
  configPath: string | undefined,
  modes: (string | undefined)[],
  browserOverride?: string,
): Promise<void> {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, true);
  const missing: { modeName?: string; browser?: string }[] = [];

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
    process.env.BROWSER = resolved.browser;
  }

  if (!missing.length) return;
  await handleMissingWebBrowsers(missing);
}

function resolveBrowserSelection(
  requested: string = "",
): { browser: string } | null {
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

function resolveNamedBrowser(browser: string): { browser: string } | null {
  const normalized = browser.trim().toLowerCase();
  if (!normalized.length) return null;
  if (
    browser.includes("/") ||
    browser.includes("\\") ||
    path.isAbsolute(browser)
  ) {
    return hasExecutable(browser) ? { browser } : null;
  }

  const aliases: Record<string, string[]> = {
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

  const playwrightFallback = resolvePlaywrightBrowserExecutable(normalized);
  if (playwrightFallback) {
    return { browser: playwrightFallback };
  }
  return null;
}

function usesWebBrowser(config: Config): boolean {
  return (
    config.buildOptions.target == "web" ||
    config.runOptions.runtime.browser.length > 0 ||
    config.runOptions.runtime.cmd.includes("default.web.js")
  );
}

async function handleMissingWebBrowsers(
  missing: { modeName?: string; browser?: string }[],
): Promise<void> {
  const scope = missing
    .map((entry) =>
      entry.browser?.length
        ? `${entry.modeName ?? "default"} (${entry.browser})`
        : (entry.modeName ?? "default"),
    )
    .join(", ");
  const details =
    "no web-capable browser was found in PATH, BROWSER, or Playwright cache";

  if (!canPromptForWebInstall()) {
    throw new Error(
      `web target requires a browser for mode(s) ${scope}; ${details}. Export BROWSER or install one with "npx -y playwright install chromium" or "npx -y playwright install webkit".`,
    );
  }

  process.stdout.write(
    chalk.bold.blue("◇  Browser Setup Needed") +
      "\n" +
      `│  ${details}\n` +
      "│\n",
  );

  const choice = await promptLine(
    "Install Chromium with Playwright now? [Y/n] ",
  );
  const normalized = choice.trim().toLowerCase();
  if (normalized == "n" || normalized == "no") {
    throw new Error(
      'browser install skipped. Export BROWSER or install one with "npx -y playwright install chromium" or "npx -y playwright install webkit", then rerun.',
    );
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
    throw new Error(
      `Playwright installed ${selected}, but as-test could not locate the browser executable`,
    );
  }
  process.env.BROWSER = browserPath;
}

function canPromptForWebInstall(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function promptLine(question: string): Promise<string> {
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

function resolvePlaywrightBrowserExecutable(browser: string): string | null {
  const cacheRoot = path.join(
    process.env.HOME ?? "",
    ".cache",
    "ms-playwright",
  );
  if (!cacheRoot.length || !existsSync(cacheRoot)) return null;
  const map: Record<string, string[]> = {
    chromium: ["chromium-*/chrome-linux64/chrome"],
    chrome: ["chromium-*/chrome-linux64/chrome"],
    firefox: ["firefox-*/firefox/firefox"],
    webkit: ["webkit-*/pw_run.sh"],
  };
  const patterns = map[browser] ?? [];
  for (const pattern of patterns) {
    const matches = glob.sync(path.join(cacheRoot, pattern)).sort();
    if (matches.length) return matches[matches.length - 1]!;
  }
  return null;
}

function hasExecutable(command: string): boolean {
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
  command: "build" | "run" | "test" | "fuzz",
  configPath: string | undefined,
  selectors: string[],
  modes: (string | undefined)[],
  listFlags: CliListFlags,
  fuzzEnabled: boolean = false,
): Promise<void> {
  const resolvedConfigPath =
    configPath ?? path.join(process.cwd(), "./as-test.config.json");
  const config = loadConfig(resolvedConfigPath, true);
  const configuredModes = Object.keys(config.modes);
  const configuredModeLabels = configuredModes.length
    ? configuredModes
    : ["default"];
  const selectedModeLabels = modes.map((modeName) => modeName ?? "default");
  const unknownModes = modes.filter((modeName): modeName is string =>
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
      process.stdout.write(`  - ${modeName}\n`);
    }
    process.stdout.write(chalk.bold("\nSelected modes:\n"));
    for (const modeName of selectedModeLabels) {
      process.stdout.write(`  - ${modeName}\n`);
    }
    process.stdout.write("\n");
  }

  if (!listFlags.list) return;

  const specFiles =
    command == "fuzz" ? [] : await resolveSelectedFiles(configPath, selectors);
  const fuzzFiles =
    command == "fuzz"
      ? await resolveSelectedFuzzFiles(configPath, selectors)
      : command == "test" && fuzzEnabled
        ? await resolveSelectedFuzzFiles(configPath, selectors)
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
      ...config.env,
      ...(modeName ? (config.modes[modeName]?.env ?? {}) : {}),
      ...(command == "build"
        ? active.buildOptions.env
        : command == "run" || command == "test"
          ? active.runOptions.env
          : {}),
    };
    const envKeys = Object.keys(envOverrides);
    process.stdout.write(
      `  env overrides: ${envKeys.length}${
        envKeys.length ? ` (${envKeys.join(", ")})` : ""
      }\n`,
    );
    if (specFiles.length) {
      process.stdout.write("  artifacts:\n");
      for (const file of specFiles) {
        const artifactName = resolveArtifactFileNameForPreview(
          file,
          active.buildOptions.target,
          modeName,
          duplicateSpecBasenames,
        );
        process.stdout.write(
          `    - ${path.join(active.outDir, artifactName)}\n`,
        );
      }
    }
    if (fuzzFiles.length && command == "test") {
      process.stdout.write("  fuzz artifacts:\n");
      for (const file of fuzzFiles) {
        const artifactName = resolveArtifactFileNameForPreview(
          file,
          "bindings",
          modeName,
          duplicateFuzzBasenames,
        );
        process.stdout.write(
          `    - ${path.join(active.outDir, artifactName)}\n`,
        );
      }
    } else if (command == "fuzz") {
      process.stdout.write("  artifacts:\n");
      for (const file of fuzzFiles) {
        const artifactName = resolveArtifactFileNameForPreview(
          file,
          "bindings",
          modeName,
          duplicateFuzzBasenames,
        );
        process.stdout.write(
          `    - ${path.join(active.outDir, artifactName)}\n`,
        );
      }
    }
    process.stdout.write("\n");
  }
}

function aggregateRunResults(results: RunResult[]): {
  stats: RunStats;
  snapshotSummary: {
    matched: number;
    created: number;
    updated: number;
    failed: number;
  };
  coverageSummary: CoverageSummary;
  reports: unknown[];
} {
  const stats: RunStats = {
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
  const coverageSummary: CoverageSummary = {
    enabled: false,
    showPoints: false,
    total: 0,
    covered: 0,
    uncovered: 0,
    percent: 100,
    files: [],
  };
  const uniqueCoveragePoints = new Map<
    string,
    {
      hash: string;
      file: string;
      line: number;
      column: number;
      type: string;
      executed: boolean;
    }
  >();
  let fallbackCoverageTotal = 0;
  let fallbackCoverageCovered = 0;
  let fallbackCoverageUncovered = 0;
  const fallbackCoverageFiles: CoverageSummary["files"] = [];
  const reports: unknown[] = [];

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
  }

  if (uniqueCoveragePoints.size > 0) {
    const byFile = new Map<
      string,
      CoverageSummary["files"][number]["points"]
    >();
    for (const point of uniqueCoveragePoints.values()) {
      if (!byFile.has(point.file)) byFile.set(point.file, []);
      byFile.get(point.file)!.push(point);
    }
    const sortedFiles = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      const points = byFile.get(file)!;
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

  return { stats, snapshotSummary, coverageSummary, reports };
}

function printCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
}
