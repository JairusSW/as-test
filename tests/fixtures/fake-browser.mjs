import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const url = [...process.argv]
  .reverse()
  .find((value) => /^https?:\/\//.test(value));
if (!url) {
  process.stderr.write("fake-browser requires a runner URL\n");
  process.exit(1);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "as-test-browser-"));
const page = await fetchWithRetry(url);
if (!page.ok) {
  throw new Error(`failed to fetch runner page: ${page.status}`);
}
const html = await page.text();
const envMatch = html.match(/window\.__AS_TEST_ENV__ = (\{.*?\});<\/script>/s);
if (!envMatch) {
  throw new Error("failed to locate injected runtime env");
}
const runtimeEnv = JSON.parse(envMatch[1]);
const wasmResponse = await fetch(new URL(runtimeEnv.AS_TEST_WASM_PATH, url));
if (!wasmResponse.ok) {
  throw new Error(`failed to fetch wasm artifact: ${wasmResponse.status}`);
}
const wasmPath = path.join(
  tempRoot,
  path.basename(String(runtimeEnv.AS_TEST_WASM_PATH)),
);
await fs.writeFile(wasmPath, Buffer.from(await wasmResponse.arrayBuffer()));

let helperPath = null;
if (runtimeEnv.AS_TEST_HELPER_PATH) {
  const helperResponse = await fetch(
    new URL(runtimeEnv.AS_TEST_HELPER_PATH, url),
  );
  if (!helperResponse.ok) {
    throw new Error(
      `failed to fetch helper artifact: ${helperResponse.status}`,
    );
  }
  helperPath = path.join(
    tempRoot,
    path.basename(String(runtimeEnv.AS_TEST_HELPER_PATH)),
  );
  await fs.writeFile(helperPath, await helperResponse.text(), "utf8");
}

const websocketUrl = url.replace(/^http/, "ws") + "ws";
const socket = new WebSocket(websocketUrl);
const closePhase = process.env.AS_TEST_FAKE_BROWSER_CLOSE_PHASE ?? "";

let started = false;
let closed = false;
let instance = null;

const realProcess = globalThis.process;

globalThis.process = {
  env: runtimeEnv,
  versions: realProcess.versions,
  stdout: {
    write(data) {
      const frame = data instanceof ArrayBuffer ? data : data?.buffer;
      if (frame) {
        socket.send(frame);
      }
      return true;
    },
  },
  stderr: {
    write(data) {
      realProcess.stderr.write(String(data));
      return true;
    },
  },
  stdin: {
    read() {
      return new ArrayBuffer(0);
    },
  },
};

socket.binaryType = "arraybuffer";
socket.addEventListener("open", async () => {
  if (closePhase == "open") {
    socket.close();
    return;
  }
  socket.send(JSON.stringify({ kind: "ready" }));
  instance = await instantiate(runtimeEnv, wasmPath, helperPath);
  if (closePhase == "instantiated") {
    socket.close();
    return;
  }
  socket.send(JSON.stringify({ kind: "instantiated" }));
});

socket.addEventListener("message", (event) => {
  if (typeof event.data != "string") {
    return;
  }
  const message = JSON.parse(event.data);
  if (message.kind == "start" && !started) {
    started = true;
    if (closePhase == "start") {
      socket.close();
      return;
    }
    instance?.exports?.start?.();
    socket.send(JSON.stringify({ kind: "done" }));
    setTimeout(() => socket.close(), 10);
  }
});

socket.addEventListener("close", () => {
  closed = true;
});

socket.addEventListener("error", (error) => {
  if (closed) return;
  process.stderr?.write?.(String(error) + "\n");
  process.exit(1);
});

async function instantiate(runtimeEnv, wasmPath, helperPath) {
  const binary = await fs.readFile(wasmPath);
  const module = new WebAssembly.Module(binary);
  const kind = String(runtimeEnv.AS_TEST_BINDINGS_KIND ?? "raw");
  if (kind == "raw") {
    const helper = await import(pathToFileURL(helperPath).href);
    const captured = await captureInstantiateInstance(async () => {
      await helper.instantiate(module, {});
    });
    return decorateInstance(captured);
  }
  if (kind == "esm") {
    const captured = await captureInstantiateInstance(async () => {
      await import(pathToFileURL(helperPath).href);
    });
    return decorateInstance(captured);
  }
  const result = await WebAssembly.instantiate(module, {});
  const wasmInstance =
    result instanceof WebAssembly.Instance ? result : result.instance;
  return decorateInstance(wasmInstance);
}

async function captureInstantiateInstance(run) {
  const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  let captured = null;
  WebAssembly.instantiate = async (source, imports) => {
    const result = await originalInstantiate(source, imports);
    captured =
      result instanceof WebAssembly.Instance ? result : result.instance;
    return result;
  };
  try {
    await run();
  } finally {
    WebAssembly.instantiate = originalInstantiate;
  }
  if (!captured) {
    throw new Error("failed to capture wasm instance");
  }
  return captured;
}

function decorateInstance(instance) {
  const exports = instance.exports ?? {};
  if (typeof exports.start == "function") {
    return instance;
  }
  const startFn = exports._start;
  if (typeof startFn != "function") {
    return instance;
  }
  const exportsProxy = new Proxy(exports, {
    get(target, prop, receiver) {
      if (prop == "start") {
        return () => startFn.call(target);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (prop == "start") return true;
      return Reflect.has(target, prop);
    },
  });
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (prop == "exports") return exportsProxy;
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function fetchWithRetry(resource, attempts = 20, delayMs = 50) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(resource);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error(`failed to fetch ${String(resource)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
