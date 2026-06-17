export async function executeTestCommand(
  rawArgs,
  flags,
  configPath,
  selectedModes,
  deps,
) {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "test");
  const suiteSelectors = deps.resolveSuiteSelectors(rawArgs, "test");
  const fuzzerSelectors = deps.resolveFuzzerSelectors(rawArgs, "test");
  const listFlags = deps.resolveListFlags(rawArgs, "test");
  const featureToggles = deps.resolveFeatureToggles(rawArgs, "test");
  const buildFeatureToggles = {
    coverage: featureToggles.coverage,
    featureOverrides: featureToggles.featureOverrides,
  };
  const showCoverageMode = deps.resolveShowCoverageMode(rawArgs, "test");
  const runFlags = {
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
