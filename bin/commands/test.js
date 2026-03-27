export async function executeTestCommand(rawArgs, flags, configPath, selectedModes, deps) {
    const commandArgs = deps.resolveCommandArgs(rawArgs, "test");
    const listFlags = deps.resolveListFlags(rawArgs, "test");
    const featureToggles = deps.resolveFeatureToggles(rawArgs, "test");
    const buildFeatureToggles = {
        tryAs: featureToggles.tryAs,
        coverage: featureToggles.coverage,
    };
    const runFlags = {
        snapshot: !flags.includes("--no-snapshot"),
        createSnapshots: flags.includes("--create-snapshots"),
        overwriteSnapshots: flags.includes("--overwrite-snapshots"),
        clean: flags.includes("--clean"),
        showCoverage: flags.includes("--show-coverage"),
        verbose: flags.includes("--verbose"),
        ...deps.resolveParallelJobs(rawArgs, "test"),
        coverage: featureToggles.coverage,
        browser: deps.resolveBrowserOverride(rawArgs, "test"),
    };
    const fuzzEnabled = flags.includes("--fuzz");
    const fuzzOverrides = deps.resolveFuzzOverrides(rawArgs, "test");
    const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
    if (listFlags.list || listFlags.listModes) {
        await deps.listExecutionPlan("test", configPath, commandArgs, modeTargets, listFlags, fuzzEnabled);
        return;
    }
    await deps.runTestModes(runFlags, configPath, commandArgs, modeTargets, buildFeatureToggles, fuzzEnabled, fuzzOverrides);
}
