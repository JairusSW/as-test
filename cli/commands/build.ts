import { BuildFeatureToggles } from "./build-core.js";
import { CliFeatureToggles, CliListFlags } from "./types.js";

export { build } from "./build-core.js";
export type { BuildFeatureToggles } from "./build-core.js";

type BuildCommandDeps = {
  resolveCommandArgs(rawArgs: string[], command: string): string[];
  resolveListFlags(rawArgs: string[], command: string): CliListFlags;
  resolveFeatureToggles(rawArgs: string[], command: string): CliFeatureToggles;
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
  await deps.runBuildModes(
    configPath,
    commandArgs,
    modeTargets,
    buildFeatureToggles,
  );
}
