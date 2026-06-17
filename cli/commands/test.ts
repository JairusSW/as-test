import { BuildFeatureToggles } from "./build.js";
import { CliFeatureToggles, CliListFlags, RunFlags } from "./types.js";
import { FuzzOverrides } from "./fuzz-core.js";

type TestCommandDeps = {
  resolveCommandArgs(rawArgs: string[], command: string): string[];
  resolveSuiteSelectors(rawArgs: string[], command: "run" | "test"): string[];
  resolveFuzzerSelectors(rawArgs: string[], command: "fuzz" | "test"): string[];
  resolveListFlags(rawArgs: string[], command: string): CliListFlags;
  resolveFeatureToggles(rawArgs: string[], command: string): CliFeatureToggles;
  resolveParallelJobs(
    rawArgs: string[],
    command: "test",
  ): {
    jobs: number;
    buildJobs: number;
    runJobs: number;
  };
  resolveBrowserOverride(
    rawArgs: string[],
    command: "test",
  ): string | undefined;
  resolveShowCoverageMode(
    rawArgs: string[],
    command: "test",
  ): "collapsed" | "all" | undefined;
  resolveFuzzOverrides(
    rawArgs: string[],
    command: "test" | "fuzz",
  ): FuzzOverrides;
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
    suiteSelectors: string[],
    fuzzerSelectors: string[],
    modes: (string | undefined)[],
    buildFeatureToggles: BuildFeatureToggles,
    fuzzEnabled: boolean,
    fuzzOverrides: FuzzOverrides,
  ): Promise<void>;
  activateChangedFilter(configPath: string | undefined): Promise<void>;
};

export async function executeTestCommand(
  rawArgs: string[],
  flags: string[],
  configPath: string | undefined,
  selectedModes: string[],
  deps: TestCommandDeps,
): Promise<void> {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "test");
  const suiteSelectors = deps.resolveSuiteSelectors(rawArgs, "test");
  const fuzzerSelectors = deps.resolveFuzzerSelectors(rawArgs, "test");
  const listFlags = deps.resolveListFlags(rawArgs, "test");
  const featureToggles = deps.resolveFeatureToggles(rawArgs, "test");
  const buildFeatureToggles: BuildFeatureToggles = {
    coverage: featureToggles.coverage,
    featureOverrides: featureToggles.featureOverrides,
  };
  const showCoverageMode = deps.resolveShowCoverageMode(rawArgs, "test");
  const runFlags: RunFlags = {
    snapshot: !flags.includes("--no-snapshot"),
    createSnapshots: flags.includes("--create-snapshots"),
    overwriteSnapshots: flags.includes("--overwrite-snapshots"),
    clean: flags.includes("--clean"),
    showCoverage: showCoverageMode != undefined,
    showCoverageAll: showCoverageMode == "all",
    verbose: flags.includes("--verbose"),
    showLogs: flags.includes("--show-logs"),
    ...deps.resolveParallelJobs(rawArgs, "test"),
    coverage: featureToggles.coverage,
    browser: deps.resolveBrowserOverride(rawArgs, "test"),
    watch: flags.includes("--watch") || flags.includes("-w"),
    cache: flags.includes("--cache"),
    noCache: flags.includes("--no-cache"),
    changed: flags.includes("--changed"),
  };
  const fuzzEnabled = flags.includes("--fuzz");
  const fuzzOverrides = deps.resolveFuzzOverrides(rawArgs, "test");
  const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
  if (runFlags.changed) await deps.activateChangedFilter(configPath);
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
    suiteSelectors,
    fuzzerSelectors,
    modeTargets,
    buildFeatureToggles,
    fuzzEnabled,
    fuzzOverrides,
  );
}
