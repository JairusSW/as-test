import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { Duplex } from "stream";
import { pathToFileURL } from "url";
import { WASI } from "wasi";
import { buildWebRunnerClientSource } from "./web-runner/client.js";
import { buildWebRunnerHtml } from "./web-runner/html.js";
import { buildWebRunnerWorkerSource } from "./web-runner/worker.js";

type BindingsKind = "raw" | "esm" | "none";
type RuntimeTarget = "bindings" | "wasi" | "web";
type AnyImports = WebAssembly.Imports & {
  env?: Record<string, unknown>;
  wasi_snapshot_preview1?: WebAssembly.Imports[string];
};
type ExportMap = Record<string, unknown>;
type StartedInstance = WebAssembly.Instance & {
  exports: ExportMap & {
    start?: () => void;
  };
};

let patchedNodeIo = false;
const wasiInstances = new WeakMap<WebAssembly.Instance, WASI>();
const WEB_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WEB_HEADLESS_FLAGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
] as const;

function withNodeIo(imports: WebAssembly.Imports): WebAssembly.Imports {
  validateImports(imports, "withNodeIo");
  patchNodeIo();
  return imports;
}

export async function instantiate(
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  validateImports(imports, "instantiate");

  const wasmPath = process.env.AS_TEST_WASM_PATH;
  if (!wasmPath || !wasmPath.length) {
    throw new Error(
      "AS_TEST_WASM_PATH is not set; as-test must resolve the wasm artifact before launching the runner",
    );
  }
  const target = (process.env.AS_TEST_RUNTIME_TARGET || "bindings") as RuntimeTarget;
  if (target == "wasi") {
    return instantiateWasiInstance(wasmPath, imports);
  }
  if (target == "web") {
    return instantiateWebInstance(wasmPath, imports);
  }
  const kind = (process.env.AS_TEST_BINDINGS_KIND || "none") as BindingsKind;

  if (kind == "raw") {
    return instantiateRawInstance(wasmPath, imports);
  }
  if (kind == "esm") {
    return instantiateEsmInstance(wasmPath, imports);
  }
  if (kind == "none") {
    return instantiateNoBindingsInstance(wasmPath, imports);
  }
  throw new Error(`unsupported bindings kind "${kind}"`);
}

function validateImports(
  imports: WebAssembly.Imports,
  fnName: string,
): asserts imports is AnyImports {
  if (arguments.length < 1) {
    throw new Error(
      `${fnName}(imports) requires an imports object; pass {} when unused`,
    );
  }
  if (!imports || typeof imports != "object" || Array.isArray(imports)) {
    throw new Error(`${fnName}(imports) requires a non-null imports object`);
  }
}

function patchNodeIo(): void {
  if (patchedNodeIo) return;
  patchedNodeIo = true;

  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    if (chunk instanceof ArrayBuffer) {
      writeRaw(chunk);
      return true;
    }
    return originalWrite(chunk as never, ...(args as never[]));
  }) as typeof process.stdout.write;

  process.stdin.read = ((size?: number | null) =>
    readExact(Number(size ?? 0))) as typeof process.stdin.read;
}

function readExact(length: number): ArrayBuffer {
  const out = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let read = 0;
    try {
      read = fs.readSync(0, out, offset, length - offset, null);
    } catch (error) {
      if (
        error &&
        typeof error == "object" &&
        "code" in error &&
        error.code == "EAGAIN"
      ) {
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

function writeRaw(data: ArrayBuffer): void {
  const view = Buffer.from(data);
  let offset = 0;
  while (offset < view.byteLength) {
    let written = 0;
    try {
      written = fs.writeSync(1, view, offset, view.byteLength - offset);
    } catch (error) {
      if (
        error &&
        typeof error == "object" &&
        "code" in error &&
        error.code == "EAGAIN"
      ) {
        continue;
      }
      throw error;
    }
    if (!written) continue;
    offset += written;
  }
}

function mergeImports(...groups: unknown[]): AnyImports {
  const out: Record<string, unknown> = {};
  for (const group of groups) {
    if (!group || typeof group != "object" || Array.isArray(group)) continue;
    for (const [key, value] of Object.entries(group)) {
      if (
        value &&
        typeof value == "object" &&
        !Array.isArray(value) &&
        typeof value != "function"
      ) {
        out[key] = mergeImports(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out as AnyImports;
}

async function instantiateRawInstance(
  wasmPath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  validateImports(imports, "instantiateRawInstance");
  const helperPath = process.env.AS_TEST_HELPER_PATH || "";
  if (!helperPath.length) {
    throw new Error("bindings kind is raw but AS_TEST_HELPER_PATH is not set");
  }
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const helper = (await import(`${pathToFileURL(helperPath).href}?t=${Date.now()}`)) as {
    instantiate?: (
      module: WebAssembly.Module,
      imports?: WebAssembly.Imports,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
  if (typeof helper.instantiate != "function") {
    throw new Error("bindings helper missing instantiate export");
  }
  const mergedImports = mergeImports(withNodeIo({}), imports);
  const instance = await captureHelperInstance(async () => {
    await helper.instantiate!(module, mergedImports);
  });
  return decorateInstance(instance, "bindings");
}

async function instantiateEsmInstance(
  wasmPath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  validateImports(imports, "instantiateEsmInstance");
  const helperPath = process.env.AS_TEST_HELPER_PATH || "";
  if (!helperPath.length) {
    throw new Error("bindings kind is esm but AS_TEST_HELPER_PATH is not set");
  }
  if (hasUserImports(imports)) {
    throw new Error(
      "esm bindings do not support custom imports in as-test/lib; pass {} or switch to raw bindings",
    );
  }
  const instance = await captureHelperInstance(async () => {
    await import(`${pathToFileURL(helperPath).href}?t=${Date.now()}`);
  });
  return decorateInstance(instance, "bindings");
}

async function instantiateNoBindingsInstance(
  wasmPath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  validateImports(imports, "instantiateNoBindingsInstance");
  const instance = await instantiateModuleInstance(wasmPath, imports);
  return decorateInstance(instance, "bindings");
}

async function instantiateWasiInstance(
  wasmPath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  validateImports(imports, "instantiateWasiInstance");
  suppressExperimentalWasiWarning();
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const wasi = new WASI({
    version: "preview1",
    args: [wasmPath],
    env: process.env,
    preopens: {},
  });
  const mergedImports = createWasmImports(module, imports);
  mergedImports.wasi_snapshot_preview1 = wasi.wasiImport;
  const instance = new WebAssembly.Instance(module, mergedImports);
  wasiInstances.set(instance, wasi);
  return decorateInstance(instance, "wasi");
}

async function instantiateWebInstance(
  wasmPath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  validateImports(imports, "instantiateWebInstance");
  if (hasUserImports(imports)) {
    throw new Error(
      "web runtime does not support custom imports in the default runner; pass {} or write a custom web runner",
    );
  }

  const bindingsKind = (process.env.AS_TEST_BINDINGS_KIND || "raw") as BindingsKind;
  const helperPath = process.env.AS_TEST_HELPER_PATH
    ? path.resolve(process.cwd(), process.env.AS_TEST_HELPER_PATH)
    : wasmPath.replace(/\.wasm$/, ".js");
  const wasmUrlPath = "/" + path.basename(wasmPath);
  const helperUrlPath = "/" + path.basename(helperPath);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`missing wasm artifact: ${wasmPath}`);
  }
  if (bindingsKind != "none" && !fs.existsSync(helperPath)) {
    throw new Error(`missing bindings helper: ${helperPath}`);
  }

  const html = buildWebRunnerHtml();
  const client = buildWebRunnerClientSource();
  const worker = buildWebRunnerWorkerSource();
  const headless = process.argv.includes("--headless");
  const webRuntimeEnv = {
    AS_TEST_RUNTIME_TARGET: "web",
    AS_TEST_WASM_PATH: wasmUrlPath,
    AS_TEST_BINDINGS_KIND: bindingsKind,
    ...(bindingsKind != "none" ? { AS_TEST_HELPER_PATH: helperUrlPath } : {}),
  };

  return new Promise<WebAssembly.Instance>((resolve, reject) => {
    let resolved = false;
    let finished = false;
    let ready = false;
    let wsSocket: Duplex | null = null;
    let wsBuffer = Buffer.alloc(0);
    let stdinBuffer = Buffer.alloc(0);
    let browserProcess: ChildProcess | null = null;
    let browserStderr = "";
    let browserRetryTimer: NodeJS.Timeout | null = null;
    let browserStartupTimer: NodeJS.Timeout | null = null;
    let browserTempProfileDir: string | null = null;
    let ownsBrowserProcess = false;
    const pendingFrames: Buffer[] = [];
    const rejectOnce = (error: Error) => {
      if (resolved || finished) return;
      finished = true;
      reject(error);
      cleanup();
    };
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (!resolved && code != 0) {
        reject(new Error(`web runtime exited with code ${code}`));
        return;
      }
      if (!resolved) {
        reject(new Error("web runtime exited before instantiation completed"));
      }
    };
    const cleanup = () => {
      process.stdin.off("data", onStdinData);
      process.stdin.off("end", onStdinEnd);
      try {
        process.stdin.pause();
      } catch {}
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      try {
        wsSocket?.end();
      } catch {}
      try {
        wsSocket?.destroy();
      } catch {}
      try {
        server.close();
      } catch {}
      try {
        server.unref();
      } catch {}
      if (browserRetryTimer) {
        clearInterval(browserRetryTimer);
        browserRetryTimer = null;
      }
      if (browserStartupTimer) {
        clearTimeout(browserStartupTimer);
        browserStartupTimer = null;
      }
      if (browserTempProfileDir) {
        try {
          fs.rmSync(browserTempProfileDir, { recursive: true, force: true });
        } catch {}
        browserTempProfileDir = null;
      }
      if (browserProcess && ownsBrowserProcess && !browserProcess.killed) {
        killOwnedBrowserProcess(browserProcess);
      }
    };
    const sendControl = (message: Record<string, unknown>) => {
      if (!wsSocket) return;
      sendWebSocketFrame(wsSocket, 0x1, Buffer.from(JSON.stringify(message)));
    };
    const flushPendingFrames = () => {
      if (!ready || !wsSocket) return;
      while (pendingFrames.length) {
        sendWebSocketFrame(wsSocket, 0x2, pendingFrames.shift()!);
      }
    };
    const onControl = (raw: string) => {
      let message: Record<string, unknown> | null = null;
      try {
        message = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message?.kind == "ready") {
        ready = true;
        flushPendingFrames();
        return;
      }
      if (message?.kind == "instantiated") {
        if (resolved) return;
        resolved = true;
        resolve(createWebInstanceController(() => {
          sendControl({ kind: "start" });
        }));
        return;
      }
      if (message?.kind == "done") {
        finish(0);
        return;
      }
      if (message?.kind == "error") {
        rejectOnce(
          new Error(String(message.message ?? "browser runtime failed")),
        );
      }
    };
    const onWebSocketData = (chunk: Buffer) => {
      wsBuffer = Buffer.concat([wsBuffer, chunk]);
      while (wsBuffer.length >= 2) {
        const first = wsBuffer[0]!;
        const second = wsBuffer[1]!;
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let offset = 2;
        if (length == 126) {
          if (wsBuffer.length < offset + 2) return;
          length = wsBuffer.readUInt16BE(offset);
          offset += 2;
        } else if (length == 127) {
          if (wsBuffer.length < offset + 8) return;
          length = Number(wsBuffer.readBigUInt64BE(offset));
          offset += 8;
        }
        const maskLength = masked ? 4 : 0;
        if (wsBuffer.length < offset + maskLength + length) return;
        let payload = wsBuffer.subarray(
          offset + maskLength,
          offset + maskLength + length,
        );
        if (masked) {
          const mask = wsBuffer.subarray(offset, offset + 4);
          const unmasked = Buffer.alloc(length);
          for (let i = 0; i < length; i++) {
            unmasked[i] = payload[i]! ^ mask[i % 4]!;
          }
          payload = unmasked;
        } else {
          payload = Buffer.from(payload);
        }
        wsBuffer = wsBuffer.subarray(offset + maskLength + length);
        if (opcode == 0x8) {
          finish(0);
          return;
        }
        if (opcode == 0x1) {
          onControl(payload.toString("utf8"));
          continue;
        }
        if (opcode == 0x2) {
          process.stdout.write(payload);
        }
      }
    };
    const onStdinData = (chunk: Buffer) => {
      stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
      while (stdinBuffer.length >= 9) {
        const length = stdinBuffer.readUInt32LE(5);
        const frameSize = 9 + length;
        if (stdinBuffer.length < frameSize) return;
        const frame = stdinBuffer.subarray(0, frameSize);
        stdinBuffer = stdinBuffer.subarray(frameSize);
        if (ready && wsSocket) {
          sendWebSocketFrame(wsSocket, 0x2, frame);
        } else {
          pendingFrames.push(Buffer.from(frame));
        }
      }
    };
    const onStdinEnd = () => {
      stdinBuffer = Buffer.alloc(0);
    };
    const onSigint = () => finish(130);
    const onSigterm = () => finish(143);

    const server = http.createServer((req, res) => {
      const headers = {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cache-Control": "no-store",
      };
      const url = req.url ?? "/";
      if (url == "/" || url.startsWith("/?")) {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(
          html.replace(
            "</body>",
            '    <script>window.__AS_TEST_ENV__ = ' +
              JSON.stringify(webRuntimeEnv) +
              ';</script>\n  </body>',
          ),
        );
        return;
      }
      if (url == "/client.js") {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/javascript; charset=utf-8",
        });
        res.end(client);
        return;
      }
      if (url == "/worker.js") {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/javascript; charset=utf-8",
        });
        res.end(worker);
        return;
      }
      if (url == helperUrlPath) {
        if (bindingsKind == "none") {
          res.writeHead(404, headers);
          res.end("not found");
          return;
        }
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/javascript; charset=utf-8",
        });
        res.end(fs.readFileSync(helperPath, "utf8"));
        return;
      }
      if (url == wasmUrlPath) {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/wasm",
        });
        res.end(fs.readFileSync(wasmPath));
        return;
      }
      res.writeHead(404, headers);
      res.end("not found");
    });

    server.on("upgrade", (req, socket) => {
      if ((req.url ?? "") != "/ws") {
        socket.destroy();
        return;
      }
      const key = String(req.headers["sec-websocket-key"] ?? "");
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = createHash("sha1")
        .update(key + WEB_MAGIC)
        .digest("base64");
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Accept: " + accept,
          "",
          "",
        ].join("\r\n"),
      );
      wsSocket = socket;
      wsBuffer = Buffer.alloc(0);
      if (browserStartupTimer) {
        clearTimeout(browserStartupTimer);
        browserStartupTimer = null;
      }
      socket.on("data", (chunk) => onWebSocketData(chunk));
      socket.on("close", () => {
        wsSocket = null;
        if (!finished) finish(1);
      });
      socket.on("error", (error) => {
        if (!finished) {
          rejectOnce(
            error instanceof Error
              ? error
              : new Error(String(error)),
          );
        }
      });
      flushPendingFrames();
    });

    process.stdin.on("data", onStdinData);
    process.stdin.on("end", onStdinEnd);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address == "string") {
        rejectOnce(new Error("failed to determine local web runner address"));
        return;
      }
      const url = "http://127.0.0.1:" + address.port + "/";
      try {
        const launched = launchWebBrowser(url, headless);
        browserProcess = launched.process;
        browserTempProfileDir = launched.tempProfileDir;
        ownsBrowserProcess = launched.ownsProcess;
        if (browserProcess.stderr) {
          browserProcess.stderr.on("data", (chunk: Buffer | string) => {
            browserStderr = appendBrowserOutput(
              browserStderr,
              typeof chunk == "string" ? chunk : chunk.toString("utf8"),
            );
          });
        }
        if (!headless) {
          browserRetryTimer = setInterval(() => {
            if (finished || resolved || ready || wsSocket) return;
            try {
              openWithReusableBrowserWindow(url);
            } catch {}
          }, 750);
          browserRetryTimer.unref?.();
        }
        if (headless) {
          browserStartupTimer = setTimeout(() => {
            if (finished || resolved || ready || wsSocket) return;
            rejectOnce(
              new Error(
                "headless web browser did not connect to the local runner",
              ),
            );
          }, 10000);
          browserStartupTimer.unref?.();
          browserProcess.on("close", (code) => {
            if (finished) return;
            if (resolved) {
              finish(code ?? 0);
              return;
            }
            if (code && code != 0) {
              rejectOnce(new Error(formatBrowserExitError(code, browserStderr)));
              return;
            }
            if (ready || wsSocket) {
              finish(code ?? 0);
            }
          });
        }
      } catch (error) {
        rejectOnce(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  });
}

function hasUserImports(imports: AnyImports): boolean {
  return Object.keys(imports).length > 0;
}

function createWasmImports(
  module: WebAssembly.Module,
  imports: AnyImports,
): AnyImports {
  const mergedImports = mergeImports(withNodeIo({}), imports);
  if (!mergedImports.env || typeof mergedImports.env != "object") {
    mergedImports.env = {};
  }
  for (const entry of WebAssembly.Module.imports(module)) {
    if (
      entry.module == "env" &&
      entry.kind == "function" &&
      !(entry.name in mergedImports.env)
    ) {
      mergedImports.env[entry.name] = () => 0;
    }
  }
  return mergedImports;
}

let patchedWasiWarning = false;

function suppressExperimentalWasiWarning(): void {
  if (patchedWasiWarning) return;
  patchedWasiWarning = true;
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const type = typeof args[0] == "string" ? args[0] : "";
    const name =
      warning && typeof warning == "object" && "name" in warning
        ? String((warning as { name?: unknown }).name ?? type)
        : type;
    const message =
      typeof warning == "string"
        ? warning
        : String(
            warning && typeof warning == "object" && "message" in warning
              ? (warning as { message?: unknown }).message ?? ""
              : "",
          );
    if (
      name == "ExperimentalWarning" &&
      message.includes("WASI is an experimental feature")
    ) {
      return;
    }
    return originalEmitWarning(warning as never, ...(args as never[]));
  }) as typeof process.emitWarning;
}

async function instantiateModuleInstance(
  wasmPath: string,
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  return new WebAssembly.Instance(module, createWasmImports(module, imports));
}

function decorateInstance(
  instance: WebAssembly.Instance,
  target: RuntimeTarget,
): WebAssembly.Instance {
  const exports = instance.exports as ExportMap;
  const start = createStartFunction(instance, target, exports);
  if (!start) return instance;

  const exportsProxy = new Proxy(exports, {
    get(targetExports, prop, receiver) {
      if (prop == "start") return start;
      return Reflect.get(targetExports, prop, receiver);
    },
    has(targetExports, prop) {
      if (prop == "start") return true;
      return Reflect.has(targetExports, prop);
    },
  });

  return new Proxy(instance, {
    get(targetInstance, prop, receiver) {
      if (prop == "exports") return exportsProxy;
      return Reflect.get(targetInstance, prop, receiver);
    },
  }) as StartedInstance;
}

function createStartFunction(
  instance: WebAssembly.Instance,
  target: RuntimeTarget,
  exports: ExportMap,
): (() => void) | null {
  if (target == "wasi") {
    return () => {
      const wasi = wasiInstances.get(instance);
      if (!wasi) {
        throw new Error("WASI runtime state missing for instance");
      }
      wasi.start(instance);
    };
  }
  const startFn = exports._start;
  if (typeof startFn != "function") {
    return null;
  }
  return () => {
    (startFn as () => unknown)();
  };
}

function createWebInstanceController(start: () => void): WebAssembly.Instance {
  const exportsProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop == "start") return start;
        return undefined;
      },
      has(_target, prop) {
        return prop == "start";
      },
    },
  );
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop == "exports") return exportsProxy;
        return undefined;
      },
      has(_target, prop) {
        return prop == "exports";
      },
    },
  ) as WebAssembly.Instance;
}

function sendWebSocketFrame(
  socket: Duplex,
  opcode: number,
  payload: Buffer,
): void {
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function launchWebBrowser(
  url: string,
  headless: boolean,
): {
  process: ChildProcess;
  tempProfileDir: string | null;
  ownsProcess: boolean;
} {
  if (!headless) {
    const reused = openWithReusableBrowserWindow(url);
    if (reused) {
      return { process: reused, tempProfileDir: null, ownsProcess: false };
    }
    const opener = openWithSystemBrowser(url);
    if (opener) {
      return { process: opener, tempProfileDir: null, ownsProcess: false };
    }
  }
  const direct = openWithInstalledBrowser(url, headless);
  if (direct) return direct;
  throw new Error(
    headless
      ? "could not find a headless-capable browser; set BROWSER to a Chromium/Firefox executable"
      : "could not open a browser automatically; set BROWSER to a browser executable",
  );
}

function openWithReusableBrowserWindow(url: string): ChildProcess | null {
  if (process.platform != "darwin") return null;
  if (!hasExecutable("osascript")) return null;
  const browserApp = resolveMacBrowserAppName(process.env.BROWSER?.trim() ?? "");
  if (!browserApp) return null;
  const script = buildMacBrowserOpenScript(browserApp, url);
  if (!script.length) return null;
  return spawn(
    "osascript",
    script.flatMap((line) => ["-e", line]),
    { stdio: "ignore", detached: true },
  );
}

function openWithSystemBrowser(url: string): ChildProcess | null {
  if (process.env.BROWSER) {
    return spawnBrowserCommand(process.env.BROWSER, url, false)?.process ?? null;
  }
  if (process.platform == "darwin") {
    if (!hasExecutable("open")) return null;
    return spawn("open", [url], { stdio: "ignore", detached: true });
  }
  if (process.platform == "win32") {
    if (!hasExecutable("cmd")) return null;
    return spawn("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    });
  }
  if (!hasExecutable("xdg-open")) return null;
  return spawn("xdg-open", [url], { stdio: "ignore", detached: true });
}

function resolveMacBrowserAppName(browser: string): string | null {
  const trimmed = browser.trim();
  if (!trimmed.length) return null;
  const extracted = extractMacAppNameFromExecutable(trimmed);
  if (extracted) return extracted;

  const command = splitCommand(trimmed)[0]?.toLowerCase() ?? "";
  if (!command.length) return null;
  const aliases: Record<string, string> = {
    chrome: "Google Chrome",
    "google-chrome": "Google Chrome",
    "google-chrome-stable": "Google Chrome",
    chromium: "Chromium",
    "chromium-browser": "Chromium",
    msedge: "Microsoft Edge",
    firefox: "Firefox",
    safari: "Safari",
  };
  return aliases[command] ?? null;
}

function extractMacAppNameFromExecutable(browser: string): string | null {
  const appMatch = browser.match(/\/([^/]+)\.app\/Contents\/MacOS\//);
  if (!appMatch?.[1]) return null;
  return appMatch[1];
}

function buildMacBrowserOpenScript(appName: string, url: string): string[] {
  const escapedApp = escapeAppleScriptString(appName);
  const escapedUrl = escapeAppleScriptString(url);
  const lower = appName.toLowerCase();

  if (
    lower.includes("chrome") ||
    lower.includes("chromium") ||
    lower.includes("edge")
  ) {
    return [
      `tell application "${escapedApp}"`,
      "activate",
      'if (count of windows) = 0 then make new window',
      `set URL of active tab of front window to "${escapedUrl}"`,
      "end tell",
    ];
  }
  if (lower.includes("safari")) {
    return [
      `tell application "${escapedApp}"`,
      "activate",
      'if (count of windows) = 0 then make new document',
      `set URL of front document to "${escapedUrl}"`,
      "end tell",
    ];
  }
  if (lower.includes("firefox")) {
    return [
      `tell application "${escapedApp}"`,
      "activate",
      `open location "${escapedUrl}"`,
      "end tell",
    ];
  }
  return [];
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function openWithInstalledBrowser(
  url: string,
  headless: boolean,
): {
  process: ChildProcess;
  tempProfileDir: string | null;
  ownsProcess: boolean;
} | null {
  const browserEnv = process.env.BROWSER;
  if (browserEnv) {
    return spawnBrowserCommand(browserEnv, url, headless);
  }
  const candidates = [
    { command: "chromium", headless: [...WEB_HEADLESS_FLAGS] },
    { command: "chromium-browser", headless: [...WEB_HEADLESS_FLAGS] },
    { command: "google-chrome", headless: [...WEB_HEADLESS_FLAGS] },
    { command: "google-chrome-stable", headless: [...WEB_HEADLESS_FLAGS] },
    { command: "chrome", headless: [...WEB_HEADLESS_FLAGS] },
    { command: "msedge", headless: [...WEB_HEADLESS_FLAGS] },
    { command: "firefox", headless: ["-headless"] },
  ];
  for (const candidate of candidates) {
    if (!hasExecutable(candidate.command)) continue;
    return {
      process: spawn(
        candidate.command,
        [...(headless ? candidate.headless : []), url],
        {
          stdio: ["ignore", "ignore", "pipe"],
          detached: true,
        },
      ),
      tempProfileDir: null,
      ownsProcess: true,
    };
  }
  const playwrightFallback =
    resolvePlaywrightBrowserExecutable("chromium") ??
    resolvePlaywrightBrowserExecutable("firefox") ??
    resolvePlaywrightBrowserExecutable("webkit");
  if (playwrightFallback) {
    return spawnBrowserCommand(playwrightFallback, url, headless);
  }
  return null;
}

function spawnBrowserCommand(
  commandValue: string,
  url: string,
  headless: boolean,
): {
  process: ChildProcess;
  tempProfileDir: string | null;
  ownsProcess: boolean;
} | null {
  const directCommand = unwrapQuotedPath(String(commandValue).trim());
  if (hasExecutable(directCommand)) {
    const resolvedHeadless = headless
      ? resolveHeadlessLaunch(directCommand, directCommand)
      : { flags: [], tempProfileDir: null };
    const args = [...resolvedHeadless.flags];
    args.push(url);
    return {
      process: spawn(directCommand, args, {
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      }),
      tempProfileDir: resolvedHeadless.tempProfileDir,
      ownsProcess: true,
    };
  }
  const parts = splitCommand(String(commandValue));
  if (!parts.length) return null;
  const command = parts[0]!;
  if (!hasExecutable(command)) return null;
  const args = parts.slice(1);
  let tempProfileDir: string | null = null;
  if (headless) {
    const resolvedHeadless = resolveHeadlessLaunch(commandValue, command);
    args.push(...resolvedHeadless.flags);
    tempProfileDir = resolvedHeadless.tempProfileDir;
  }
  args.push(url);
  return {
    process: spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    }),
    tempProfileDir,
    ownsProcess: true,
  };
}

function splitCommand(commandValue: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | "" = "";
  for (let i = 0; i < commandValue.length; i++) {
    const char = commandValue[i]!;
    if (quote) {
      if (char == quote) {
        quote = "";
      } else if (char == "\\" && i + 1 < commandValue.length) {
        current += commandValue[++i]!;
      } else {
        current += char;
      }
      continue;
    }
    if (char == "'" || char == '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    if (char == "\\" && i + 1 < commandValue.length) {
      current += commandValue[++i]!;
      continue;
    }
    current += char;
  }
  if (current.length) {
    parts.push(current);
  }
  return parts;
}

function appendBrowserOutput(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= 16384) return combined;
  return combined.slice(combined.length - 16384);
}

function formatBrowserExitError(code: number, stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed.length) {
    return `web browser process exited with code ${code}`;
  }
  return `web browser process exited with code ${code}\nstderr:\n${trimmed}`;
}

function killOwnedBrowserProcess(browserProcess: ChildProcess): void {
  try {
    if (
      process.platform != "win32" &&
      typeof browserProcess.pid == "number" &&
      browserProcess.pid > 0
    ) {
      process.kill(-browserProcess.pid, "SIGTERM");
      return;
    }
  } catch {}
  try {
    browserProcess.kill("SIGTERM");
  } catch {}
}

function unwrapQuotedPath(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveHeadlessLaunch(
  commandValue: string,
  command: string,
): { flags: string[]; tempProfileDir: string | null } {
  const lower = `${commandValue} ${command}`.toLowerCase();
  if (lower.includes("firefox")) {
    const tempProfileDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "as-test-firefox-profile-"),
    );
    return {
      flags: ["-headless", "-no-remote", "-profile", tempProfileDir],
      tempProfileDir,
    };
  }
  if (lower.includes("webkit") || lower.includes("minibrowser")) {
    return { flags: ["--headless"], tempProfileDir: null };
  }
  return { flags: [...WEB_HEADLESS_FLAGS], tempProfileDir: null };
}

function hasExecutable(command: string): boolean {
  if (!command.length) return false;
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command);
  }
  const pathValue = process.env.PATH ?? "";
  const suffixes =
    process.platform == "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const base of pathValue.split(path.delimiter)) {
    if (!base) continue;
    for (const suffix of suffixes) {
      if (fs.existsSync(path.join(base, command + suffix))) {
        return true;
      }
    }
  }
  return false;
}

function resolvePlaywrightBrowserExecutable(browser: string): string | null {
  const patterns = getPlaywrightBrowserPatterns(browser);
  if (!patterns.length) return null;
  for (const cacheRoot of getPlaywrightCacheRoots()) {
    if (!fs.existsSync(cacheRoot)) continue;
    for (const pattern of patterns) {
      const matches = fs.globSync(path.join(cacheRoot, pattern)).sort();
      if (matches.length) {
        return matches[matches.length - 1]!;
      }
    }
  }
  return null;
}

function getPlaywrightCacheRoots(): string[] {
  const roots = new Set<string>();
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ?? "";
  if (configured.length && configured != "0") {
    roots.add(path.resolve(configured));
  }
  const home = process.env.HOME ?? "";
  if (process.platform == "darwin" && home.length) {
    roots.add(path.join(home, "Library", "Caches", "ms-playwright"));
  } else if (process.platform == "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim() ?? "";
    if (localAppData.length) {
      roots.add(path.join(localAppData, "ms-playwright"));
    }
    const userProfile = process.env.USERPROFILE?.trim() ?? "";
    if (userProfile.length) {
      roots.add(path.join(userProfile, "AppData", "Local", "ms-playwright"));
    }
  } else if (home.length) {
    roots.add(path.join(home, ".cache", "ms-playwright"));
  }
  return [...roots];
}

function getPlaywrightBrowserPatterns(browser: string): string[] {
  if (process.platform == "darwin") {
    const macMap: Record<string, string[]> = {
      chromium: [
        "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
        "chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell",
      ],
      chrome: [
        "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
        "chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell",
      ],
      firefox: [
        "firefox-*/firefox/*.app/Contents/MacOS/firefox",
        "firefox-*/*.app/Contents/MacOS/firefox",
        "firefox-*/firefox/firefox",
      ],
      webkit: ["webkit-*/pw_run.sh"],
    };
    return macMap[browser] ?? [];
  }
  if (process.platform == "win32") {
    const winMap: Record<string, string[]> = {
      chromium: [
        "chromium-*/chrome-win/chrome.exe",
        "chromium-*/chrome-win64/chrome.exe",
        "chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe",
      ],
      chrome: [
        "chromium-*/chrome-win/chrome.exe",
        "chromium-*/chrome-win64/chrome.exe",
        "chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe",
      ],
      firefox: ["firefox-*/firefox/firefox.exe"],
      webkit: ["webkit-*/Playwright.exe"],
    };
    return winMap[browser] ?? [];
  }
  const linuxMap: Record<string, string[]> = {
    chromium: [
      "chromium-*/chrome-linux/chrome",
      "chromium-*/chrome-linux64/chrome",
      "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
    ],
    chrome: [
      "chromium-*/chrome-linux/chrome",
      "chromium-*/chrome-linux64/chrome",
      "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
    ],
    firefox: ["firefox-*/firefox/firefox"],
    webkit: ["webkit-*/pw_run.sh"],
  };
  return linuxMap[browser] ?? [];
}

async function captureHelperInstance(
  runHelper: () => Promise<unknown>,
): Promise<WebAssembly.Instance> {
  const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  let instance: WebAssembly.Instance | null = null;

  WebAssembly.instantiate = (async (
    source: BufferSource | WebAssembly.Module,
    importObject?: WebAssembly.Imports,
  ) => {
    const result = await originalInstantiate(source, importObject);
    if (result instanceof WebAssembly.Instance) {
      instance = result;
    }
    return result;
  }) as typeof WebAssembly.instantiate;

  try {
    await runHelper();
  } finally {
    WebAssembly.instantiate = originalInstantiate as typeof WebAssembly.instantiate;
  }

  if (!instance) {
    throw new Error("bindings helper did not produce a WebAssembly.Instance");
  }
  return instance;
}
