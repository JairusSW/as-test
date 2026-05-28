import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { glob } from "glob";
import { build } from "./build-core.js";
import {
  applyMode,
  loadConfig,
  resolveArtifactPath,
  resolveSpecRelativePath,
} from "../util.js";
import type { FuzzConfig } from "../types.js";
import { persistCrashRecord } from "../crash-store.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
const MAGIC = Buffer.from("WIPC");
const HEADER_SIZE = 9;
// See cli/wipc.ts: the magic can occur by chance in passthrough output, so a
// declared length above this bound means the match is coincidental.
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const KNOWN_FRAME_TYPES = new Set([0x00, 0x01, 0x02, 0x03]);

export type FuzzRunOverride =
  | { kind: "set"; value: number }
  | { kind: "scale"; value: number }
  | { kind: "add"; value: number }
  | { kind: "percent-add"; value: number };

export type FuzzOverrides = {
  runs?: number;
  seed?: number;
  runsOverride?: FuzzRunOverride;
};

export type FuzzerRunResult = {
  name: string;
  selector?: string;
  runs: number;
  passed: number;
  failed: number;
  crashed: number;
  skipped: number;
  time: {
    start: number;
    end: number;
  };
  failure?: {
    instr: string;
    left: string;
    right: string;
    message: string;
  };
  failures?: {
    run: number;
    seed: number;
    input: unknown[] | null;
  }[];
  crashFile?: string;
};

export type FuzzResult = {
  file: string;
  target: string;
  modeName: string;
  runs: number;
  crashes: number;
  crashFiles: string[];
  seed: number;
  time: number;
  buildTime: number;
  buildStartedAt: number;
  buildFinishedAt: number;
  fuzzers: FuzzerRunResult[];
};

type FuzzPayload = {
  fuzzers?: FuzzerRunResult[];
};

type ResolvedFuzzConfig = FuzzConfig & {
  runsOverrideKind: number;
  runsOverrideValue: number;
};

const MAX_DEFAULT_SEED = 0x7fffffff;

export async function fuzz(
  configPath: string = DEFAULT_CONFIG_PATH,
  selectors: string[] = [],
  modeName?: string,
  overrides: FuzzOverrides = {},
  fuzzerSelectors: string[] = [],
): Promise<FuzzResult[]> {
  const loadedConfig = loadConfig(configPath, false);
  const mode = applyMode(loadedConfig, modeName);
  const activeConfig = mode.config;
  const config = resolveFuzzConfig(activeConfig.fuzz, overrides);
  const inputPatterns = resolveFuzzInputPatterns(config.input, selectors);
  const inputFiles = (await glob(inputPatterns)).sort((a, b) =>
    a.localeCompare(b),
  );

  if (!inputFiles.length) {
    throw new Error(
      `No fuzz files matched: ${selectors.length ? selectors.join(", ") : "configured input patterns"}`,
    );
  }

  const results: FuzzResult[] = [];
  for (const file of inputFiles) {
    const buildStartedAt = Date.now();
    await build(
      configPath,
      [file],
      modeName,
      { coverage: false },
      { target: "bindings", args: ["--use", "AS_TEST_FUZZ=1"], kind: "fuzz" },
      loadedConfig,
    );
    const buildFinishedAt = Date.now();
    const buildTime = buildFinishedAt - buildStartedAt;
    results.push(
      await runFuzzTarget(
        file,
        activeConfig.outDir,
        config,
        fuzzerSelectors,
        buildStartedAt,
        buildFinishedAt,
        buildTime,
        modeName,
      ),
    );
  }
  return results;
}

function resolveFuzzConfig(
  raw: FuzzConfig,
  overrides: FuzzOverrides,
): ResolvedFuzzConfig {
  const config = Object.assign({}, raw) as ResolvedFuzzConfig;
  if (typeof overrides.seed == "number") {
    config.seed = overrides.seed;
  } else if (config.seed < 0) {
    config.seed = generateRandomSeed();
  }
  if (typeof overrides.runs == "number") {
    config.runs = overrides.runs;
  }
  config.runsOverrideKind = 0;
  config.runsOverrideValue = 0;
  if (overrides.runsOverride) {
    config.runsOverrideKind = encodeRunsOverrideKind(
      overrides.runsOverride.kind,
    );
    config.runsOverrideValue = overrides.runsOverride.value;
    if (overrides.runsOverride.kind == "set") {
      config.runs = Math.max(1, Math.round(overrides.runsOverride.value));
    }
  }
  if (config.target != "bindings") {
    throw new Error(
      `fuzz target must be "bindings"; received "${config.target}"`,
    );
  }
  return config;
}

function generateRandomSeed(): number {
  return Math.floor(Math.random() * (MAX_DEFAULT_SEED + 1));
}

function encodeRunsOverrideKind(kind: FuzzRunOverride["kind"]): number {
  switch (kind) {
    case "set":
      return 1;
    case "scale":
      return 2;
    case "add":
      return 3;
    case "percent-add":
      return 4;
  }
}

async function runFuzzTarget(
  file: string,
  outDir: string,
  config: FuzzConfig,
  fuzzerSelectors: string[],
  buildStartedAt: number,
  buildFinishedAt: number,
  buildTime: number,
  modeName?: string,
): Promise<FuzzResult> {
  const startedAt = Date.now();
  const artifact = resolveArtifactPath(file, config.input);
  const wasmPath = path.resolve(process.cwd(), outDir, artifact);
  const jsPath = resolveBindingsHelperPath(wasmPath);
  const helper = await import(pathToFileURL(jsPath).href + `?t=${Date.now()}`);
  const binary = readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);

  let report: FuzzPayload | null = null;
  let reportParseError: string | null = null;
  const reportStream = {
    sawChunkStart: false,
    sawChunkEnd: false,
    chunkCountExpected: 0,
    chunkTotalBytesExpected: 0,
    chunkFramesReceived: 0,
    chunkBytesReceived: 0,
    chunks: [] as string[],
  };
  const captured = captureFrames((type, payload, respond) => {
    if (type == 0x02) {
      // A coincidental magic + CALL match whose payload is not JSON must not
      // crash the run (it would be misreported as a fuzz crash); drop it.
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
      } catch {
        return;
      }
      const kind = String(event.kind ?? "");
      if (kind == "fuzz:config") {
        const resolved = config as ResolvedFuzzConfig;
        respond(
          `${config.runs}\n${config.seed}\n${resolved.runsOverrideKind ?? 0}\n${resolved.runsOverrideValue ?? 0}`,
        );
      } else if (kind == "report:start") {
        reportStream.sawChunkStart = true;
        reportStream.sawChunkEnd = false;
        reportStream.chunkCountExpected = Number(event.chunkCount ?? 0);
        reportStream.chunkTotalBytesExpected = Number(event.totalBytes ?? 0);
        reportStream.chunkFramesReceived = 0;
        reportStream.chunkBytesReceived = 0;
        reportStream.chunks = [];
      } else if (kind == "report:end") {
        reportStream.sawChunkEnd = true;
      } else {
        respond("");
      }
      return;
    }
    if (type == 0x03) {
      if (reportStream.sawChunkStart && !reportStream.sawChunkEnd) {
        reportStream.chunkFramesReceived++;
        reportStream.chunkBytesReceived += payload.length;
        reportStream.chunks.push(payload.toString("utf8"));
      } else {
        try {
          report = JSON.parse(payload.toString("utf8")) as FuzzPayload;
          reportParseError = null;
        } catch (error) {
          reportParseError = String(error);
        }
      }
    }
  });

  try {
    await helper.instantiate(module, {});
  } catch (error) {
    const passthrough = captured.restore();
    const crashMessage =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    const crash = persistCrashRecord(config.crashDir, {
      kind: "fuzz",
      file,
      entryKey: buildFuzzCrashEntryKey(
        file,
        config.input,
        modeName ?? "default",
      ),
      mode: modeName ?? "default",
      seed: config.seed,
      error: crashMessage,
      stdout: passthrough.stdout,
      stderr: "",
    });
    return {
      file,
      target: path.basename(file),
      modeName: modeName ?? "default",
      runs: config.runs,
      crashes: 1,
      crashFiles: [crash.jsonPath],
      seed: config.seed,
      time: Date.now() - startedAt,
      buildTime,
      buildStartedAt,
      buildFinishedAt,
      fuzzers: [],
    };
  }

  const passthrough = captured.restore();
  if (reportStream.sawChunkStart) {
    if (reportStream.sawChunkEnd) {
      const chunkedPayload = reportStream.chunks.join("");
      try {
        report = JSON.parse(chunkedPayload) as FuzzPayload;
        reportParseError = null;
      } catch (error) {
        reportParseError = String(error);
      }
    }
  }
  if (!report?.fuzzers) {
    const diagnostics = [
      `chunked=${reportStream.sawChunkStart ? "yes" : "no"}`,
      `chunkStart=${reportStream.sawChunkStart ? "yes" : "no"}`,
      `chunkEnd=${reportStream.sawChunkEnd ? "yes" : "no"}`,
      `chunkFrames=${reportStream.chunkFramesReceived}`,
      `expectedChunkFrames=${reportStream.chunkCountExpected}`,
      `chunkBytes=${reportStream.chunkBytesReceived}`,
      `expectedChunkBytes=${reportStream.chunkTotalBytesExpected}`,
    ].join(", ");
    const crash = persistCrashRecord(config.crashDir, {
      kind: "fuzz",
      file,
      entryKey: buildFuzzCrashEntryKey(
        file,
        config.input,
        modeName ?? "default",
      ),
      mode: modeName ?? "default",
      seed: config.seed,
      error: `${reportParseError ? `invalid fuzz report payload: ${reportParseError}` : `missing fuzz report payload from ${path.basename(file)}`} (${diagnostics})`,
      stdout: passthrough.stdout,
      stderr: "",
    });
    return {
      file,
      target: path.basename(file),
      modeName: modeName ?? "default",
      runs: config.runs,
      crashes: 1,
      crashFiles: [crash.jsonPath],
      seed: config.seed,
      time: Date.now() - startedAt,
      buildTime,
      buildStartedAt,
      buildFinishedAt,
      fuzzers: [],
    };
  }

  const crashFiles: string[] = [];
  const selectedFuzzers = fuzzerSelectors.length
    ? filterSelectedFuzzers(report.fuzzers, fuzzerSelectors, file)
    : report.fuzzers;
  for (const fuzzer of selectedFuzzers) {
    if (fuzzer.failed <= 0 && fuzzer.crashed <= 0) continue;
    const firstFailureSeed =
      typeof fuzzer.failures?.[0]?.seed == "number"
        ? fuzzer.failures[0].seed
        : config.seed;
    const crash = persistCrashRecord(config.crashDir, {
      kind: "fuzz",
      file,
      entryKey: buildFuzzFailureEntryKey(
        file,
        config.input,
        fuzzer.name,
        modeName ?? "default",
      ),
      mode: modeName ?? "default",
      seed: firstFailureSeed,
      reproCommand: buildFuzzReproCommand(
        file,
        firstFailureSeed,
        modeName ?? "default",
        fuzzer.selector,
        1,
      ),
      error:
        fuzzer.failure?.message ||
        `fuzz failure in ${fuzzer.name} after ${fuzzer.runs} runs`,
      stdout: passthrough.stdout,
      stderr: "",
      failure: fuzzer.failure,
      failures: fuzzer.failures,
    });
    crashFiles.push(crash.jsonPath);
    fuzzer.crashFile = crash.jsonPath;
  }

  return {
    file,
    target: path.basename(file),
    modeName: modeName ?? "default",
    runs: selectedFuzzers.reduce((sum, item) => sum + item.runs, 0),
    crashes: selectedFuzzers.reduce((sum, item) => sum + item.crashed, 0),
    crashFiles,
    seed: config.seed,
    time: Date.now() - startedAt,
    buildTime,
    buildStartedAt,
    buildFinishedAt,
    fuzzers: selectedFuzzers,
  };
}

function filterSelectedFuzzers(
  fuzzers: FuzzerRunResult[],
  selectors: string[],
  file: string,
): FuzzerRunResult[] {
  const annotated = fuzzers.map((fuzzer) => ({
    ...fuzzer,
    selector: slugifyFuzzerSelector(fuzzer.name),
  }));
  const selected = new Set<string>();
  for (const selector of selectors) {
    const slug = slugifyFuzzerSelector(selector);
    if (!slug.length) continue;
    const matches = annotated.filter((fuzzer) => fuzzer.selector == slug);
    if (!matches.length) {
      throw new Error(
        `No fuzz targets matched "${selector}" in ${path.basename(file)}.`,
      );
    }
    for (const match of matches) {
      selected.add(match.selector);
    }
  }
  return annotated.filter((fuzzer) => selected.has(fuzzer.selector ?? ""));
}

function slugifyFuzzerSelector(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFuzzReproCommand(
  file: string,
  seed: number,
  modeName: string,
  fuzzer?: string,
  runs?: number,
): string {
  const modeArg = modeName != "default" ? ` --mode ${modeName}` : "";
  const fuzzerArg = fuzzer?.length ? ` --fuzzer ${fuzzer}` : "";
  const runsArg = typeof runs == "number" ? ` --runs ${runs}` : "";
  return `ast fuzz ${file}${modeArg}${fuzzerArg} --seed ${seed}${runsArg}`;
}

function buildFuzzFailureEntryKey(
  file: string,
  inputPatterns: string[] | string,
  name: string,
  modeName: string,
): string {
  const stem = resolveSpecRelativePath(file, inputPatterns).replace(
    /\.ts$/i,
    "",
  );
  return `${stem}.${sanitizeEntryName(modeName)}.${sanitizeEntryName(name)}`;
}

function buildFuzzCrashEntryKey(
  file: string,
  inputPatterns: string[] | string,
  modeName: string,
): string {
  const stem = resolveSpecRelativePath(file, inputPatterns).replace(
    /\.ts$/i,
    "",
  );
  return `${stem}.${sanitizeEntryName(modeName)}`;
}

function sanitizeEntryName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "fuzzer"
  );
}

function captureFrames(
  onFrame: (
    type: number,
    payload: Buffer,
    respond: (body: string) => void,
  ) => void,
): {
  restore(): { stdout: string };
} {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalRead =
    typeof process.stdin.read == "function"
      ? process.stdin.read.bind(process.stdin)
      : null;
  let buffer = Buffer.alloc(0);
  let passthrough = Buffer.alloc(0);
  let replies = Buffer.alloc(0);

  function encodeReply(body: string): Buffer {
    const payload = Buffer.from(body, "utf8");
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC.copy(header, 0);
    header.writeUInt8(0x02, 4);
    header.writeUInt32LE(payload.length, 5);
    return Buffer.concat([header, payload]);
  }

  function dequeueReply(length: number): ArrayBuffer {
    const available = Math.min(length, replies.length);
    const view = replies.subarray(0, available);
    replies = replies.subarray(available);
    return view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    );
  }

  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    if (!(chunk instanceof ArrayBuffer) && !Buffer.isBuffer(chunk)) {
      return originalWrite(chunk as never, ...(args as []));
    }
    const incoming = Buffer.from(chunk as ArrayBuffer);
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
      if (buffer.length < HEADER_SIZE) return true;
      const type = buffer.readUInt8(4);
      const length = buffer.readUInt32LE(5);
      // A coincidental magic match in passthrough output: an unknown type or
      // an implausible length means these 4 bytes are data, not a frame.
      // Emit them and resync past the magic so we don't stall or misparse.
      if (!KNOWN_FRAME_TYPES.has(type) || length > MAX_FRAME_SIZE) {
        const raw = buffer.subarray(0, MAGIC.length);
        passthrough = Buffer.concat([passthrough, raw]);
        originalWrite(raw);
        buffer = buffer.subarray(MAGIC.length);
        continue;
      }
      const frameSize = HEADER_SIZE + length;
      if (buffer.length < frameSize) return true;
      const payload = buffer.subarray(HEADER_SIZE, frameSize);
      buffer = buffer.subarray(frameSize);
      onFrame(type, payload, (body) => {
        replies = Buffer.concat([replies, encodeReply(body)]);
      });
    }
  }) as typeof process.stdout.write;
  process.stdin.read = ((size?: number | null) => {
    const max = size == null ? 0 : Number(size);
    if (max > 0 && replies.length) {
      return dequeueReply(max);
    }
    if (originalRead) {
      return originalRead(size === null ? undefined : size);
    }
    return null;
  }) as typeof process.stdin.read;

  return {
    restore() {
      process.stdout.write = originalWrite;
      if (originalRead) {
        process.stdin.read = originalRead as typeof process.stdin.read;
      }
      return {
        stdout: passthrough.toString("utf8"),
      };
    },
  };
}

function resolveFuzzInputPatterns(
  configured: string[] | string,
  selectors: string[],
): string[] {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;
  const patterns = new Set<string>();
  for (const selector of expandSelectors(selectors)) {
    if (!selector) continue;
    if (isBareSelector(selector)) {
      const base = selector.replace(/\.fuzz\.ts$/, "").replace(/\.ts$/, "");
      for (const configuredInput of configuredInputs) {
        patterns.add(
          path.join(path.dirname(configuredInput), `${base}.fuzz.ts`),
        );
      }
      continue;
    }
    patterns.add(selector);
  }
  return [...patterns];
}

function resolveBindingsHelperPath(wasmPath: string): string {
  const bindingsPath = wasmPath.replace(/\.wasm$/, ".bindings.js");
  if (existsSync(bindingsPath)) return bindingsPath;
  const directPath = wasmPath.replace(/\.wasm$/, ".js");
  if (existsSync(directPath)) return directPath;
  return bindingsPath;
}

function expandSelectors(selectors: string[]): string[] {
  const expanded: string[] = [];
  for (const selector of selectors) {
    if (
      selector.includes(",") &&
      !selector.includes("/") &&
      !selector.includes("\\") &&
      !/[*?[\]{}]/.test(selector)
    ) {
      for (const token of selector.split(",")) {
        const trimmed = token.trim();
        if (trimmed.length) expanded.push(trimmed);
      }
      continue;
    }
    expanded.push(selector);
  }
  return expanded;
}

function isBareSelector(selector: string): boolean {
  return (
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}
