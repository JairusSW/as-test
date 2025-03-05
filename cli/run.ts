import chalk from "chalk";
import { exec } from "child_process";
import { glob } from "glob";

import { formatTime, getExec, loadConfig } from "./util.js";
import * as path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { diff } from "typer-diff";

const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");

export async function run() {
  const reports: any[] = [];
  const config = loadConfig(CONFIG_PATH);
  const inputFiles = await glob(config.input);

  console.log(
    chalk.dim("Running tests using " + config.runOptions.runtime.name + ""),
  );

  const command = config.runOptions.runtime.run.split(" ")[0];
  let execPath = getExec(command);

  if (!execPath) {
    console.log(
      `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${command} in PATH variable!`,
    );
    process.exit(0);
  }

  if (inputFiles.length) {
    console.log(
      chalk.bold.blueBright(` _____  _____      _____  _____  _____  _____ `),
    );
    console.log(
      chalk.bold.blueBright(`|  _  ||   __| ___|_   _||   __||   __||_   _|`),
    );
    console.log(
      chalk.bold.blueBright(`|     ||__   ||___| | |  |   __||__   |  | |  `),
    );
    console.log(
      chalk.bold.blueBright(`|__|__||_____|      |_|  |_____||_____|  |_|  `),
    );
    console.log(
      chalk.dim("\n------------------- v0.3.5 -------------------\n"),
    );
  }

  for (const plugin of Object.keys(config.plugins)) {
    if (!config.plugins[plugin]) continue;
    console.log(
      chalk.bgBlueBright(" PLUGIN ") +
        " " +
        chalk.dim(
          "Using " + plugin.slice(0, 1).toUpperCase() + plugin.slice(1),
        ) +
        "\n",
    );
  }

  for (let i = 0; i < inputFiles.length; i++) {
    const file = inputFiles[i];
    const outFile = path.join(
      config.outDir,
      file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm"),
    );

    let cmd = config.runOptions.runtime.run.replace(command, execPath);
    if (config.buildOptions.target == "bindings") {
      cmd = config.runOptions.runtime.run.replace(command, execPath);

      if (cmd.includes("<name>")) {
        cmd = cmd.replace(
          "<name>",
          file
            .slice(file.lastIndexOf("/") + 1)
            .replace(".ts", "")
            .replace(".spec", ""),
        );
      } else {
        cmd = cmd.replace(
          "<file>",
          outFile
            .replace("build", "tests")
            .replace(".spec", "")
            .replace(".wasm", ".run.js"),
        );
      }
    } else {
      cmd = cmd.replace("<file>", outFile);
    }

    const report = JSON.parse(
      await (() => {
        return new Promise<string>((res, _) => {
          let stdout = "";
          const io = exec(cmd);
          io.stdout.pipe(process.stdout);
          io.stderr.pipe(process.stderr);
          io.stdout.on("data", (data: string) => {
            stdout += readData(data);
          });
          io.stdout.on("close", () => {
            res(stdout);
          });
        });
      })(),
    );
    reports.push(report);
  }

  if (config.logs && config.logs != "none") {
    if (!existsSync(path.join(process.cwd(), config.logs))) {
      mkdirSync(path.join(process.cwd(), config.logs));
    }
    writeFileSync(
      path.join(process.cwd(), config.logs, "test.log.json"),
      JSON.stringify(reports, null, 2),
    );
  }
  const reporter = new Reporter(reports);

  if (reporter.failed.length) {
    console.log(chalk.dim("----------------- [FAILED] -------------------\n"));
    for (const failed of reporter.failed) {
      console.log(
        `${chalk.bgRed(" FAIL ")} ${chalk.dim(failed.description)}\n`,
      );
      for (const test of failed.tests) {
        const diffResult = diff(
          JSON.stringify(test.left),
          JSON.stringify(test.right),
        );
        let expected = "";
        let received = chalk.dim(JSON.stringify(test._left));
        for (const res of diffResult.diff) {
          switch (res.type) {
            case "correct": {
              expected += chalk.dim(res.value);
              continue;
            }
            case "extra": {
              expected += chalk.red.strikethrough(res.value);
              continue;
            }
            case "missing": {
              expected += chalk.bgBlack(res.value);
              continue;
            }
            case "wrong": {
              expected += chalk.bgRed(res.value);
              continue;
            }
            case "untouched": {
              //received += chalk.bgBlackBright(res.value);
              continue;
            }
            case "spacer": {
              //received += chalk.bgBlackBright(res.value);
              continue;
            }
          }
        }
        if (test.verdict == "fail") {
          console.log(`${chalk.dim("(expected) ->")} ${expected}`);
          console.log(`${chalk.dim("(received) ->")} ${received}\n`);
        }
      }
    }
  }

  console.log(chalk.dim("----------------- [RESULTS] ------------------\n"));

  process.stdout.write(chalk.bold("Files:  "));
  if (reporter.failedFiles) {
    process.stdout.write(chalk.bold.red(reporter.failedFiles + " failed"));
  } else {
    process.stdout.write(chalk.bold.greenBright("0 failed"));
  }
  process.stdout.write(
    ", " + (reporter.failedFiles + reporter.passedFiles) + " total\n",
  );

  process.stdout.write(chalk.bold("Suites: "));
  if (reporter.failedSuites) {
    process.stdout.write(chalk.bold.red(reporter.failedSuites + " failed"));
  } else {
    process.stdout.write(chalk.bold.greenBright("0 failed"));
  }
  process.stdout.write(
    ", " + (reporter.failedSuites + reporter.passedSuites) + " total\n",
  );

  process.stdout.write(chalk.bold("Tests:  "));
  if (reporter.failedTests) {
    process.stdout.write(chalk.bold.red(reporter.failedTests + " failed"));
  } else {
    process.stdout.write(chalk.bold.greenBright("0 failed"));
  }
  process.stdout.write(
    ", " + (reporter.failedTests + reporter.passedTests) + " total\n",
  );

  process.stdout.write(
    chalk.bold("Time:   ") + formatTime(reporter.time) + "\n",
  );

  if (reporter.failedFiles) process.exit(1);
  process.exit(0);
}

class Reporter {
  public passedFiles = 0;
  public failedFiles = 0;

  public passedSuites = 0;
  public failedSuites = 0;

  public passedTests = 0;
  public failedTests = 0;

  public failed: any[] = [];

  public time = 0.0;
  constructor(reports: any[]) {
    this.readReports(reports);
  }
  readReports(reports: any[]) {
    for (const file of reports) {
      this.readFile(file);
    }
  }
  readFile(file: any) {
    let failed = false;
    for (const suite of file) {
      if (suite.verdict == "fail") {
        failed = true;
        this.failedSuites++;
      } else {
        this.passedSuites++;
      }
      this.time += suite.time.end - suite.time.start;
      for (const subSuite of suite.suites) {
        this.readSuite(subSuite);
      }
      for (const test of suite.tests) {
        if (test.verdict == "fail") this.failed.push(suite);
        this.readTest(test);
      }
    }
    if (failed) this.failedFiles++;
    else this.passedFiles++;
  }
  readSuite(suite: any) {
    if (suite.verdict == "fail") {
      this.failedSuites++;
    } else {
      this.passedSuites++;
    }
    this.time += suite.time.end - suite.time.start;
    for (const subSuite of suite.suites) {
      this.readSuite(subSuite);
    }
    for (const test of suite.tests) {
      if (test.verdict == "fail") this.failed.push(suite);
      this.readTest(test);
    }
  }
  readTest(test: any) {
    if (test.verdict == "fail") {
      this.failedTests++;
    } else {
      this.passedTests++;
    }
  }
}

function readData(data: string): string {
  let out = "";
  const start = data.indexOf("READ_LINE");
  if (start >= 0) {
    const slice = data.slice(start + 9);
    const end = slice.indexOf("END_LINE");
    out += slice.slice(0, end);
    out += readData(slice);
  }
  return out;
}
