import { BuildFeatureToggles } from "./build.js";
import { CliFeatureToggles, CliListFlags, RunFlags } from "./types.js";
import { FuzzOverrides } from "./fuzz-core.js";

type TestCommandDeps = {
  resolveCommandArgs(rawArgs: string[], command: string): string[];
  resolveListFlags(rawArgs: string[], command: string): CliListFlags;
  resolveFeatureToggles(rawArgs: string[], command: string): CliFeatureToggles;
  resolveBrowserOverride(rawArgs: string[], command: "test"): string | undefined;
  resolveFuzzOverrides(rawArgs: string[], command: "test" | "fuzz"): FuzzOverrides;
  resolveExecutionModes(
    configPath: string | undefined,
    selectedModes: string[],
  ): (string | undefined)[];
  listExecutionPlan(
    command: "build" | "run" | "test" | "fuzz",
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    listFlags: CliListFlags,
    fuzzEnabled?: boolean,
  ): Promise<void>;
  runTestModes(
    runFlags: RunFlags,
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    buildFeatureToggles: BuildFeatureToggles,
    fuzzEnabled: boolean,
    fuzzOverrides: FuzzOverrides,
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
    browser: deps.resolveBrowserOverride(rawArgs, "test"),
  };
  const fuzzEnabled = flags.includes("--fuzz");
  const fuzzOverrides = deps.resolveFuzzOverrides(rawArgs, "test");
  const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
  if (listFlags.list || listFlags.listModes) {
    await deps.listExecutionPlan(
      "test",
      configPath,
      commandArgs,
      modeTargets,
      listFlags,
      fuzzEnabled,
    );
    return;
  }
  await deps.runTestModes(
    runFlags,
    configPath,
    commandArgs,
    modeTargets,
    buildFeatureToggles,
    fuzzEnabled,
    fuzzOverrides,
  );
}
