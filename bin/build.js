"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.build = build;
const fs_1 = require("fs");
const types_1 = require("./types");
const glob_1 = require("glob");
const chalk_1 = require("chalk");
const child_process_1 = require("child_process");
const util_1 = require("./util");
async function build(args, flags) {
    const config = Object.assign(new types_1.Config(), JSON.parse((0, fs_1.readFileSync)("./as-test.config.json").toString()));
    const pkg = JSON.parse((0, fs_1.readFileSync)("./package.json").toString());
    let buildCommands = [];
    if (config.buildOptions.wasi) {
        if (!(0, fs_1.existsSync)("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(chalk_1.default.bgRed(" ERROR ") + chalk_1.default.dim(":") + " " + "could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!");
            process.exit(1);
        }
        if ((pkg.dependencies && !Object.keys(pkg.dependencies).includes("@assemblyscript/wasi-shim"))
            || (pkg.devDependencies && !Object.keys(pkg.devDependencies).includes("@assemblyscript/wasi-shim"))
            || (pkg.peerDependencies && !Object.keys(pkg.peerDependencies).includes("@assemblyscript/wasi-shim"))) {
            if ((0, fs_1.existsSync)("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
                console.log(chalk_1.default.bold.bgMagentaBright(" WARN ") + chalk_1.default.dim(": @assemblyscript/wasi-shim") + " is not included in project dependencies!");
            }
        }
    }
    const inputFiles = await (0, glob_1.glob)(config.input);
    for (const file of inputFiles) {
        console.log(chalk_1.default.dim("Including " + file));
        let command = `npx asc ${file}${args.length ? " " + args.join(" ") : ""}`;
        if (config.buildOptions.wasi) {
            command += " --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json";
        }
        const outFile = config.outDir + "/" + file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm");
        if (config.outDir) {
            command += " -o " + outFile;
        }
        buildCommands.push(command);
    }
    const build = (command) => {
        return new Promise((resolve, _) => {
            (0, child_process_1.exec)(command, (err, stdout, stderr) => {
                if (config.buildOptions.verbose) {
                    process.stdout.write(stdout);
                }
                if (err) {
                    process.stderr.write(stderr + "\n");
                    process.exit(1);
                }
                resolve();
            });
        });
    };
    if (config.buildOptions.parallel) {
        console.log(chalk_1.default.dim("Building sources in parallel..."));
        const start = performance.now();
        let builders = [];
        for (const command of buildCommands) {
            builders.push(build(command));
        }
        await Promise.all(builders);
        console.log(chalk_1.default.dim("Compiled in " + (0, util_1.formatTime)(performance.now() - start)) + "\n");
    }
}
