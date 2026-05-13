import { clean } from "./clean-core.js";
import { loadConfig } from "../util.js";

export { clean } from "./clean-core.js";

export async function executeCleanCommand(
  rawArgs: string[],
  configPath: string | undefined,
  selectedModes: string[],
  resolveExecutionModes: (
    configPath: string | undefined,
    selectedModes: string[],
  ) => (string | undefined)[],
): Promise<void> {
  const modeTargets =
    selectedModes.length > 0
      ? resolveExecutionModes(configPath, selectedModes)
      : resolveAllCleanModes(configPath);
  await clean(configPath, modeTargets, selectedModes.length == 0);
}

function resolveAllCleanModes(
  configPath: string | undefined,
): (string | undefined)[] {
  const resolvedConfigPath = configPath ?? "./as-test.config.json";
  const config = loadConfig(resolvedConfigPath, true);
  return [undefined, ...Object.keys(config.modes)];
}
