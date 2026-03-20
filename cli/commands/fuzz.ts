import { CliListFlags } from "./types.js";

export type FuzzFlags = {
  list?: boolean;
};

type FuzzCommandDeps = {
  resolveCommandArgs(rawArgs: string[], command: string): string[];
  resolveListFlags(rawArgs: string[], command: string): CliListFlags;
  resolveExecutionModes(
    configPath: string | undefined,
    selectedModes: string[],
  ): (string | undefined)[];
  listExecutionPlan(
    command: "build" | "run" | "test" | "fuzz",
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    listFlags: CliListFlags,
  ): Promise<void>;
  runFuzzModes(
    configPath: string | undefined,
    selectors: string[],
    modes: (string | undefined)[],
    rawArgs: string[],
  ): Promise<void>;
};

export async function executeFuzzCommand(
  rawArgs: string[],
  configPath: string | undefined,
  selectedModes: string[],
  deps: FuzzCommandDeps,
): Promise<void> {
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
