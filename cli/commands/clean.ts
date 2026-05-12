import { clean } from "./clean-core.js";

export { clean } from "./clean-core.js";

export async function executeCleanCommand(
  configPath: string | undefined,
  selectedModes: string[],
  resolveExecutionModes: (
    configPath: string | undefined,
    selectedModes: string[],
  ) => (string | undefined)[],
): Promise<void> {
  const modeTargets = resolveExecutionModes(configPath, selectedModes);
  await clean(configPath, modeTargets);
}
