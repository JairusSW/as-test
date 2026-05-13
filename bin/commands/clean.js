import { clean } from "./clean-core.js";
import { loadConfig } from "../util.js";
export { clean } from "./clean-core.js";
export async function executeCleanCommand(
  rawArgs,
  configPath,
  selectedModes,
  resolveExecutionModes,
) {
  const modeTargets =
    selectedModes.length > 0
      ? resolveExecutionModes(configPath, selectedModes)
      : resolveAllCleanModes(configPath);
  await clean(configPath, modeTargets, selectedModes.length == 0);
}
function resolveAllCleanModes(configPath) {
  const resolvedConfigPath = configPath ?? "./as-test.config.json";
  const config = loadConfig(resolvedConfigPath, true);
  return [undefined, ...Object.keys(config.modes)];
}
