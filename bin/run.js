import chalk from "chalk";
import { exec } from "child_process";
import { glob } from "glob";
import { formatTime, getExec, loadConfig } from "./util.js";
import * as path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
const CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
const ansi = new RegExp("[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))", "g");
export async function run() {
    const reports = [];
    const config = loadConfig(CONFIG_PATH);
    const inputFiles = await glob(config.input);
    console.log(chalk.dim("Running tests using " + config.runOptions.runtime.name + ""));
    const command = config.runOptions.runtime.run.split(" ")[0];
    let execPath = getExec(command);
    if (!execPath) {
        console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${command} in PATH variable!`);
        process.exit(0);
    }
    if (inputFiles.length) {
        console.log(chalk.bold.blueBright(` _____  _____      _____  _____  _____  _____ `));
        console.log(chalk.bold.blueBright(`|  _  ||   __| ___|_   _||   __||   __||_   _|`));
        console.log(chalk.bold.blueBright(`|     ||__   ||___| | |  |   __||__   |  | |  `));
        console.log(chalk.bold.blueBright(`|__|__||_____|      |_|  |_____||_____|  |_|  `));
        console.log(chalk.dim("\n------------------- v0.3.0 -------------------\n"));
    }
    for (const plugin of Object.keys(config.plugins)) {
        if (!config.plugins[plugin])
            continue;
        console.log(chalk.bgBlueBright(" PLUGIN ") + " " + chalk.dim("Using " + plugin.slice(0, 1).toUpperCase() + plugin.slice(1)) + "\n");
    }
    for (let i = 0; i < inputFiles.length; i++) {
        const file = inputFiles[i];
        const outFile = path.join(config.outDir, file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm"));
        let cmd = config.runOptions.runtime.run
            .replace(command, execPath)
            .replace("<file>", outFile);
        if (config.buildOptions.target == "bindings") {
            cmd = config.runOptions.runtime.run
                .replace(command, execPath)
                .replace("<file>", outFile.replace(".wasm", ".js"));
        }
        const report = JSON.parse(await (() => {
            return new Promise((res, _) => {
                let stdout = "";
                const io = exec(cmd);
                io.stdout.pipe(process.stdout);
                io.stderr.pipe(process.stderr);
                io.stdout.on("data", (data) => {
                    stdout += data;
                });
                io.stdout.on("close", () => {
                    res(stdout.slice(stdout.indexOf("START_READ") + 10, stdout.indexOf("END_READ")));
                });
            });
        })());
        reports.push(report);
    }
    if (config.logs && config.logs != "none") {
        if (!existsSync(path.join(process.cwd(), config.logs))) {
            mkdirSync(path.join(process.cwd(), config.logs));
        }
        writeFileSync(path.join(process.cwd(), config.logs, "test.log.json"), JSON.stringify(reports, null, 2));
    }
    const reporter = new Reporter(reports);
    if (reporter.failed.length) {
        console.log(chalk.dim("----------------- [FAILED] -------------------\n"));
        for (const failed of reporter.failed) {
            console.log(`${chalk.bgRed(" FAIL ")} ${chalk.dim(failed.description)}\n`);
            for (const test of failed.tests) {
                if (test.verdict == "fail") {
                    console.log(`${chalk.dim("(expected) ->")} ${chalk.bold(test._left.toString())}`);
                    console.log(`${chalk.dim("(received) ->")} ${chalk.bold(test._right.toString())}\n`);
                }
            }
        }
    }
    console.log("----------------- [RESULTS] ------------------\n");
    process.stdout.write(chalk.bold("Files:  "));
    if (reporter.failedFiles) {
        process.stdout.write(chalk.bold.red(reporter.failedFiles + " failed"));
    }
    else {
        process.stdout.write(chalk.bold.greenBright("0 failed"));
    }
    process.stdout.write(", " + (reporter.failedFiles + reporter.passedFiles) + " total\n");
    process.stdout.write(chalk.bold("Suites: "));
    if (reporter.failedSuites) {
        process.stdout.write(chalk.bold.red(reporter.failedSuites + " failed"));
    }
    else {
        process.stdout.write(chalk.bold.greenBright("0 failed"));
    }
    process.stdout.write(", " + (reporter.failedSuites + reporter.passedSuites) + " total\n");
    process.stdout.write(chalk.bold("Tests:  "));
    if (reporter.failedTests) {
        process.stdout.write(chalk.bold.red(reporter.failedTests + " failed"));
    }
    else {
        process.stdout.write(chalk.bold.greenBright("0 failed"));
    }
    process.stdout.write(", " + (reporter.failedTests + reporter.passedTests) + " total\n");
    process.stdout.write(chalk.bold("Time:   ") + formatTime(reporter.time) + "\n");
    if (reporter.failedFiles)
        process.exit(1);
    process.exit(0);
}
class Reporter {
    constructor(reports) {
        this.passedFiles = 0;
        this.failedFiles = 0;
        this.passedSuites = 0;
        this.failedSuites = 0;
        this.passedTests = 0;
        this.failedTests = 0;
        this.failed = [];
        this.time = 0.0;
        this.readReports(reports);
    }
    readReports(reports) {
        for (const file of reports) {
            this.readFile(file);
        }
    }
    readFile(file) {
        let failed = false;
        for (const suite of file) {
            if (suite.verdict == "fail") {
                failed = true;
                this.failedSuites++;
            }
            else {
                this.passedSuites++;
            }
            this.time += suite.time.end - suite.time.start;
            for (const subSuite of suite.suites) {
                this.readSuite(subSuite);
            }
            for (const test of suite.tests) {
                if (test.verdict == "fail")
                    this.failed.push(suite);
                this.readTest(test);
            }
        }
        if (failed)
            this.failedFiles++;
        else
            this.passedFiles++;
    }
    readSuite(suite) {
        if (suite.verdict == "fail") {
            this.failedSuites++;
        }
        else {
            this.passedSuites++;
        }
        this.time += suite.time.end - suite.time.start;
        for (const subSuite of suite.suites) {
            this.readSuite(subSuite);
        }
        for (const test of suite.tests) {
            if (test.verdict == "fail")
                this.failed.push(suite);
            this.readTest(test);
        }
    }
    readTest(test) {
        if (test.verdict == "fail") {
            this.failedTests++;
        }
        else {
            this.passedTests++;
        }
    }
}
