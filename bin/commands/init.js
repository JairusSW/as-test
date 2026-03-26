import { init } from "./init-core.js";
export { init } from "./init-core.js";
export async function executeInitCommand(rawArgs, deps) {
    const commandTokens = deps.resolveCommandTokens(rawArgs, "init");
    await init(commandTokens);
}
