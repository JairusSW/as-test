import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export const runnerImports = {
  env: {
    // Add synchronous custom imports here. Example:
    // "host.add"(a, b) {
    //   return Number(a) + Number(b);
    // },
  },
};

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

function mergeImportMaps(...sources) {
  const out = {};
  for (const source of sources) {
    if (!source || typeof source != "object" || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (
        value &&
        typeof value == "object" &&
        !Array.isArray(value) &&
        typeof value != "function"
      ) {
        out[key] = mergeImportMaps(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

export function createRunnerImports(extraImports = {}) {
  return mergeImportMaps(runnerImports, extraImports);
}

export function withNodeIo(imports = {}) {
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

export async function runBindingsModule(wasmPathArg, extraImports = {}) {
  if (!wasmPathArg) {
    throw new Error(
      "usage: node ./.as-test/runners/default.bindings.js <file.wasm>",
    );
  }
  const wasmPath = path.resolve(process.cwd(), wasmPathArg);
  const jsPath = wasmPath.replace(/\.wasm$/, ".js");
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const mod = await import(pathToFileURL(jsPath).href);
  if (typeof mod.instantiate !== "function") {
    throw new Error("bindings helper missing instantiate export");
  }
  return mod.instantiate(module, withNodeIo(createRunnerImports(extraImports)));
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url == pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  runBindingsModule(process.argv[2]).catch((error) => {
    process.stderr.write(
      "failed to run bindings module: " + String(error) + "\n",
    );
    process.exit(1);
  });
}
