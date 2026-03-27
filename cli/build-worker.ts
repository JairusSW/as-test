import { build } from "./commands/build-core.js";
import type {
  BuildConfigOverrides,
  BuildFeatureToggles,
} from "./commands/build-core.js";

process.env.AS_TEST_BUILD_API = "1";

type BuildTaskMessage = {
  type: "build-file";
  id: number;
  configPath?: string;
  file: string;
  modeName?: string;
  featureToggles: BuildFeatureToggles;
  overrides: BuildConfigOverrides;
};

type BuildSuccessMessage = {
  type: "done";
  id: number;
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
  try {
    await build(
      message.configPath,
      [message.file],
      message.modeName,
      message.featureToggles,
      message.overrides,
    );
    send({
      type: "done",
      id: message.id,
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
