import chalk from "chalk";
import { version } from "../package.json";
const _args = process.argv.slice(2);
const options = [];
const args = [];
for (const arg of _args) {
    if (arg.startsWith("--"))
        options.push(arg);
    else
        args.push(arg);
}
console.log(chalk.bold.blueBright("as-test") + " is a testing framework for AssemblyScript. " + chalk.dim("(v" + version + ")") + "\n");
console.log(chalk.bold("Usage: as-test <command>") + " " + chalk.bold.blueBright("[...flags]") + " " + chalk.bold("[...args]") + " " + chalk.dim("(alias: ast)") + "\n");
console.log(chalk.bold("Commands:"));
console.log("  " + chalk.bold.blueBright("run") + "       " + chalk.dim("my-test.spec.ts") + "        " + "Build and/or run unit tests");
console.log("  " + chalk.bold.blueBright("suite") + "     " + chalk.dim("<suite-name>") + "           " + "Build and/or run unit tests");
console.log("  " + chalk.bold.blueBright("build") + "     " + chalk.dim("my-test.spec.ts") + "        " + "Build unit tests and compile" + "\n");
console.log("  " + chalk.bold.magentaBright("init") + "      " + chalk.dim("") + "                       " + "Initialize an empty testing template");
console.log("  " + chalk.bold.magentaBright("config") + "    " + chalk.dim("my-config.json") + "         " + "Specify the configuration file");
