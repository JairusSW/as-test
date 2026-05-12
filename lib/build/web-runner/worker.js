export function buildWebRunnerWorkerSource() {
    return String.raw `let replyState = null;
let replyBytes = null;
const WIPC_MAGIC = [0x57, 0x49, 0x50, 0x43];
let runtimeEnv = {};
let instance = null;

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.kind == "init") {
    const shared = message.replyBuffer;
    replyState = new Int32Array(shared, 0, 2);
    replyBytes = new Uint8Array(shared, 8);
    try {
      self.postMessage({
        kind: "status",
        level: "accent",
        text: "initializing",
        summary: "worker resolving runtime imports",
        footer: "Loading wasm assets in the browser worker.",
      });
      runtimeEnv = message.env ?? {};
      applyRuntimeEnvironment(runtimeEnv);
      instance = await instantiate({});
      self.postMessage({ kind: "instantiated" });
    } catch (error) {
      emitError(error);
    }
    return;
  }
  if (message.kind == "start") {
    try {
      if (!instance) {
        throw new Error("web runtime has not been instantiated yet");
      }
      instance.exports.start?.();
      self.postMessage({ kind: "done" });
    } catch (error) {
      emitError(error);
    }
  }
};

function emitError(error) {
  const message =
    error && typeof error == "object" && "stack" in error
      ? String(error.stack)
      : String(error);
  self.postMessage({ kind: "error", message });
}

function readReply(max) {
  if (!replyState || !replyBytes || max <= 0) {
    return new ArrayBuffer(0);
  }
  while (Atomics.load(replyState, 0) == 0) {
    Atomics.wait(replyState, 0, 0);
  }
  const total = Atomics.load(replyState, 1);
  const size = Math.min(max, total);
  const out = new Uint8Array(size);
  out.set(replyBytes.subarray(0, size));
  if (size < total) {
    replyBytes.copyWithin(0, size, total);
    Atomics.store(replyState, 1, total - size);
  } else {
    Atomics.store(replyState, 1, 0);
    Atomics.store(replyState, 0, 0);
    Atomics.notify(replyState, 0, 1);
  }
  return out.buffer;
}

function applyRuntimeEnvironment(env) {
  self.process = {
    env,
    stdout: {
      write(data) {
        const frame = data instanceof ArrayBuffer ? data : data?.buffer;
        if (frame) {
          mirrorFrame(frame);
          self.postMessage({ kind: "wipc", frame }, [frame]);
        }
        return true;
      },
    },
    stdin: {
      read(size) {
        return readReply(Number(size ?? 0));
      },
    },
  };
}

async function instantiate(imports) {
  const wasmUrl = String(runtimeEnv.AS_TEST_WASM_PATH ?? "");
  const helperUrl = String(runtimeEnv.AS_TEST_HELPER_PATH ?? "");
  const kind = String(runtimeEnv.AS_TEST_BINDINGS_KIND ?? "raw");
  if (!wasmUrl) {
    throw new Error("web runtime wasm path is missing");
  }
  if (kind === "raw") {
    if (!helperUrl) {
      throw new Error("web runtime helper path is missing for raw bindings");
    }
    const binary = await fetchWasmBinary(wasmUrl);
    const module = new WebAssembly.Module(binary);
    const helper = await import(helperUrl);
    if (typeof helper.instantiate != "function") {
      throw new Error("bindings helper missing instantiate export");
    }
    const instance = await captureInstantiateInstance(async () => {
      await helper.instantiate(module, imports);
    });
    return decorateInstance(instance);
  }
  if (kind === "esm") {
    if (!helperUrl) {
      throw new Error("web runtime helper path is missing for esm bindings");
    }
    const instance = await captureInstantiateInstance(async () => {
      await import(helperUrl);
    });
    return decorateInstance(instance);
  }
  const binary = await fetchWasmBinary(wasmUrl);
  const module = new WebAssembly.Module(binary);
  const result = await WebAssembly.instantiate(module, imports);
  const instance = result instanceof WebAssembly.Instance ? result : result.instance;
  return decorateInstance(instance);
}

async function fetchWasmBinary(wasmUrl) {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error("failed to fetch wasm artifact: " + response.status);
  }
  return response.arrayBuffer();
}

async function captureInstantiateInstance(run) {
  const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  let captured = null;
  WebAssembly.instantiate = async (source, importObject) => {
    const result = await originalInstantiate(source, importObject);
    if (result instanceof WebAssembly.Instance) {
      captured = result;
    } else {
      captured = result.instance;
    }
    return result;
  };
  try {
    await run();
  } finally {
    WebAssembly.instantiate = originalInstantiate;
  }
  if (!captured) {
    throw new Error("failed to capture WebAssembly.Instance in web worker");
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

function mirrorFrame(frame) {
  if (!(frame instanceof ArrayBuffer)) return;
  const bytes = new Uint8Array(frame);
  if (
    bytes.length < 9 ||
    bytes[0] !== WIPC_MAGIC[0] ||
    bytes[1] !== WIPC_MAGIC[1] ||
    bytes[2] !== WIPC_MAGIC[2] ||
    bytes[3] !== WIPC_MAGIC[3]
  ) {
    return;
  }
  const type = bytes[4];
  const size =
    bytes[5] |
    (bytes[6] << 8) |
    (bytes[7] << 16) |
    (bytes[8] << 24);
  const payload = bytes.subarray(9, 9 + size);
  if (type !== 0x02) return;
  let raw = "";
  try {
    raw = new TextDecoder().decode(payload);
  } catch {
    return;
  }
  if (!raw.length) return;
  let message = null;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  renderControl(message);
}

function renderControl(message) {
  if (!message || typeof message !== "object") return;
  const kind = String(message.kind ?? "");
  if (kind === "event:file-start") {
    self.postMessage({ kind: "terminal", level: "accent prompt", text: "running " + String(message.file ?? "spec") });
    return;
  }
  if (kind === "event:file-end") {
    const verdict = String(message.verdict ?? "done").toUpperCase();
    const time = String(message.time ?? "");
    self.postMessage({
      kind: "terminal",
      level: verdict === "PASS" ? "success" : "error",
      text: verdict + " " + String(message.file ?? "") + (time ? " " + time : ""),
    });
    return;
  }
  if (kind === "event:suite-start") {
    const depth = Number(message.depth ?? 0);
    const indent = "  ".repeat(Math.max(0, depth));
    self.postMessage({ kind: "terminal", level: "dim", text: indent + String(message.description ?? "") });
    return;
  }
  if (kind === "event:log") {
    self.postMessage({ kind: "terminal", level: "", text: String(message.text ?? "") });
    return;
  }
  if (kind === "event:warn") {
    self.postMessage({ kind: "terminal", level: "warn", text: String(message.message ?? "warning") });
    return;
  }
  if (kind === "event:assert-fail") {
    const parts = [
      "assertion failed",
      String(message.message ?? ""),
      "left: " + String(message.left ?? ""),
      "right: " + String(message.right ?? ""),
    ].filter(Boolean);
    self.postMessage({ kind: "terminal", level: "error", text: parts.join(" | ") });
  }
}
`;
}
