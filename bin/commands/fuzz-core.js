import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { glob } from "glob";
import { build } from "./build-core.js";
import { applyMode, loadConfig } from "../util.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
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
        await build(configPath, [file], modeName, { coverage: false }, {
            target: "bindings",
        });
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
    const helper = await import(pathToFileURL(jsPath).href);
    const binary = readFileSync(wasmPath);
    const module = new WebAssembly.Module(binary);
    const crashFiles = [];
    const corpus = loadCorpusInputs(config, file);
    let crashes = 0;
    for (let iteration = 0; iteration < config.runs; iteration++) {
        const seed = (config.seed + iteration) >>> 0;
        const input = mutateInput(corpus, seed, config.maxInputBytes);
        try {
            const exports = await helper.instantiate(module, {});
            const target = exports?.[config.entry];
            if (typeof target != "function") {
                throw new Error(`fuzz export "${config.entry}" not found`);
            }
            target(input);
            if (typeof exports.__collect == "function") {
                exports.__collect();
            }
        }
        catch (error) {
            crashes++;
            crashFiles.push(persistCrash(config, file, iteration, seed, input, error));
            break;
        }
    }
    return {
        file,
        target: `${path.basename(file)}:${config.entry}`,
        runs: config.runs,
        crashes,
        crashFiles,
        seed: config.seed,
        time: Date.now() - startedAt,
    };
}
function loadCorpusInputs(config, file) {
    const stem = path.basename(file, ".fuzz.ts");
    const dir = path.resolve(process.cwd(), config.corpusDir, stem);
    if (!existsSync(dir))
        return [new Uint8Array(0)];
    const entries = readdirSync(dir)
        .filter((entry) => !entry.startsWith("."))
        .sort((a, b) => a.localeCompare(b));
    if (!entries.length)
        return [new Uint8Array(0)];
    return entries.map((entry) => new Uint8Array(readFileSync(path.join(dir, entry))));
}
function mutateInput(corpus, seed, maxInputBytes) {
    const rand = mulberry32(seed);
    const base = corpus[Math.floor(rand() * corpus.length)] ?? new Uint8Array(0);
    const nextLength = Math.max(1, Math.min(maxInputBytes, base.length + Math.floor(rand() * 9) - Math.floor(rand() * 5)));
    const out = new Uint8Array(nextLength);
    for (let i = 0; i < out.length; i++) {
        out[i] = i < base.length ? base[i] : Math.floor(rand() * 256);
    }
    const edits = Math.max(1, Math.min(8, Math.floor(rand() * 8) + 1));
    for (let i = 0; i < edits; i++) {
        out[Math.floor(rand() * out.length)] = Math.floor(rand() * 256);
    }
    return out;
}
function persistCrash(config, file, iteration, seed, input, error) {
    const stem = path.basename(file, ".fuzz.ts");
    const crashDir = path.resolve(process.cwd(), config.crashDir, stem);
    mkdirSync(crashDir, { recursive: true });
    const fileBase = String(iteration).padStart(6, "0");
    const binPath = path.join(crashDir, `${fileBase}.bin`);
    const jsonPath = path.join(crashDir, `${fileBase}.json`);
    writeFileSync(binPath, Buffer.from(input));
    writeFileSync(jsonPath, JSON.stringify({
        file,
        seed,
        iteration,
        entry: config.entry,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        inputFile: path.relative(process.cwd(), binPath),
    }, null, 2));
    return binPath;
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
function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let current = value;
        current = Math.imul(current ^ (current >>> 15), current | 1);
        current ^= current + Math.imul(current ^ (current >>> 7), current | 61);
        return ((current ^ (current >>> 14)) >>> 0) / 4294967296;
    };
}
