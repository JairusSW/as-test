export function buildWebRunnerClientSource(): string {
  return String.raw`const runnerOrigin = location.origin;
const workerUrl = new URL("/worker.js", runnerOrigin);
const wsUrl = new URL("/ws", runnerOrigin);
wsUrl.protocol = location.protocol == "https:" ? "wss:" : "ws:";

const status = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const summary = document.getElementById("summary");
const footerDetail = document.getElementById("footer-detail");
const output = document.getElementById("output");
const replyBuffer = new SharedArrayBuffer(8 + 4 * 1024 * 1024);
const replyState = new Int32Array(replyBuffer, 0, 2);
const replyBytes = new Uint8Array(replyBuffer, 8);
const worker = new Worker(workerUrl, { type: "module" });
const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";

appendLine("launching browser terminal session", "dim prompt");
appendLine("waiting for worker bootstrap", "dim");

function setStatus(message, tone = "warn") {
  status.textContent = message;
  const tones = {
    warn: "var(--warn)",
    error: "var(--error)",
    ok: "var(--success)",
    accent: "var(--accent)",
  };
  statusDot.style.color = tones[tone] || tones.warn;
  statusDot.style.background = tones[tone] || tones.warn;
}

function setSummary(message) {
  summary.textContent = message;
}

function setFooter(message) {
  footerDetail.textContent = message;
}

function appendLine(message, className = "") {
  const line = document.createElement("span");
  line.className = "line " + className;
  line.textContent = String(message ?? "");
  output.appendChild(line);
  output.appendChild(document.createTextNode("\n"));
  output.scrollTop = output.scrollHeight;
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
  if (message.kind == "terminal") {
    appendLine(String(message.text ?? ""), String(message.level ?? ""));
    return;
  }
  if (message.kind == "instantiated") {
    setStatus("ready", "accent");
    setSummary("worker instantiated the wasm module");
    setFooter("Waiting for start signal from the host runner.");
    appendLine("runtime instantiated", "success prompt");
    ws.send(JSON.stringify({ kind: "instantiated" }));
    return;
  }
  if (message.kind == "done") {
    setStatus("finished", "ok");
    setSummary("test execution completed");
    setFooter("Browser runtime finished cleanly.");
    appendLine("session complete", "success prompt");
    ws.send(JSON.stringify({ kind: "done" }));
    return;
  }
  if (message.kind == "error") {
    setStatus("failed", "error");
    setSummary("browser runtime failed");
    setFooter("See terminal output for the failure reason.");
    appendLine(String(message.message ?? "unknown browser runtime error"), "error");
    ws.send(
      JSON.stringify({
        kind: "error",
        message: String(message.message ?? "unknown browser runtime error"),
      }),
    );
    return;
  }
  if (message.kind == "status") {
    setStatus(String(message.text ?? "running"), String(message.level ?? "accent"));
    if (message.summary) setSummary(String(message.summary));
    if (message.footer) setFooter(String(message.footer));
    return;
  }
};

ws.addEventListener("open", () => {
  setStatus("connected", "accent");
  setSummary("transport online");
  setFooter("Spawning browser worker.");
  appendLine("websocket tunnel established", "accent prompt");
  ws.send(JSON.stringify({ kind: "ready" }));
  worker.postMessage({
    kind: "init",
    env: window.__AS_TEST_ENV__,
    replyBuffer,
  });
});

ws.addEventListener("message", (event) => {
  if (typeof event.data == "string") {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message?.kind == "start") {
      setStatus("running", "accent");
      setSummary("host runner started execution");
      setFooter("Streaming runtime frames to the host runner.");
      appendLine("received start signal", "accent prompt");
      worker.postMessage({ kind: "start" });
    }
    return;
  }
  try {
    pushReply(event.data);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    setStatus("bridge failure", "error");
    setSummary("shared reply buffer failure");
    setFooter("The browser could not deliver runtime data.");
    appendLine(message, "error");
    ws.send(JSON.stringify({ kind: "error", message }));
  }
});

ws.addEventListener("close", () => {
  setStatus("disconnected", "error");
  setSummary("runner disconnected");
  setFooter("The browser transport closed.");
  appendLine("runner disconnected", "error prompt");
});

ws.addEventListener("error", () => {
  setStatus("connection error", "error");
  setSummary("websocket connection failed");
  setFooter("Unable to connect to the local web runner.");
  appendLine("websocket connection failed", "error prompt");
});
`;
}
