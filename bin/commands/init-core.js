import chalk from "chalk";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { getCliVersion } from "../util.js";
import { buildWebRunnerSource } from "./web-runner-source.js";
const TARGETS = ["wasi", "bindings", "web"];
const EXAMPLE_MODES = ["minimal", "full", "none"];
export async function init(rawArgs) {
    const options = parseInitArgs(rawArgs);
    const rl = options.yes
        ? null
        : createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    try {
        printOnboardingHeader();
        const answers = options.yes
            ? {
                root: path.resolve(process.cwd(), options.dir),
                target: options.target ?? "wasi",
                example: options.example ?? "minimal",
                fuzzExample: options.fuzzExample ?? false,
                installDependenciesNow: options.install ?? false,
            }
            : await runInteractiveOnboarding(options, rl);
        if (!answers) {
            console.log(chalk.bold.red("◆  Cancelled"));
            return;
        }
        printPlan(answers.root, answers.target, answers.example, answers.fuzzExample, answers.installDependenciesNow);
        if (!options.yes) {
            const cont = await askYesNo("Continue with these changes?", rl, true);
            if (!cont) {
                console.log(chalk.bold.red("◆  Cancelled"));
                return;
            }
        }
        const summary = applyInit(answers.root, answers.target, answers.example, answers.fuzzExample, options.force);
        printSummary(summary);
        console.log(chalk.bold.green("◆  Finished!"));
        if (answers.installDependenciesNow) {
            installDependencies(answers.root);
            console.log("\nNow, run " + chalk.italic.bold("npm test") + "\n");
        }
        else {
            console.log("\nNow, run " + chalk.italic.bold("npm i && npm test") + "\n");
        }
    }
    finally {
        rl?.close();
    }
}
function parseInitArgs(rawArgs) {
    const options = {
        yes: false,
        force: false,
        dir: ".",
        dirExplicit: false,
    };
    const positional = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg == "--yes" || arg == "-y") {
            options.yes = true;
            continue;
        }
        if (arg == "--force") {
            options.force = true;
            continue;
        }
        if (arg == "--install") {
            options.install = true;
            continue;
        }
        if (arg == "--fuzz-example") {
            options.fuzzExample = true;
            continue;
        }
        if (arg == "--no-fuzz-example") {
            options.fuzzExample = false;
            continue;
        }
        if (arg == "--target") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                options.target = parseTarget(next);
                i++;
                continue;
            }
            throw new Error("--target requires a value: wasi|bindings|web");
        }
        if (arg.startsWith("--target=")) {
            options.target = parseTarget(arg.slice("--target=".length));
            continue;
        }
        if (arg == "--example") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                options.example = parseExampleMode(next);
                i++;
                continue;
            }
            throw new Error("--example requires a value: minimal|full|none");
        }
        if (arg.startsWith("--example=")) {
            options.example = parseExampleMode(arg.slice("--example=".length));
            continue;
        }
        if (arg == "--dir") {
            const next = rawArgs[i + 1];
            if (next && !next.startsWith("-")) {
                options.dir = next;
                options.dirExplicit = true;
                i++;
                continue;
            }
            throw new Error("--dir requires a path value");
        }
        if (arg.startsWith("--dir=")) {
            options.dir = arg.slice("--dir=".length);
            options.dirExplicit = true;
            continue;
        }
        if (arg.startsWith("-")) {
            throw new Error(`Unknown init flag: ${arg}`);
        }
        positional.push(arg);
    }
    // First positional argument is always the target directory.
    if (positional.length > 0) {
        options.dir = positional.shift();
        options.dirExplicit = true;
    }
    if (!options.target && positional.length > 0 && isTarget(positional[0])) {
        options.target = positional.shift();
    }
    if (!options.example &&
        positional.length > 0 &&
        isExampleMode(positional[0])) {
        options.example = positional.shift();
    }
    if (positional.length > 0) {
        throw new Error(`Unknown init argument(s): ${positional.join(", ")}. Usage: init [dir] [--target wasi|bindings|web] [--example minimal|full|none] [--fuzz-example|--no-fuzz-example] [--install] [--yes] [--force] [--dir <path>]`);
    }
    return options;
}
async function runInteractiveOnboarding(options, face) {
    printOnboardingIntro();
    const acknowledged = await askYesNo("I understand this command writes files and can run package manager installs. Continue?", face, true);
    if (!acknowledged)
        return null;
    const onboardingMode = await askMenuChoice("Onboarding mode", [
        { value: "manual", label: "Manual (guided prompts)" },
        { value: "quick", label: "Quick (sensible defaults)" },
    ], face, "manual");
    const workspacePrompt = "What do you want to set up? (default: ./)";
    const defaultRoot = options.dir;
    let selectedDir = defaultRoot;
    if (options.dirExplicit || onboardingMode == "quick") {
        selectedDir = options.dir;
    }
    else {
        const defaultDisplay = defaultRoot == "." ? "./" : defaultRoot;
        const enteredDir = (await ask(`${chalk.bold.blue(`◇  ${workspacePrompt}`)}\n│  `, face, defaultDisplay)).trim();
        selectedDir = enteredDir.length ? enteredDir : defaultRoot;
    }
    const resolvedRoot = path.resolve(process.cwd(), selectedDir);
    if (options.dirExplicit || onboardingMode == "quick") {
        printPromptAndSelectionLine(workspacePrompt, resolvedRoot);
    }
    else {
        printSelectionLine(resolvedRoot);
    }
    const target = options.target ??
        (onboardingMode == "quick"
            ? "wasi"
            : await askMenuChoice("Build target", [
                {
                    value: "wasi",
                    label: "wasi (default runner: node .as-test/runners/default.wasi.js)",
                },
                {
                    value: "bindings",
                    label: "bindings (default runner: node .as-test/runners/default.bindings.js)",
                },
                {
                    value: "web",
                    label: "web (default runner: node .as-test/runners/default.web.js <file>)",
                },
            ], face, "wasi"));
    if (options.target || onboardingMode == "quick") {
        printPromptAndSelectionLine("Build target", target);
    }
    const example = options.example ??
        (onboardingMode == "quick"
            ? "minimal"
            : await askMenuChoice("Example template", [
                { value: "minimal", label: "minimal (one short starter spec)" },
                { value: "full", label: "full (hooks, assertions, logs, suites)" },
                { value: "none", label: "none (config/runners only)" },
            ], face, "minimal"));
    if (options.example || onboardingMode == "quick") {
        printPromptAndSelectionLine("Example template", example);
    }
    const fuzzExample = options.fuzzExample ??
        (onboardingMode == "quick"
            ? false
            : await askYesNo("Add a basic fuzzer example?", face, false));
    if (options.fuzzExample !== undefined || onboardingMode == "quick") {
        printPromptAndSelectionLine("Add a basic fuzzer example?", fuzzExample ? "Yes" : "No");
    }
    const installDependenciesNow = options.install ??
        (onboardingMode == "quick"
            ? false
            : await askYesNo("Install dependencies now?", face, false));
    if (options.install !== undefined || onboardingMode == "quick") {
        printPromptAndSelectionLine("Install dependencies now?", installDependenciesNow ? "Yes" : "No");
    }
    return {
        root: resolvedRoot,
        target,
        example,
        fuzzExample,
        installDependenciesNow,
    };
}
function printOnboardingHeader() {
    // console.log(
    //   chalk.bold.cyan(
    //     `as-test ${getCliVersion()} — AssemblyScript testing without runtime guesswork.`,
    //   ) + "\n",
    // );
}
function printOnboardingIntro() {
    console.log(chalk.bold.blue("╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗"));
    console.log(chalk.bold.blue("╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ "));
    console.log(chalk.bold.blue("╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ "));
    console.log("");
    // console.log(chalk.bold("┌") + " " + chalk.bold.blueBright(""));
    // console.log("│");
    // printPanel("Security", [
    //   "Security warning — please read.",
    //   "",
    //   "as-test is a local developer tool and executes build/runtime commands from your project config.",
    //   "If the config is untrusted, those commands can run arbitrary programs on your machine.",
    //   "",
    //   "Recommended baseline:",
    //   "- Keep this tool scoped to trusted repositories.",
    //   "- Review runOptions.runtime.cmd and buildOptions.cmd before running.",
    //   "- Prefer least-privilege shells/environments for shared machines and CI.",
    //   "",
    //   "Run regularly: ast doctor and ast test --list",
    //   "Read docs: README.md (Configuration + Setup Diagnostics sections).",
    // ]);
    // console.log("│");
}
// function printPanel(title: string, lines: string[]): void {
//   const innerWidth = Math.max(32, (process.stdout.columns ?? 80) - 6);
//   const heading = `◇  ${title} `;
//   const rule = "─".repeat(Math.max(8, innerWidth - heading.length));
//   console.log(chalk.bold.blue(`${heading}${rule}`));
//   for (const line of lines) {
//     if (!line.length) {
//       console.log("│");
//       continue;
//     }
//     for (const wrapped of wrapText(line, innerWidth)) {
//       console.log(`│ ${wrapped}`);
//     }
//   }
//   console.log(`├${"─".repeat(Math.max(8, innerWidth))}`);
// }
// function wrapText(value: string, width: number): string[] {
//   if (width < 1) return [value];
//   const words = value.split(/\s+/).filter((part) => part.length > 0);
//   if (!words.length) return [""];
//   const lines: string[] = [];
//   let current = "";
//   for (const word of words) {
//     if (!current.length) {
//       current = word;
//       continue;
//     }
//     if (current.length + 1 + word.length <= width) {
//       current += ` ${word}`;
//       continue;
//     }
//     lines.push(current);
//     current = word;
//   }
//   if (current.length) {
//     lines.push(current);
//   }
//   return lines;
// }
function printPromptAndSelectionLine(prompt, answer) {
    console.log(chalk.bold.blue(`◇  ${prompt}`));
    printSelectionLine(answer);
}
function printSelectionLine(answer) {
    console.log(`│  ${chalk.gray(answer)}`);
    console.log("│");
}
function parseTarget(value) {
    if (!isTarget(value)) {
        throw new Error(`Invalid target "${value}". Expected wasi|bindings|web`);
    }
    return value;
}
function parseExampleMode(value) {
    if (!isExampleMode(value)) {
        throw new Error(`Invalid example mode "${value}". Expected minimal|full|none`);
    }
    return value;
}
function isTarget(value) {
    return TARGETS.includes(value);
}
function isExampleMode(value) {
    return EXAMPLE_MODES.includes(value);
}
function printPlan(root, target, example, fuzzExample, install) {
    const displayRoot = () => {
        const rel = path.relative(process.cwd(), root).split(path.sep).join("/");
        if (!rel || rel == ".")
            return "./";
        if (rel.startsWith(".."))
            return rel;
        return `./${rel}`;
    };
    const statusColor = (relPath) => existsSync(path.join(root, relPath)) ? chalk.hex("#d29922") : chalk.green;
    const paintNode = (node) => statusColor(node.relPath)(node.isDir ? `${node.name}/` : node.name);
    const ensureChild = (parent, name, relPath, isDir) => {
        let child = parent.children.find((entry) => entry.name == name);
        if (!child) {
            child = { name, relPath, isDir, children: [] };
            parent.children.push(child);
            return child;
        }
        if (isDir) {
            child.isDir = true;
        }
        return child;
    };
    const buildTree = (entries) => {
        const rootNode = {
            name: "",
            relPath: "",
            isDir: true,
            children: [],
        };
        for (const entry of entries) {
            const parts = entry.path.split("/").filter((part) => part.length > 0);
            let cursor = rootNode;
            let relPath = "";
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                relPath = relPath ? `${relPath}/${part}` : part;
                const isLeaf = i == parts.length - 1;
                cursor = ensureChild(cursor, part, relPath, isLeaf ? entry.isDir : true);
            }
        }
        return rootNode;
    };
    const renderBranch = (nodes, prefix) => {
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const isLast = i == nodes.length - 1;
            const branch = isLast ? "└── " : "├── ";
            const treeGlyphs = chalk.dim(`${prefix}${branch}`);
            console.log(`│  ${treeGlyphs}${paintNode(node)}`);
            if (node.children.length > 0) {
                const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
                renderBranch(node.children, childPrefix);
            }
        }
    };
    const fileEntries = [
        { path: ".as-test", isDir: true },
        { path: ".as-test/build", isDir: true },
        { path: ".as-test/logs", isDir: true },
        { path: ".as-test/coverage", isDir: true },
        { path: ".as-test/snapshots", isDir: true },
        { path: "assembly", isDir: true },
        { path: "assembly/tsconfig.json", isDir: false },
        { path: "assembly/__tests__", isDir: true },
        { path: "as-test.config.json", isDir: false },
        { path: "package.json", isDir: false },
    ];
    if (target == "wasi" || target == "bindings" || target == "web") {
        fileEntries.push({ path: ".as-test/runners", isDir: true });
        fileEntries.push({
            path: ".as-test/runners/default.bindings.js",
            isDir: false,
        });
        fileEntries.push({
            path: ".as-test/runners/default.bindings.hooks.js",
            isDir: false,
        });
        fileEntries.push({
            path: ".as-test/runners/default.wasi.js",
            isDir: false,
        });
        fileEntries.push({
            path: ".as-test/runners/default.web.js",
            isDir: false,
        });
        fileEntries.push({
            path: ".as-test/runners/default.web.hooks.js",
            isDir: false,
        });
    }
    if (example != "none") {
        fileEntries.push({
            path: "assembly/__tests__/example.spec.ts",
            isDir: false,
        });
    }
    if (fuzzExample) {
        fileEntries.push({ path: "assembly/__fuzz__", isDir: true });
        fileEntries.push({
            path: "assembly/__fuzz__/example.fuzz.ts",
            isDir: false,
        });
    }
    const treeRoot = buildTree(fileEntries);
    console.log(chalk.bold.blue("◇  Planned Changes"));
    console.log("│" + chalk.dim(`  - Target: ${target}`));
    console.log("│" + chalk.dim(`  - Example: ${example}`));
    console.log("│" + chalk.dim(`  - Fuzzer example: ${fuzzExample ? "yes" : "no"}`));
    console.log("│" + chalk.dim(`  - Directory: ${displayRoot()}`));
    console.log("│" + chalk.dim(`  - Install dependencies: ${install ? "yes" : "no"}`));
    console.log("│" + chalk.bold.blue("  File Changes"));
    for (const topLevelNode of treeRoot.children) {
        console.log(`│  ${paintNode(topLevelNode)}`);
        renderBranch(topLevelNode.children, "");
    }
    console.log("│");
}
function applyInit(root, target, example, fuzzExample, force) {
    const summary = {
        created: [],
        updated: [],
        skipped: [],
    };
    ensureDir(root, ".as-test/build", summary);
    ensureDir(root, ".as-test/logs", summary);
    ensureDir(root, ".as-test/coverage", summary);
    ensureDir(root, ".as-test/snapshots", summary);
    ensureDir(root, "assembly/__tests__", summary);
    if (fuzzExample) {
        ensureDir(root, "assembly/__fuzz__", summary);
    }
    if (target == "wasi" || target == "bindings" || target == "web") {
        ensureDir(root, ".as-test/runners", summary);
    }
    ensureGitignoreIncludesAsTestDirs(root, summary);
    writeJson(path.join(root, "assembly/tsconfig.json"), buildAssemblyTsconfig(), summary, "assembly/tsconfig.json");
    const configPath = path.join(root, "as-test.config.json");
    const config = {
        $schema: "node_modules/as-test/as-test.config.schema.json",
        input: ["assembly/__tests__/*.spec.ts"],
        output: ".as-test/",
        config: "none",
        coverage: false,
        env: {},
        ...(fuzzExample
            ? {
                fuzz: {
                    input: ["assembly/__fuzz__/*.fuzz.ts"],
                    runs: 1000,
                    seed: 1337,
                    target: "bindings",
                    corpusDir: ".as-test/corpus",
                    crashDir: ".as-test/crashes",
                },
            }
            : {}),
        buildOptions: {
            target,
        },
        runOptions: {
            runtime: {
                cmd: target == "wasi"
                    ? "node .as-test/runners/default.wasi.js <file>"
                    : target == "bindings"
                        ? "node .as-test/runners/default.bindings.js <file>"
                        : "node .as-test/runners/default.web.js <file>",
            },
            reporter: "default",
        },
        modes: target == "web"
            ? {
                "web-headless": {
                    runOptions: {
                        runtime: {
                            cmd: "node .as-test/runners/default.web.js --headless <file>",
                        },
                    },
                },
            }
            : {},
    };
    writeJson(configPath, config, summary, "as-test.config.json");
    if (example != "none") {
        const examplePath = path.join(root, "assembly/__tests__/example.spec.ts");
        const content = example == "minimal" ? buildMinimalExampleSpec() : buildFullExampleSpec();
        writeManagedFile(examplePath, content, force, summary, "assembly/__tests__/example.spec.ts");
    }
    if (fuzzExample) {
        const fuzzPath = path.join(root, "assembly/__fuzz__/example.fuzz.ts");
        writeManagedFile(fuzzPath, buildBasicFuzzerExample(), force, summary, "assembly/__fuzz__/example.fuzz.ts");
    }
    if (target == "wasi" || target == "bindings" || target == "web") {
        const runnerPath = path.join(root, ".as-test/runners/default.wasi.js");
        writeManagedFile(runnerPath, buildWasiRunner(), force, summary, ".as-test/runners/default.wasi.js");
    }
    if (target == "wasi" || target == "bindings" || target == "web") {
        const runnerPath = path.join(root, ".as-test/runners/default.bindings.js");
        writeManagedFile(runnerPath, buildBindingsRunner(), force, summary, ".as-test/runners/default.bindings.js");
    }
    if (target == "wasi" || target == "bindings" || target == "web") {
        const hooksPath = path.join(root, ".as-test/runners/default.bindings.hooks.js");
        writeManagedFile(hooksPath, buildBindingsRunnerHooks(), force, summary, ".as-test/runners/default.bindings.hooks.js");
    }
    if (target == "wasi" || target == "bindings" || target == "web") {
        const runnerPath = path.join(root, ".as-test/runners/default.web.js");
        writeManagedFile(runnerPath, buildWebRunnerSource(), force, summary, ".as-test/runners/default.web.js");
    }
    if (target == "wasi" || target == "bindings" || target == "web") {
        const hooksPath = path.join(root, ".as-test/runners/default.web.hooks.js");
        writeManagedFile(hooksPath, buildWebRunnerHooks(), force, summary, ".as-test/runners/default.web.hooks.js");
    }
    const pkgPath = path.join(root, "package.json");
    const pkg = existsSync(pkgPath)
        ? JSON.parse(readFileSync(pkgPath, "utf8"))
        : {};
    if (!pkg.scripts || typeof pkg.scripts != "object") {
        pkg.scripts = {};
    }
    const scripts = pkg.scripts;
    if (!scripts.test) {
        scripts.test = "ast test";
    }
    if (fuzzExample && !scripts.fuzz) {
        scripts.fuzz = "ast fuzz";
    }
    if (!pkg.type) {
        pkg.type = "module";
    }
    if (!pkg.devDependencies || typeof pkg.devDependencies != "object") {
        pkg.devDependencies = {};
    }
    const devDependencies = pkg.devDependencies;
    if (!devDependencies["as-test"]) {
        devDependencies["as-test"] = "^" + getCliVersion();
    }
    if (!hasDependency(pkg, "assemblyscript")) {
        devDependencies["assemblyscript"] = "^0.28.9";
    }
    if (target == "wasi" && !devDependencies["@assemblyscript/wasi-shim"]) {
        devDependencies["@assemblyscript/wasi-shim"] = "^0.1.0";
    }
    if (target == "bindings" && !pkg.type) {
        pkg.type = "module";
    }
    writeJson(pkgPath, pkg, summary, "package.json");
    return summary;
}
function hasDependency(pkg, dependency) {
    const sections = ["dependencies", "devDependencies", "peerDependencies"];
    for (const section of sections) {
        const value = pkg[section];
        if (!value || typeof value != "object" || Array.isArray(value))
            continue;
        if (dependency in value)
            return true;
    }
    return false;
}
function ensureDir(root, rel, summary) {
    const full = path.join(root, rel);
    if (existsSync(full))
        return;
    mkdirSync(full, { recursive: true });
    summary.created.push(rel + "/");
}
function ensureGitignoreIncludesAsTestDirs(root, summary) {
    const rel = ".gitignore";
    const fullPath = path.join(root, rel);
    const entries = [
        "# Include essential as-test artifacts",
        "!.as-test/",
        ".as-test/*",
        "!.as-test/runners/",
        "!.as-test/snapshots/",
    ];
    const existed = existsSync(fullPath);
    const source = existed ? readFileSync(fullPath, "utf8") : "";
    const lines = source.split(/\r?\n/);
    const missing = entries.filter((entry) => !lines.some((line) => line.trim() == entry));
    if (!missing.length) {
        return;
    }
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    let output = source;
    if (output.length && !output.endsWith("\n") && !output.endsWith("\r\n")) {
        output += eol;
    }
    output += missing.join(eol) + eol;
    writeFileSync(fullPath, output);
    if (existed)
        summary.updated.push(rel);
    else
        summary.created.push(rel);
}
function buildAssemblyTsconfig() {
    return {
        extends: "assemblyscript/std/assembly.json",
        include: ["./**/*.ts"],
    };
}
function writeJson(fullPath, value, summary, displayPath) {
    const rel = displayPath ??
        path.relative(process.cwd(), fullPath) ??
        path.basename(fullPath);
    const existed = existsSync(fullPath);
    const data = JSON.stringify(value, null, 2) + "\n";
    writeFileSync(fullPath, data);
    if (existed)
        summary.updated.push(rel);
    else
        summary.created.push(rel);
}
function writeManagedFile(fullPath, data, force, summary, displayPath) {
    const rel = displayPath ??
        path.relative(process.cwd(), fullPath) ??
        path.basename(fullPath);
    const existed = existsSync(fullPath);
    if (existed && !force) {
        summary.skipped.push(rel);
        return;
    }
    if (!existsSync(path.dirname(fullPath))) {
        mkdirSync(path.dirname(fullPath), { recursive: true });
    }
    writeFileSync(fullPath, data);
    if (existed)
        summary.updated.push(rel);
    else
        summary.created.push(rel);
}
function printSummary(summary) {
    console.log("│");
    if (summary.created.length) {
        console.log(chalk.bold("│  Created:"));
        for (const item of summary.created) {
            console.log(`│    + ${item}`);
        }
    }
    if (summary.updated.length) {
        console.log(chalk.bold("│  Updated:"));
        for (const item of summary.updated) {
            console.log(`│    ~ ${item}`);
        }
    }
    if (summary.skipped.length) {
        console.log(chalk.bold("│  Skipped (exists, use --force to overwrite):"));
        for (const item of summary.skipped) {
            console.log(`│    = ${item}`);
        }
    }
    console.log("│");
}
function ask(question, face, initialValue) {
    if (!face) {
        throw new Error("interactive input is unavailable; pass --yes with options");
    }
    return new Promise((res) => {
        face.question(question, (answer) => {
            const stdout = process.stdout;
            if (stdout.isTTY) {
                stdout.write("\x1b[1A");
                stdout.write("\x1b[2K");
                stdout.write("\r");
            }
            res(answer);
        });
        if (initialValue && initialValue.length) {
            face.write(initialValue);
        }
    });
}
async function askChoice(label, choices, face, fallback) {
    if (!face) {
        return fallback;
    }
    const answer = (await ask(`${label} [${choices.join("/")}] (${fallback}) -> `, face, fallback))
        .trim()
        .toLowerCase();
    if (!answer.length)
        return fallback;
    if (choices.includes(answer))
        return answer;
    throw new Error(`Invalid choice "${answer}" for ${label}`);
}
async function askMenuChoice(label, choices, face, fallback) {
    const fallbackValue = choices.some((choice) => choice.value == fallback)
        ? fallback
        : choices[0].value;
    if (!face)
        return fallbackValue;
    if (!canUseArrowMenu(face)) {
        const values = choices.map((choice) => choice.value);
        return askChoice(label, values, face, fallbackValue);
    }
    return askMenuChoiceWithArrows(label, choices, face, fallbackValue);
}
async function askYesNo(label, face, fallback) {
    if (!face)
        return fallback;
    if (canUseArrowMenu(face)) {
        const selected = await askMenuChoice(label, [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
        ], face, fallback ? "yes" : "no");
        return selected == "yes";
    }
    const suffix = fallback ? "[Y/n]" : "[y/N]";
    const defaultValue = fallback ? "yes" : "no";
    const answer = (await ask(`${label} ${suffix} `, face, defaultValue))
        .trim()
        .toLowerCase();
    if (!answer.length)
        return fallback;
    if (answer == "y" || answer == "yes")
        return true;
    if (answer == "n" || answer == "no")
        return false;
    throw new Error(`Invalid answer "${answer}". Expected yes or no.`);
}
function canUseArrowMenu(face) {
    if (!face)
        return false;
    const stdin = process.stdin;
    const stdout = process.stdout;
    return (Boolean(stdin.isTTY) &&
        Boolean(stdout.isTTY) &&
        typeof stdin.setRawMode == "function");
}
async function askMenuChoiceWithArrows(label, choices, face, fallback) {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const fallbackIndex = choices.findIndex((choice) => choice.value == fallback);
    let selectedIndex = fallbackIndex == -1 ? 0 : fallbackIndex;
    let renderedLineCount = 0;
    const previousRawMode = Boolean(stdin.isRaw);
    const lineWidth = Math.max(20, (stdout.columns ?? 80) - 2);
    const clamp = (value, max) => {
        if (value.length <= max)
            return value;
        if (max <= 1)
            return value.slice(0, max);
        return `${value.slice(0, max - 1)}…`;
    };
    const titleLine = () => chalk.bold.blue(`◆  ${clamp(label, Math.max(8, lineWidth - 3))}`);
    const menuLines = () => {
        const lines = [titleLine()];
        for (let i = 0; i < choices.length; i++) {
            const choice = choices[i];
            const marker = i == selectedIndex ? chalk.blue("●") : chalk.dim("○");
            lines.push(`│  ${marker} ${clamp(choice.label, Math.max(8, lineWidth - 6))}`);
        }
        lines.push("│");
        return lines;
    };
    const collapsedLines = () => {
        const selected = choices[selectedIndex];
        return [
            `│  ${chalk.gray(clamp(selected.label, Math.max(8, lineWidth - 4)))}`,
        ];
    };
    const writeLines = (lines, collapse = false) => {
        if (renderedLineCount > 0) {
            process.stdout.write(`\x1b[${renderedLineCount}A`);
        }
        const totalLineCount = Math.max(lines.length, renderedLineCount);
        for (let i = 0; i < totalLineCount; i++) {
            process.stdout.write("\x1b[2K");
            if (i < lines.length) {
                process.stdout.write(lines[i]);
            }
            process.stdout.write("\n");
        }
        renderedLineCount = lines.length;
        if (collapse) {
            renderedLineCount = 0;
        }
    };
    const collapseInPlace = () => {
        const lines = collapsedLines();
        if (renderedLineCount > 0) {
            process.stdout.write(`\x1b[${renderedLineCount}A`);
        }
        const totalLineCount = Math.max(renderedLineCount, lines.length);
        for (let i = 0; i < totalLineCount; i++) {
            process.stdout.write("\r\x1b[2K");
            if (i < lines.length) {
                process.stdout.write(lines[i]);
            }
            process.stdout.write("\n");
        }
        const extraLines = totalLineCount - lines.length;
        if (extraLines > 0) {
            process.stdout.write(`\x1b[${extraLines}A`);
        }
        renderedLineCount = 0;
    };
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            stdin.off("data", onData);
            if (stdin.isTTY) {
                stdin.setRawMode(previousRawMode);
            }
            const isClosed = Boolean(face.closed);
            if (!isClosed) {
                try {
                    face.resume();
                }
                catch {
                    // noop: readline may already be closed during shutdown/cancel paths.
                }
            }
        };
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            collapseInPlace();
            cleanup();
            resolve(value);
        };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onData = (chunk) => {
            const input = typeof chunk == "string" ? chunk : chunk.toString("utf8");
            if (!input.length)
                return;
            if (input == "\u0003") {
                fail(new Error(chalk.bold.red("◆  Cancelled")));
                return;
            }
            if (input == "\x1b[A" ||
                input == "\x1bOA" ||
                input == "\x1b[D" ||
                input == "\x1bOD") {
                selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
                writeLines(menuLines());
                return;
            }
            if (input == "\x1b[B" ||
                input == "\x1bOB" ||
                input == "\x1b[C" ||
                input == "\x1bOC") {
                selectedIndex = (selectedIndex + 1) % choices.length;
                writeLines(menuLines());
                return;
            }
            if (input == "\r" || input == "\n") {
                finish(choices[selectedIndex].value);
                return;
            }
        };
        face.pause();
        if (stdin.isTTY) {
            stdin.setRawMode(true);
        }
        stdin.resume();
        stdin.on("data", onData);
        writeLines(menuLines());
    });
}
function installDependencies(root) {
    const install = resolveInstallCommand(root);
    console.log("\n" +
        chalk.dim(`Installing dependencies with: ${install.command} ${install.args.join(" ")}`));
    const child = spawnSync(install.command, install.args, {
        cwd: root,
        stdio: "inherit",
        shell: process.platform == "win32",
    });
    if (child.error) {
        throw new Error(`failed to run dependency install: ${child.error.message}`);
    }
    if (child.status !== 0) {
        throw new Error(`dependency installation failed with exit code ${String(child.status)}`);
    }
}
function resolveInstallCommand(root) {
    if (existsSync(path.join(root, "pnpm-lock.yaml"))) {
        return { command: "pnpm", args: ["install"] };
    }
    if (existsSync(path.join(root, "yarn.lock"))) {
        return { command: "yarn", args: ["install"] };
    }
    if (existsSync(path.join(root, "bun.lockb")) ||
        existsSync(path.join(root, "bun.lock"))) {
        return { command: "bun", args: ["install"] };
    }
    const userAgent = process.env.npm_config_user_agent ?? "";
    if (userAgent.startsWith("pnpm")) {
        return { command: "pnpm", args: ["install"] };
    }
    if (userAgent.startsWith("yarn")) {
        return { command: "yarn", args: ["install"] };
    }
    if (userAgent.startsWith("bun")) {
        return { command: "bun", args: ["install"] };
    }
    return { command: "npm", args: ["install"] };
}
function buildMinimalExampleSpec() {
    return `import { describe, expect, test } from "as-test";

describe("example", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });
});
`;
}
function buildFullExampleSpec() {
    return `import { afterAll, beforeAll, describe, expect, it, log, test } from "as-test";

beforeAll(() => {
  log("setup");
});

afterAll(() => {
  log("teardown");
});

describe("math", () => {
  test("addition", () => {
    expect(2 + 2).toBe(4);
  });

  test("comparisons", () => {
    expect(10).toBeGreaterThan(2);
    expect(2).toBeLessThan(10);
  });
});

describe("strings", () => {
  it("contains", () => {
    expect("assemblyscript").toContain("script");
  });

  test("prefix", () => {
    expect("as-test").toStartWith("as");
  });
});
`;
}
function buildBasicFuzzerExample() {
    return `import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("basic string fuzzer", (value: string): bool => {
  expect(value.length >= 0).toBe(true);
  return value.length <= 24;
}, 250).generate((seed: FuzzSeed, run: (value: string) => bool): void => {
  run(
    seed.string({
      charset: "ascii",
      min: 0,
      max: 24,
      exclude: [0x00, 0x0a, 0x0d],
    }),
  );
});
`;
}
function buildWasiRunner() {
    return `import { readFileSync } from "fs";
import { WASI } from "wasi";

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning, ...args) => {
  const type = typeof args[0] == "string" ? args[0] : "";
  const name = typeof warning?.name == "string" ? warning.name : type;
  const message =
    typeof warning == "string" ? warning : String(warning?.message ?? "");
  if (
    name == "ExperimentalWarning" &&
    message.includes("WASI is an experimental feature")
  ) {
    return;
  }
  return originalEmitWarning(warning, ...args);
});

const wasmPath = process.argv[2];
if (!wasmPath) {
  process.stderr.write("usage: node ./.as-test/runners/default.wasi.js <file.wasm>\\n");
  process.exit(1);
}

try {
  const wasi = new WASI({
    version: "preview1",
    args: [wasmPath],
    env: process.env,
    preopens: {},
  });

  const binary = readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const instance = new WebAssembly.Instance(module, {
    env: {
      __as_test_request_fuzz_config() {
        return 0;
      },
    },
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.start(instance);
} catch (error) {
  process.stderr.write("failed to run WASI module: " + String(error) + "\\n");
  process.exit(1);
}
`;
}
function buildBindingsRunner() {
    return `import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const HOOKS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "./default.bindings.hooks.js",
);

function readExact(length) {
  const out = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let read = 0;
    try {
      read = fs.readSync(0, out, offset, length - offset, null);
    } catch (error) {
      if (error && error.code === "EAGAIN") {
        continue;
      }
      throw error;
    }
    if (!read) break;
    offset += read;
  }
  const view = out.subarray(0, offset);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function writeRaw(data) {
  const view = Buffer.from(data);
  fs.writeSync(1, view);
}

function createRunnerContext({ wasmPath, module, helperPath }) {
  return {
    wasmPath,
    helperPath,
    module,
    argv: process.argv.slice(2),
    env: process.env,
    readFrame(size) {
      return readExact(Number(size ?? 0));
    },
    writeFrame(data) {
      writeRaw(data);
      return true;
    },
  };
}

function createAsTestImports(ctx) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => {
    if (chunk instanceof ArrayBuffer) {
      return ctx.writeFrame(chunk);
    }
    return originalWrite(chunk, ...args);
  };
  process.stdin.read = (size) => ctx.readFrame(size);
  return {};
}

function mergeImports(...groups) {
  const out = {};
  for (const group of groups) {
    if (!group || typeof group != "object") continue;
    for (const moduleName of Object.keys(group)) {
      out[moduleName] = Object.assign(out[moduleName] || {}, group[moduleName]);
    }
  }
  return out;
}

async function loadRunnerHooks() {
  if (!fs.existsSync(HOOKS_PATH)) {
    return {
      createUserImports() {
        return {};
      },
      async runModule(_exports, _ctx) {},
    };
  }
  const mod = await import(pathToFileURL(HOOKS_PATH).href + "?t=" + Date.now());
  return {
    createUserImports:
      typeof mod.createUserImports == "function"
        ? mod.createUserImports
        : () => ({}),
    runModule:
      typeof mod.runModule == "function" ? mod.runModule : async () => {},
  };
}

async function instantiateModule(ctx, hooks) {
  const helper = await import(pathToFileURL(ctx.helperPath).href);
  if (typeof helper.instantiate !== "function") {
    throw new Error("bindings helper missing instantiate export");
  }
  const imports = mergeImports(
    createAsTestImports(ctx),
    await hooks.createUserImports(ctx),
  );
  return helper.instantiate(ctx.module, imports);
}

const wasmPathArg = process.argv[2];
if (!wasmPathArg) {
  process.stderr.write("usage: node ./.as-test/runners/default.bindings.js <file.wasm>\\n");
  process.exit(1);
}

const wasmPath = path.resolve(process.cwd(), wasmPathArg);
const jsPath = wasmPath.replace(/\\.wasm$/, ".js");

try {
  const binary = fs.readFileSync(wasmPath);
  const module = new WebAssembly.Module(binary);
  const ctx = createRunnerContext({ wasmPath, module, helperPath: jsPath });
  const hooks = await loadRunnerHooks();
  const exports = await instantiateModule(ctx, hooks);
  await hooks.runModule(exports, ctx);
} catch (error) {
  process.stderr.write("failed to run bindings module: " + String(error) + "\\n");
  process.exit(1);
}
`;
}
function buildBindingsRunnerHooks() {
    return `export function createUserImports(_ctx) {
  return {
    // env: {
    //   now_ms: () => Date.now(),
    // },
  };
}

export async function runModule(_exports, _ctx) {
  // The generated bindings helper already calls exports._start().
  // Add extra startup calls here when your module exposes them.
  //
  // Example:
  // _exports.run?.();
}
`;
}
function buildWebRunnerHooks() {
    return `export function createUserImports(_ctx) {
  return {
    // env: {
    //   now_ms: () => performance.now(),
    // },
  };
}

export async function runModule(_exports, _ctx) {
  // The generated bindings helper already calls exports._start().
  // Add extra startup calls here when your module exposes them.
  //
  // Example:
  // _exports.run?.();
}
`;
}
