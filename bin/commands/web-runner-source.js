export function buildWebRunnerHooksSource() {
    return `export function createUserImports(_ctx) {
  return {
    // env: {
    //   now_ms: () => performance.now(),
    // },
  };
}

export async function runModule(_exports, _ctx) {
  // The generated bindings helper already calls exports._start().
  // Add extra startup calls here when your module exposes them.
  //
  // Example:
  // _exports.run?.();
}
`;
}
export function buildWebRunnerSource() {
    const html = String.raw `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>as-test web runner</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f172a;
        --panel: #111827;
        --muted: #94a3b8;
        --text: #e5e7eb;
        --accent: #38bdf8;
        --error: #f87171;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 35%),
          linear-gradient(180deg, #020617, var(--bg));
        font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: var(--text);
      }
      main {
        width: min(640px, calc(100vw - 32px));
        background: rgba(17, 24, 39, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 20px 60px rgba(2, 6, 23, 0.45);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 20px;
      }
      p {
        margin: 0 0 10px;
        color: var(--muted);
      }
      code {
        color: var(--accent);
      }
      pre {
        margin: 16px 0 0;
        padding: 12px;
        border-radius: 12px;
        background: rgba(2, 6, 23, 0.8);
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .error {
        color: var(--error);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>as-test web runner</h1>
      <p id="status">Connecting to the terminal runner...</p>
      <pre id="details">Waiting for browser runtime bootstrap.</pre>
    </main>
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
    const client = String.raw `const status = document.getElementById("status");
const details = document.getElementById("details");
const replyBuffer = new SharedArrayBuffer(8 + 4 * 1024 * 1024);
const replyState = new Int32Array(replyBuffer, 0, 2);
const replyBytes = new Uint8Array(replyBuffer, 8);
const worker = new Worker("/worker.js", { type: "module" });
const ws = new WebSocket((location.protocol == "https:" ? "wss://" : "ws://") + location.host + "/ws");
ws.binaryType = "arraybuffer";

function setStatus(message, error = false) {
  status.textContent = message;
  status.className = error ? "error" : "";
}

function setDetails(message) {
  details.textContent = message;
}

function pushReply(frame) {
  if (frame.byteLength > replyBytes.byteLength) {
    throw new Error("WIPC reply exceeded shared browser buffer");
  }
  if (Atomics.load(replyState, 0) != 0) {
    throw new Error("received concurrent WIPC replies in web runner");
  }
  replyBytes.set(new Uint8Array(frame), 0);
  Atomics.store(replyState, 1, frame.byteLength);
  Atomics.store(replyState, 0, 1);
  Atomics.notify(replyState, 0, 1);
}

worker.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.kind == "wipc" && message.frame instanceof ArrayBuffer) {
    ws.send(message.frame);
    return;
  }
  if (message.kind == "ready") {
    setStatus("Running tests in the browser...");
    setDetails("Worker loaded the generated bindings helper and wasm artifact.");
    return;
  }
  if (message.kind == "done") {
    setStatus("Finished. Closing browser runner...");
    setDetails("Test execution completed successfully.");
    ws.send(JSON.stringify({ kind: "done" }));
    return;
  }
  if (message.kind == "error") {
    setStatus("Browser runtime failed.", true);
    setDetails(String(message.message ?? "unknown browser runtime error"));
    ws.send(
      JSON.stringify({
        kind: "error",
        message: String(message.message ?? "unknown browser runtime error"),
      }),
    );
  }
};

ws.addEventListener("open", () => {
  setStatus("Connected. Starting browser worker...");
  setDetails("WebSocket tunnel established; waiting for wasm startup.");
  ws.send(JSON.stringify({ kind: "ready" }));
  worker.postMessage({
    kind: "init",
    helperUrl: "/artifact.js",
    hooksUrl: "/runner-hooks.js",
    wasmUrl: "/artifact.wasm",
    replyBuffer,
  });
});

ws.addEventListener("message", (event) => {
  if (typeof event.data == "string") {
    return;
  }
  try {
    pushReply(event.data);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    setStatus("Bridge failure.", true);
    setDetails(message);
    ws.send(JSON.stringify({ kind: "error", message }));
  }
});

ws.addEventListener("close", () => {
  setStatus("Runner disconnected.", true);
});

ws.addEventListener("error", () => {
  setStatus("WebSocket connection failed.", true);
});
`;
    const worker = String.raw `let replyState = null;
let replyBytes = null;

function createRunnerContext({ helperUrl, wasmUrl, module }) {
  return {
    helperUrl,
    wasmUrl,
    module,
    postFrame(frame) {
      self.postMessage({ kind: "wipc", frame }, [frame]);
      return true;
    },
    readFrame(size) {
      return readReply(Number(size ?? 0));
    },
  };
}

function createAsTestImports(ctx) {
  globalThis.process = {
    stdout: {
      write(data) {
        const frame = data instanceof ArrayBuffer ? data : data?.buffer;
        return ctx.postFrame(frame);
      },
    },
    stdin: {
      read(size) {
        return ctx.readFrame(size);
      },
    },
  };
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

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.kind != "init") {
    return;
  }

  const shared = message.replyBuffer;
  replyState = new Int32Array(shared, 0, 2);
  replyBytes = new Uint8Array(shared, 8);

  try {
    const hooks = await import(message.hooksUrl);
    const helper = await import(message.helperUrl);
    if (typeof helper.instantiate != "function") {
      throw new Error("bindings helper missing instantiate export");
    }
    const response = await fetch(message.wasmUrl);
    if (!response.ok) {
      throw new Error("failed to fetch wasm artifact: " + response.status);
    }
    const binary = await response.arrayBuffer();
    const module = new WebAssembly.Module(binary);
    const ctx = createRunnerContext({
      helperUrl: message.helperUrl,
      wasmUrl: message.wasmUrl,
      module,
    });
    const imports = mergeImports(
      createAsTestImports(ctx),
      typeof hooks.createUserImports == "function"
        ? await hooks.createUserImports(ctx)
        : {},
    );
    self.postMessage({ kind: "ready" });
    const exports = await helper.instantiate(module, imports);
    if (typeof hooks.runModule == "function") {
      await hooks.runModule(exports, ctx);
    }
    self.postMessage({ kind: "done" });
  } catch (error) {
    const message =
      error && typeof error == "object" && "stack" in error
        ? String(error.stack)
        : String(error);
    self.postMessage({ kind: "error", message });
  }
};

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
`;
    const hooks = buildWebRunnerHooksSource();
    return `import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import http from "http";
import path from "path";
import { spawn } from "child_process";

const INDEX_HTML = ${JSON.stringify(html)};
const CLIENT_JS = ${JSON.stringify(client)};
const WORKER_JS = ${JSON.stringify(worker)};
const DEFAULT_HOOKS_JS = ${JSON.stringify(hooks)};
const MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const HEADLESS_FLAGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
];

const rawArgs = process.argv.slice(2);
const headless = rawArgs.includes("--headless");
const wasmArg = rawArgs.find((value) => value != "--headless");
if (!wasmArg) {
  process.stderr.write(
    "usage: node ./.as-test/runners/default.web.js [--headless] <file.wasm>\\n",
  );
  process.exit(1);
}

const wasmPath = path.resolve(process.cwd(), wasmArg);
const helperPath = wasmPath.replace(/\\.wasm$/, ".js");
const hooksPath = path.resolve(process.cwd(), ".as-test/runners/default.web.hooks.js");
if (!existsSync(wasmPath)) {
  process.stderr.write("missing wasm artifact: " + wasmPath + "\\n");
  process.exit(1);
}
if (!existsSync(helperPath)) {
  process.stderr.write("missing bindings helper: " + helperPath + "\\n");
  process.exit(1);
}

let wsSocket = null;
let wsBuffer = Buffer.alloc(0);
let stdinBuffer = Buffer.alloc(0);
let browserProcess = null;
let closed = false;
let exitCode = 0;
let ready = false;
const pendingFrames = [];

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
    res.end(INDEX_HTML);
    return;
  }
  if (url == "/client.js") {
    res.writeHead(200, {
      ...headers,
      "Content-Type": "text/javascript; charset=utf-8",
    });
    res.end(CLIENT_JS);
    return;
  }
  if (url == "/worker.js") {
    res.writeHead(200, {
      ...headers,
      "Content-Type": "text/javascript; charset=utf-8",
    });
    res.end(WORKER_JS);
    return;
  }
  if (url == "/artifact.js") {
    res.writeHead(200, {
      ...headers,
      "Content-Type": "text/javascript; charset=utf-8",
    });
    res.end(readFileSync(helperPath, "utf8"));
    return;
  }
  if (url == "/runner-hooks.js") {
    res.writeHead(200, {
      ...headers,
      "Content-Type": "text/javascript; charset=utf-8",
    });
    res.end(existsSync(hooksPath) ? readFileSync(hooksPath, "utf8") : DEFAULT_HOOKS_JS);
    return;
  }
  if (url == "/artifact.wasm") {
    res.writeHead(200, {
      ...headers,
      "Content-Type": "application/wasm",
    });
    res.end(readFileSync(wasmPath));
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
    .update(key + MAGIC)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: " + accept,
      "",
      "",
    ].join("\\r\\n"),
  );
  wsSocket = socket;
  wsBuffer = Buffer.alloc(0);
  socket.on("data", (chunk) => onWebSocketData(chunk));
  socket.on("close", () => {
    wsSocket = null;
    if (!closed) {
      finish(exitCode || 1);
    }
  });
  socket.on("error", (error) => {
    process.stderr.write("web runner websocket error: " + String(error) + "\\n");
  });
  flushPendingFrames();
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address == "string") {
    process.stderr.write("failed to determine local web runner address\\n");
    finish(1);
    return;
  }
  const url = "http://127.0.0.1:" + address.port + "/";
  try {
    browserProcess = launchBrowser(url, headless);
  } catch (error) {
    process.stderr.write(String(error) + "\\n");
    finish(1);
  }
});

process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  while (stdinBuffer.length >= 9) {
    const length = stdinBuffer.readUInt32LE(5);
    const frameSize = 9 + length;
    if (stdinBuffer.length < frameSize) {
      return;
    }
    const frame = stdinBuffer.subarray(0, frameSize);
    stdinBuffer = stdinBuffer.subarray(frameSize);
    if (ready && wsSocket) {
      sendWebSocketFrame(wsSocket, 0x2, frame);
    } else {
      pendingFrames.push(Buffer.from(frame));
    }
  }
});

process.stdin.on("end", () => finish(exitCode));
process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));

function onWebSocketData(chunk) {
  wsBuffer = Buffer.concat([wsBuffer, chunk]);
  while (wsBuffer.length >= 2) {
    const first = wsBuffer[0];
    const second = wsBuffer[1];
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
    let payload = wsBuffer.subarray(offset + maskLength, offset + maskLength + length);
    if (masked) {
      const mask = wsBuffer.subarray(offset, offset + 4);
      const unmasked = Buffer.alloc(length);
      for (let i = 0; i < length; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    } else {
      payload = Buffer.from(payload);
    }
    wsBuffer = wsBuffer.subarray(offset + maskLength + length);
    if (opcode == 0x8) {
      finish(exitCode);
      return;
    }
    if (opcode == 0x1) {
      handleControl(payload.toString("utf8"));
      continue;
    }
    if (opcode == 0x2) {
      process.stdout.write(payload);
    }
  }
}

function handleControl(raw) {
  let message = null;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message?.kind == "ready") {
    ready = true;
    flushPendingFrames();
    return;
  }
  if (message?.kind == "done") {
    finish(0);
    return;
  }
  if (message?.kind == "error") {
    process.stderr.write(String(message.message ?? "browser runtime failed") + "\\n");
    finish(1);
  }
}

function flushPendingFrames() {
  if (!ready || !wsSocket) return;
  while (pendingFrames.length) {
    sendWebSocketFrame(wsSocket, 0x2, pendingFrames.shift());
  }
}

function sendWebSocketFrame(socket, opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
  let header = null;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  socket.write(Buffer.concat([header, body]));
}

function launchBrowser(url, headlessMode) {
  if (!headlessMode) {
    const opener = openWithSystemBrowser(url);
    if (opener) return opener;
  }

  const direct = openWithInstalledBrowser(url, headlessMode);
  if (direct) return direct;

  throw new Error(
    headlessMode
      ? "could not find a headless-capable browser; set BROWSER to a Chromium/Firefox executable"
      : "could not open a browser automatically; set BROWSER to a browser executable",
  );
}

function openWithSystemBrowser(url) {
  if (process.env.BROWSER) {
    return spawnBrowserCommand(process.env.BROWSER, url, false);
  }
  if (process.platform == "darwin") {
    if (!hasExecutable("open")) return null;
    return spawn("open", [url], { stdio: "ignore", detached: true });
  }
  if (process.platform == "win32") {
    if (!hasExecutable("cmd")) return null;
    return spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  }
  if (!hasExecutable("xdg-open")) return null;
  return spawn("xdg-open", [url], { stdio: "ignore", detached: true });
}

function openWithInstalledBrowser(url, headlessMode) {
  const browserEnv = process.env.BROWSER;
  if (browserEnv) {
    return spawnBrowserCommand(browserEnv, url, headlessMode);
  }
  const candidates = [
    { command: "chromium", headless: HEADLESS_FLAGS },
    { command: "chromium-browser", headless: HEADLESS_FLAGS },
    { command: "google-chrome", headless: HEADLESS_FLAGS },
    { command: "google-chrome-stable", headless: HEADLESS_FLAGS },
    { command: "chrome", headless: HEADLESS_FLAGS },
    { command: "msedge", headless: HEADLESS_FLAGS },
    { command: "firefox", headless: ["-headless"] },
  ];
  for (const candidate of candidates) {
    if (!hasExecutable(candidate.command)) continue;
    return spawn(candidate.command, [...(headlessMode ? candidate.headless : []), url], {
      stdio: "ignore",
      detached: !headlessMode,
    });
  }
  return null;
}

function spawnBrowserCommand(commandValue, url, headlessMode) {
  const parts = String(commandValue)
    .split(/\\s+/)
    .filter((part) => part.length > 0);
  if (!parts.length) {
    return null;
  }
  const command = parts[0];
  if (!hasExecutable(command)) {
    return null;
  }
  const args = parts.slice(1);
  if (headlessMode) {
    args.push(...resolveHeadlessFlags(commandValue, command));
  }
  args.push(url);
  return spawn(command, args, {
    stdio: "ignore",
    detached: !headlessMode,
  });
}

function resolveHeadlessFlags(commandValue, command) {
  const lower = String(commandValue + " " + command).toLowerCase();
  if (lower.includes("firefox")) {
    return ["-headless"];
  }
  if (lower.includes("webkit") || lower.includes("minibrowser")) {
    return ["--headless"];
  }
  return HEADLESS_FLAGS;
}

function hasExecutable(command) {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\\\")) {
    return existsSync(command);
  }
  const pathValue = process.env.PATH ?? "";
  const suffixes = process.platform == "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const base of pathValue.split(path.delimiter)) {
    if (!base) continue;
    for (const suffix of suffixes) {
      if (existsSync(path.join(base, command + suffix))) {
        return true;
      }
    }
  }
  return false;
}

function finish(code) {
  if (closed) return;
  closed = true;
  exitCode = code;
  try {
    if (wsSocket) {
      sendWebSocketFrame(wsSocket, 0x8, Buffer.alloc(0));
      wsSocket.end();
    }
  } catch {}
  try {
    server.close();
  } catch {}
  if (browserProcess && !browserProcess.killed && headless) {
    try {
      browserProcess.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(exitCode), 25);
}
`;
}
