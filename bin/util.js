import { existsSync, readFileSync } from "fs";
import { BuildOptions, Config, CoverageOptions, CoverageIgnoreOptions, FuzzConfig, ModeConfig, ReporterConfig, RunOptions, Runtime, } from "./types.js";
import chalk from "chalk";
import { createRequire } from "module";
import { delimiter, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
const CONFIG_META = new WeakMap();
export function formatTime(ms) {
    if (ms < 0) {
        throw new Error("Time should be a non-negative number.");
    }
    // Convert milliseconds to microseconds
    const us = ms * 1000;
    const units = [
        { name: "μs", divisor: 1 },
        { name: "ms", divisor: 1000 },
        { name: "s", divisor: 1000 * 1000 },
        { name: "m", divisor: 60 * 1000 * 1000 },
        { name: "h", divisor: 60 * 60 * 1000 * 1000 },
        { name: "d", divisor: 24 * 60 * 60 * 1000 * 1000 },
    ];
    for (let i = units.length - 1; i >= 0; i--) {
        const unit = units[i];
        if (us >= unit.divisor) {
            const value = Math.round((us / unit.divisor) * 1000) / 1000;
            return `${value}${unit.name}`;
        }
    }
    return `${us}us`;
}
export function loadConfig(CONFIG_PATH, warn = false) {
    const resolvedPath = resolve(CONFIG_PATH);
    const raw = readConfigRaw(resolvedPath, warn);
    return parseConfigRaw(raw, resolvedPath);
}
function readConfigRaw(configPath, warn) {
    if (!existsSync(configPath)) {
        if (warn) {
            console.log(`${chalk.bgMagentaBright(" WARN ")}${chalk.dim(":")} Could not locate config file in the current directory! Continuing with default config.`);
        }
        return {};
    }
    const rawText = readFileSync(configPath, "utf8");
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`invalid config JSON at ${configPath}\n${message}\nfix JSON syntax and rerun.`);
    }
    if (!parsed || typeof parsed != "object" || Array.isArray(parsed)) {
        throw new Error(`invalid config at ${configPath}\nroot value must be an object. Example: { "input": ["./assembly/__tests__/*.spec.ts"] }`);
    }
    const raw = parsed;
    validateConfig(raw, configPath);
    return raw;
}
function parseConfigRaw(raw, configPath) {
    const configDir = dirname(configPath);
    const config = Object.assign(new Config(), raw);
    applyOutputConfig(raw.output, raw, config);
    config.env = parseEnvValue(raw.env, configDir, "$.env");
    const runOptionsRaw = raw.runOptions ?? {};
    config.buildOptions = Object.assign(new BuildOptions(), raw.buildOptions ?? {});
    config.buildOptions.cmd =
        typeof config.buildOptions.cmd == "string" ? config.buildOptions.cmd : "";
    config.buildOptions.args = Array.isArray(config.buildOptions.args)
        ? config.buildOptions.args.filter((item) => typeof item == "string")
        : [];
    config.buildOptions.env = parseEnvValue(raw.buildOptions?.env, configDir, "$.buildOptions.env");
    config.buildOptions.target =
        typeof config.buildOptions.target == "string" &&
            config.buildOptions.target.length
            ? config.buildOptions.target
            : "wasi";
    config.runOptions = Object.assign(new RunOptions(), runOptionsRaw);
    const reporterRaw = runOptionsRaw.reporter;
    if (typeof reporterRaw == "string") {
        config.runOptions.reporter = reporterRaw;
    }
    else if (reporterRaw && typeof reporterRaw == "object") {
        const reporterConfig = Object.assign(new ReporterConfig(), reporterRaw);
        reporterConfig.name =
            typeof reporterConfig.name == "string" ? reporterConfig.name : "";
        reporterConfig.options = Array.isArray(reporterConfig.options)
            ? reporterConfig.options.filter((value) => typeof value == "string")
            : [];
        reporterConfig.outDir =
            typeof reporterConfig.outDir == "string" ? reporterConfig.outDir : "";
        reporterConfig.outFile =
            typeof reporterConfig.outFile == "string" ? reporterConfig.outFile : "";
        config.runOptions.reporter = reporterConfig;
    }
    else {
        config.runOptions.reporter = "";
    }
    const runtimeRaw = runOptionsRaw.runtime;
    const runtime = new Runtime();
    const legacyRun = typeof runOptionsRaw.run == "string" && runOptionsRaw.run.length
        ? runOptionsRaw.run
        : "";
    const cmd = runtimeRaw && typeof runtimeRaw.cmd == "string" && runtimeRaw.cmd.length
        ? runtimeRaw.cmd
        : runtimeRaw &&
            typeof runtimeRaw.run == "string" &&
            runtimeRaw.run.length
            ? runtimeRaw.run
            : legacyRun
                ? legacyRun
                : runtime.cmd;
    runtime.cmd = cmd;
    runtime.browser =
        runtimeRaw && typeof runtimeRaw.browser == "string"
            ? runtimeRaw.browser
            : "";
    config.runOptions.runtime = runtime;
    config.runOptions.env = parseEnvValue(runOptionsRaw.env, configDir, "$.runOptions.env");
    const fuzzRaw = raw.fuzz ?? {};
    config.fuzz = Object.assign(new FuzzConfig(), fuzzRaw);
    config.fuzz.input = Array.isArray(config.fuzz.input)
        ? config.fuzz.input.filter((item) => typeof item == "string")
        : typeof fuzzRaw.input == "string"
            ? [fuzzRaw.input]
            : new FuzzConfig().input;
    config.fuzz.runs = normalizePositiveNumber(config.fuzz.runs, 1000);
    config.fuzz.seed = normalizeNonNegativeNumber(config.fuzz.seed, -1);
    config.fuzz.maxInputBytes = normalizePositiveNumber(config.fuzz.maxInputBytes, 4096);
    config.fuzz.target =
        typeof config.fuzz.target == "string" && config.fuzz.target.length
            ? config.fuzz.target
            : "bindings";
    config.fuzz.corpusDir =
        typeof config.fuzz.corpusDir == "string" && config.fuzz.corpusDir.length
            ? config.fuzz.corpusDir
            : "./.as-test/fuzz/corpus";
    config.fuzz.crashDir =
        typeof config.fuzz.crashDir == "string" && config.fuzz.crashDir.length
            ? config.fuzz.crashDir
            : "./.as-test/crashes";
    config.modes = parseModes(raw.modes, configDir);
    CONFIG_META.set(config, {
        sourcePath: configPath,
        raw,
    });
    return config;
}
const TOP_LEVEL_KEYS = new Set([
    "$schema",
    "input",
    "output",
    "outDir",
    "logs",
    "coverageDir",
    "snapshotDir",
    "config",
    "coverage",
    "env",
    "buildOptions",
    "fuzz",
    "modes",
    "runOptions",
]);
const BUILD_OPTION_KEYS = new Set(["cmd", "args", "target", "env"]);
const RUN_OPTION_KEYS = new Set(["runtime", "reporter", "run", "env"]); // includes legacy "run"
const RUNTIME_OPTION_KEYS = new Set(["cmd", "run", "browser"]); // includes legacy "run"
const REPORTER_OPTION_KEYS = new Set(["name", "options", "outDir", "outFile"]);
const OUTPUT_OPTION_KEYS = new Set(["build", "logs", "coverage", "snapshots"]);
const FUZZ_OPTION_KEYS = new Set([
    "input",
    "runs",
    "seed",
    "maxInputBytes",
    "target",
    "corpusDir",
    "crashDir",
]);
const MODE_KEYS = new Set([...TOP_LEVEL_KEYS, "default"].filter((key) => key != "modes"));
function validateConfig(raw, configPath) {
    const issues = [];
    validateUnknownKeys(raw, TOP_LEVEL_KEYS, "$", issues);
    validateStringField(raw, "$schema", "$", issues);
    validateInputField(raw, "input", "$", issues);
    validateOutputField(raw, "output", "$", issues);
    validateStringField(raw, "outDir", "$", issues);
    validateStringField(raw, "logs", "$", issues);
    validateStringField(raw, "coverageDir", "$", issues);
    validateStringField(raw, "snapshotDir", "$", issues);
    validateStringField(raw, "config", "$", issues);
    validateCoverageField(raw, "coverage", "$", issues);
    validateEnvField(raw, "env", "$", issues);
    validateBuildOptionsField(raw, "buildOptions", "$", issues);
    validateFuzzField(raw, "fuzz", "$", issues);
    validateRunOptionsField(raw, "runOptions", "$", issues);
    validateModesField(raw, "modes", "$", issues);
    if (!issues.length)
        return;
    const lines = issues.map((issue, index) => {
        const suffix = issue.fix ? `\n     fix: ${issue.fix}` : "";
        return `${index + 1}. ${issue.path}: ${issue.message}${suffix}`;
    });
    throw new Error(`invalid config at ${configPath}\n${lines.join("\n")}\nrun "ast doctor" to check your setup.`);
}
function validateUnknownKeys(raw, allowed, pathPrefix, issues) {
    for (const key of Object.keys(raw)) {
        if (allowed.has(key))
            continue;
        const suggestion = resolveClosestKey(key, [...allowed]);
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "unknown property",
            fix: suggestion
                ? `use "${suggestion}" if that was intended, otherwise remove this property`
                : `remove this property`,
        });
    }
}
function validateInputField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (typeof value == "string") {
        if (!value.length) {
            issues.push({
                path: `${pathPrefix}.${key}`,
                message: "must not be an empty string",
                fix: "set to a glob pattern or remove it to use the default input patterns",
            });
        }
        return;
    }
    if (!Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be a string or array of strings",
            fix: 'example: "input": ["./assembly/__tests__/*.spec.ts"]',
        });
        return;
    }
    for (let i = 0; i < value.length; i++) {
        if (typeof value[i] == "string" && value[i].length)
            continue;
        issues.push({
            path: `${pathPrefix}.${key}[${i}]`,
            message: "must be a non-empty string",
            fix: "remove invalid entries or replace them with valid glob strings",
        });
    }
}
function validateStringField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    if (typeof raw[key] != "string") {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be a string",
            fix: `set "${key}" to a string value`,
        });
    }
}
function validateOutputField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (typeof value == "string") {
        if (!value.length) {
            issues.push({
                path: `${pathPrefix}.${key}`,
                message: "must not be an empty string",
                fix: 'example: "output": "./.as-test/"',
            });
        }
        return;
    }
    if (!value || typeof value != "object" || Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be a string or object",
            fix: 'example: "output": { "logs": "./.as-test/logs", "coverage": "./.as-test/coverage" }',
        });
        return;
    }
    const out = value;
    validateUnknownKeys(out, OUTPUT_OPTION_KEYS, `${pathPrefix}.${key}`, issues);
    if ("build" in out && (typeof out.build != "string" || !out.build.length)) {
        issues.push({
            path: `${pathPrefix}.${key}.build`,
            message: "must be a non-empty string",
        });
    }
    if ("snapshots" in out &&
        (typeof out.snapshots != "string" || !out.snapshots.length)) {
        issues.push({
            path: `${pathPrefix}.${key}.snapshots`,
            message: "must be a non-empty string",
        });
    }
    if ("logs" in out && (typeof out.logs != "string" || !out.logs.length)) {
        issues.push({
            path: `${pathPrefix}.${key}.logs`,
            message: 'must be a non-empty string or "none"',
        });
    }
    if ("coverage" in out &&
        (typeof out.coverage != "string" || !out.coverage.length)) {
        issues.push({
            path: `${pathPrefix}.${key}.coverage`,
            message: 'must be a non-empty string or "none"',
        });
    }
}
function validateCoverageField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    validateCoverageValue(raw[key], `${pathPrefix}.${key}`, issues);
}
function validateCoverageValue(value, path, issues) {
    if (typeof value == "boolean")
        return;
    if (!value || typeof value != "object" || Array.isArray(value)) {
        issues.push({
            path,
            message: "must be a boolean or object",
            fix: 'use true/false or { "enabled": true, "includeSpecs": false, "include": ["assembly/**/*.ts"], "exclude": ["assembly/__tests__/**/*.spec.ts"] }',
        });
        return;
    }
    const obj = value;
    if ("enabled" in obj && typeof obj.enabled != "boolean") {
        issues.push({
            path: `${path}.enabled`,
            message: "must be a boolean",
            fix: "set to true or false",
        });
    }
    if ("includeSpecs" in obj && typeof obj.includeSpecs != "boolean") {
        issues.push({
            path: `${path}.includeSpecs`,
            message: "must be a boolean",
            fix: "set to true or false",
        });
    }
    validateStringArrayField(obj, "include", path, issues);
    validateStringArrayField(obj, "exclude", path, issues);
    if ("ignore" in obj && obj.ignore != undefined) {
        if (!obj.ignore || typeof obj.ignore != "object" || Array.isArray(obj.ignore)) {
            issues.push({
                path: `${path}.ignore`,
                message: "must be an object",
                fix: 'set "ignore" to an object such as { "labels": ["Call"], "names": ["panic"] }',
            });
        }
        else {
            const ignore = obj.ignore;
            validateStringArrayField(ignore, "labels", `${path}.ignore`, issues);
            validateStringArrayField(ignore, "names", `${path}.ignore`, issues);
            validateStringArrayField(ignore, "locations", `${path}.ignore`, issues);
            validateStringArrayField(ignore, "snippets", `${path}.ignore`, issues);
        }
    }
}
function validateStringArrayField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (!Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be an array of strings",
            fix: `set "${key}" to an array of glob patterns`,
        });
        return;
    }
    for (let i = 0; i < value.length; i++) {
        if (typeof value[i] == "string" && value[i].length)
            continue;
        issues.push({
            path: `${pathPrefix}.${key}[${i}]`,
            message: "must be a non-empty string",
            fix: "remove invalid entries or replace them with valid glob strings",
        });
    }
}
function validateEnvField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (typeof value == "string") {
        if (!value.length) {
            issues.push({
                path: `${pathPrefix}.${key}`,
                message: "must not be an empty string",
                fix: 'use a .env file path like "./secrets/.env"',
            });
        }
        return;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (typeof item != "string" || !item.length) {
                issues.push({
                    path: `${pathPrefix}.${key}[${i}]`,
                    message: "must be a non-empty string",
                    fix: 'use entries like "FOO=1"',
                });
                continue;
            }
            const separator = item.indexOf("=");
            if (separator <= 0) {
                issues.push({
                    path: `${pathPrefix}.${key}[${i}]`,
                    message: 'must use "KEY=value" format',
                    fix: 'example: "FOO=1"',
                });
            }
        }
        return;
    }
    if (!value || typeof value != "object") {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be a .env file path, array of KEY=value strings, or object of string values",
            fix: 'example: "env": "./secrets/.env" or ["MY_FLAG=1"] or { "MY_FLAG": "1" }',
        });
        return;
    }
    for (const [name, item] of Object.entries(value)) {
        if (typeof item == "string")
            continue;
        issues.push({
            path: `${pathPrefix}.${key}.${name}`,
            message: "must be a string",
            fix: "set environment values as strings",
        });
    }
}
function validateBuildOptionsField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (!value || typeof value != "object" || Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be an object",
            fix: 'example: "buildOptions": { "cmd": "", "args": [], "target": "wasi" }',
        });
        return;
    }
    const obj = value;
    validateUnknownKeys(obj, BUILD_OPTION_KEYS, `${pathPrefix}.${key}`, issues);
    if ("cmd" in obj && typeof obj.cmd != "string") {
        issues.push({
            path: `${pathPrefix}.${key}.cmd`,
            message: "must be a string",
            fix: "set to an empty string or a command template",
        });
    }
    if ("args" in obj && !isStringArray(obj.args)) {
        issues.push({
            path: `${pathPrefix}.${key}.args`,
            message: "must be an array of strings",
            fix: 'example: "args": ["--optimize"]',
        });
    }
    if ("target" in obj) {
        if (typeof obj.target != "string") {
            issues.push({
                path: `${pathPrefix}.${key}.target`,
                message: "must be a string",
                fix: 'set to "wasi", "bindings", or "web"',
            });
        }
        else if (obj.target != "wasi" &&
            obj.target != "bindings" &&
            obj.target != "web") {
            issues.push({
                path: `${pathPrefix}.${key}.target`,
                message: `must be "wasi", "bindings", or "web"`,
                fix: `received "${obj.target}"`,
            });
        }
    }
    validateEnvField(obj, "env", `${pathPrefix}.${key}`, issues);
}
function validateRunOptionsField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (!value || typeof value != "object" || Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be an object",
            fix: 'example: "runOptions": { "runtime": { "cmd": "node ... <file>" } }',
        });
        return;
    }
    const obj = value;
    validateUnknownKeys(obj, RUN_OPTION_KEYS, `${pathPrefix}.${key}`, issues);
    if ("run" in obj && typeof obj.run != "string") {
        issues.push({
            path: `${pathPrefix}.${key}.run`,
            message: "must be a string",
            fix: 'prefer "runtime.cmd"; legacy "run" must still be string',
        });
    }
    if ("runtime" in obj && obj.runtime != undefined) {
        const runtime = obj.runtime;
        if (!runtime || typeof runtime != "object" || Array.isArray(runtime)) {
            issues.push({
                path: `${pathPrefix}.${key}.runtime`,
                message: "must be an object",
                fix: 'example: "runtime": { "cmd": "node ./.as-test/runners/default.wasi.js <file>" }',
            });
        }
        else {
            const runtimeObj = runtime;
            validateUnknownKeys(runtimeObj, RUNTIME_OPTION_KEYS, `${pathPrefix}.${key}.runtime`, issues);
            if ("cmd" in runtimeObj && typeof runtimeObj.cmd != "string") {
                issues.push({
                    path: `${pathPrefix}.${key}.runtime.cmd`,
                    message: "must be a string",
                    fix: 'set to a runtime command including "<file>"',
                });
            }
            if ("run" in runtimeObj && typeof runtimeObj.run != "string") {
                issues.push({
                    path: `${pathPrefix}.${key}.runtime.run`,
                    message: "must be a string",
                    fix: 'legacy "run" should be a command string',
                });
            }
            if ("browser" in runtimeObj && typeof runtimeObj.browser != "string") {
                issues.push({
                    path: `${pathPrefix}.${key}.runtime.browser`,
                    message: "must be a string",
                    fix: 'set to "chrome", "chromium", "firefox", "webkit", or an executable path',
                });
            }
        }
    }
    if ("reporter" in obj && obj.reporter != undefined) {
        const reporter = obj.reporter;
        if (typeof reporter == "string")
            return;
        if (!reporter || typeof reporter != "object" || Array.isArray(reporter)) {
            issues.push({
                path: `${pathPrefix}.${key}.reporter`,
                message: "must be a string or object",
                fix: 'use "default", "tap", or { "name": "...", ... }',
            });
            return;
        }
        const reporterObj = reporter;
        validateUnknownKeys(reporterObj, REPORTER_OPTION_KEYS, `${pathPrefix}.${key}.reporter`, issues);
        if ("name" in reporterObj && typeof reporterObj.name != "string") {
            issues.push({
                path: `${pathPrefix}.${key}.reporter.name`,
                message: "must be a string",
                fix: 'set to "default", "tap", or module path',
            });
        }
        if (!("name" in reporterObj)) {
            issues.push({
                path: `${pathPrefix}.${key}.reporter`,
                message: 'object reporter config requires "name"',
                fix: 'example: { "name": "tap", "outDir": "./.as-test/reports" }',
            });
        }
        if ("options" in reporterObj && !isStringArray(reporterObj.options)) {
            issues.push({
                path: `${pathPrefix}.${key}.reporter.options`,
                message: "must be an array of strings",
                fix: 'example: "options": ["single-file"]',
            });
        }
        if ("outDir" in reporterObj && typeof reporterObj.outDir != "string") {
            issues.push({
                path: `${pathPrefix}.${key}.reporter.outDir`,
                message: "must be a string",
            });
        }
        if ("outFile" in reporterObj && typeof reporterObj.outFile != "string") {
            issues.push({
                path: `${pathPrefix}.${key}.reporter.outFile`,
                message: "must be a string",
            });
        }
    }
    validateEnvField(obj, "env", `${pathPrefix}.${key}`, issues);
}
function validateFuzzField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (!value || typeof value != "object" || Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be an object",
            fix: 'example: "fuzz": { "input": ["./assembly/__fuzz__/*.fuzz.ts"], "runs": 1000 }',
        });
        return;
    }
    const obj = value;
    validateUnknownKeys(obj, FUZZ_OPTION_KEYS, `${pathPrefix}.${key}`, issues);
    validateInputField(obj, "input", `${pathPrefix}.${key}`, issues);
    validateStringField(obj, "target", `${pathPrefix}.${key}`, issues);
    validateStringField(obj, "corpusDir", `${pathPrefix}.${key}`, issues);
    validateStringField(obj, "crashDir", `${pathPrefix}.${key}`, issues);
    validateNumberField(obj, "runs", `${pathPrefix}.${key}`, issues, true);
    validateNumberField(obj, "seed", `${pathPrefix}.${key}`, issues, false);
    validateNumberField(obj, "maxInputBytes", `${pathPrefix}.${key}`, issues, true);
    if ("target" in obj && obj.target != "bindings") {
        issues.push({
            path: `${pathPrefix}.${key}.target`,
            message: 'must be "bindings"',
            fix: 'set to "bindings"',
        });
    }
}
function validateModesField(raw, key, pathPrefix, issues) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    const value = raw[key];
    if (!value || typeof value != "object" || Array.isArray(value)) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be an object",
            fix: 'example: "modes": { "wasi": { "buildOptions": { "target": "wasi" } } }',
        });
        return;
    }
    for (const [modeName, modeRaw] of Object.entries(value)) {
        if (typeof modeRaw == "string") {
            if (!modeRaw.length) {
                issues.push({
                    path: `${pathPrefix}.${key}.${modeName}`,
                    message: "must not be an empty string",
                    fix: 'set to a config file path like "./as-test.config.simd.json"',
                });
            }
            continue;
        }
        if (!modeRaw || typeof modeRaw != "object" || Array.isArray(modeRaw)) {
            issues.push({
                path: `${pathPrefix}.${key}.${modeName}`,
                message: "must be a config object or config file path string",
            });
            continue;
        }
        const modeObj = modeRaw;
        const modePath = `${pathPrefix}.${key}.${modeName}`;
        validateUnknownKeys(modeObj, MODE_KEYS, modePath, issues);
        validateStringField(modeObj, "$schema", modePath, issues);
        validateInputField(modeObj, "input", modePath, issues);
        if ("default" in modeObj && typeof modeObj.default != "boolean") {
            issues.push({
                path: `${modePath}.default`,
                message: "must be a boolean",
                fix: 'set "default" to true or false',
            });
        }
        validateOutputField(modeObj, "output", modePath, issues);
        validateStringField(modeObj, "outDir", modePath, issues);
        validateStringField(modeObj, "logs", modePath, issues);
        validateStringField(modeObj, "coverageDir", modePath, issues);
        validateStringField(modeObj, "snapshotDir", modePath, issues);
        validateStringField(modeObj, "config", modePath, issues);
        validateCoverageField(modeObj, "coverage", modePath, issues);
        validateFuzzField(modeObj, "fuzz", modePath, issues);
        validateEnvField(modeObj, "env", modePath, issues);
        validateBuildOptionsField(modeObj, "buildOptions", modePath, issues);
        validateRunOptionsField(modeObj, "runOptions", modePath, issues);
    }
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item == "string");
}
function validateNumberField(raw, key, pathPrefix, issues, positiveOnly) {
    if (!(key in raw) || raw[key] == undefined)
        return;
    if (typeof raw[key] != "number" || !Number.isFinite(raw[key])) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be a finite number",
            fix: `set "${key}" to a numeric value`,
        });
        return;
    }
    if (positiveOnly && Number(raw[key]) <= 0) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be greater than zero",
            fix: `set "${key}" to a positive integer`,
        });
        return;
    }
    if (!positiveOnly && Number(raw[key]) < 0) {
        issues.push({
            path: `${pathPrefix}.${key}`,
            message: "must be zero or greater",
            fix: `set "${key}" to a non-negative integer`,
        });
    }
}
function resolveClosestKey(value, keys) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const key of keys) {
        const distance = levenshteinDistance(value, key);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = key;
        }
    }
    if (best && bestDistance <= 3)
        return best;
    return null;
}
function levenshteinDistance(left, right) {
    if (left == right)
        return 0;
    if (!left.length)
        return right.length;
    if (!right.length)
        return left.length;
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
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[left.length][right.length];
}
function applyOutputConfig(rawOutput, rawConfig, config) {
    if (rawOutput == undefined)
        return;
    if (typeof rawOutput == "string") {
        applyOutputRoot(rawOutput, rawConfig, config);
        return;
    }
    if (!rawOutput || typeof rawOutput != "object" || Array.isArray(rawOutput)) {
        return;
    }
    const output = rawOutput;
    if ("build" in output &&
        typeof output.build == "string" &&
        output.build.length &&
        !("outDir" in rawConfig)) {
        config.outDir = output.build;
    }
    if ("logs" in output &&
        typeof output.logs == "string" &&
        output.logs.length &&
        !("logs" in rawConfig)) {
        config.logs = output.logs;
    }
    if ("coverage" in output &&
        typeof output.coverage == "string" &&
        output.coverage.length &&
        !("coverageDir" in rawConfig)) {
        config.coverageDir = output.coverage;
    }
    if ("snapshots" in output &&
        typeof output.snapshots == "string" &&
        output.snapshots.length &&
        !("snapshotDir" in rawConfig)) {
        config.snapshotDir = output.snapshots;
    }
}
function applyOutputRoot(root, rawConfig, config) {
    if (!root.length)
        return;
    if (!("outDir" in rawConfig)) {
        config.outDir = join(root, "build");
    }
    if (!("logs" in rawConfig)) {
        config.logs = join(root, "logs");
    }
    if (!("coverageDir" in rawConfig)) {
        config.coverageDir = join(root, "coverage");
    }
    if (!("snapshotDir" in rawConfig)) {
        config.snapshotDir = join(root, "snapshots");
    }
}
function parseModes(raw, configDir) {
    if (!raw || typeof raw != "object" || Array.isArray(raw))
        return {};
    const out = {};
    const entries = Object.entries(raw);
    for (const [name, value] of entries) {
        const mode = new ModeConfig();
        if (typeof value == "string") {
            mode.path = resolve(configDir, value);
            mode.config = parseConfigRaw({}, join(configDir, `__mode__.${name}.json`));
            out[name] = mode;
            continue;
        }
        if (!value || typeof value != "object" || Array.isArray(value))
            continue;
        mode.default =
            !("default" in value) ||
                Boolean(value.default);
        mode.config = parseConfigRaw(value, join(configDir, `__mode__.${name}.json`));
        out[name] = mode;
    }
    return out;
}
function parseEnvMap(raw) {
    if (!raw || typeof raw != "object" || Array.isArray(raw))
        return {};
    const env = {};
    for (const [key, val] of Object.entries(raw)) {
        if (typeof val == "string")
            env[key] = val;
    }
    return env;
}
function parseEnvValue(raw, configDir, pathLabel) {
    if (raw == undefined)
        return {};
    if (typeof raw == "string") {
        return parseEnvFile(resolve(configDir, raw), pathLabel);
    }
    if (Array.isArray(raw)) {
        return parseInlineEnvEntries(raw, pathLabel);
    }
    return parseEnvMap(raw);
}
function parseInlineEnvEntries(values, pathLabel) {
    const env = {};
    for (let i = 0; i < values.length; i++) {
        const item = values[i];
        if (typeof item != "string")
            continue;
        const separator = item.indexOf("=");
        if (separator <= 0) {
            throw new Error(`invalid config at ${pathLabel}\nenv entry at index ${i} must use KEY=value format`);
        }
        const key = item.slice(0, separator).trim();
        const value = item.slice(separator + 1);
        if (!key.length) {
            throw new Error(`invalid config at ${pathLabel}\nenv entry at index ${i} must use a non-empty key`);
        }
        env[key] = value;
    }
    return env;
}
function parseEnvFile(envPath, pathLabel) {
    if (!existsSync(envPath)) {
        throw new Error(`invalid config at ${pathLabel}\nenv file not found: ${envPath}`);
    }
    const env = {};
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        if (!line.length || line.startsWith("#"))
            continue;
        const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
        const separator = normalized.indexOf("=");
        if (separator <= 0) {
            throw new Error(`invalid config at ${pathLabel}\ninvalid env line ${i + 1} in ${envPath}: expected KEY=value`);
        }
        const key = normalized.slice(0, separator).trim();
        const value = normalized.slice(separator + 1).trim();
        env[key] = unquoteEnvValue(value);
    }
    return env;
}
function unquoteEnvValue(value) {
    if (value.length < 2)
        return value;
    const quote = value[0];
    if ((quote != '"' && quote != "'") || value[value.length - 1] != quote) {
        return value;
    }
    const inner = value.slice(1, -1);
    if (quote == "'")
        return inner;
    return inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
}
function normalizePositiveNumber(value, fallback) {
    if (typeof value != "number" || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
}
function normalizeNonNegativeNumber(value, fallback) {
    if (typeof value != "number" || !Number.isFinite(value) || value < 0) {
        return fallback;
    }
    return Math.floor(value);
}
function getConfigMeta(config) {
    const meta = CONFIG_META.get(config);
    if (!meta) {
        throw new Error("missing config metadata");
    }
    return meta;
}
function cloneCoverageOptions(coverage) {
    if (typeof coverage == "boolean")
        return coverage;
    const cloned = Object.assign(new CoverageOptions(), coverage);
    cloned.include = [...(coverage.include ?? [])];
    cloned.exclude = [...(coverage.exclude ?? [])];
    cloned.ignore = Object.assign(new CoverageIgnoreOptions(), coverage.ignore);
    cloned.ignore.labels = [...(coverage.ignore.labels ?? [])];
    cloned.ignore.names = [...(coverage.ignore.names ?? [])];
    cloned.ignore.locations = [...(coverage.ignore.locations ?? [])];
    cloned.ignore.snippets = [...(coverage.ignore.snippets ?? [])];
    return cloned;
}
function cloneBuildOptions(options) {
    const cloned = Object.assign(new BuildOptions(), options);
    cloned.args = [...options.args];
    cloned.env = { ...options.env };
    return cloned;
}
function cloneRuntime(runtime) {
    return Object.assign(new Runtime(), runtime);
}
function cloneReporterConfig(reporter) {
    if (typeof reporter == "string")
        return reporter;
    const cloned = Object.assign(new ReporterConfig(), reporter);
    cloned.options = [...(reporter.options ?? [])];
    return cloned;
}
function cloneRunOptions(options) {
    const cloned = Object.assign(new RunOptions(), options);
    cloned.runtime = cloneRuntime(options.runtime);
    cloned.reporter = cloneReporterConfig(options.reporter);
    cloned.env = { ...options.env };
    return cloned;
}
function cloneFuzzConfig(config) {
    const cloned = Object.assign(new FuzzConfig(), config);
    cloned.input = [...config.input];
    return cloned;
}
function cloneModeConfig(config) {
    const cloned = new ModeConfig();
    cloned.path = config.path;
    cloned.config = cloneConfig(config.config);
    return cloned;
}
function cloneConfig(config) {
    const cloned = Object.assign(new Config(), config);
    cloned.input = [...config.input];
    cloned.env = { ...config.env };
    cloned.buildOptions = cloneBuildOptions(config.buildOptions);
    cloned.runOptions = cloneRunOptions(config.runOptions);
    cloned.fuzz = cloneFuzzConfig(config.fuzz);
    cloned.coverage = cloneCoverageOptions(config.coverage);
    cloned.modes = Object.fromEntries(Object.entries(config.modes).map(([name, mode]) => [name, cloneModeConfig(mode)]));
    CONFIG_META.set(cloned, getConfigMeta(config));
    return cloned;
}
function outputOverridesField(raw, field) {
    if (field in raw)
        return true;
    if (!raw.output || typeof raw.output != "object" || Array.isArray(raw.output)) {
        return false;
    }
    const output = raw.output;
    if (field == "outDir")
        return typeof output.build == "string" && output.build.length > 0;
    if (field == "logs")
        return typeof output.logs == "string" && output.logs.length > 0;
    if (field == "coverageDir") {
        return typeof output.coverage == "string" && output.coverage.length > 0;
    }
    return typeof output.snapshots == "string" && output.snapshots.length > 0;
}
function mergeCoverageIgnoreOptions(base, override, raw) {
    const merged = Object.assign(new CoverageIgnoreOptions(), base);
    merged.labels = [...base.labels];
    merged.names = [...base.names];
    merged.locations = [...base.locations];
    merged.snippets = [...base.snippets];
    if ("labels" in raw)
        merged.labels = [...override.labels];
    if ("names" in raw)
        merged.names = [...override.names];
    if ("locations" in raw)
        merged.locations = [...override.locations];
    if ("snippets" in raw)
        merged.snippets = [...override.snippets];
    return merged;
}
function mergeCoverageConfig(base, override, raw) {
    if (typeof raw == "boolean")
        return override;
    if (!raw || typeof raw != "object" || Array.isArray(raw))
        return cloneCoverageOptions(base);
    const mergedBase = typeof base == "boolean"
        ? Object.assign(new CoverageOptions(), { enabled: base })
        : cloneCoverageOptions(base);
    const overrideOptions = typeof override == "boolean"
        ? Object.assign(new CoverageOptions(), { enabled: override })
        : cloneCoverageOptions(override);
    const rawObject = raw;
    if ("enabled" in rawObject)
        mergedBase.enabled = overrideOptions.enabled;
    if ("includeSpecs" in rawObject)
        mergedBase.includeSpecs = overrideOptions.includeSpecs;
    if ("include" in rawObject)
        mergedBase.include = [...overrideOptions.include];
    if ("exclude" in rawObject)
        mergedBase.exclude = [...overrideOptions.exclude];
    if (rawObject.ignore && typeof rawObject.ignore == "object" && !Array.isArray(rawObject.ignore)) {
        mergedBase.ignore = mergeCoverageIgnoreOptions(mergedBase.ignore, overrideOptions.ignore, rawObject.ignore);
    }
    return mergedBase;
}
function mergeReporterConfigByRaw(base, override, raw) {
    if (typeof raw == "string")
        return override;
    if (!raw || typeof raw != "object" || Array.isArray(raw)) {
        return cloneReporterConfig(base);
    }
    const mergedBase = typeof base == "string"
        ? new ReporterConfig()
        : cloneReporterConfig(base);
    const overrideConfig = typeof override == "string"
        ? new ReporterConfig()
        : cloneReporterConfig(override);
    const rawObject = raw;
    if ("name" in rawObject)
        mergedBase.name = overrideConfig.name;
    if ("options" in rawObject)
        mergedBase.options = [...overrideConfig.options];
    if ("outDir" in rawObject)
        mergedBase.outDir = overrideConfig.outDir;
    if ("outFile" in rawObject)
        mergedBase.outFile = overrideConfig.outFile;
    return mergedBase;
}
function mergeBuildOptions(base, override, raw) {
    const merged = cloneBuildOptions(base);
    if ("cmd" in raw)
        merged.cmd = override.cmd;
    if ("args" in raw)
        merged.args = [...override.args];
    if ("target" in raw)
        merged.target = override.target;
    if ("env" in raw) {
        merged.env = { ...override.env };
    }
    return merged;
}
function mergeRunOptions(base, override, raw) {
    const merged = cloneRunOptions(base);
    if ("runtime" in raw || "run" in raw) {
        const runtimeRaw = raw.runtime;
        if ("run" in raw || (runtimeRaw && ("cmd" in runtimeRaw || "run" in runtimeRaw))) {
            merged.runtime.cmd = override.runtime.cmd;
        }
        if (runtimeRaw && "browser" in runtimeRaw) {
            merged.runtime.browser = override.runtime.browser;
        }
    }
    if ("reporter" in raw) {
        merged.reporter = mergeReporterConfigByRaw(merged.reporter, override.reporter, raw.reporter);
    }
    if ("env" in raw) {
        merged.env = { ...override.env };
    }
    return merged;
}
function mergeFuzzConfig(base, override, raw) {
    const merged = cloneFuzzConfig(base);
    if ("input" in raw)
        merged.input = [...override.input];
    if ("runs" in raw)
        merged.runs = override.runs;
    if ("seed" in raw)
        merged.seed = override.seed;
    if ("maxInputBytes" in raw)
        merged.maxInputBytes = override.maxInputBytes;
    if ("target" in raw)
        merged.target = override.target;
    if ("corpusDir" in raw)
        merged.corpusDir = override.corpusDir;
    if ("crashDir" in raw)
        merged.crashDir = override.crashDir;
    return merged;
}
function mergeRootConfig(base, override) {
    const merged = cloneConfig(base);
    const raw = getConfigMeta(override).raw;
    if ("$schema" in raw)
        merged.$schema = override.$schema;
    if ("input" in raw)
        merged.input = [...override.input];
    if (outputOverridesField(raw, "outDir"))
        merged.outDir = override.outDir;
    if (outputOverridesField(raw, "logs"))
        merged.logs = override.logs;
    if (outputOverridesField(raw, "coverageDir")) {
        merged.coverageDir = override.coverageDir;
    }
    if (outputOverridesField(raw, "snapshotDir")) {
        merged.snapshotDir = override.snapshotDir;
    }
    if ("config" in raw)
        merged.config = override.config;
    if ("coverage" in raw) {
        merged.coverage = mergeCoverageConfig(merged.coverage, override.coverage, raw.coverage);
    }
    if ("env" in raw) {
        merged.env = { ...override.env };
    }
    if (raw.buildOptions && typeof raw.buildOptions == "object" && !Array.isArray(raw.buildOptions)) {
        merged.buildOptions = mergeBuildOptions(merged.buildOptions, override.buildOptions, raw.buildOptions);
    }
    if (raw.runOptions && typeof raw.runOptions == "object" && !Array.isArray(raw.runOptions)) {
        merged.runOptions = mergeRunOptions(merged.runOptions, override.runOptions, raw.runOptions);
    }
    if (raw.fuzz && typeof raw.fuzz == "object" && !Array.isArray(raw.fuzz)) {
        merged.fuzz = mergeFuzzConfig(merged.fuzz, override.fuzz, raw.fuzz);
    }
    CONFIG_META.set(merged, getConfigMeta(override));
    return merged;
}
function applyPerModeOutputDefaults(base, merged, override, modeName) {
    const raw = getConfigMeta(override).raw;
    if (!outputOverridesField(raw, "outDir")) {
        merged.outDir = appendPathSegment(base.outDir, modeName);
    }
    if (!outputOverridesField(raw, "logs") && base.logs != "none") {
        merged.logs = appendPathSegment(base.logs, modeName);
    }
    if (!outputOverridesField(raw, "coverageDir") && base.coverageDir != "none") {
        merged.coverageDir = appendPathSegment(base.coverageDir, modeName);
    }
}
function resolveModeOverrideConfig(root, modeName) {
    const mode = root.modes[modeName];
    if (!mode) {
        throw new Error(`unknown mode "${modeName}"`);
    }
    if (mode.path) {
        const override = loadConfig(mode.path, false);
        if (Object.keys(override.modes).length) {
            throw new Error(`mode "${modeName}" config file cannot declare nested modes`);
        }
        return override;
    }
    return cloneConfig(mode.config);
}
export function resolveModeNames(rawArgs) {
    const names = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg == "--mode") {
            const next = rawArgs[i + 1];
            if (!next || next.startsWith("-"))
                continue;
            i++;
            appendModeTokens(names, next);
            continue;
        }
        if (arg.startsWith("--mode=")) {
            appendModeTokens(names, arg.slice("--mode=".length));
        }
    }
    return [...new Set(names)];
}
export function getDefaultModeNames(config) {
    return Object.entries(config.modes)
        .filter(([, mode]) => mode.default !== false)
        .map(([name]) => name);
}
function appendModeTokens(out, value) {
    for (const token of value.split(",")) {
        const mode = token.trim();
        if (!mode.length)
            continue;
        out.push(mode);
    }
}
export function applyMode(config, modeName) {
    if (!modeName) {
        const merged = cloneConfig(config);
        merged.outDir = appendPathSegment(config.outDir, "default");
        if (config.logs != "none") {
            merged.logs = appendPathSegment(config.logs, "default");
        }
        if (config.coverageDir != "none") {
            merged.coverageDir = appendPathSegment(config.coverageDir, "default");
        }
        merged.fuzz.crashDir = appendPathSegment(config.fuzz.crashDir, "default");
        merged.fuzz.corpusDir = appendPathSegment(config.fuzz.corpusDir, "default");
        const env = {
            ...process.env,
            ...config.env,
        };
        if (merged.runOptions.runtime.browser.length) {
            env.BROWSER = merged.runOptions.runtime.browser;
        }
        return {
            config: merged,
            env,
        };
    }
    if (!config.modes[modeName]) {
        const known = Object.keys(config.modes);
        const available = known.length ? known.join(", ") : "(none)";
        throw new Error(`unknown mode "${modeName}". Available modes: ${available}`);
    }
    const modeOverride = resolveModeOverrideConfig(config, modeName);
    const merged = mergeRootConfig(config, modeOverride);
    applyPerModeOutputDefaults(config, merged, modeOverride, modeName);
    const env = {
        ...process.env,
        ...merged.env,
    };
    if (merged.runOptions.runtime.browser.length) {
        env.BROWSER = merged.runOptions.runtime.browser;
    }
    return {
        config: merged,
        env,
        modeName,
    };
}
function appendPathSegment(basePath, segment) {
    return join(basePath, segment);
}
export function getCliVersion() {
    const candidates = [
        join(process.cwd(), "package.json"),
        join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    ];
    for (const pkgPath of candidates) {
        if (!existsSync(pkgPath))
            continue;
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
            if (pkg.version)
                return pkg.version;
        }
        catch {
            // ignore invalid package metadata and continue to fallback candidate
        }
    }
    return "0.0.0";
}
export function getPkgRunner() {
    const userAgent = process.env.npm_config_user_agent ?? "";
    if (userAgent.startsWith("pnpm"))
        return "pnpx";
    if (userAgent.startsWith("yarn"))
        return "yarn";
    if (userAgent.startsWith("bun"))
        return "bunx";
    return "npx";
}
export function getExec(exec) {
    const PATH = (process.env.PATH ?? "").split(delimiter);
    for (const pathDir of PATH) {
        const fullPath = join(pathDir, exec + (process.platform === "win32" ? ".exe" : ""));
        if (existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}
export function tokenizeCommand(command) {
    const out = [];
    let current = "";
    let quote = null;
    let escaping = false;
    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (escaping) {
            current += ch;
            escaping = false;
            continue;
        }
        if (ch == "\\") {
            if (quote == "'") {
                current += ch;
            }
            else {
                escaping = true;
            }
            continue;
        }
        if (quote) {
            if (ch == quote) {
                quote = null;
            }
            else {
                current += ch;
            }
            continue;
        }
        if (ch == '"' || ch == "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (current.length) {
                out.push(current);
                current = "";
            }
            continue;
        }
        current += ch;
    }
    if (escaping) {
        current += "\\";
    }
    if (quote) {
        throw new Error(`unterminated quote in command: ${command}`);
    }
    if (current.length) {
        out.push(current);
    }
    return out;
}
export function resolveProjectModule(specifier) {
    const cwdRequire = createRequire(join(process.cwd(), "package.json"));
    const localRequire = createRequire(import.meta.url);
    for (const req of [cwdRequire, localRequire]) {
        try {
            return req.resolve(specifier);
        }
        catch {
            // try next resolver
        }
    }
    return null;
}
