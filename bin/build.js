import { existsSync, readFileSync } from "fs";
import { glob } from "glob";
import chalk from "chalk";
import { execSync } from "child_process";
import * as path from "path";
import { loadConfig } from "./util.js";
const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
const PKG_PATH = path.join(process.cwd(), "./package.json");
export async function build() {
    let config = loadConfig(CONFIG_PATH, true);
    const ASCONFIG_PATH = path.join(process.cwd(), config.config);
    if (config.config && config.config !== "none" && !existsSync(ASCONFIG_PATH)) {
        console.log(`${chalk.bgMagentaBright(" WARN ")}${chalk.dim(":")} Could not locate asconfig.json file! If you do not want to provide a config, set "config": "none"`);
    }
    ensureDeps(config);
    let pkgRunner = getPkgRunner();
    const inputFiles = await glob(config.input);
    let buildArgs = getBuildArgs(config);
    for (const file of inputFiles) {
        let cmd = `${pkgRunner} asc ${file}${buildArgs}`;
        const outFile = `${config.outDir}/${file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm")}`;
        if (config.outDir) {
            cmd += " -o " + outFile;
        }
        buildFile(cmd);
    }
}
function ensureDeps(config) {
    const pkg = JSON.parse(readFileSync(PKG_PATH).toString());
    if (config.buildOptions.target == "wasi") {
        if (!existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!`);
            process.exit(1);
        }
        if (pkg.dependencies &&
            !Object.keys(pkg.dependencies).includes("@assemblyscript/wasi-shim") &&
            pkg.devDependencies &&
            !Object.keys(pkg.devDependencies).includes("@assemblyscript/wasi-shim") &&
            pkg.peerDependencies &&
            !Object.keys(pkg.peerDependencies).includes("@assemblyscript/wasi-shim") &&
            existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(`${chalk.bold.bgMagentaBright(" WARN ")}${chalk.dim(":")} @assemblyscript/wasi-shim is not included in project dependencies!"`);
        }
    }
}
function getPkgRunner() {
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
function buildFile(command) {
    execSync(command, { stdio: "inherit" });
}
function getBuildArgs(config) {
    let buildArgs = "";
    buildArgs += " --transform as-test/transform";
    if (config.config && config.config !== "none") {
        buildArgs += " --config " + config.config;
    }
    // Should also strip any bindings-enabling from asconfig
    if (config.buildOptions.target == "bindings") {
        buildArgs += " --bindings raw --exportRuntime --exportStart _start";
    }
    else if (config.buildOptions.target == "wasi") {
        buildArgs +=
            " --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json";
    }
    else {
        console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could determine target in config! Set target to 'bindings' or 'wasi'`);
        process.exit(0);
    }
    if (config.buildOptions.args.length &&
        config.buildOptions.args.find((v) => v.length > 0)) {
        buildArgs += " " + config.buildOptions.args.join(" ");
    }
    return buildArgs;
}
