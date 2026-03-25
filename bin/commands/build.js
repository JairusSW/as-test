export { build } from "./build-core.js";
export { formatInvocation, getBuildInvocationPreview } from "./build-core.js";
export async function executeBuildCommand(rawArgs, configPath, selectedModes, deps) {
    const commandArgs = deps.resolveCommandArgs(rawArgs, "build");
    const listFlags = deps.resolveListFlags(rawArgs, "build");
    const featureToggles = deps.resolveFeatureToggles(rawArgs, "build");
    const buildFeatureToggles = {
        tryAs: featureToggles.tryAs,
        coverage: featureToggles.coverage,
    };
    const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
    if (listFlags.list || listFlags.listModes) {
        await deps.listExecutionPlan("build", configPath, commandArgs, modeTargets, listFlags);
        return;
    }
    await deps.runBuildModes(configPath, commandArgs, modeTargets, buildFeatureToggles);
}
