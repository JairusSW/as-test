import { existsSync, readFileSync } from "fs";
import { Config } from "./types.js";
import { glob } from "glob";
import chalk from "chalk";
import { exec } from "child_process";
import { formatTime } from "./util.js";
import * as path from "path";
const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
const PKG_PATH = path.join(process.cwd(), "./package.json");
export async function build(args) {
    let config = loadConfig();
    const ASCONFIG_PATH = path.join(process.cwd(), config.config);
    if (!existsSync(ASCONFIG_PATH)) {
        console.log(chalk.bgMagentaBright(" WARN ") +
            chalk.dim(":") +
            ' Could not locate asconfig.json file! If you do not want to provide a config, set "config": "none". Continuing with default config.' +
            "\n");
    }
    verifyPackagesInstalled(config);
    let pkgMan = getPkgManager();
    console.log("");
    const buildCommands = [];
    const inputFiles = await glob(config.input);
    for (const file of inputFiles) {
        console.log(chalk.dim("Including " + file));
        let command = `${pkgMan} asc ${file}${args.length ? " " + args.join(" ") : ""}`;
        if (config.config !== "none") {
            command += " --config " + config.config;
        }
        if (config.buildOptions.target == "wasi") {
            command +=
                " --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json";
        }
        const outFile = config.outDir +
            "/" +
            file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm");
        if (config.outDir) {
            command += " -o " + outFile;
        }
        if (config.plugins["coverage"]) {
            command += " --use COVERAGE_USE=1 --transform as-test/transform";
            command += " --use COVERAGE_SHOW=1";
        }
        if (config.buildOptions.args) {
            command += " " + config.buildOptions.args.join(" ");
        }
        if (["node", "deno", "bun"].includes(config.runOptions.runtime.run.split(" ")[0])) {
            command += " --exportStart";
        }
        buildCommands.push(command);
    }
    const build = (command) => {
        return new Promise((resolve, _) => {
            console.log(chalk.dim("Building: " + command));
            exec(command, (err, stdout, stderr) => {
                process.stdout.write(stdout);
                if (err) {
                    process.stderr.write(stderr + "\n");
                    process.exit(1);
                }
                resolve();
            });
        });
    };
    console.log(chalk.dim("Building sources in parallel..."));
    const start = performance.now();
    let builders = [];
    for (const command of buildCommands) {
        builders.push(build(command));
    }
    await Promise.all(builders);
    console.log(chalk.dim("Compiled in " + formatTime(performance.now() - start)) + "\n");
}
function verifyPackagesInstalled(config) {
    const pkg = JSON.parse(readFileSync(PKG_PATH).toString());
    if (config.buildOptions.target == "wasi") {
        if (!existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(chalk.bgRed(" ERROR ") +
                chalk.dim(":") +
                " " +
                "could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!");
            process.exit(1);
        }
        if (pkg.dependencies &&
            !Object.keys(pkg.dependencies).includes("@assemblyscript/wasi-shim") &&
            pkg.devDependencies &&
            !Object.keys(pkg.devDependencies).includes("@assemblyscript/wasi-shim") &&
            pkg.peerDependencies &&
            !Object.keys(pkg.peerDependencies).includes("@assemblyscript/wasi-shim") &&
            existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(chalk.bold.bgMagentaBright(" WARN ") +
                chalk.dim(": @assemblyscript/wasi-shim") +
                " is not included in project dependencies!");
        }
    }
}
function loadConfig() {
    if (!existsSync(CONFIG_PATH)) {
        console.log(chalk.bgMagentaBright(" WARN ") +
            chalk.dim(":") +
            " Could not locate config file in the current directory! Continuing with default config." +
            "\n");
        console.log(chalk.dim("Using default configuration") + "\n");
        return new Config();
    }
    else {
        console.log(chalk.dim("Loading config from: " + CONFIG_PATH) + "\n");
        return Object.assign(new Config(), JSON.parse(readFileSync(CONFIG_PATH).toString()));
    }
}
function getPkgManager() {
    switch (process.env.npm_config_user_agent) {
        case "pnpm": {
            return "pnpx";
        }
        case "yarn": {
            return "yarn";
        }
        case "bun": {
            return "bunx";
        }
    }
    return "npx";
}
