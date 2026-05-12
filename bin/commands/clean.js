import { clean } from "./clean-core.js";
export { clean } from "./clean-core.js";
export async function executeCleanCommand(configPath, selectedModes, resolveExecutionModes) {
    const modeTargets = resolveExecutionModes(configPath, selectedModes);
    await clean(configPath, modeTargets);
}
