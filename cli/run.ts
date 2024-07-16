import chalk from "chalk";
import { execSync } from "child_process";
import { glob } from "glob";

import { report } from "../build/log.reporter.js";
import { getExec, loadConfig } from "./util.js";
import * as path from "path";

const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
export async function run() {
  const reports: any[] = [];
  const config = loadConfig(CONFIG_PATH);
  const inputFiles = await glob(config.input);

  console.log(
    chalk.dim("Running tests using " + config.runOptions.runtime.name + ""),
  );

  const exec = config.runOptions.runtime.run.split(" ")[0];
  let execPath = getExec(exec);

  if (!execPath) {
    console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${exec} in PATH variable!`);
    process.exit(0);
  }

  for (const file of inputFiles) {
    const outFile = path.join(config.outDir, file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm"));

    let cmd = config.runOptions.runtime.run
      .replace(exec, execPath)
      .replace("<file>", outFile);
    if (config.buildOptions.target == "bindings") {
      cmd = config.runOptions.runtime.run
        .replace(exec, execPath)
        .replace("<file>", outFile.replace(".wasm", ".js"));
    }
    execSync(cmd, { stdio: "inherit"});/*
    process.stdout.write(stdout.toString().slice(0, stdout.indexOf("--REPORT-START--")));
    const report = stdout
      .toString()
      .slice(
        stdout.indexOf("--REPORT-START--") + 16,
        stdout.indexOf("--REPORT-END--"),
      );
    reports.push(JSON.parse(report));*/
  }

  //report(JSON.stringify(reports));

  for (const report of reports) {
    if (report.verdict == "fail") process.exit(1);
  }
  process.exit(0);
}
