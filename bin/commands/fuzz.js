export async function executeFuzzCommand(
  rawArgs,
  configPath,
  selectedModes,
  deps,
) {
  const commandArgs = deps.resolveCommandArgs(rawArgs, "fuzz");
  const listFlags = deps.resolveListFlags(rawArgs, "fuzz");
  const modeTargets = deps.resolveExecutionModes(configPath, selectedModes);
  if (listFlags.list || listFlags.listModes) {
    await deps.listExecutionPlan(
      "fuzz",
      configPath,
      commandArgs,
      modeTargets,
      listFlags,
    );
    return;
  }
  await deps.runFuzzModes(configPath, commandArgs, modeTargets, rawArgs);
}
