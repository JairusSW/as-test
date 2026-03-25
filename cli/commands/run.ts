import { CliFeatureToggles, CliListFlags, RunFlags } from "./types.js";

export { createRunReporter, run } from "./run-core.js";
export type { RunResult } from "./run-core.js";

type RunCommandDeps = {
  resolveCommandArgs(rawArgs: string[], command: string): string[];
  resolveListFlags(rawArgs: string[], command: string): CliListFlags;
  resolveFeatureToggles(rawArgs: string[], command: string): CliFeatureToggles;
  resolveBrowserOverride(rawArgs: string[], command: "run"): string | undefined;
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
  runRuntimeModes(
    runFlags: RunFlags,
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
  ): Promise<void>;
};

export async function executeRunCommand(
  rawArgs: string[],
  flags: string[],
  configPath: string | undefined,
  selectedModes: string[],
  deps: RunCommandDeps,
): Promise<void> {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "run");
  const listFlags = deps.resolveListFlags(rawArgs, "run");
  const featureToggles = deps.resolveFeatureToggles(rawArgs, "run");
  const runFlags: RunFlags = {
    snapshot: !flags.includes("--no-snapshot"),
    createSnapshots: flags.includes("--create-snapshots"),
    overwriteSnapshots: flags.includes("--overwrite-snapshots"),
    clean: flags.includes("--clean"),
    showCoverage: flags.includes("--show-coverage"),
    verbose: flags.includes("--verbose"),
    coverage: featureToggles.coverage,
    browser: deps.resolveBrowserOverride(rawArgs, "run"),
  };
  const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
  if (listFlags.list || listFlags.listModes) {
    await deps.listExecutionPlan(
      "run",
      configPath,
      commandArgs,
      modeTargets,
      listFlags,
    );
    return;
  }
  await deps.runRuntimeModes(runFlags, configPath, commandArgs, modeTargets);
}
