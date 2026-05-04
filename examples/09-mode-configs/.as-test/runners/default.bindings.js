import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const HOOKS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "./default.bindings.hooks.js",
);

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

function createRunnerContext({ wasmPath, module, helperPath }) {
  return {
    wasmPath,
    helperPath,
    module,
    argv: process.argv.slice(2),
    env: process.env,
    readFrame(size) {
      return readExact(Number(size ?? 0));
    },
    writeFrame(data) {
      writeRaw(data);
      return true;
    },
  };
}

function createAsTestImports(ctx) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => {
    if (chunk instanceof ArrayBuffer) {
      return ctx.writeFrame(chunk);
    }
    return originalWrite(chunk, ...args);
  };
  process.stdin.read = (size) => ctx.readFrame(size);
  return {};
}

function mergeImports(...groups) {
  const out = {};
  for (const group of groups) {
    if (!group || typeof group != "object") continue;
    for (const moduleName of Object.keys(group)) {
      out[moduleName] = Object.assign(out[moduleName] || {}, group[moduleName]);
    }
  }
  return out;
}

async function loadRunnerHooks() {
  if (!fs.existsSync(HOOKS_PATH)) {
    return {
      createUserImports() {
        return {};
      },
      async runModule(_exports, _ctx) {},
    };
  }
  const mod = await import(pathToFileURL(HOOKS_PATH).href + "?t=" + Date.now());
  return {
    createUserImports:
      typeof mod.createUserImports == "function"
        ? mod.createUserImports
        : () => ({}),
    runModule:
      typeof mod.runModule == "function" ? mod.runModule : async () => {},
  };
}

async function instantiateModule(ctx, hooks) {
  const helper = await import(pathToFileURL(ctx.helperPath).href);
  if (typeof helper.instantiate !== "function") {
    throw new Error("bindings helper missing instantiate export");
  }
  const imports = mergeImports(
    createAsTestImports(ctx),
    await hooks.createUserImports(ctx),
  );
  return helper.instantiate(ctx.module, imports);
}

const wasmPathArg = process.argv[2];
if (!wasmPathArg) {
  process.stderr.write("usage: node ./.as-test/runners/default.bindings.js <file.wasm>\n");
  process.exit(1);
}

const wasmPath = path.resolve(process.cwd(), wasmPathArg);
const jsPath = wasmPath.replace(/\.wasm$/, ".js");

try {
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const ctx = createRunnerContext({ wasmPath, module, helperPath: jsPath });
  const hooks = await loadRunnerHooks();
  const exports = await instantiateModule(ctx, hooks);
  await hooks.runModule(exports, ctx);
} catch (error) {
  process.stderr.write("failed to run bindings module: " + String(error) + "\n");
  process.exit(1);
}
