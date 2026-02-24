import { existsSync } from "fs";
import { glob } from "glob";
import chalk from "chalk";
import { execSync } from "child_process";
import * as path from "path";
import { applyMode, getPkgRunner, loadConfig } from "./util.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
export async function build(configPath = DEFAULT_CONFIG_PATH, selectors = [], modeName) {
    const loadedConfig = loadConfig(configPath, false);
    const mode = applyMode(loadedConfig, modeName);
    const config = mode.config;
    ensureDeps(config);
    const pkgRunner = getPkgRunner();
    const inputPatterns = resolveInputPatterns(config.input, selectors);
    const inputFiles = (await glob(inputPatterns)).sort((a, b) => a.localeCompare(b));
    const buildArgs = getBuildArgs(config);
    for (const file of inputFiles) {
        let cmd = `${pkgRunner} asc ${file}${buildArgs}`;
        const outFile = `${config.outDir}/${resolveArtifactFileName(file, config.buildOptions.target, modeName)}`;
        if (config.outDir) {
            cmd += " -o " + outFile;
        }
        try {
            buildFile(cmd, mode.env);
        }
        catch (error) {
            throw new Error(`Failed to build ${path.basename(file)} with ${getBuildStderr(error)}`);
        }
    }
}
function resolveArtifactFileName(file, target, modeName) {
    const base = path
        .basename(file)
        .replace(/\.spec\.ts$/, "")
        .replace(/\.ts$/, "");
    if (!modeName) {
        return `${path.basename(file).replace(".ts", ".wasm")}`;
    }
    return `${base}.${modeName}.${target}.wasm`;
}
function resolveInputPatterns(configured, selectors) {
    const configuredInputs = Array.isArray(configured)
        ? configured
        : [configured];
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
function ensureDeps(config) {
    if (config.buildOptions.target == "wasi") {
        if (!existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!`);
            process.exit(1);
        }
    }
}
function buildFile(command, env) {
    execSync(command, {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env,
    });
}
function getBuildStderr(error) {
    const err = error;
    const stderr = err?.stderr;
    if (typeof stderr == "string") {
        const trimmed = stderr.trim();
        if (trimmed.length)
            return trimmed;
    }
    else if (stderr instanceof Buffer) {
        const trimmed = stderr.toString("utf8").trim();
        if (trimmed.length)
            return trimmed;
    }
    const message = typeof err?.message == "string" ? err.message.trim() : "";
    return message || "unknown error";
}
function getBuildArgs(config) {
    let buildArgs = "";
    buildArgs += " --transform as-test/transform";
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
