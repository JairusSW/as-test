import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { spawn } from "child_process";
import fs from "fs/promises";
import { Readable, Writable } from "node:stream";
import { Channel, MessageType } from "../bin/wipc.js";

const repoRoot = process.cwd();

// The WIPC magic ("WIPC") can occur by chance inside a test's ordinary stdout
// output (binary data, hex dumps, or the literal string). The frame scanner
// must never crash or stall on such a collision: it must surface the magic as
// passthrough output, resync, and keep delivering the real frames around it.

function frame(type, payloadBuf) {
  const head = Buffer.alloc(9);
  Buffer.from("WIPC").copy(head, 0);
  head.writeUInt8(type, 4);
  head.writeUInt32LE(payloadBuf.length, 5);
  return Buffer.concat([head, payloadBuf]);
}

// Feed `chunks` through a Channel and collect what it emits.
async function drive(chunks) {
  const input = new Readable({ read() {} });
  const output = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  const passthrough = [];
  const calls = [];
  const dataMsgs = [];
  let crashed = null;

  class Probe extends Channel {
    onPassthrough(d) {
      passthrough.push(Buffer.from(d));
    }
    onCall(msg) {
      calls.push(msg);
    }
    onDataMessage(d) {
      dataMsgs.push(Buffer.from(d));
    }
  }
  const handler = (e) => {
    crashed = e;
  };
  process.once("uncaughtException", handler);
  new Probe(input, output);
  for (const c of chunks) input.push(c);
  input.push(null);
  await new Promise((r) => setTimeout(r, 30));
  process.removeListener("uncaughtException", handler);

  return {
    crashed,
    passthrough: Buffer.concat(passthrough).toString("utf8"),
    calls,
    dataMsgs,
  };
}

test("magic + CALL type + non-JSON payload does not crash (was SyntaxError)", async () => {
  const r = await drive([
    frame(MessageType.CALL, Buffer.from("this is not json")),
  ]);
  assert.equal(r.crashed, null, "frame scanner threw an uncaught exception");
  assert.equal(r.calls.length, 0);
  assert.match(
    r.passthrough,
    /WIPC/,
    "coincidental magic should surface as output",
  );
});

test("magic + unknown type byte does not crash (was 'Unknown frame type')", async () => {
  const r = await drive([frame(0x09, Buffer.from("xx"))]);
  assert.equal(r.crashed, null);
  assert.equal(r.calls.length, 0);
});

test("magic + oversized length field does not stall or swallow later frames", async () => {
  // 0x09 (tab) lands in the length field -> ~1.8 GiB declared length.
  const collision = Buffer.from("WIPC\tpayload-from-a-normal-test", "utf8");
  const real = frame(
    MessageType.CALL,
    Buffer.from(JSON.stringify({ kind: "event:warn" })),
  );
  const r = await drive([Buffer.concat([collision, real])]);
  assert.equal(r.crashed, null);
  // The real frame after the collision must still be delivered (lossless resync).
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].kind, "event:warn");
});

test("a real CALL frame split across two chunks is still parsed", async () => {
  const f = frame(
    MessageType.CALL,
    Buffer.from(JSON.stringify({ kind: "event:log", text: "ok" })),
  );
  const r = await drive([f.subarray(0, 6), f.subarray(6)]);
  assert.equal(r.crashed, null);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].text, "ok");
});

// End-to-end: a real spec that prints the magic to stdout must still PASS and
// report its result, rather than crash the CLI or silently vanish (SKIP).
test("end-to-end: spec printing the WIPC magic still passes and reports", async () => {
  const specRel = "assembly/__tests__/__tmp_wipc_collision.spec.ts";
  const specPath = path.join(repoRoot, specRel);
  const SPEC = `import { describe, expect, test } from "..";

describe("user output collides with WIPC framing", () => {
  test("forged CALL header in stdout", () => {
    console.log("WIPC\\u0002\\u0004\\u0000\\u0000\\u0000xxxx");
    expect(1).toBe(1);
  });
});
`;
  await fs.writeFile(specPath, SPEC, "utf8");
  try {
    const result = await runNode([
      "./bin/index.js",
      "test",
      specRel,
      "--mode",
      "node:wasi",
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS/);
    // The test must actually run and report (broken state: 0 tests ran and the
    // file showed as "1 skipped" because the report frame was swallowed).
    assert.match(result.stdout, /Tests:\s+0 failed, 0 skipped, 1 total/);
    assert.match(result.stdout, /Files:\s+0 failed, 0 skipped, 1 total/);
  } finally {
    await fs.rm(specPath, { force: true });
  }
});

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn("node", args, {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
