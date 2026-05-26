import { build, buildRecorderStorage } from "./commands/build-core.js";
import type {
  BuildConfigOverrides,
  BuildFeatureToggles,
} from "./commands/build-core.js";
import type { BuildReadEntry } from "./build-worker-pool.js";

type BuildTaskMessage = {
  type: "build-file";
  id: number;
  configPath?: string;
  file: string;
  modeName?: string;
  featureToggles: BuildFeatureToggles;
  overrides: BuildConfigOverrides;
  recordReads?: boolean;
};

type BuildSuccessMessage = {
  type: "done";
  id: number;
  reads?: BuildReadEntry[];
};

type BuildErrorMessage = {
  type: "error";
  id: number;
  error: {
    name: string;
    message: string;
    stack?: string;
    [key: string]: unknown;
  };
};

process.on("message", async (message: BuildTaskMessage) => {
  if (!message || message.type != "build-file") return;
  // Force the in-process API build path inside this worker so the readFile
  // hook is reachable. We do it on first message rather than at module load
  // so importing this file from a test doesn't mutate the parent env.
  process.env.AS_TEST_BUILD_API = "1";

  const seen = new Set<string>();
  const collected: BuildReadEntry[] = [];
  const runBuild = async (): Promise<void> => {
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
        record: (
          mode: string | undefined,
          spec: string,
          file: string,
        ): void => {
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
    } satisfies BuildSuccessMessage);
  } catch (error) {
    send({
      type: "error",
      id: message.id,
      error: serializeError(error),
    } satisfies BuildErrorMessage);
  }
});

function send(message: BuildSuccessMessage | BuildErrorMessage): void {
  if (!process.send) return;
  process.send(message);
}

function serializeError(error: unknown): BuildErrorMessage["error"] {
  if (!(error instanceof Error)) {
    return {
      name: "Error",
      message: typeof error == "string" ? error : "unknown error",
    };
  }
  const out: BuildErrorMessage["error"] = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  const errorRecord = error as unknown as Record<string, unknown>;
  for (const key of Object.keys(error)) {
    out[key] = errorRecord[key];
  }
  return out;
}
