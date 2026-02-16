import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { getCliVersion, loadConfig } from "./util.js";
const TARGETS = ["wasi", "bindings"];
const EXAMPLE_MODES = ["minimal", "full", "none"];
export async function init(rawArgs) {
    const options = parseInitArgs(rawArgs);
    const root = path.resolve(process.cwd(), options.dir);
    const rl = options.yes
        ? null
        : createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    try {
        console.log(chalk.bold(`as-test init v${getCliVersion()}`) + "\n");
        const target = options.target ??
            (await askChoice("Select target", TARGETS, rl, "wasi"));
        const example = options.example ??
            (await askChoice("Select example mode", EXAMPLE_MODES, rl, "minimal"));
        printPlan(root, target, example);
        if (!options.yes) {
            const cont = (await ask("Continue? [y/n] ", rl)).toLowerCase().trim();
            if (!["y", "yes"].includes(cont)) {
                console.log("Exiting.");
                return;
            }
        }
        const summary = applyInit(root, target, example, options.force);
        printSummary(summary);
    }
    finally {
        rl?.close();
    }
}
function parseInitArgs(rawArgs) {
    const options = {
        yes: false,
        force: false,
        dir: ".",
    };
    const positional = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg == "--yes" || arg == "-y") {
            options.yes = true;
            continue;
        }
        if (arg == "--force") {
            options.force = true;
            continue;
        }
        if (arg == "--target") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                options.target = parseTarget(next);
                i++;
                continue;
            }
            throw new Error("--target requires a value: wasi|bindings");
        }
        if (arg.startsWith("--target=")) {
            options.target = parseTarget(arg.slice("--target=".length));
            continue;
        }
        if (arg == "--example") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                options.example = parseExampleMode(next);
                i++;
                continue;
            }
            throw new Error("--example requires a value: minimal|full|none");
        }
        if (arg.startsWith("--example=")) {
            options.example = parseExampleMode(arg.slice("--example=".length));
            continue;
        }
        if (arg == "--dir") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                options.dir = next;
                i++;
                continue;
            }
            throw new Error("--dir requires a path value");
        }
        if (arg.startsWith("--dir=")) {
            options.dir = arg.slice("--dir=".length);
            continue;
        }
        if (arg.startsWith("-")) {
            throw new Error(`Unknown init flag: ${arg}`);
        }
        positional.push(arg);
    }
    // First positional argument is always the target directory.
    if (positional.length > 0) {
        options.dir = positional.shift();
    }
    if (!options.target && positional.length > 0 && isTarget(positional[0])) {
        options.target = positional.shift();
    }
    if (!options.example && positional.length > 0 && isExampleMode(positional[0])) {
        options.example = positional.shift();
    }
    if (positional.length > 0) {
        throw new Error(`Unknown init argument(s): ${positional.join(", ")}. Usage: init [dir] [--target wasi|bindings] [--example minimal|full|none] [--yes] [--force] [--dir <path>]`);
    }
    return options;
}
function parseTarget(value) {
    if (!isTarget(value)) {
        throw new Error(`Invalid target "${value}". Expected wasi|bindings`);
    }
    return value;
}
function parseExampleMode(value) {
    if (!isExampleMode(value)) {
        throw new Error(`Invalid example mode "${value}". Expected minimal|full|none`);
    }
    return value;
}
function isTarget(value) {
    return TARGETS.includes(value);
}
function isExampleMode(value) {
    return EXAMPLE_MODES.includes(value);
}
function printPlan(root, target, example) {
    console.log(chalk.dim("Planned changes:\n"));
    console.log(chalk.dim(`  target: ${target}`));
    console.log(chalk.dim(`  example: ${example}`));
    console.log(chalk.dim(`  root: ${root}\n`));
    console.log(chalk.dim("  directories:"));
    console.log(chalk.dim("    .as-test/build"));
    console.log(chalk.dim("    .as-test/logs"));
    console.log(chalk.dim("    .as-test/coverage"));
    console.log(chalk.dim("    .as-test/snapshots"));
    console.log(chalk.dim("    assembly/__tests__"));
    if (target == "wasi" || target == "bindings") {
        console.log(chalk.dim("    .as-test/runners"));
    }
    console.log(chalk.dim("\n  files:"));
    console.log(chalk.dim("    as-test.config.json"));
    if (example != "none") {
        console.log(chalk.dim("    assembly/__tests__/example.spec.ts"));
    }
    if (target == "wasi") {
        console.log(chalk.dim("    .as-test/runners/default.wasi.js"));
    }
    if (target == "bindings") {
        console.log(chalk.dim("    .as-test/runners/default.run.js"));
    }
    console.log(chalk.dim("    package.json"));
    console.log("");
}
function applyInit(root, target, example, force) {
    const summary = {
        created: [],
        updated: [],
        skipped: [],
    };
    ensureDir(root, ".as-test/build", summary);
    ensureDir(root, ".as-test/logs", summary);
    ensureDir(root, ".as-test/coverage", summary);
    ensureDir(root, ".as-test/snapshots", summary);
    ensureDir(root, "assembly/__tests__", summary);
    if (target == "wasi" || target == "bindings") {
        ensureDir(root, ".as-test/runners", summary);
    }
    const configPath = path.join(root, "as-test.config.json");
    const config = loadConfig(configPath, false);
    config.$schema = "./node_modules/as-test/as-test.config.schema.json";
    config.buildOptions.target = target;
    if (target == "wasi") {
        config.runOptions.runtime.cmd = "node ./.as-test/runners/default.wasi.js <file>";
    }
    else {
        config.runOptions.runtime.cmd = "node ./.as-test/runners/default.run.js <file>";
    }
    writeJson(configPath, config, summary, "as-test.config.json");
    if (example != "none") {
        const examplePath = path.join(root, "assembly/__tests__/example.spec.ts");
        const content = example == "minimal" ? buildMinimalExampleSpec() : buildFullExampleSpec();
        writeManagedFile(examplePath, content, force, summary, "assembly/__tests__/example.spec.ts");
    }
    if (target == "wasi") {
        const runnerPath = path.join(root, ".as-test/runners/default.wasi.js");
        writeManagedFile(runnerPath, buildWasiRunner(), force, summary, ".as-test/runners/default.wasi.js");
    }
    if (target == "bindings") {
        const runnerPath = path.join(root, ".as-test/runners/default.run.js");
        writeManagedFile(runnerPath, buildBindingsRunner(), force, summary, ".as-test/runners/default.run.js");
    }
    const pkgPath = path.join(root, "package.json");
    const pkg = existsSync(pkgPath)
        ? JSON.parse(readFileSync(pkgPath, "utf8"))
        : {};
    if (!pkg.scripts || typeof pkg.scripts != "object") {
        pkg.scripts = {};
    }
    const scripts = pkg.scripts;
    if (!scripts.test) {
        scripts.test = "as-test test";
    }
    if (!pkg.devDependencies || typeof pkg.devDependencies != "object") {
        pkg.devDependencies = {};
    }
    const devDependencies = pkg.devDependencies;
    if (!devDependencies["as-test"]) {
        devDependencies["as-test"] = "^" + getCliVersion();
    }
    if (target == "wasi" && !devDependencies["@assemblyscript/wasi-shim"]) {
        devDependencies["@assemblyscript/wasi-shim"] = "^0.1.0";
    }
    if (target == "bindings" && !pkg.type) {
        pkg.type = "module";
    }
    writeJson(pkgPath, pkg, summary, "package.json");
    return summary;
}
function ensureDir(root, rel, summary) {
    const full = path.join(root, rel);
    if (existsSync(full))
        return;
    mkdirSync(full, { recursive: true });
    summary.created.push(rel + "/");
}
function writeJson(fullPath, value, summary, displayPath) {
    const rel = displayPath ??
        path.relative(process.cwd(), fullPath) ??
        path.basename(fullPath);
    const existed = existsSync(fullPath);
    const data = JSON.stringify(value, null, 2) + "\n";
    writeFileSync(fullPath, data);
    if (existed)
        summary.updated.push(rel);
    else
        summary.created.push(rel);
}
function writeManagedFile(fullPath, data, force, summary, displayPath) {
    const rel = displayPath ??
        path.relative(process.cwd(), fullPath) ??
        path.basename(fullPath);
    const existed = existsSync(fullPath);
    if (existed && !force) {
        summary.skipped.push(rel);
        return;
    }
    if (!existsSync(path.dirname(fullPath))) {
        mkdirSync(path.dirname(fullPath), { recursive: true });
    }
    writeFileSync(fullPath, data);
    if (existed)
        summary.updated.push(rel);
    else
        summary.created.push(rel);
}
function printSummary(summary) {
    console.log("");
    if (summary.created.length) {
        console.log(chalk.bold("Created:"));
        for (const item of summary.created) {
            console.log(`  + ${item}`);
        }
    }
    if (summary.updated.length) {
        console.log(chalk.bold("Updated:"));
        for (const item of summary.updated) {
            console.log(`  ~ ${item}`);
        }
    }
    if (summary.skipped.length) {
        console.log(chalk.bold("Skipped (exists, use --force to overwrite):"));
        for (const item of summary.skipped) {
            console.log(`  = ${item}`);
        }
    }
    console.log("\nNext: run " + chalk.bold("as-test test") + "\n");
}
function ask(question, face) {
    if (!face) {
        throw new Error("interactive input is unavailable; pass --yes with options");
    }
    return new Promise((res) => {
        face.question(question, (answer) => {
            res(answer);
        });
    });
}
async function askChoice(label, choices, face, fallback) {
    if (!face) {
        return fallback;
    }
    const answer = (await ask(`${label} [${choices.join("/")}] (${fallback}) -> `, face))
        .trim()
        .toLowerCase();
    if (!answer.length)
        return fallback;
    if (choices.includes(answer))
        return answer;
    throw new Error(`Invalid choice "${answer}" for ${label}`);
}
function buildMinimalExampleSpec() {
    return `import { describe, expect, test, run } from "as-test";

describe("example", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });
});

run();
`;
}
function buildFullExampleSpec() {
    return `import { afterAll, beforeAll, describe, expect, it, log, run, test } from "as-test";

beforeAll(() => {
  log("setup");
});

afterAll(() => {
  log("teardown");
});

describe("math", () => {
  test("addition", () => {
    expect(2 + 2).toBe(4);
  });

  test("comparisons", () => {
    expect(10).toBeGreaterThan(2);
    expect(2).toBeLessThan(10);
  });
});

describe("strings", () => {
  it("contains", () => {
    expect("assemblyscript").toContain("script");
  });

  test("prefix", () => {
    expect("as-test").toStartWith("as");
  });
});

run();
`;
}
function buildWasiRunner() {
    return `import { readFileSync } from "fs";
import { WASI } from "wasi";

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning, ...args) => {
  const type = typeof args[0] == "string" ? args[0] : "";
  const name = typeof warning?.name == "string" ? warning.name : type;
  const message =
    typeof warning == "string" ? warning : String(warning?.message ?? "");
  if (
    name == "ExperimentalWarning" &&
    message.includes("WASI is an experimental feature")
  ) {
    return;
  }
  return originalEmitWarning(warning, ...args);
});

const wasmPath = process.argv[2];
if (!wasmPath) {
  process.stderr.write("usage: node ./.as-test/runners/default.wasi.js <file.wasm>\\n");
  process.exit(1);
}

try {
  const wasi = new WASI({
    version: "preview1",
    args: [wasmPath],
    env: process.env,
    preopens: {},
  });

  const binary = readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.start(instance);
} catch (error) {
  process.stderr.write("failed to run WASI module: " + String(error) + "\\n");
  process.exit(1);
}
`;
}
function buildBindingsRunner() {
    return `import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

let patched = false;

function readExact(length) {
  const out = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let read = 0;
    try {
      read = fs.readSync(0, out, offset, length - offset, null);
    } catch (error) {
      if (error && error.code === "EAGAIN") {
        continue;
      }
      throw error;
    }
    if (!read) break;
    offset += read;
  }
  const view = out.subarray(0, offset);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function writeRaw(data) {
  const view = Buffer.from(data);
  fs.writeSync(1, view);
}

function withNodeIo(imports = {}) {
  if (!patched) {
    patched = true;
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      if (chunk instanceof ArrayBuffer) {
        writeRaw(chunk);
        return true;
      }
      return originalWrite(chunk, ...args);
    };
    process.stdin.read = (size) => readExact(Number(size ?? 0));
  }
  return imports;
}

const wasmPathArg = process.argv[2];
if (!wasmPathArg) {
  process.stderr.write("usage: node ./.as-test/runners/default.run.js <file.wasm>\\n");
  process.exit(1);
}

const wasmPath = path.resolve(process.cwd(), wasmPathArg);
const jsPath = wasmPath.replace(/\\.wasm$/, ".js");

try {
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const mod = await import(pathToFileURL(jsPath).href);
  if (typeof mod.instantiate !== "function") {
    throw new Error("bindings helper missing instantiate export");
  }
  mod.instantiate(module, withNodeIo({}));
} catch (error) {
  process.stderr.write("failed to run bindings module: " + String(error) + "\\n");
  process.exit(1);
}
`;
}
