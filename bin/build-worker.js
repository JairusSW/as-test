import { build, buildRecorderStorage } from "./commands/build-core.js";
process.on("message", async (message) => {
  if (!message || message.type != "build-file") return;
  // Force the in-process API build path inside this worker so the readFile
  // hook is reachable. We do it on first message rather than at module load
  // so importing this file from a test doesn't mutate the parent env.
  process.env.AS_TEST_BUILD_API = "1";
  const seen = new Set();
  const collected = [];
  const runBuild = async () => {
    await build(
      message.configPath,
      [message.file],
      message.modeName,
      message.featureToggles,
      message.overrides,
    );
  };
  try {
    if (message.recordReads) {
      const store = {
        // asc commonly resolves the same source twice during a build (entry
        // lookups, transform passes). Dedupe at record time so IPC payloads
        // stay bounded — `(mode, spec)` is constant for the worker's lifetime
        // of this task, so a file-keyed set is sufficient.
        record: (mode, spec, file) => {
          if (seen.has(file)) return;
          seen.add(file);
          collected.push({ mode, spec, file });
        },
      };
      await buildRecorderStorage.run(store, runBuild);
    } else {
      await runBuild();
    }
    send({
      type: "done",
      id: message.id,
      reads: message.recordReads ? collected : undefined,
    });
  } catch (error) {
    send({
      type: "error",
      id: message.id,
      error: serializeError(error),
    });
  }
});
function send(message) {
  if (!process.send) return;
  process.send(message);
}
function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      name: "Error",
      message: typeof error == "string" ? error : "unknown error",
    };
  }
  const out = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  const errorRecord = error;
  for (const key of Object.keys(error)) {
    out[key] = errorRecord[key];
  }
  return out;
}
