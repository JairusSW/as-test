import { existsSync } from "fs";
import { glob } from "glob";
import chalk from "chalk";
import { spawnSync } from "child_process";
import * as path from "path";
import { applyMode, getPkgRunner, loadConfig, tokenizeCommand, resolveProjectModule, } from "../util.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
export async function build(configPath = DEFAULT_CONFIG_PATH, selectors = [], modeName, featureToggles = {}, overrides = {}) {
    const loadedConfig = loadConfig(configPath, false);
    const mode = applyMode(loadedConfig, modeName);
    const config = Object.assign(Object.create(Object.getPrototypeOf(mode.config)), mode.config);
    config.buildOptions = Object.assign(Object.create(Object.getPrototypeOf(mode.config.buildOptions)), mode.config.buildOptions);
    if (overrides.target) {
        config.buildOptions.target = overrides.target;
    }
    if (overrides.args?.length) {
        config.buildOptions.args = [...config.buildOptions.args, ...overrides.args];
    }
    if (!hasCustomBuildCommand(config)) {
        ensureDeps(config);
    }
    const pkgRunner = getPkgRunner();
    const inputPatterns = resolveInputPatterns(config.input, selectors);
    const inputFiles = (await glob(inputPatterns)).sort((a, b) => a.localeCompare(b));
    const duplicateSpecBasenames = await resolveDuplicateSpecBasenames(config.input);
    const coverageEnabled = resolveCoverageEnabled(config.coverage, featureToggles.coverage);
    const buildEnv = {
        ...mode.env,
        ...config.buildOptions.env,
        AS_TEST_COVERAGE_ENABLED: coverageEnabled ? "1" : "0",
    };
    for (const file of inputFiles) {
        const outFile = `${config.outDir}/${resolveArtifactFileName(file, config.buildOptions.target, modeName, duplicateSpecBasenames)}`;
        const invocation = getBuildCommand(config, pkgRunner, file, outFile, modeName, featureToggles);
        try {
            buildFile(invocation, buildEnv);
        }
        catch (error) {
            const modeLabel = modeName ?? "default";
            throw new Error(`Failed to build ${path.basename(file)} in mode ${modeLabel} with ${getBuildStderr(error)}\nBuild command: ${formatInvocation(invocation)}`);
        }
    }
}
function hasCustomBuildCommand(config) {
    return !!config.buildOptions.cmd.trim().length;
}
function getBuildCommand(config, pkgRunner, file, outFile, modeName, featureToggles = {}) {
    const userArgs = getUserBuildArgs(config);
    if (hasCustomBuildCommand(config)) {
        const tokens = tokenizeCommand(expandBuildCommand(config.buildOptions.cmd, file, outFile, config.buildOptions.target, modeName));
        if (!tokens.length) {
            throw new Error("custom build command is empty");
        }
        return {
            command: tokens[0],
            args: [...tokens.slice(1), ...userArgs],
        };
    }
    const defaultArgs = getDefaultBuildArgs(config, featureToggles);
    const args = ["asc", file, ...userArgs, ...defaultArgs];
    if (config.outDir.length) {
        args.push("-o", outFile);
    }
    return {
        command: pkgRunner,
        args,
    };
}
function getUserBuildArgs(config) {
    const args = [];
    for (const value of config.buildOptions.args) {
        if (!value.length)
            continue;
        args.push(...tokenizeCommand(value));
    }
    return args;
}
function expandBuildCommand(template, file, outFile, target, modeName) {
    const name = path
        .basename(file)
        .replace(/\.spec\.ts$/, "")
        .replace(/\.ts$/, "");
    return template
        .replace(/<file>/g, file)
        .replace(/<name>/g, name)
        .replace(/<outFile>/g, outFile)
        .replace(/<target>/g, target)
        .replace(/<mode>/g, modeName ?? "");
}
function resolveArtifactFileName(file, target, modeName, duplicateSpecBasenames = new Set()) {
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
    const disambiguator = resolveDisambiguator(file);
    if (!disambiguator.length) {
        return legacy;
    }
    const ext = path.extname(legacy);
    const stem = ext.length ? legacy.slice(0, -ext.length) : legacy;
    return `${stem}.${disambiguator}${ext}`;
}
async function resolveDuplicateSpecBasenames(configured) {
    const patterns = Array.isArray(configured) ? configured : [configured];
    const files = await glob(patterns);
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
function resolveDisambiguator(file) {
    const relDir = path.dirname(path.relative(process.cwd(), file));
    if (!relDir.length || relDir == ".")
        return "";
    return relDir
        .replace(/[\\/]+/g, "__")
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .replace(/^_+|_+$/g, "");
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
function ensureDeps(config) {
    if (config.buildOptions.target == "wasi") {
        if (!resolveWasiShim()) {
            console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!`);
            process.exit(1);
        }
    }
}
function buildFile(invocation, env) {
    const result = spawnSync(invocation.command, invocation.args, {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env,
        shell: false,
    });
    if (result.error)
        throw result.error;
    if (result.status !== 0) {
        const error = new Error(result.stderr?.trim() ||
            result.stdout?.trim() ||
            `command exited with code ${result.status}`);
        error.stderr = result.stderr ?? "";
        throw error;
    }
}
function formatInvocation(invocation) {
    return [invocation.command, ...invocation.args]
        .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
        .join(" ");
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
function getDefaultBuildArgs(config, featureToggles) {
    const buildArgs = [];
    const tryAsEnabled = resolveTryAsEnabled(featureToggles.tryAs);
    buildArgs.push("--transform", "as-test/transform");
    if (tryAsEnabled) {
        buildArgs.push("--transform", "try-as/transform");
    }
    if (config.config && config.config !== "none") {
        buildArgs.push("--config", config.config);
    }
    if (tryAsEnabled) {
        buildArgs.push("--use", "AS_TEST_TRY_AS=1");
    }
    // Should also strip any bindings-enabling from asconfig
    if (config.buildOptions.target == "bindings" ||
        config.buildOptions.target == "web") {
        buildArgs.push("--use", "AS_TEST_BINDINGS=1", "--bindings", "raw", "--exportRuntime", "--exportStart", "_start");
    }
    else if (config.buildOptions.target == "wasi") {
        const wasiShim = resolveWasiShim();
        if (!wasiShim) {
            throw new Error('WASI target requires package "@assemblyscript/wasi-shim"');
        }
        buildArgs.push("--use", "AS_TEST_WASI=1", "--config", wasiShim.configPath);
    }
    else {
        console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not determine target in config! Set target to 'bindings', 'web', or 'wasi'`);
        process.exit(1);
    }
    return buildArgs;
}
function resolveTryAsEnabled(override) {
    const installed = hasTryAsRuntime();
    if (override === false)
        return false;
    if (override === true && !installed) {
        throw new Error('try-as feature was enabled, but package "try-as" is not installed');
    }
    return installed;
}
function resolveCoverageEnabled(rawCoverage, override) {
    if (override != undefined)
        return override;
    if (typeof rawCoverage == "boolean")
        return rawCoverage;
    if (rawCoverage && typeof rawCoverage == "object") {
        const enabled = rawCoverage.enabled;
        if (typeof enabled == "boolean")
            return enabled;
    }
    return true;
}
function hasTryAsRuntime() {
    return resolveProjectModule("try-as/package.json") != null;
}
function resolveWasiShim() {
    const resolved = resolveProjectModule("@assemblyscript/wasi-shim/asconfig.json");
    if (!resolved)
        return null;
    if (!existsSync(resolved))
        return null;
    const relative = path.relative(process.cwd(), resolved).replace(/\\/g, "/");
    return {
        configPath: normalizeCliPath(relative),
    };
}
function quoteCliArg(value) {
    if (!/[\s"]/g.test(value))
        return value;
    return `"${value.replace(/"/g, '\\"')}"`;
}
function normalizeCliPath(value) {
    if (!value.length)
        return ".";
    if (value.startsWith(".") || value.startsWith("/"))
        return value;
    return "./" + value;
}
