export function buildWebRunnerHtml() {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>as-test web runner</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #030712;
        --bg2: #07101d;
        --line: rgba(125, 211, 252, 0.14);
        --muted: #7f92b0;
        --text: #dde7f7;
        --accent: #7dd3fc;
        --accent2: #5eead4;
        --warn: #fbbf24;
        --error: #f87171;
        --success: #86efac;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        min-height: 100vh;
      }
      body {
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(125, 211, 252, 0.12), transparent 34%),
          radial-gradient(circle at top right, rgba(94, 234, 212, 0.08), transparent 28%),
          linear-gradient(180deg, var(--bg), var(--bg2));
        color: var(--text);
        font: 14px/1.6 "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
      }
      .chrome {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px 14px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(8, 14, 28, 0.96), rgba(8, 14, 28, 0.78));
        backdrop-filter: blur(18px);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .lights {
        display: flex;
        gap: 8px;
      }
      .light {
        width: 11px;
        height: 11px;
        border-radius: 999px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      }
      .light.red { background: #fb7185; }
      .light.yellow { background: #fbbf24; }
      .light.green { background: #4ade80; }
      .title {
        display: grid;
        gap: 2px;
      }
      .title strong {
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .title span,
      .footer {
        color: var(--muted);
      }
      .statusbar {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--warn);
        box-shadow: 0 0 18px currentColor;
      }
      .status-text {
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .terminal {
        position: relative;
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(7, 12, 24, 0.92), rgba(3, 8, 18, 0.98)),
          linear-gradient(90deg, rgba(125, 211, 252, 0.03), rgba(94, 234, 212, 0.03));
      }
      .terminal::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(rgba(125, 211, 252, 0.04), transparent 2px),
          linear-gradient(90deg, rgba(125, 211, 252, 0.03), transparent 1px);
        background-size: 100% 4px, 24px 100%;
        opacity: 0.22;
        pointer-events: none;
      }
      #output {
        position: absolute;
        inset: 0;
        margin: 0;
        padding: 22px 24px 28px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.65;
        tab-size: 2;
      }
      .line {
        display: block;
      }
      .line.dim { color: var(--muted); }
      .line.warn { color: var(--warn); }
      .line.error { color: var(--error); }
      .line.success { color: var(--success); }
      .line.accent { color: var(--accent); }
      .prompt::before {
        content: "› ";
        color: var(--accent2);
      }
      .footer {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 22px 14px;
        border-top: 1px solid var(--line);
        font-size: 12px;
        background: rgba(7, 12, 24, 0.86);
      }
      .footer strong {
        color: var(--text);
      }
      @media (max-width: 720px) {
        .chrome {
          padding: 14px 16px 12px;
          align-items: flex-start;
          flex-direction: column;
        }
        #output {
          padding: 16px 16px 22px;
        }
        .footer {
          padding: 10px 16px 14px;
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="chrome">
        <div class="brand">
          <div class="lights" aria-hidden="true">
            <span class="light red"></span>
            <span class="light yellow"></span>
            <span class="light green"></span>
          </div>
          <div class="title">
            <strong>as-test web runner</strong>
            <span id="summary">waiting for browser runtime bootstrap</span>
          </div>
        </div>
        <div class="statusbar">
          <span id="status-dot" class="status-dot"></span>
          <span id="status" class="status-text">connecting</span>
        </div>
      </header>
      <main class="terminal">
        <pre id="output" aria-live="polite"></pre>
      </main>
      <footer class="footer">
        <span>Mode: <strong>web</strong></span>
        <span id="footer-detail">Waiting for transport handshake.</span>
      </footer>
    </div>
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
}
