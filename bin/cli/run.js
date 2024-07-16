import { existsSync, readFileSync, readdirSync } from "fs";
import { Config } from "./types.js";
import chalk from "chalk";
import { execSync } from "child_process";
import { glob } from "glob";
import { report } from "../build/log.reporter.js";
const installScripts = new Map([
  ["wasmtime", "curl https://wasmtime.dev/install.sh -sSf | bash"],
  ["wasmer", "curl https://get.wasmer.io -sSfL | sh"],
]);
export async function run() {
  const reports = [];
  const config = Object.assign(
    new Config(),
    JSON.parse(readFileSync("./as-test.config.json").toString()),
  );
  const inputFiles = await glob(config.input);
  console.log(
    chalk.dim("Running tests using " + config.runOptions.runtime.name + ""),
  );
  let execPath = "";
  const PATH = process.env["PATH"]?.split(":");
  for (const bin of PATH) {
    if (bin.startsWith("/mnt/")) continue; // WSL
    if (!existsSync(bin)) continue;
    for (const file of readdirSync(bin)) {
      if (
        file == config.runOptions.runtime.run.split(" ")[0] ||
        file == config.runOptions.runtime.run.split(" ")[0] + ".exe"
      ) {
        execPath = bin + "/" + file;
      }
    }
  }
  if (!execPath) {
    console.log(
      chalk.bgRed(" ERROR ") +
        chalk.dim(":") +
        " could not locate " +
        config.runOptions.runtime.run.split(" ")[0] +
        " in your PATH variable. Either set it, or install it" +
        (config.runOptions.runtime.run.split(" ")[0]
          ? "using " +
            chalk.dim(
              installScripts.get(config.runOptions.runtime.run.split(" ")[0]),
            )
          : "."),
    );
  }
  for (const file of inputFiles) {
    const outFile =
      config.outDir +
      "/" +
      file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm");
    let cmd = config.runOptions.runtime.run
      .replace(config.runOptions.runtime.name, execPath)
      .replace("<file>", outFile);
    if (
      config.runOptions.runtime.run.startsWith("bun") ||
      config.runOptions.runtime.run.startsWith("node") ||
      config.runOptions.runtime.run.startsWith("deno")
    ) {
      cmd = config.runOptions.runtime.run
        .replace(config.runOptions.runtime.name, execPath)
        .replace("<file>", outFile.replace(".wasm", ".js"));
    }
    const stdout = execSync(cmd);
    const report = stdout
      .toString()
      .slice(
        stdout.indexOf("--REPORT-START--") + 16,
        stdout.indexOf("--REPORT-END--"),
      );
    console.dir(JSON.parse(report), { depth: 256 });
    reports.push(JSON.parse(report));
  }
  report(JSON.stringify(reports));
}
