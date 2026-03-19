import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { glob } from "glob";
import { build } from "./build-core.js";
import { applyMode, loadConfig } from "../util.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
const MAGIC = Buffer.from("WIPC");
const HEADER_SIZE = 9;
export async function fuzz(configPath = DEFAULT_CONFIG_PATH, selectors = [], modeName, overrides = {}) {
    const loadedConfig = loadConfig(configPath, false);
    const mode = applyMode(loadedConfig, modeName);
    const config = resolveFuzzConfig(loadedConfig.fuzz, overrides);
    const inputPatterns = resolveFuzzInputPatterns(config.input, selectors);
    const inputFiles = (await glob(inputPatterns)).sort((a, b) => a.localeCompare(b));
    if (!inputFiles.length) {
        throw new Error(`No fuzz files matched: ${selectors.length ? selectors.join(", ") : "configured input patterns"}`);
    }
    const duplicateBasenames = resolveDuplicateBasenames(inputFiles);
    const results = [];
    for (const file of inputFiles) {
        await build(configPath, [file], modeName, { coverage: false }, { target: "bindings", args: ["--use", "AS_TEST_FUZZ=1"] });
        results.push(await runFuzzTarget(file, mode.config.outDir, duplicateBasenames, config, modeName));
    }
    return results;
}
function resolveFuzzConfig(raw, overrides) {
    const config = Object.assign({}, raw, overrides);
    if (config.target != "bindings") {
        throw new Error(`fuzz target must be "bindings"; received "${config.target}"`);
    }
    return config;
}
async function runFuzzTarget(file, outDir, duplicateBasenames, config, modeName) {
    const startedAt = Date.now();
    const artifact = resolveArtifactFileName(file, duplicateBasenames, modeName);
    const wasmPath = path.resolve(process.cwd(), outDir, artifact);
    const jsPath = resolveBindingsHelperPath(wasmPath);
    const helper = await import(pathToFileURL(jsPath).href + `?t=${Date.now()}`);
    const binary = readFileSync(wasmPath);
    const module = new WebAssembly.Module(binary);
    let report = null;
    const restoreStdout = captureFrames((type, payload) => {
        if (type != 0x03)
            return;
        report = JSON.parse(payload.toString("utf8"));
    });
    const globalKey = "__as_test_request_fuzz_config";
    const previousConfig = Reflect.get(globalThis, globalKey);
    try {
        Reflect.set(globalThis, globalKey, () => `${config.runs}\n${config.seed}`);
        await helper.instantiate(module, {});
    }
    catch (error) {
        if (previousConfig === undefined) {
            Reflect.deleteProperty(globalThis, globalKey);
        }
        else {
            Reflect.set(globalThis, globalKey, previousConfig);
        }
        restoreStdout();
        const crashMessage = error instanceof Error ? error.stack ?? error.message : String(error);
        return {
            file,
            target: path.basename(file),
            runs: config.runs,
            crashes: 1,
            crashFiles: [persistCrash(config, file, crashMessage)],
            seed: config.seed,
            time: Date.now() - startedAt,
            fuzzers: [],
        };
    }
    if (previousConfig === undefined) {
        Reflect.deleteProperty(globalThis, globalKey);
    }
    else {
        Reflect.set(globalThis, globalKey, previousConfig);
    }
    restoreStdout();
    if (!report?.fuzzers) {
        throw new Error(`missing fuzz report payload from ${path.basename(file)}`);
    }
    return {
        file,
        target: path.basename(file),
        runs: report.fuzzers.reduce((sum, item) => sum + item.runs, 0),
        crashes: report.fuzzers.reduce((sum, item) => sum + item.crashed, 0),
        crashFiles: [],
        seed: config.seed,
        time: Date.now() - startedAt,
        fuzzers: report.fuzzers,
    };
}
function captureFrames(onFrame) {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let buffer = Buffer.alloc(0);
    process.stdout.write = ((chunk, ...args) => {
        if (!(chunk instanceof ArrayBuffer) && !Buffer.isBuffer(chunk)) {
            return originalWrite(chunk, ...args);
        }
        const incoming = Buffer.from(chunk);
        buffer = Buffer.concat([buffer, incoming]);
        while (true) {
            const index = buffer.indexOf(MAGIC);
            if (index == -1) {
                if (buffer.length) {
                    originalWrite(buffer);
                    buffer = Buffer.alloc(0);
                }
                return true;
            }
            if (index > 0) {
                originalWrite(buffer.subarray(0, index));
                buffer = buffer.subarray(index);
            }
            if (buffer.length < HEADER_SIZE)
                return true;
            const type = buffer.readUInt8(4);
            const length = buffer.readUInt32LE(5);
            const frameSize = HEADER_SIZE + length;
            if (buffer.length < frameSize)
                return true;
            const payload = buffer.subarray(HEADER_SIZE, frameSize);
            buffer = buffer.subarray(frameSize);
            onFrame(type, payload);
        }
    });
    return () => {
        process.stdout.write = originalWrite;
    };
}
function persistCrash(config, file, error) {
    const stem = path.basename(file, ".fuzz.ts");
    const crashDir = path.resolve(process.cwd(), config.crashDir, stem);
    mkdirSync(crashDir, { recursive: true });
    const fileBase = "crash";
    const jsonPath = path.join(crashDir, `${fileBase}.json`);
    writeFileSync(jsonPath, JSON.stringify({
        file,
        seed: config.seed,
        error,
    }, null, 2));
    return jsonPath;
}
function resolveFuzzInputPatterns(configured, selectors) {
    const configuredInputs = Array.isArray(configured)
        ? configured
        : [configured];
    if (!selectors.length)
        return configuredInputs;
    const patterns = new Set();
    for (const selector of expandSelectors(selectors)) {
        if (!selector)
            continue;
        if (isBareSelector(selector)) {
            const base = selector.replace(/\.fuzz\.ts$/, "").replace(/\.ts$/, "");
            for (const configuredInput of configuredInputs) {
                patterns.add(path.join(path.dirname(configuredInput), `${base}.fuzz.ts`));
            }
            continue;
        }
        patterns.add(selector);
    }
    return [...patterns];
}
function resolveArtifactFileName(file, duplicateBasenames, modeName) {
    const base = path
        .basename(file)
        .replace(/\.spec\.ts$/, "")
        .replace(/\.ts$/, "");
    const legacy = !modeName
        ? `${path.basename(file).replace(".ts", ".wasm")}`
        : `${base}.${modeName}.bindings.wasm`;
    if (!duplicateBasenames.has(path.basename(file))) {
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
function resolveBindingsHelperPath(wasmPath) {
    const bindingsPath = wasmPath.replace(/\.wasm$/, ".bindings.js");
    if (existsSync(bindingsPath))
        return bindingsPath;
    const directPath = wasmPath.replace(/\.wasm$/, ".js");
    if (existsSync(directPath))
        return directPath;
    return bindingsPath;
}
function expandSelectors(selectors) {
    const expanded = [];
    for (const selector of selectors) {
        if (selector.includes(",") &&
            !selector.includes("/") &&
            !selector.includes("\\") &&
            !/[*?[\]{}]/.test(selector)) {
            for (const token of selector.split(",")) {
                const trimmed = token.trim();
                if (trimmed.length)
                    expanded.push(trimmed);
            }
            continue;
        }
        expanded.push(selector);
    }
    return expanded;
}
function isBareSelector(selector) {
    return (!selector.includes("/") &&
        !selector.includes("\\") &&
        !/[*?[\]{}]/.test(selector));
}
