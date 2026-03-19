import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { glob } from "glob";
import { build } from "./build-core.js";
import { applyMode, loadConfig } from "../util.js";
import { persistCrashRecord } from "../crash-store.js";
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
    const captured = captureFrames((type, payload, respond) => {
        if (type == 0x02) {
            const event = JSON.parse(payload.toString("utf8"));
            if (String(event.kind ?? "") == "fuzz:config") {
                respond(`${config.runs}\n${config.seed}`);
            }
            else {
                respond("");
            }
            return;
        }
        if (type == 0x03) {
            report = JSON.parse(payload.toString("utf8"));
        }
    });
    try {
        await helper.instantiate(module, {});
    }
    catch (error) {
        const passthrough = captured.restore();
        const crashMessage = error instanceof Error ? error.stack ?? error.message : String(error);
        const crash = persistCrashRecord(config.crashDir, {
            kind: "fuzz",
            file,
            mode: modeName ?? "default",
            seed: config.seed,
            error: crashMessage,
            stdout: passthrough.stdout,
            stderr: "",
        });
        return {
            file,
            target: path.basename(file),
            runs: config.runs,
            crashes: 1,
            crashFiles: [crash.jsonPath],
            seed: config.seed,
            time: Date.now() - startedAt,
            fuzzers: [],
        };
    }
    const passthrough = captured.restore();
    if (!report?.fuzzers) {
        const crash = persistCrashRecord(config.crashDir, {
            kind: "fuzz",
            file,
            mode: modeName ?? "default",
            seed: config.seed,
            error: `missing fuzz report payload from ${path.basename(file)}`,
            stdout: passthrough.stdout,
            stderr: "",
        });
        return {
            file,
            target: path.basename(file),
            runs: config.runs,
            crashes: 1,
            crashFiles: [crash.jsonPath],
            seed: config.seed,
            time: Date.now() - startedAt,
            fuzzers: [],
        };
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
    const originalRead = typeof process.stdin.read == "function"
        ? process.stdin.read.bind(process.stdin)
        : null;
    let buffer = Buffer.alloc(0);
    let passthrough = Buffer.alloc(0);
    let replies = Buffer.alloc(0);
    function encodeReply(body) {
        const payload = Buffer.from(body, "utf8");
        const header = Buffer.alloc(HEADER_SIZE);
        MAGIC.copy(header, 0);
        header.writeUInt8(0x02, 4);
        header.writeUInt32LE(payload.length, 5);
        return Buffer.concat([header, payload]);
    }
    function dequeueReply(length) {
        const available = Math.min(length, replies.length);
        const view = replies.subarray(0, available);
        replies = replies.subarray(available);
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
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
                    passthrough = Buffer.concat([passthrough, buffer]);
                    originalWrite(buffer);
                    buffer = Buffer.alloc(0);
                }
                return true;
            }
            if (index > 0) {
                const raw = buffer.subarray(0, index);
                passthrough = Buffer.concat([passthrough, raw]);
                originalWrite(raw);
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
            onFrame(type, payload, (body) => {
                replies = Buffer.concat([replies, encodeReply(body)]);
            });
        }
    });
    process.stdin.read = ((size) => {
        const max = Number(size ?? 0);
        if (max > 0 && replies.length) {
            return dequeueReply(max);
        }
        if (originalRead) {
            return originalRead(size);
        }
        return null;
    });
    return {
        restore() {
            process.stdout.write = originalWrite;
            if (originalRead) {
                process.stdin.read = originalRead;
            }
            return {
                stdout: passthrough.toString("utf8"),
            };
        },
    };
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
