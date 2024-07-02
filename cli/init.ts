import chalk from "chalk";
import { existsSync, writeFileSync } from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { Config } from "./types.js";

export function init(args: string[]): void {
  console.log(
    chalk.bold("This command will make sure that the following files exist") +
      "\n",
  );
  console.log(
    "  " +
      chalk.bold.blueBright("./as-test.config.json") +
      chalk.dim(" - The core config file for as-test") +
      "\n",
  );

  console.log(
    "This command will attempt to update files to match the correct configuration.\n",
  );
  console.log("Do you want to proceed? [Y/n] ");
  createInterface({
    input: process.stdin,
    output: process.stdout,
  }).question("", (answer) => {
    if (answer.toLowerCase() === "y") {
      initialize();
    } else {
      console.log("Exiting...");
      process.exit(0);
    }
  });
}

function initialize(): void {
  const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
  if (existsSync(CONFIG_PATH)) {
    console.log("Found ./as-test.config.json. Updating...");
    process.exit(0);
  } else {
    console.log("Wrote ./as-test.config.json");
    writeFileSync(CONFIG_PATH, JSON.stringify(new Config(), null, 2));
    console.log(JSON.stringify(new Config(), null, 2));
    process.exit(0);
  }
}
