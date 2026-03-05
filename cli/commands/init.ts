import { init } from "./init-core.js";

export { init } from "./init-core.js";

type InitCommandDeps = {
  resolveCommandTokens(rawArgs: string[], command: string): string[];
};

export async function executeInitCommand(
  rawArgs: string[],
  deps: InitCommandDeps,
): Promise<void> {
  const commandTokens = deps.resolveCommandTokens(rawArgs, "init");
  await init(commandTokens);
}
