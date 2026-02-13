#!/usr/bin/env node

import chalk from "chalk";
import { build } from "./build.js";
import { run } from "./run.js";
import { init } from "./init.js";
import { getCliVersion } from "./util.js";
import * as path from "path";

const _args = process.argv.slice(2);
const flags: string[] = [];
const args: string[] = [];

const COMMANDS: string[] = ["run", "build", "test", "init"];

const version = getCliVersion();
const configPath = resolveConfigPath(_args);

for (const arg of _args) {
  if (arg.startsWith("-")) flags.push(arg);
  else args.push(arg);
}

if (!args.length) {
  if (flags.includes("--version") || flags.includes("-v")) {
    console.log("as-test v" + version.toString());
  } else {
    info();
  }
} else if (COMMANDS.includes(args[0]!)) {
  const command = args.shift();
  const runFlags = {
    snapshot: !flags.includes("--no-snapshot"),
    updateSnapshots: flags.includes("--update-snapshots"),
    clean: flags.includes("--clean"),
    showCoverage: flags.includes("--show-coverage"),
  };
  if (command === "build") {
    build(configPath);
  } else if (command === "run") {
    run(runFlags, configPath);
  } else if (command === "test") {
    build(configPath).then(() => {
      run(runFlags, configPath);
    });
  } else if (command === "init") {
    init(args);
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
      "       " +
      chalk.dim("<my-test.spec.ts>") +
      "       " +
      "Run unit tests with selected runtime",
  );
  console.log(
    "  " +
      chalk.bold.blueBright("build") +
      "     " +
      chalk.dim("<my-test.spec.ts>") +
      "       " +
      "Build unit tests and compile",
  );
  console.log(
    "  " +
      chalk.bold.blueBright("test") +
      "      " +
      chalk.dim("<my-test.spec.ts>") +
      "       " +
      "Build and run unit tests with selected runtime" +
      "\n",
  );

  console.log(
    "  " +
      chalk.bold.magentaBright("init") +
      "       " +
      "Initialize an empty testing template",
  );
  console.log("");

  console.log(chalk.bold("Flags:"));

  console.log(
    "  " +
      chalk.dim("build/run/test") +
      "   " +
      chalk.bold.blue("--config <path>") +
      "       " +
      "Use a specific config file",
  );
  console.log(
    "  " +
      chalk.dim("run/test") +
      "   " +
      chalk.bold.blue("--snapshot") +
      "             " +
      "Snapshot assertions (enabled by default)",
  );
  console.log(
    "  " +
      chalk.dim("run/test") +
      "   " +
      chalk.bold.blue("--update-snapshots") +
      "     " +
      "Create/update snapshot files on mismatch",
  );
  console.log(
    "  " +
      chalk.dim("run/test") +
      "   " +
      chalk.bold.blue("--no-snapshot") +
      "          " +
      "Disable snapshot assertions for this run",
  );
  console.log(
    "  " +
      chalk.dim("run/test") +
      "   " +
      chalk.bold.blue("--clean") +
      "                " +
      "Minimal output (summary-first)",
  );
  console.log(
    "  " +
      chalk.dim("run/test") +
      "   " +
      chalk.bold.blue("--show-coverage") +
      "        " +
      "Print all coverage points with line:column refs",
  );
  console.log("");

  console.log(
    chalk.dim(
      "If your using this, consider dropping a star, it would help a lot!",
    ) + "\n",
  );

  console.log(
    "View the repo:                   " +
      chalk.magenta("https://github.com/JairusSW/as-test"),
  );
  console.log(
    "View the docs:                   " +
      chalk.blue("https://docs.jairus.dev/as-test"),
  );
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
