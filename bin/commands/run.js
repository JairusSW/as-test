export { createRunReporter, resetCollectedLogs, run } from "./run-core.js";
export async function executeRunCommand(
  rawArgs,
  flags,
  configPath,
  selectedModes,
  deps,
) {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "run");
  const suiteSelectors = deps.resolveSuiteSelectors(rawArgs, "run");
  const listFlags = deps.resolveListFlags(rawArgs, "run");
  const featureToggles = deps.resolveFeatureToggles(rawArgs, "run");
  const showCoverageMode = deps.resolveShowCoverageMode(rawArgs, "run");
  const runFlags = {
    snapshot: !flags.includes("--no-snapshot"),
    createSnapshots: flags.includes("--create-snapshots"),
    overwriteSnapshots: flags.includes("--overwrite-snapshots"),
    clean: flags.includes("--clean"),
    showCoverage: showCoverageMode != undefined,
    showCoverageAll: showCoverageMode == "all",
    verbose: flags.includes("--verbose"),
    showLogs: flags.includes("--show-logs"),
    ...deps.resolveParallelJobs(rawArgs, "run"),
    coverage: featureToggles.coverage,
    browser: deps.resolveBrowserOverride(rawArgs, "run"),
    reporterPath: deps.resolveReporterOverride(rawArgs, "run"),
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
  await deps.runRuntimeModes(
    runFlags,
    configPath,
    commandArgs,
    suiteSelectors,
    modeTargets,
  );
}
