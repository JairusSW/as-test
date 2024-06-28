"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = require("chalk");
const package_json_1 = require("../package.json");
const build_1 = require("./build");
const run_1 = require("./run");
const _args = process.argv.slice(2);
const flags = [];
const args = [];
const COMMANDS = [
    "run",
    "build",
    "test"
];
for (const arg of _args) {
    if (arg.startsWith("-"))
        flags.push(arg);
    else
        args.push(arg);
}
if (!args.length) {
    if (flags.includes("--version") || flags.includes("-v")) {
        console.log("as-test" + " " + package_json_1.version.toString());
    }
    else {
        console.log(chalk_1.default.bold.blueBright("as-test") + " is a testing framework for AssemblyScript. " + chalk_1.default.dim("(v" + package_json_1.version + ")") + "\n");
        console.log(chalk_1.default.bold("Usage: as-test") + " " + chalk_1.default.dim("<command>") + " " + chalk_1.default.bold.blueBright("[...flags]") + " " + chalk_1.default.bold("[...args]") + " " + chalk_1.default.dim("(alias: ast)") + "\n");
        console.log(chalk_1.default.bold("Commands:"));
        console.log("  " + chalk_1.default.bold.blueBright("run") + "       " + chalk_1.default.dim("<my-test.spec.ts>") + "       " + "Run unit tests with selected runtime");
        console.log("  " + chalk_1.default.bold.blueBright("build") + "     " + chalk_1.default.dim("<my-test.spec.ts>") + "       " + "Build unit tests and compile");
        console.log("  " + chalk_1.default.bold.blueBright("test") + "     " + chalk_1.default.dim("<my-test.spec.ts>") + "       " + "Build and run unit tests with selected runtime" + "\n");
        console.log("  " + chalk_1.default.bold.magentaBright("init") + "       " + chalk_1.default.dim("") + "                       " + "Initialize an empty testing template");
        console.log("  " + chalk_1.default.bold.magentaBright("config") + "     " + chalk_1.default.dim("as-test.config.json") + "    " + "Specify the configuration file");
        console.log("  " + chalk_1.default.bold.magentaBright("reporter") + "   " + chalk_1.default.dim("<tap>") + "                  " + "Specify the test reporter to use");
        console.log("  " + chalk_1.default.bold.magentaBright("use") + "        " + chalk_1.default.dim("wasmtime") + "               " + "Specify the runtime to use" + "\n");
        console.log(chalk_1.default.bold("Flags:"));
        console.log("  " + chalk_1.default.dim("run") + "        " + chalk_1.default.bold.blue("--coverage") + "             " + "Use code coverage");
        console.log("  " + chalk_1.default.dim("run") + "        " + chalk_1.default.bold.blue("--snapshot") + "             " + "Take a snapshot of the tests");
        console.log("  " + chalk_1.default.dim("use") + "        " + chalk_1.default.bold.blue("--list") + "                 " + "List supported runtimes");
        console.log("  " + chalk_1.default.dim("reporter") + "   " + chalk_1.default.bold.blue("--list") + "                 " + "List supported reporters");
        console.log("  " + chalk_1.default.dim("<command>") + "  " + chalk_1.default.bold.blue("--help") + "                 " + "Print info about command" + "\n");
        console.log(chalk_1.default.dim("If your using this, consider dropping a star, it would help a lot!") + "\n");
        console.log("View the repo:                   " + chalk_1.default.magenta("https://github.com/JairusSW/as-test"));
        console.log("View the docs:                   " + chalk_1.default.blue("https://docs.jairus.dev/as-test"));
    }
}
else if (COMMANDS.includes(args[0])) {
    const command = args.shift();
    if (command === "build") {
        (0, build_1.build)(args, flags);
    }
    else if (command === "run") {
        (0, run_1.run)();
    }
    else if (command === "test") {
        (0, build_1.build)(args, flags).then(() => {
            (0, run_1.run)();
        });
    }
}
else {
    console.log(chalk_1.default.bgRed(" ERROR ") + chalk_1.default.dim(":") + " " + chalk_1.default.bold("Unknown command: ") + args[0]);
}
