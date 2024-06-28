"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const fs_1 = require("fs");
const types_1 = require("./types");
const chalk_1 = require("chalk");
const child_process_1 = require("child_process");
const glob_1 = require("glob");
const installScripts = new Map([
    ["wasmtime", "curl https://wasmtime.dev/install.sh -sSf | bash"]
]);
async function run() {
    const config = Object.assign(new types_1.Config(), JSON.parse((0, fs_1.readFileSync)("./as-test.config.json").toString()));
    const inputFiles = await (0, glob_1.glob)(config.input);
    console.log(chalk_1.default.dim("Running tests using " + config.runOptions.runtime.name + ""));
    let execPath = "";
    const PATH = process.env["PATH"]?.split(":");
    for (const bin of PATH) {
        if (bin.startsWith("/mnt/"))
            continue;
        for (const file of (0, fs_1.readdirSync)(bin)) {
            if (file == config.runOptions.runtime.name || file == config.runOptions.runtime.name + ".exe") {
                execPath = bin + "/" + file;
            }
        }
    }
    if (!execPath) {
        console.log(chalk_1.default.bgRed(" ERROR ") + chalk_1.default.dim(":") + " could not locate " + config.runOptions.runtime.name + " in your PATH variable. Either set it, or install it" + (config.runOptions.runtime.name ? "using " + chalk_1.default.dim(installScripts.get(config.runOptions.runtime.name)) : "."));
    }
    for (const file of inputFiles) {
        const outFile = config.outDir + "/" + file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm");
        (0, child_process_1.exec)(config.runOptions.runtime.run.replace(config.runOptions.runtime.name, execPath).replace("<file>", outFile), (err, stdout, stderr) => {
            process.stdout.write(stdout);
            process.stderr.write(stderr);
            if (err) {
                process.exit(err.code);
            }
        });
    }
}
