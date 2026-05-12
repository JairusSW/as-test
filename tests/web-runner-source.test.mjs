import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";

const repoRoot = process.cwd();

test("web runner client uses one origin and one port for all browser-side traffic", async () => {
  const clientSource = await fs.readFile(
    path.join(repoRoot, "lib/src/web-runner/client.ts"),
    "utf8",
  );
  const htmlSource = await fs.readFile(
    path.join(repoRoot, "lib/src/web-runner/html.ts"),
    "utf8",
  );

  assert.match(clientSource, /const runnerOrigin = location\.origin;/);
  assert.match(clientSource, /new URL\("\/worker\.js", runnerOrigin\)/);
  assert.match(clientSource, /new URL\("\/ws", runnerOrigin\)/);
  assert.match(clientSource, /new WebSocket\(wsUrl\)/);
  assert.match(htmlSource, /src="\/client\.js"/);
});
