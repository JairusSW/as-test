#!/usr/bin/env node
import chalk from "chalk";
import { build } from "./build.js";
import { run } from "./run.js";
import { init } from "./init.js";
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = ["run", "build", "test", "init"];
const version = "0.3.0";
for (const arg of _args) {
    if (arg.startsWith("-"))
        flags.push(arg);
    else
        args.push(arg);
}
if (!args.length) {
    if (flags.includes("--version") || flags.includes("-v")) {
        console.log("as-test v" + version.toString());
    }
    else {
        info();
    }
}
else if (COMMANDS.includes(args[0])) {
    const command = args.shift();
    if (command === "build") {
        build();
    }
    else if (command === "run") {
        run();
    }
    else if (command === "test") {
        build().then(() => {
            run();
        });
    }
    else if (command === "init") {
        init(args);
    }
}
else {
    console.log(chalk.bgRed(" ERROR ") +
        chalk.dim(":") +
        " " +
        chalk.bold("Unknown command: ") +
        args[0]);
}
function info() {
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
        "      " +
        chalk.dim("<my-test.spec.ts>") +
        "       " +
        "Build and run unit tests with selected runtime" +
        "\n");
    console.log("  " +
        chalk.bold.magentaBright("init") +
        "       " +
        chalk.strikethrough.dim("") +
        "                       " +
        "Initialize an empty testing template");
    console.log("  " +
        chalk.strikethrough.bold.magentaBright("config") +
        "     " +
        chalk.strikethrough.dim("as-test.config.json") +
        "    " +
        "Specify the configuration file");
    console.log("  " +
        chalk.strikethrough.bold.magentaBright("reporter") +
        "   " +
        chalk.strikethrough.dim("<tap>") +
        "                  " +
        "Specify the test reporter to use");
    console.log("  " +
        chalk.strikethrough.bold.magentaBright("use") +
        "        " +
        chalk.strikethrough.dim("wasmtime") +
        "               " +
        "Specify the runtime to use" +
        "\n");
    console.log(chalk.bold("Flags:"));
    console.log("  " +
        chalk.strikethrough.dim("run") +
        "        " +
        chalk.strikethrough.bold.blue("--coverage") +
        "             " +
        "Use code coverage");
    console.log("  " +
        chalk.strikethrough.dim("run") +
        "        " +
        chalk.strikethrough.bold.blue("--snapshot") +
        "             " +
        "Take a snapshot of the tests");
    console.log("  " +
        chalk.strikethrough.dim("use") +
        "        " +
        chalk.strikethrough.bold.blue("--list") +
        "                 " +
        "List supported runtimes");
    console.log("  " +
        chalk.strikethrough.dim("reporter") +
        "   " +
        chalk.strikethrough.bold.blue("--list") +
        "                 " +
        "List supported reporters");
    console.log("  " +
        chalk.strikethrough.dim("<command>") +
        "  " +
        chalk.strikethrough.bold.blue("--help") +
        "                 " +
        "Print info about command" +
        "\n");
    console.log(chalk.dim("If your using this, consider dropping a star, it would help a lot!") + "\n");
    console.log("View the repo:                   " +
        chalk.magenta("https://github.com/JairusSW/as-test"));
    console.log("View the docs:                   " +
        chalk.strikethrough.blue("https://docs.jairus.dev/as-test"));
}
