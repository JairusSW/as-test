import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import net from "net";
import type { Duplex } from "stream";

const WEB_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type SessionJob = {
  id: string;
  env: Record<string, string>;
  label: string;
  wasmPath: string;
  helperPath: string | null;
  onBinary(frame: Buffer): void;
  resolve(): void;
  reject(error: Error): void;
  started: boolean;
};

export class PersistentWebSessionHost {
  private readonly html = buildWebSessionHtml();
  private readonly client = buildWebSessionClientSource();
  private readonly worker = buildWebSessionWorkerSource();
  private readonly server = http.createServer((req, res) =>
    this.onRequest(req, res),
  );
  private browserProcess: ChildProcess | null = null;
  private ownsBrowserProcess = false;
  private readonly serverSockets = new Set<net.Socket>();
  private wsSocket: Duplex | null = null;
  private wsBuffer = Buffer.alloc(0);
  private ready = false;
  private closed = false;
  private currentJob: SessionJob | null = null;
  private nextJobId = 1;
  private closeError: Error | null = null;
  private readonly readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly terminalHooksEnabled = Boolean(process.stdin.isTTY);
  private readonly onTerminalClosed = () => {
    void this.exitFromTerminalClosure();
  };
  private readonly onTerminalHangup = () => {
    void this.exitFromTerminalClosure();
  };

  private constructor(private readonly headless: boolean) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  static async start(headless: boolean): Promise<PersistentWebSessionHost> {
    const host = new PersistentWebSessionHost(headless);
    await host.listen();
    return host;
  }

  async runJob(
    env: Record<string, string>,
    label: string,
    onBinary: (frame: Buffer) => void,
  ): Promise<void> {
    await this.readyPromise;
    if (this.closed) {
      throw this.closeError ?? new Error("web session host is already closed");
    }
    if (this.currentJob) {
      throw new Error("web session host already has an active job");
    }

    const wasmPath = env.AS_TEST_WASM_PATH || "";
    if (!wasmPath.length) {
      throw new Error("AS_TEST_WASM_PATH is not set for web session job");
    }
    const helperPath = env.AS_TEST_HELPER_PATH?.length
      ? env.AS_TEST_HELPER_PATH
      : null;
    const jobId = String(this.nextJobId++);
    const browserEnv: Record<string, string> = {
      ...env,
      AS_TEST_WASM_PATH: `/job/${jobId}/${path.basename(wasmPath)}`,
    };
    if (helperPath) {
      browserEnv.AS_TEST_HELPER_PATH = `/job/${jobId}/${path.basename(helperPath)}`;
    } else {
      delete browserEnv.AS_TEST_HELPER_PATH;
    }

    await new Promise<void>((resolve, reject) => {
      this.currentJob = {
        id: jobId,
        env: browserEnv,
        label,
        wasmPath,
        helperPath,
        onBinary,
        resolve: () => {
          this.currentJob = null;
          resolve();
        },
        reject: (error) => {
          this.currentJob = null;
          reject(error);
        },
        started: false,
      };
      this.sendControl({ kind: "load", env: browserEnv, label });
    });
  }

  sendReply(frame: Buffer): void {
    if (!this.wsSocket || !frame.length) return;
    sendWebSocketFrame(this.wsSocket, 0x2, frame);
  }

  async close(reason?: Error): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.removeTerminalHooks();
    const closeError = reason ?? new Error("web session host closed");
    this.closeError = closeError;
    if (!this.ready) {
      this.readyReject?.(closeError);
      this.readyResolve = null;
      this.readyReject = null;
    }
    if (this.currentJob) {
      this.currentJob.reject(closeError);
    }
    try {
      this.sendControl({
        kind: "shutdown",
        ok: reason == null,
        message: reason?.message ?? "",
      });
    } catch {}
    try {
      this.wsSocket?.end();
    } catch {}
    try {
      this.wsSocket?.destroy();
    } catch {}
    try {
      this.server.closeIdleConnections?.();
      this.server.closeAllConnections?.();
    } catch {}
    for (const socket of this.serverSockets) {
      try {
        socket.destroy();
      } catch {}
    }
    await new Promise<void>((resolve) => {
      try {
        this.server.close(() => resolve());
      } catch {
        resolve();
      }
    });
    if (
      this.browserProcess &&
      this.ownsBrowserProcess &&
      !this.browserProcess.killed
    ) {
      killOwnedBrowserProcess(this.browserProcess);
    }
  }

  private async exitFromTerminalClosure(): Promise<void> {
    await this.close(new Error("terminal side closed"));
    process.exit(0);
  }

  private async listen(): Promise<void> {
    this.installTerminalHooks();
    this.server.on("connection", (socket) => {
      this.serverSockets.add(socket);
      socket.on("close", () => {
        this.serverSockets.delete(socket);
      });
    });
    this.server.on("upgrade", (req, socket) => {
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
      this.wsSocket = socket;
      this.wsBuffer = Buffer.alloc(0);
      socket.on("data", (chunk) => this.onWebSocketData(chunk));
      socket.on("end", () => {
        this.wsSocket = null;
        if (!this.closed) {
          void this.close(new Error("web browser disconnected"));
        }
      });
      socket.on("close", () => {
        this.wsSocket = null;
        if (!this.closed) {
          void this.close(new Error("web browser disconnected"));
        }
      });
      socket.on("error", (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (!this.closed) {
          void this.close(err);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server.once("error", (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address == "string") {
      throw new Error("failed to determine web session host address");
    }
    const url = `http://127.0.0.1:${address.port}/`;
    if (!this.headless && !process.env.BROWSER?.trim().length) {
      process.stdout.write(`Open web session: ${url}\n`);
    } else {
      const launched = launchBrowser(url, this.headless);
      this.browserProcess = launched.process;
      this.ownsBrowserProcess = launched.ownsProcess;
      this.browserProcess.on("close", (code) => {
        if (this.closed) return;
        const error = new Error(
          `web browser process exited with code ${code ?? 0}`,
        );
        if (!this.ready && this.readyReject) {
          this.readyReject(error);
          return;
        }
        void this.close(error);
      });
    }
    await this.readyPromise;
  }

  private installTerminalHooks(): void {
    if (!this.terminalHooksEnabled) return;
    process.stdin.on("close", this.onTerminalClosed);
    process.stdin.on("end", this.onTerminalClosed);
    process.on("SIGHUP", this.onTerminalHangup);
  }

  private removeTerminalHooks(): void {
    if (!this.terminalHooksEnabled) return;
    process.stdin.off("close", this.onTerminalClosed);
    process.stdin.off("end", this.onTerminalClosed);
    process.off("SIGHUP", this.onTerminalHangup);
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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
      res.end(this.html);
      return;
    }
    if (url == "/client.js") {
      res.writeHead(200, {
        ...headers,
        "Content-Type": "text/javascript; charset=utf-8",
      });
      res.end(this.client);
      return;
    }
    if (url == "/worker.js") {
      res.writeHead(200, {
        ...headers,
        "Content-Type": "text/javascript; charset=utf-8",
      });
      res.end(this.worker);
      return;
    }
    if (this.currentJob) {
      const wasmUrl = this.currentJob.env.AS_TEST_WASM_PATH;
      const helperUrl = this.currentJob.env.AS_TEST_HELPER_PATH ?? "";
      if (url == wasmUrl) {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/wasm",
        });
        res.end(fs.readFileSync(this.currentJob.wasmPath));
        return;
      }
      if (helperUrl.length && url == helperUrl && this.currentJob.helperPath) {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/javascript; charset=utf-8",
        });
        res.end(fs.readFileSync(this.currentJob.helperPath, "utf8"));
        return;
      }
    }
    res.writeHead(404, headers);
    res.end("not found");
  }

  private onWebSocketData(chunk: Buffer): void {
    this.wsBuffer = Buffer.concat([this.wsBuffer, chunk]);
    while (this.wsBuffer.length >= 2) {
      const first = this.wsBuffer[0]!;
      const second = this.wsBuffer[1]!;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length == 126) {
        if (this.wsBuffer.length < offset + 2) return;
        length = this.wsBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (length == 127) {
        if (this.wsBuffer.length < offset + 8) return;
        length = Number(this.wsBuffer.readBigUInt64BE(offset));
        offset += 8;
      }
      const maskLength = masked ? 4 : 0;
      if (this.wsBuffer.length < offset + maskLength + length) return;
      let payload = this.wsBuffer.subarray(
        offset + maskLength,
        offset + maskLength + length,
      );
      if (masked) {
        const mask = this.wsBuffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(length);
        for (let i = 0; i < length; i++) {
          unmasked[i] = payload[i]! ^ mask[i % 4]!;
        }
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }
      this.wsBuffer = this.wsBuffer.subarray(offset + maskLength + length);
      if (opcode == 0x8) {
        return;
      }
      if (opcode == 0x1) {
        this.onControl(payload.toString("utf8"));
        continue;
      }
      if (opcode == 0x2 && this.currentJob) {
        this.currentJob.onBinary(Buffer.from(payload));
      }
    }
  }

  private onControl(raw: string): void {
    let message: Record<string, unknown> | null = null;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message?.kind == "ready") {
      this.ready = true;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    if (message?.kind == "instantiated") {
      if (this.currentJob && !this.currentJob.started) {
        this.currentJob.started = true;
        this.sendControl({ kind: "start" });
      }
      return;
    }
    if (message?.kind == "done") {
      this.currentJob?.resolve();
      return;
    }
    if (message?.kind == "error") {
      this.currentJob?.reject(
        new Error(String(message.message ?? "browser runtime failed")),
      );
    }
  }

  private sendControl(message: Record<string, unknown>): void {
    if (!this.wsSocket) {
      throw new Error("web session host is not connected to a browser");
    }
    sendWebSocketFrame(
      this.wsSocket,
      0x1,
      Buffer.from(JSON.stringify(message), "utf8"),
    );
  }
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

function launchBrowser(
  url: string,
  headless: boolean,
): { process: ChildProcess; ownsProcess: boolean } {
  if (process.env.BROWSER?.trim()) {
    const child = spawnBrowserCommand(process.env.BROWSER, url, headless);
    if (child) return { process: child, ownsProcess: true };
  }
  if (!headless) {
    const opened = openWithSystemBrowser(url);
    if (opened) return { process: opened, ownsProcess: false };
  }
  const direct = openWithInstalledBrowser(url, headless);
  if (direct) return { process: direct, ownsProcess: true };
  throw new Error(
    headless
      ? "could not find a headless-capable browser"
      : "could not open a browser automatically",
  );
}

function openWithSystemBrowser(url: string): ChildProcess | null {
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

function openWithInstalledBrowser(
  url: string,
  headless: boolean,
): ChildProcess | null {
  const candidates = [
    { command: "chromium", headless: ["--headless=new"] },
    { command: "chromium-browser", headless: ["--headless=new"] },
    { command: "google-chrome", headless: ["--headless=new"] },
    { command: "google-chrome-stable", headless: ["--headless=new"] },
    { command: "chrome", headless: ["--headless=new"] },
    { command: "msedge", headless: ["--headless=new"] },
    { command: "firefox", headless: ["-headless"] },
  ];
  for (const candidate of candidates) {
    if (!hasExecutable(candidate.command)) continue;
    return spawn(
      candidate.command,
      [...(headless ? candidate.headless : []), url],
      { stdio: "ignore", detached: true },
    );
  }
  return null;
}

function spawnBrowserCommand(
  commandValue: string,
  url: string,
  headless: boolean,
): ChildProcess | null {
  const direct = unwrapQuotedPath(String(commandValue).trim());
  if (hasExecutable(direct)) {
    const args = headless ? resolveHeadlessFlags(direct) : [];
    args.push(url);
    return spawn(direct, args, {
      stdio: "ignore",
      detached: true,
    });
  }
  const parts = splitCommand(String(commandValue));
  if (!parts.length) return null;
  const command = parts[0]!;
  if (!hasExecutable(command)) return null;
  const args = parts.slice(1);
  if (headless) {
    args.push(...resolveHeadlessFlags(commandValue));
  }
  args.push(url);
  return spawn(command, args, {
    stdio: "ignore",
    detached: true,
  });
}

function resolveHeadlessFlags(commandValue: string): string[] {
  const lower = commandValue.toLowerCase();
  if (lower.includes("firefox")) return ["-headless"];
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
  ];
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

function unwrapQuotedPath(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
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

function buildWebSessionHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>as-test</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #edf1f7;
        --panel: rgba(255, 255, 255, 0.72);
        --panel-edge: rgba(255, 255, 255, 0.7);
        --text: #1f2937;
        --muted: #667085;
        --track: rgba(15, 23, 42, 0.09);
        --fill-a: #8ec5ff;
        --fill-b: #5aa8ff;
        --shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
        --button-bg: rgba(255, 255, 255, 0.92);
        --button-text: #0f172a;
        --button-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.7),
          0 8px 20px rgba(15, 23, 42, 0.08);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0e1625;
          --panel: rgba(18, 24, 38, 0.76);
          --panel-edge: rgba(148, 163, 184, 0.18);
          --text: #e5edf8;
          --muted: #93a4bc;
          --track: rgba(255, 255, 255, 0.08);
          --fill-a: #79b8ff;
          --fill-b: #4d93ff;
          --shadow: 0 28px 90px rgba(2, 6, 23, 0.42);
          --button-bg: rgba(255, 255, 255, 0.12);
          --button-text: #e5edf8;
          --button-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 10px 24px rgba(2, 6, 23, 0.24);
        }
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        min-height: 100vh;
        font-family:
          "SF Pro Display",
          "SF Pro Text",
          -apple-system,
          BlinkMacSystemFont,
          "Helvetica Neue",
          sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top, rgba(255,255,255,.95), rgba(255,255,255,.35) 28%, transparent 50%),
          linear-gradient(180deg, #eef3f9 0%, #e7edf6 48%, #dfe6f0 100%);
      }
      @media (prefers-color-scheme: dark) {
        html, body {
          background:
            radial-gradient(circle at top, rgba(95, 153, 255, 0.16), rgba(14, 22, 37, 0.18) 26%, transparent 48%),
            linear-gradient(180deg, #111827 0%, #0e1625 52%, #09111d 100%);
        }
      }
      body {
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .panel {
        width: min(520px, calc(100vw - 48px));
        padding: 26px 28px 24px;
        border-radius: 28px;
        background: var(--panel);
        border: 1px solid var(--panel-edge);
        box-shadow: var(--shadow);
        backdrop-filter: blur(24px) saturate(1.2);
      }
      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: 30px;
        font-weight: 650;
        letter-spacing: -0.03em;
      }
      #status {
        margin-top: 10px;
        font-size: 14px;
        color: var(--muted);
      }
      #current {
        margin-top: 22px;
        font-size: 15px;
        font-weight: 560;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bar {
        position: relative;
        height: 7px;
        margin-top: 16px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--track);
      }
      .bar::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 -30%;
        width: 34%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--fill-a), var(--fill-b));
        box-shadow: 0 0 14px rgba(90, 168, 255, 0.35);
        animation: glide 1.15s ease-in-out infinite;
      }
      .note {
        margin-top: 14px;
        font-size: 12px;
        color: var(--muted);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 18px;
      }
      .button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: var(--button-text);
        background: var(--button-bg);
        box-shadow: var(--button-shadow);
        cursor: pointer;
      }
      .button:hover {
        filter: brightness(1.04);
      }
      .button[hidden] {
        display: none;
      }
      body[data-state="done"] .bar::before,
      body[data-state="disconnected"] .bar::before {
        animation: none;
        inset: 0;
        width: 100%;
      }
      @keyframes glide {
        0% { transform: translateX(0); }
        50% { transform: translateX(210%); }
        100% { transform: translateX(0); }
      }
    </style>
  </head>
  <body>
    <section class="panel" aria-live="polite">
      <p class="eyebrow">as-test</p>
      <h1>Running web tests</h1>
      <p id="status">Connecting to browser session…</p>
      <div id="current">Preparing runtime…</div>
      <div class="bar" aria-hidden="true"></div>
      <div class="note" id="note">Results continue streaming to the terminal while this page stays attached to the current run.</div>
      <div class="actions">
        <button class="button" id="exit" hidden type="button">Exit</button>
      </div>
    </section>
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
}

function buildWebSessionClientSource(): string {
  return String.raw`const runnerOrigin = location.origin;
const worker = new Worker(new URL("/worker.js", runnerOrigin), { type: "module" });
const wsUrl = new URL("/ws", runnerOrigin);
wsUrl.protocol = location.protocol == "https:" ? "wss:" : "ws:";
const ws = new WebSocket(wsUrl);
const status = document.getElementById("status");
const current = document.getElementById("current");
const note = document.getElementById("note");
const exitButton = document.getElementById("exit");
const replyBuffer = new SharedArrayBuffer(8 + 4 * 1024 * 1024);
const replyState = new Int32Array(replyBuffer, 0, 2);
const replyBytes = new Uint8Array(replyBuffer, 8);
ws.binaryType = "arraybuffer";

function setState(state) {
  document.body.dataset.state = state;
}

function setStatus(text) {
  status.textContent = text;
}

function setCurrent(text) {
  current.textContent = text;
}

function setNote(text) {
  note.textContent = text;
}

function showExitButton() {
  exitButton.hidden = false;
}

function attemptWindowClose(onBlocked) {
  try {
    window.close();
  } catch {}
  setTimeout(() => {
    if (!window.closed) onBlocked();
  }, 80);
}

function pushReply(frame) {
  if (frame.byteLength > replyBytes.byteLength) {
    throw new Error("WIPC reply exceeded shared browser buffer");
  }
  while (Atomics.load(replyState, 0) != 0) {
    Atomics.wait(replyState, 0, 1, 10);
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
  if (message.kind == "instantiated") {
    setState("loaded");
    setStatus("Runtime instantiated. Starting entrypoint…");
    ws.send(JSON.stringify({ kind: "instantiated" }));
    return;
  }
  if (message.kind == "done") {
    setState("done");
    setStatus("Completed.");
    ws.send(JSON.stringify({ kind: "done" }));
    return;
  }
  if (message.kind == "error") {
    setState("error");
    setStatus("Browser runtime error.");
    setCurrent(String(message.message ?? "Unknown browser runtime error"));
    ws.send(JSON.stringify({ kind: "error", message: String(message.message ?? "browser runtime error") }));
    return;
  }
};

ws.addEventListener("open", () => {
  setState("connected");
  setStatus("Connected. Waiting for work…");
  setCurrent("Waiting for the next test artifact…");
  ws.send(JSON.stringify({ kind: "ready" }));
});

ws.addEventListener("message", (event) => {
  if (typeof event.data == "string") {
    const message = JSON.parse(event.data);
    if (message.kind == "load") {
      setState("loading");
      setStatus("Instantiating current test file…");
      setCurrent(String(message.label ?? "Preparing test file…"));
      setNote("Results continue streaming to the terminal while this page stays attached to the current run.");
      worker.postMessage({ kind: "load", env: message.env, replyBuffer });
      return;
    }
    if (message.kind == "start") {
      setState("running");
      setStatus("Executing current test file…");
      worker.postMessage({ kind: "start" });
      return;
    }
    if (message.kind == "shutdown") {
      const ok = message.ok !== false;
      if (!ok) {
        setState("error");
        setStatus("Failed.");
        setCurrent(
          String(message.message ?? "The web test session ended with an error."),
        );
      } else {
        setState("done");
        setStatus("Completed.");
        setCurrent("All selected web binaries have finished.");
      }
      setNote("Closing browser page…");
      attemptWindowClose(() => {
        setNote("The browser kept this page open. You can close it now.");
        showExitButton();
      });
      ws.close();
      return;
    }
    return;
  }
  try {
    pushReply(event.data);
  } catch (error) {
    ws.send(JSON.stringify({ kind: "error", message: String(error) }));
  }
});

ws.addEventListener("close", () => {
  const state = document.body.dataset.state;
  if (state != "done" && state != "error") {
    setState("disconnected");
    setStatus("Disconnected.");
    setNote("The browser session closed before the run completed.");
    showExitButton();
  }
});

exitButton.addEventListener("click", () => {
  attemptWindowClose(() => {
    setStatus("Completed.");
    setCurrent("You can close this tab at any time.");
    setNote("This tab was opened manually, so the browser may require you to close it yourself.");
  });
});
`;
}

function buildWebSessionWorkerSource(): string {
  return String.raw`let replyState = null;
let replyBytes = null;
const WIPC_MAGIC = [0x57, 0x49, 0x50, 0x43];
let runtimeEnv = {};
let instance = null;

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.kind == "load") {
    const shared = message.replyBuffer;
    replyState = new Int32Array(shared, 0, 2);
    replyBytes = new Uint8Array(shared, 8);
    runtimeEnv = message.env ?? {};
    try {
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
      if (!instance) throw new Error("web runtime has not been instantiated yet");
      instance.exports.start?.();
      instance = null;
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
    versions: {},
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
  if (!wasmUrl) throw new Error("web runtime wasm path is missing");
  if (kind === "raw") {
    if (!helperUrl) throw new Error("web runtime helper path is missing for raw bindings");
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
    if (!helperUrl) throw new Error("web runtime helper path is missing for esm bindings");
    const instance = await captureInstantiateInstance(async () => {
      await import(helperUrl);
    });
    return decorateInstance(instance);
  }
  const binary = await fetchWasmBinary(wasmUrl);
  const module = new WebAssembly.Module(binary);
  const result = await WebAssembly.instantiate(module, imports);
  const wasmInstance = result instanceof WebAssembly.Instance ? result : result.instance;
  return decorateInstance(wasmInstance);
}

async function fetchWasmBinary(wasmUrl) {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error("failed to fetch wasm artifact: " + response.status);
  return response.arrayBuffer();
}

async function captureInstantiateInstance(run) {
  const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  let captured = null;
  WebAssembly.instantiate = async (source, importObject) => {
    const result = await originalInstantiate(source, importObject);
    captured = result instanceof WebAssembly.Instance ? result : result.instance;
    return result;
  };
  try {
    await run();
  } finally {
    WebAssembly.instantiate = originalInstantiate;
  }
  if (!captured) throw new Error("failed to capture WebAssembly.Instance in web worker");
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
    self.postMessage({ kind: "terminal", level: "accent", text: "running " + String(message.file ?? "spec") });
    return;
  }
  if (kind === "event:file-end") {
    const verdict = String(message.verdict ?? "done").toUpperCase();
    const time = String(message.time ?? "");
    self.postMessage({ kind: "terminal", level: verdict === "PASS" ? "success" : "error", text: verdict + " " + String(message.file ?? "") + (time ? " " + time : "") });
    return;
  }
  if (kind === "event:log") {
    self.postMessage({ kind: "terminal", level: "", text: String(message.text ?? "") });
    return;
  }
  if (kind === "event:warn") {
    self.postMessage({ kind: "terminal", level: "error", text: String(message.message ?? "warning") });
  }
}
`;
}
