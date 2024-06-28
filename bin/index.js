#!/usr/bin/env node
import chalk from "chalk";
import { build } from "./build.js";
import { run } from "./run.js";
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "init"];
const version = "0.1.5";
for (const arg of _args) {
    if (arg.startsWith("-"))
        flags.push(arg);
    else
        args.push(arg);
}
if (!args.length) {
    if (flags.includes("--version") || flags.includes("-v")) {
        console.log("as-test" + " " + version.toString());
    }
    else {
        console.log(chalk.bold.blueBright("as-test") +
            " is a testing framework for AssemblyScript. " +
            chalk.dim("(v" + version + ")") +
            "\n");
        console.log(chalk.bold("Usage: as-test") +
            " " +
            chalk.dim("<command>") +
            " " +
            chalk.bold.blueBright("[...flags]") +
            " " +
            chalk.bold("[...args]") +
            " " +
            chalk.dim("(alias: ast)") +
            "\n");
        console.log(chalk.bold("Commands:"));
        console.log("  " +
            chalk.bold.blueBright("run") +
            "       " +
            chalk.dim("<my-test.spec.ts>") +
            "       " +
            "Run unit tests with selected runtime");
        console.log("  " +
            chalk.bold.blueBright("build") +
            "     " +
            chalk.dim("<my-test.spec.ts>") +
            "       " +
            "Build unit tests and compile");
        console.log("  " +
            chalk.bold.blueBright("test") +
            "     " +
            chalk.dim("<my-test.spec.ts>") +
            "       " +
            "Build and run unit tests with selected runtime" +
            "\n");
        console.log("  " +
            chalk.bold.magentaBright("init") +
            "       " +
            chalk.dim("") +
            "                       " +
            "Initialize an empty testing template");
        console.log("  " +
            chalk.bold.magentaBright("config") +
            "     " +
            chalk.dim("as-test.config.json") +
            "    " +
            "Specify the configuration file");
        console.log("  " +
            chalk.bold.magentaBright("reporter") +
            "   " +
            chalk.dim("<tap>") +
            "                  " +
            "Specify the test reporter to use");
        console.log("  " +
            chalk.bold.magentaBright("use") +
            "        " +
            chalk.dim("wasmtime") +
            "               " +
            "Specify the runtime to use" +
            "\n");
        console.log(chalk.bold("Flags:"));
        console.log("  " +
            chalk.dim("run") +
            "        " +
            chalk.bold.blue("--coverage") +
            "             " +
            "Use code coverage");
        console.log("  " +
            chalk.dim("run") +
            "        " +
            chalk.bold.blue("--snapshot") +
            "             " +
            "Take a snapshot of the tests");
        console.log("  " +
            chalk.dim("use") +
            "        " +
            chalk.bold.blue("--list") +
            "                 " +
            "List supported runtimes");
        console.log("  " +
            chalk.dim("reporter") +
            "   " +
            chalk.bold.blue("--list") +
            "                 " +
            "List supported reporters");
        console.log("  " +
            chalk.dim("<command>") +
            "  " +
            chalk.bold.blue("--help") +
            "                 " +
            "Print info about command" +
            "\n");
        console.log(chalk.dim("If your using this, consider dropping a star, it would help a lot!") + "\n");
        console.log("View the repo:                   " +
            chalk.magenta("https://github.com/JairusSW/as-test"));
        console.log("View the docs:                   " +
            chalk.blue("https://docs.jairus.dev/as-test"));
    }
}
else if (COMMANDS.includes(args[0])) {
    const command = args.shift();
    if (command === "build") {
        build(args);
    }
    else if (command === "run") {
        run();
    }
    else if (command === "test") {
        build(args).then(() => {
            run();
        });
    }
}
else {
    console.log(chalk.bgRed(" ERROR ") +
        chalk.dim(":") +
        " " +
        chalk.bold("Unknown command: ") +
        args[0]);
}
