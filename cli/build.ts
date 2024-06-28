import { existsSync, readFileSync, readdirSync } from "fs";
import { Config } from "./types.js";
import { glob } from "glob";
import chalk from "chalk";
import { exec } from "child_process";
import { formatTime } from "./util.js";

export async function build(args: string[], flags: string[]) {
    const config = Object.assign(new Config(), JSON.parse(readFileSync("./as-test.config.json").toString())) as Config;
    const pkg = JSON.parse(readFileSync("./package.json").toString()) as { dependencies: string[] | null, devDependencies: string[] | null, peerDependencies: string[] | null };
    let buildCommands: string[] = [];

    if (config.buildOptions.wasi) {
        if (!existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
            console.log(chalk.bgRed(" ERROR ") + chalk.dim(":") + " " + "could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!");
            process.exit(1);
        }
        if (
            (pkg.dependencies && !Object.keys(pkg.dependencies).includes("@assemblyscript/wasi-shim"))
            || (pkg.devDependencies && !Object.keys(pkg.devDependencies).includes("@assemblyscript/wasi-shim"))
            || (pkg.peerDependencies && !Object.keys(pkg.peerDependencies).includes("@assemblyscript/wasi-shim"))
        ) {
            if (existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
                console.log(chalk.bold.bgMagentaBright(" WARN ") + chalk.dim(": @assemblyscript/wasi-shim") + " is not included in project dependencies!");
            }
        }
    }

    const inputFiles = await glob(config.input);
    for (const file of inputFiles) {
        console.log(chalk.dim("Including " + file));
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

    const build = (command: string) => {
        return new Promise<void>((resolve, _) => {
            exec(command, (err, stdout, stderr) => {
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
    }

    if (config.buildOptions.parallel) {
        console.log(chalk.dim("Building sources in parallel..."));
        const start = performance.now();
        let builders: Promise<void>[] = [];
        for (const command of buildCommands) {
            builders.push(build(command));
        }

        await Promise.all(builders);
        console.log(chalk.dim("Compiled in " + formatTime(performance.now() - start)) + "\n");
    }
}