import chalk from "chalk";
import { createInterface } from "readline";
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
  const force = rawArgs.includes("-f") || rawArgs.includes("--force");
  const modeTargets =
    selectedModes.length > 0
      ? resolveExecutionModes(configPath, selectedModes)
      : resolveAllCleanModes(configPath);
  if (!force && selectedModes.length == 0) {
    await confirmFullClean(configPath);
  }
  await clean(configPath, modeTargets, selectedModes.length == 0);
}

function resolveAllCleanModes(
  configPath: string | undefined,
): (string | undefined)[] {
  const resolvedConfigPath = configPath ?? "./as-test.config.json";
  const config = loadConfig(resolvedConfigPath, true);
  return [undefined, ...Object.keys(config.modes)];
}

async function confirmFullClean(configPath: string | undefined): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'clean without --mode requires confirmation. Re-run with "-f" or "--force" to skip the prompt.',
    );
  }
  const target = configPath ? ` in ${configPath}` : "";
  process.stdout.write(
    chalk.bold.blue("◇  Confirm Clean") +
      "\n" +
      `│  This will remove configured build outputs, crash reports, and logs for every mode${target}.\n` +
      "│\n",
  );
  const answer = await promptLine("Continue? [Y/n] ");
  const normalized = answer.trim().toLowerCase();
  if (normalized == "" || normalized == "y" || normalized == "yes") return;
  if (normalized == "n" || normalized == "no") {
    process.stdout.write(chalk.dim("clean cancelled\n"));
    process.exit(0);
  }
  throw new Error(`invalid answer "${answer}". Expected yes or no.`);
}

function promptLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
