import { existsSync, readFileSync } from "fs";
import { Config } from "./types.js";
import { glob } from "glob";
import chalk from "chalk";
import { exec } from "child_process";
import { formatTime } from "./util.js";
import * as path from "path";
export async function build(args) {
  const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
  let config;
  if (!existsSync(CONFIG_PATH)) {
    console.log(
      chalk.bgMagentaBright(" WARN ") +
        chalk.dim(":") +
        " Could not locate config file in the current directory! Continuing with default config." +
        "\n",
    );
    config = new Config();
  } else {
    config = Object.assign(
      new Config(),
      JSON.parse(readFileSync(CONFIG_PATH).toString()),
    );
    console.log(chalk.dim("Loading config from: " + CONFIG_PATH) + "\n");
  }
  const ASCONFIG_PATH = path.join(process.cwd(), config.config);
  if (!existsSync(ASCONFIG_PATH)) {
    console.log(
      chalk.bgMagentaBright(" WARN ") +
        chalk.dim(":") +
        ' Could not locate asconfig.json file! If you do not want to provide a config, set "config": "none". Continuing with default config.' +
        "\n",
    );
  }
  const pkg = JSON.parse(readFileSync("./package.json").toString());
  let buildCommands = [];
  if (config.buildOptions.wasi) {
    if (
      (pkg.dependencies &&
        !Object.keys(pkg.dependencies).includes("@assemblyscript/wasi-shim")) ||
      (pkg.devDependencies &&
        !Object.keys(pkg.devDependencies).includes(
          "@assemblyscript/wasi-shim",
        )) ||
      (pkg.peerDependencies &&
        !Object.keys(pkg.peerDependencies).includes(
          "@assemblyscript/wasi-shim",
        ))
    ) {
        console.log(
          chalk.bold.bgMagentaBright(" WARN ") +
            chalk.dim(": @assemblyscript/wasi-shim") +
            " is not included in project dependencies!",
        );
    }
  }
  let packageManagerCommand = "npx";
  if (
    process.env.npm_config_user_agent &&
    process.env.npm_config_user_agent.includes("pnpm")
  ) {
    packageManagerCommand = "pnpx";
  } else if (
    process.env.npm_config_user_agent &&
    process.env.npm_config_user_agent.includes("yarn")
  ) {
    packageManagerCommand = "yarn run";
  } else if (
    process.env.npm_config_user_agent &&
    process.env.npm_config_user_agent.includes("bun")
  ) {
    packageManagerCommand = "bunx";
  }
  console.log("");
  const inputFiles = await glob(config.input);
  for (const file of inputFiles) {
    console.log(chalk.dim("Including " + file));
    let command = `${packageManagerCommand} asc ${file}${args.length ? " " + args.join(" ") : ""}`;
    if (config.buildOptions.wasi) {
      command +=
        " --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json";
    }
    if (config.config !== "none") {
      command += " --config " + config.config;
    }
    const outFile =
      config.outDir +
      "/" +
      file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm");
    if (config.outDir) {
      command += " -o " + outFile;
    }
    if (config.coverage.enabled) {
      console.log(chalk.dim("Enabling coverage"));
      command += " --use COVERAGE_USE=1 --transform as-test/transform";
      if (config.coverage.show) command += " --use COVERAGE_SHOW=1";
    }
    if (config.buildOptions.args) {
      command += " " + config.buildOptions.args.join(" ");
    }
    buildCommands.push(command);
  }
  const build = (command) => {
    return new Promise((resolve, _) => {
      console.log(chalk.dim("Building: " + command));
      exec(command, (err, stdout, stderr) => {
        if (config.buildOptions.verbose) {
          process.stdout.write(stdout);
        }
        if (err) {
          process.stderr.write(stderr + "\n");
          process.exit(1);
        }
        resolve();
      });
    });
  };
  if (config.buildOptions.parallel) {
    console.log(chalk.dim("Building sources in parallel..."));
    const start = performance.now();
    let builders = [];
    for (const command of buildCommands) {
      builders.push(build(command));
    }
    await Promise.all(builders);
    console.log(
      chalk.dim("Compiled in " + formatTime(performance.now() - start)) + "\n",
    );
  }
}
