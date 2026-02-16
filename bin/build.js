import { existsSync, readFileSync } from "fs";
import { glob } from "glob";
import chalk from "chalk";
import { execSync } from "child_process";
import * as path from "path";
import { getPkgRunner, loadConfig } from "./util.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
const PKG_PATH = path.join(process.cwd(), "./package.json");
export async function build(configPath = DEFAULT_CONFIG_PATH) {
    const config = loadConfig(configPath, true);
    const ASCONFIG_PATH = path.join(process.cwd(), config.config);
    if (config.config && config.config !== "none" && !existsSync(ASCONFIG_PATH)) {
        console.log(`${chalk.bgMagentaBright(" WARN ")}${chalk.dim(":")} Could not locate asconfig.json file! If you do not want to provide a config, set "config": "none"`);
    }
    ensureDeps(config);
    const pkgRunner = getPkgRunner();
    const inputFiles = await glob(config.input);
    const buildArgs = getBuildArgs(config);
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
        if (!hasDep(pkg, "@assemblyscript/wasi-shim") &&
            existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(`${chalk.bold.bgMagentaBright(" WARN ")}${chalk.dim(":")} @assemblyscript/wasi-shim is not included in project dependencies!"`);
        }
    }
    if (!hasJsonAsTransform()) {
        console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find json-as. Install it to compile as-test suites.`);
        process.exit(1);
    }
}
function buildFile(command) {
    execSync(command, { stdio: "inherit" });
}
function getBuildArgs(config) {
    let buildArgs = "";
    buildArgs += " --transform as-test/transform";
    buildArgs += " --transform json-as/transform";
    if (hasTryAsRuntime()) {
        buildArgs += " --transform try-as/transform";
    }
    if (config.config && config.config !== "none") {
        buildArgs += " --config " + config.config;
    }
    if (hasTryAsRuntime()) {
        buildArgs += " --use AS_TEST_TRY_AS=1";
    }
    // Should also strip any bindings-enabling from asconfig
    if (config.buildOptions.target == "bindings") {
        buildArgs += " --use AS_TEST_BINDINGS=1";
        buildArgs += " --bindings raw --exportRuntime --exportStart _start";
    }
    else if (config.buildOptions.target == "wasi") {
        buildArgs += " --use AS_TEST_WASI=1";
        buildArgs +=
            " --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json";
    }
    else {
        console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not determine target in config! Set target to 'bindings' or 'wasi'`);
        process.exit(1);
    }
    if (config.buildOptions.args.length &&
        config.buildOptions.args.find((v) => v.length > 0)) {
        buildArgs += " " + config.buildOptions.args.join(" ");
    }
    return buildArgs;
}
function hasTryAsRuntime() {
    return (existsSync(path.join(process.cwd(), "node_modules/try-as")) ||
        existsSync(path.join(process.cwd(), "node_modules/try-as/package.json")));
}
function hasDep(pkg, dep) {
    return Boolean(pkg.dependencies?.[dep] ||
        pkg.devDependencies?.[dep] ||
        pkg.peerDependencies?.[dep]);
}
function hasJsonAsTransform() {
    return (existsSync(path.join(process.cwd(), "node_modules/json-as/transform.js")) ||
        existsSync(path.join(process.cwd(), "node_modules/json-as/transform.ts")) ||
        existsSync(path.join(process.cwd(), "node_modules/json-as/transform")));
}
