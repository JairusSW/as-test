import { existsSync } from "fs";
import { glob } from "glob";
import chalk from "chalk";
import { spawn } from "child_process";
import * as path from "path";
import { createMemoryStream, main as ascMain, } from "assemblyscript/dist/asc.js";
import { applyMode, getPkgRunner, loadConfig, tokenizeCommand, resolveProjectModule, } from "../util.js";
import { persistCrashRecord } from "../crash-store.js";
import { BuildWorkerPool } from "../build-worker-pool.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
class BuildFailureError extends Error {
    constructor(args) {
        super(args.message);
        this.name = "BuildFailureError";
        this.file = args.file;
        this.mode = args.mode;
        this.invocation = args.invocation;
        this.stdout = args.stdout;
        this.stderr = args.stderr;
        this.kind = args.kind;
    }
}
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
    const duplicateSpecBasenames = resolveDuplicateBasenames(inputFiles);
    const coverageEnabled = resolveCoverageEnabled(config.coverage, featureToggles.coverage);
    const buildEnv = {
        ...mode.env,
        ...config.buildOptions.env,
        AS_TEST_COVERAGE_ENABLED: coverageEnabled ? "1" : "0",
    };
    if (!process.env.AS_TEST_BUILD_API && !hasCustomBuildCommand(config)) {
        const pool = getSerialBuildWorkerPool();
        for (const file of inputFiles) {
            await pool.buildFileMode({
                configPath,
                file,
                modeName,
                featureToggles,
                overrides,
            });
        }
        return;
    }
    for (const file of inputFiles) {
        const outFile = `${config.outDir}/${resolveArtifactFileName(file, config.buildOptions.target, modeName, duplicateSpecBasenames)}`;
        const invocation = getBuildCommand(config, pkgRunner, file, outFile, modeName, featureToggles);
        try {
            await buildFile(invocation, buildEnv);
        }
        catch (error) {
            const modeLabel = modeName ?? "default";
            const stdout = getBuildStdout(error);
            const stderr = getBuildStderr(error);
            const buildCommand = formatInvocation(invocation);
            const kind = overrides.kind ?? "test";
            const crash = persistCrashRecord(config.fuzz.crashDir, {
                kind,
                stage: "build",
                file,
                mode: modeLabel,
                cwd: process.cwd(),
                buildCommand,
                reproCommand: buildCommand,
                error: stderr || stdout || "unknown build error",
                stdout,
                stderr,
            });
            throw new BuildFailureError({
                file,
                mode: modeLabel,
                invocation,
                stdout,
                stderr,
                kind,
                message: `Failed to build ${path.basename(file)} in mode ${modeLabel} with ${stderr || stdout || "unknown build error"}\n` +
                    `Build command: ${buildCommand}\n` +
                    `Crash log: ${crash.logPath}`,
            });
        }
    }
}
let serialBuildWorkerPool = null;
function getSerialBuildWorkerPool() {
    if (!serialBuildWorkerPool) {
        serialBuildWorkerPool = new BuildWorkerPool(1);
    }
    return serialBuildWorkerPool;
}
export async function closeSerialBuildWorkerPool() {
    if (!serialBuildWorkerPool)
        return;
    const pool = serialBuildWorkerPool;
    serialBuildWorkerPool = null;
    await pool.close();
}
export async function getBuildInvocationPreview(configPath = DEFAULT_CONFIG_PATH, file, modeName, featureToggles = {}, overrides = {}) {
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
    const duplicateSpecBasenames = resolveDuplicateBasenames([file]);
    const outFile = `${config.outDir}/${resolveArtifactFileName(file, config.buildOptions.target, modeName, duplicateSpecBasenames)}`;
    return getBuildCommand(config, getPkgRunner(), file, outFile, modeName, featureToggles);
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
    const ascInvocation = resolveAscInvocation(pkgRunner);
    const args = [...ascInvocation.args, file, ...userArgs, ...defaultArgs];
    if (config.outDir.length) {
        args.push("-o", outFile);
    }
    return {
        command: ascInvocation.command,
        args,
        apiArgs: args.slice(1),
    };
}
function resolveAscInvocation(pkgRunner) {
    const assemblyscriptPkg = resolveProjectModule("assemblyscript/package.json");
    if (assemblyscriptPkg) {
        const ascPath = path.join(path.dirname(assemblyscriptPkg), "bin", "asc.js");
        if (existsSync(ascPath)) {
            return {
                command: process.execPath,
                args: [ascPath],
            };
        }
    }
    return {
        command: pkgRunner,
        args: ["asc"],
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
function resolveDuplicateBasenames(files) {
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
async function buildFile(invocation, env) {
    if (process.env.AS_TEST_BUILD_API == "1" && invocation.apiArgs?.length) {
        await buildFileViaApi(invocation.apiArgs, env);
        return;
    }
    await buildFileViaSpawn(invocation, env);
}
async function buildFileViaApi(args, env) {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdout = createMemoryStream((chunk) => {
        stdoutChunks.push(typeof chunk == "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    });
    const stderr = createMemoryStream((chunk) => {
        stderrChunks.push(typeof chunk == "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    });
    const previousEnv = snapshotEnv();
    applyEnv(env);
    try {
        const result = await ascMain(args, { stdout, stderr });
        if (result.error) {
            const error = result.error;
            error.stderr = stderrChunks.join("").trim();
            error.stdout = stdoutChunks.join("").trim();
            throw error;
        }
    }
    finally {
        restoreEnv(previousEnv);
    }
}
async function buildFileViaSpawn(invocation, env) {
    await new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            stdio: ["ignore", "pipe", "pipe"],
            env,
            shell: false,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            const error = new Error(stderr.trim() || stdout.trim() || `command exited with code ${code}`);
            error.stderr = stderr.trim();
            error.stdout = stdout.trim();
            reject(error);
        });
    });
}
function snapshotEnv() {
    return { ...process.env };
}
function applyEnv(nextEnv) {
    const keys = new Set([
        ...Object.keys(process.env),
        ...Object.keys(nextEnv),
    ]);
    for (const key of keys) {
        const value = nextEnv[key];
        if (value == undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
}
function restoreEnv(previousEnv) {
    const keys = new Set([
        ...Object.keys(process.env),
        ...Object.keys(previousEnv),
    ]);
    for (const key of keys) {
        const value = previousEnv[key];
        if (value == undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
}
function formatInvocation(invocation) {
    return [invocation.command, ...invocation.args]
        .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
        .join(" ");
}
export { getBuildCommand, formatInvocation };
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
function getBuildStdout(error) {
    const err = error;
    const stdout = err?.stdout;
    if (typeof stdout == "string")
        return stdout.trim();
    if (stdout instanceof Buffer)
        return stdout.toString("utf8").trim();
    return "";
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
    return false;
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
