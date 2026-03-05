import { BuildFeatureToggles } from "./build.js";
import { CliFeatureToggles, CliListFlags, RunFlags } from "./types.js";

type TestCommandDeps = {
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
  runTestModes(
    runFlags: RunFlags,
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    buildFeatureToggles: BuildFeatureToggles,
  ): Promise<void>;
};

export async function executeTestCommand(
  rawArgs: string[],
  flags: string[],
  configPath: string | undefined,
  selectedModes: string[],
  deps: TestCommandDeps,
): Promise<void> {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "test");
  const listFlags = deps.resolveListFlags(rawArgs, "test");
  const featureToggles = deps.resolveFeatureToggles(rawArgs, "test");
  const buildFeatureToggles: BuildFeatureToggles = {
    tryAs: featureToggles.tryAs,
    coverage: featureToggles.coverage,
  };
  const runFlags: RunFlags = {
    snapshot: !flags.includes("--no-snapshot"),
    updateSnapshots: flags.includes("--update-snapshots"),
    clean: flags.includes("--clean"),
    showCoverage: flags.includes("--show-coverage"),
    verbose: flags.includes("--verbose"),
    coverage: featureToggles.coverage,
  };
  const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
  if (listFlags.list || listFlags.listModes) {
    await deps.listExecutionPlan(
      "test",
      configPath,
      commandArgs,
      modeTargets,
      listFlags,
    );
    return;
  }
  await deps.runTestModes(
    runFlags,
    configPath,
    commandArgs,
    modeTargets,
    buildFeatureToggles,
  );
}
