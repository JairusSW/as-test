export { createRunReporter, run } from "./run-core.js";
export async function executeRunCommand(rawArgs, flags, configPath, selectedModes, deps) {
    const commandArgs = deps.resolveCommandArgs(rawArgs, "run");
    const listFlags = deps.resolveListFlags(rawArgs, "run");
    const featureToggles = deps.resolveFeatureToggles(rawArgs, "run");
    const runFlags = {
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
        await deps.listExecutionPlan("run", configPath, commandArgs, modeTargets, listFlags);
        return;
    }
    await deps.runRuntimeModes(runFlags, configPath, commandArgs, modeTargets);
}
