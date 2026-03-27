import {
  BuildFeatureToggles,
  closeSerialBuildWorkerPool,
} from "./build-core.js";
import { CliFeatureToggles, CliListFlags } from "./types.js";

export { build } from "./build-core.js";
export { formatInvocation, getBuildInvocationPreview } from "./build-core.js";
export type { BuildFeatureToggles } from "./build-core.js";

type BuildCommandDeps = {
  resolveCommandArgs(rawArgs: string[], command: string): string[];
  resolveListFlags(rawArgs: string[], command: string): CliListFlags;
  resolveFeatureToggles(rawArgs: string[], command: string): CliFeatureToggles;
  resolveBuildParallelJobs(rawArgs: string[]): {
    jobs: number;
    buildJobs: number;
  };
  resolveExecutionModes(
    configPath: string | undefined,
    selectedModes: string[],
  ): (string | undefined)[];
  listExecutionPlan(
    command: "build" | "run" | "test",
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    listFlags: CliListFlags,
  ): Promise<void>;
  runBuildModes(
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    buildFeatureToggles: BuildFeatureToggles,
    parallel: {
      jobs: number;
      buildJobs: number;
    },
  ): Promise<void>;
};

export async function executeBuildCommand(
  rawArgs: string[],
  configPath: string | undefined,
  selectedModes: string[],
  deps: BuildCommandDeps,
): Promise<void> {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "build");
  const listFlags = deps.resolveListFlags(rawArgs, "build");
  const featureToggles = deps.resolveFeatureToggles(rawArgs, "build");
  const parallel = deps.resolveBuildParallelJobs(rawArgs);
  const buildFeatureToggles: BuildFeatureToggles = {
    tryAs: featureToggles.tryAs,
    coverage: featureToggles.coverage,
  };
  const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
  if (listFlags.list || listFlags.listModes) {
    await deps.listExecutionPlan(
      "build",
      configPath,
      commandArgs,
      modeTargets,
      listFlags,
    );
    return;
  }
  const previousBuildApi = process.env.AS_TEST_BUILD_API;
  process.env.AS_TEST_BUILD_API = "1";
  try {
    await deps.runBuildModes(
      configPath,
      commandArgs,
      modeTargets,
      buildFeatureToggles,
      parallel,
    );
  } finally {
    if (previousBuildApi == undefined) {
      delete process.env.AS_TEST_BUILD_API;
    } else {
      process.env.AS_TEST_BUILD_API = previousBuildApi;
    }
    await closeSerialBuildWorkerPool();
  }
}
