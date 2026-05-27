import chalk from "chalk";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { createInterface, Interface } from "readline";
import { getCliVersion } from "../util.js";
import { buildWebRunnerSource } from "./web-runner-source.js";

const TARGETS = ["wasi", "bindings", "web"] as const;
type Target = (typeof TARGETS)[number];

const EXAMPLE_MODES = ["minimal", "full", "none"] as const;
type ExampleMode = (typeof EXAMPLE_MODES)[number];

const FEATURE_KEYS = ["coverage", "tryAs"] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];
type FeatureSelection = Record<FeatureKey, boolean>;

const FEATURE_LABELS: Record<FeatureKey, string> = {
  coverage: "coverage (runtime coverage points + report)",
  tryAs:
    "try-as (try/catch/finally + toThrow assertions + throwable rewriting)",
};

type InitOptions = {
  target?: Target;
  example?: ExampleMode;
  fuzzExample?: boolean;
  install?: boolean;
  features: Partial<FeatureSelection>;
  yes: boolean;
  force: boolean;
  dir: string;
  dirExplicit: boolean;
};

type ApplySummary = {
  created: string[];
  updated: string[];
  skipped: string[];
};

export async function init(rawArgs: string[]) {
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
          features: resolveFeatures(options.features, {
            coverage: false,
            tryAs: false,
          }),
          installDependenciesNow: options.install ?? false,
        }
      : await runInteractiveOnboarding(options, rl);

    if (!answers) {
      console.log(chalk.bold.red("◆  Cancelled"));
      return;
    }

    printPlan(
      answers.root,
      answers.target,
      answers.example,
      answers.fuzzExample,
      answers.features,
      answers.installDependenciesNow,
    );

    if (!options.yes) {
      const cont = await askYesNo("Continue with these changes?", rl, true);
      if (!cont) {
        console.log(chalk.bold.red("◆  Cancelled"));
        return;
      }
    }

    const summary = applyInit(
      answers.root,
      answers.target,
      answers.example,
      answers.fuzzExample,
      answers.features,
      options.force,
    );
    printSummary(summary);
    console.log(chalk.bold.green("◆  Finished!"));
    if (answers.installDependenciesNow) {
      installDependencies(answers.root);
      console.log("\nNow, run " + chalk.italic.bold("npm test") + "\n");
    } else {
      console.log(
        "\nNow, run " + chalk.italic.bold("npm i && npm test") + "\n",
      );
    }
  } finally {
    rl?.close();
  }
}

function parseInitArgs(rawArgs: string[]): InitOptions {
  const options: InitOptions = {
    features: {},
    yes: false,
    force: false,
    dir: ".",
    dirExplicit: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
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
    if (arg == "--enable" || arg == "--disable") {
      const next = rawArgs[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`${arg} requires a value: coverage|try-as`);
      }
      for (const name of splitInitFeatureList(next)) {
        applyInitFeatureToggle(options.features, name, arg == "--enable");
      }
      i++;
      continue;
    }
    if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
      const eq = arg.indexOf("=");
      const flag = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      const names = splitInitFeatureList(value);
      if (!names.length) {
        throw new Error(`${flag} requires a value: coverage|try-as`);
      }
      for (const name of names) {
        applyInitFeatureToggle(options.features, name, flag == "--enable");
      }
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
    options.dir = positional.shift()!;
    options.dirExplicit = true;
  }

  if (!options.target && positional.length > 0 && isTarget(positional[0]!)) {
    options.target = positional.shift() as Target;
  }
  if (
    !options.example &&
    positional.length > 0 &&
    isExampleMode(positional[0]!)
  ) {
    options.example = positional.shift() as ExampleMode;
  }

  if (positional.length > 0) {
    throw new Error(
      `Unknown init argument(s): ${positional.join(", ")}. Usage: init [dir] [--target wasi|bindings|web] [--example minimal|full|none] [--fuzz-example|--no-fuzz-example] [--enable coverage|try-as] [--disable coverage|try-as] [--install] [--yes] [--force] [--dir <path>]`,
    );
  }

  return options;
}

function splitInitFeatureList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function applyInitFeatureToggle(
  out: Partial<FeatureSelection>,
  rawFeature: string,
  enabled: boolean,
): void {
  const key = rawFeature.trim().toLowerCase();
  if (key == "coverage") {
    out.coverage = enabled;
    return;
  }
  if (key == "try-as" || key == "try_as" || key == "tryas") {
    out.tryAs = enabled;
    return;
  }
  throw new Error(
    `unknown feature "${rawFeature}". Supported features: coverage, try-as`,
  );
}

function resolveFeatures(
  overrides: Partial<FeatureSelection>,
  defaults: FeatureSelection,
): FeatureSelection {
  return {
    coverage: overrides.coverage ?? defaults.coverage,
    tryAs: overrides.tryAs ?? defaults.tryAs,
  };
}

type InteractiveAnswers = {
  root: string;
  target: Target;
  example: ExampleMode;
  fuzzExample: boolean;
  features: FeatureSelection;
  installDependenciesNow: boolean;
};

type MenuOption<T extends string> = {
  value: T;
  label: string;
};

type ToggleOption<T extends string> = {
  value: T;
  label: string;
};

async function runInteractiveOnboarding(
  options: InitOptions,
  face: Interface | null,
): Promise<InteractiveAnswers | null> {
  printOnboardingIntro();
  const acknowledged = await askYesNo(
    "I understand this command writes files and can run package manager installs. Continue?",
    face,
    true,
  );
  if (!acknowledged) return null;

  const onboardingMode = await askMenuChoice(
    "Onboarding mode",
    [
      { value: "manual", label: "Manual (guided prompts)" },
      { value: "quick", label: "Quick (sensible defaults)" },
    ],
    face,
    "manual",
  );
  const workspacePrompt = "What do you want to set up? (default: ./)";

  const defaultRoot = options.dir;
  let selectedDir = defaultRoot;
  if (options.dirExplicit || onboardingMode == "quick") {
    selectedDir = options.dir;
  } else {
    const defaultDisplay = defaultRoot == "." ? "./" : defaultRoot;
    const enteredDir = (
      await ask(
        `${chalk.bold.blue(`◇  ${workspacePrompt}`)}\n│  `,
        face,
        defaultDisplay,
      )
    ).trim();
    selectedDir = enteredDir.length ? enteredDir : defaultRoot;
  }
  const resolvedRoot = path.resolve(process.cwd(), selectedDir);
  if (options.dirExplicit || onboardingMode == "quick") {
    printPromptAndSelectionLine(workspacePrompt, resolvedRoot);
  } else {
    printSelectionLine(resolvedRoot);
  }

  const target: Target =
    options.target ??
    (onboardingMode == "quick"
      ? "wasi"
      : await askMenuChoice(
          "Build target",
          [
            {
              value: "wasi",
              label:
                "wasi (default runner: node .as-test/runners/default.wasi.js)",
            },
            {
              value: "bindings",
              label:
                "bindings (default runner: node .as-test/runners/default.bindings.js)",
            },
            {
              value: "web",
              label:
                "web (default runner: node .as-test/runners/default.web.js)",
            },
          ],
          face,
          "wasi",
        ));
  if (options.target || onboardingMode == "quick") {
    printPromptAndSelectionLine("Build target", target);
  }

  const featureDefaults: FeatureSelection = { coverage: false, tryAs: false };
  const explicitFeatures =
    options.features.coverage !== undefined ||
    options.features.tryAs !== undefined;
  const features: FeatureSelection =
    explicitFeatures || onboardingMode == "quick"
      ? resolveFeatures(options.features, featureDefaults)
      : await askMultiToggle(
          "Features (↑/↓ to move, space to toggle, enter to confirm)",
          FEATURE_KEYS.map((key) => ({
            value: key,
            label: FEATURE_LABELS[key],
          })),
          face,
          resolveFeatures(options.features, featureDefaults),
        );
  if (explicitFeatures || onboardingMode == "quick") {
    printPromptAndSelectionLine("Features", formatFeatureSelection(features));
  }

  const example: ExampleMode =
    options.example ??
    (onboardingMode == "quick"
      ? "minimal"
      : await askMenuChoice(
          "Example template",
          [
            { value: "minimal", label: "minimal (one short starter spec)" },
            { value: "full", label: "full (hooks, assertions, logs, suites)" },
            { value: "none", label: "none (config/runners only)" },
          ],
          face,
          "minimal",
        ));
  if (options.example || onboardingMode == "quick") {
    printPromptAndSelectionLine("Example template", example);
  }

  const fuzzExample =
    options.fuzzExample ??
    (onboardingMode == "quick"
      ? false
      : await askYesNo("Add a basic fuzzer example?", face, false));
  if (options.fuzzExample !== undefined || onboardingMode == "quick") {
    printPromptAndSelectionLine(
      "Add a basic fuzzer example?",
      fuzzExample ? "Yes" : "No",
    );
  }

  const installDependenciesNow =
    options.install ??
    (onboardingMode == "quick"
      ? false
      : await askYesNo("Install dependencies now?", face, false));
  if (options.install !== undefined || onboardingMode == "quick") {
    printPromptAndSelectionLine(
      "Install dependencies now?",
      installDependenciesNow ? "Yes" : "No",
    );
  }

  return {
    root: resolvedRoot,
    target,
    example,
    fuzzExample,
    features,
    installDependenciesNow,
  };
}

function formatFeatureSelection(features: FeatureSelection): string {
  const labels: string[] = [];
  if (features.coverage) labels.push("coverage");
  if (features.tryAs) labels.push("try-as");
  return labels.length ? labels.join(", ") : "none";
}

function printOnboardingHeader(): void {
  // console.log(
  //   chalk.bold.cyan(
  //     `as-test ${getCliVersion()} — AssemblyScript testing without runtime guesswork.`,
  //   ) + "\n",
  // );
}

function printOnboardingIntro(): void {
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

function printPromptAndSelectionLine(prompt: string, answer: string): void {
  console.log(chalk.bold.blue(`◇  ${prompt}`));
  printSelectionLine(answer);
}

function printSelectionLine(answer: string): void {
  console.log(`│  ${chalk.gray(answer)}`);
  console.log("│");
}

function parseTarget(value: string): Target {
  if (!isTarget(value)) {
    throw new Error(`Invalid target "${value}". Expected wasi|bindings|web`);
  }
  return value;
}

function parseExampleMode(value: string): ExampleMode {
  if (!isExampleMode(value)) {
    throw new Error(
      `Invalid example mode "${value}". Expected minimal|full|none`,
    );
  }
  return value;
}

function isTarget(value: string): value is Target {
  return TARGETS.includes(value as Target);
}

function isExampleMode(value: string): value is ExampleMode {
  return EXAMPLE_MODES.includes(value as ExampleMode);
}

function printPlan(
  root: string,
  target: Target,
  example: ExampleMode,
  fuzzExample: boolean,
  features: FeatureSelection,
  install: boolean,
): void {
  type TreeEntry = {
    path: string;
    isDir: boolean;
  };
  type TreeNode = {
    name: string;
    relPath: string;
    isDir: boolean;
    children: TreeNode[];
  };

  const displayRoot = (): string => {
    const rel = path.relative(process.cwd(), root).split(path.sep).join("/");
    if (!rel || rel == ".") return "./";
    if (rel.startsWith("..")) return rel;
    return `./${rel}`;
  };
  const statusColor = (relPath: string) =>
    existsSync(path.join(root, relPath)) ? chalk.hex("#d29922") : chalk.green;
  const paintNode = (node: TreeNode): string =>
    statusColor(node.relPath)(node.isDir ? `${node.name}/` : node.name);
  const ensureChild = (
    parent: TreeNode,
    name: string,
    relPath: string,
    isDir: boolean,
  ): TreeNode => {
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
  const buildTree = (entries: readonly TreeEntry[]): TreeNode => {
    const rootNode: TreeNode = {
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
        const part = parts[i]!;
        relPath = relPath ? `${relPath}/${part}` : part;
        const isLeaf = i == parts.length - 1;
        cursor = ensureChild(
          cursor,
          part,
          relPath,
          isLeaf ? entry.isDir : true,
        );
      }
    }
    return rootNode;
  };
  const renderBranch = (nodes: readonly TreeNode[], prefix: string): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
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

  const fileEntries: TreeEntry[] = [
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
      path: ".as-test/runners/default.wasi.js",
      isDir: false,
    });
    fileEntries.push({
      path: ".as-test/runners/default.web.js",
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
  console.log(
    "│" + chalk.dim(`  - Fuzzer example: ${fuzzExample ? "yes" : "no"}`),
  );
  console.log(
    "│" + chalk.dim(`  - Features: ${formatFeatureSelection(features)}`),
  );
  console.log("│" + chalk.dim(`  - Directory: ${displayRoot()}`));
  console.log(
    "│" + chalk.dim(`  - Install dependencies: ${install ? "yes" : "no"}`),
  );
  console.log("│" + chalk.bold.blue("  File Changes"));
  for (const topLevelNode of treeRoot.children) {
    console.log(`│  ${paintNode(topLevelNode)}`);
    renderBranch(topLevelNode.children, "");
  }
  console.log("│");
}

function applyInit(
  root: string,
  target: Target,
  example: ExampleMode,
  fuzzExample: boolean,
  features: FeatureSelection,
  force: boolean,
): ApplySummary {
  const summary: ApplySummary = {
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

  writeJson(
    path.join(root, "assembly/tsconfig.json"),
    buildAssemblyTsconfig(),
    summary,
    "assembly/tsconfig.json",
  );

  const featuresArray: string[] = [];
  if (features.tryAs) featuresArray.push("try-as");

  const configPath = path.join(root, "as-test.config.json");
  const config = {
    $schema: "node_modules/as-test/as-test.config.schema.json",
    input: ["assembly/__tests__/*.spec.ts"],
    output: ".as-test/",
    config: "none",
    coverage: features.coverage,
    features: featuresArray,
    env: {},
    ...(fuzzExample
      ? {
          fuzz: {
            input: ["assembly/__fuzz__/*.fuzz.ts"],
            runs: 1000,
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
        cmd:
          target == "wasi"
            ? "node .as-test/runners/default.wasi.js"
            : target == "bindings"
              ? "node .as-test/runners/default.bindings.js"
              : "node .as-test/runners/default.web.js",
      },
      reporter: "default",
    },
    modes:
      target == "web"
        ? {
            web: {
              default: false,
              runOptions: {
                runtime: {
                  cmd: "node .as-test/runners/default.web.js",
                },
              },
            },
            "web-headless": {
              default: false,
              runOptions: {
                runtime: {
                  cmd: "node .as-test/runners/default.web.js --headless",
                },
              },
            },
          }
        : {},
  };
  writeJson(configPath, config, summary, "as-test.config.json");

  if (example != "none") {
    const examplePath = path.join(root, "assembly/__tests__/example.spec.ts");
    const content =
      example == "minimal" ? buildMinimalExampleSpec() : buildFullExampleSpec();
    writeManagedFile(
      examplePath,
      content,
      force,
      summary,
      "assembly/__tests__/example.spec.ts",
    );
  }

  if (fuzzExample) {
    const fuzzPath = path.join(root, "assembly/__fuzz__/example.fuzz.ts");
    writeManagedFile(
      fuzzPath,
      buildBasicFuzzerExample(),
      force,
      summary,
      "assembly/__fuzz__/example.fuzz.ts",
    );
  }

  if (target == "wasi" || target == "bindings" || target == "web") {
    const runnerPath = path.join(root, ".as-test/runners/default.wasi.js");
    writeManagedFile(
      runnerPath,
      buildWasiRunner(),
      force,
      summary,
      ".as-test/runners/default.wasi.js",
    );
  }

  if (target == "wasi" || target == "bindings" || target == "web") {
    const runnerPath = path.join(root, ".as-test/runners/default.bindings.js");
    writeManagedFile(
      runnerPath,
      buildBindingsRunner(),
      force,
      summary,
      ".as-test/runners/default.bindings.js",
    );
  }

  if (target == "wasi" || target == "bindings" || target == "web") {
    const runnerPath = path.join(root, ".as-test/runners/default.web.js");
    writeManagedFile(
      runnerPath,
      buildWebRunnerSource(),
      force,
      summary,
      ".as-test/runners/default.web.js",
    );
  }

  const pkgPath = path.join(root, "package.json");
  const pkg = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>)
    : ({} as Record<string, unknown>);

  if (!pkg.scripts || typeof pkg.scripts != "object") {
    pkg.scripts = {};
  }
  const scripts = pkg.scripts as Record<string, string>;
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
  const devDependencies = pkg.devDependencies as Record<string, string>;
  if (!devDependencies["as-test"]) {
    devDependencies["as-test"] = "^" + getCliVersion();
  }
  if (!hasDependency(pkg, "assemblyscript")) {
    devDependencies["assemblyscript"] = "^0.28.9";
  }
  if (target == "wasi" && !devDependencies["@assemblyscript/wasi-shim"]) {
    devDependencies["@assemblyscript/wasi-shim"] = "^0.1.0";
  }
  if (features.tryAs && !hasDependency(pkg, "try-as")) {
    devDependencies["try-as"] = "^1.1.0";
  }
  if (target == "bindings" && !pkg.type) {
    pkg.type = "module";
  }

  writeJson(pkgPath, pkg, summary, "package.json");
  return summary;
}

function hasDependency(
  pkg: Record<string, unknown>,
  dependency: string,
): boolean {
  const sections = ["dependencies", "devDependencies", "peerDependencies"];
  for (const section of sections) {
    const value = pkg[section];
    if (!value || typeof value != "object" || Array.isArray(value)) continue;
    if (dependency in (value as Record<string, unknown>)) return true;
  }
  return false;
}

function ensureDir(root: string, rel: string, summary: ApplySummary): void {
  const full = path.join(root, rel);
  if (existsSync(full)) return;
  mkdirSync(full, { recursive: true });
  summary.created.push(rel + "/");
}

function ensureGitignoreIncludesAsTestDirs(
  root: string,
  summary: ApplySummary,
): void {
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
  const missing = entries.filter(
    (entry) => !lines.some((line) => line.trim() == entry),
  );
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
  if (existed) summary.updated.push(rel);
  else summary.created.push(rel);
}

function buildAssemblyTsconfig(): Record<string, unknown> {
  return {
    extends: "assemblyscript/std/assembly.json",
    include: ["./**/*.ts"],
  };
}

function writeJson(
  fullPath: string,
  value: unknown,
  summary: ApplySummary,
  displayPath?: string,
): void {
  const rel =
    displayPath ??
    path.relative(process.cwd(), fullPath) ??
    path.basename(fullPath);
  const existed = existsSync(fullPath);
  const data = JSON.stringify(value, null, 2) + "\n";
  writeFileSync(fullPath, data);
  if (existed) summary.updated.push(rel);
  else summary.created.push(rel);
}

function writeManagedFile(
  fullPath: string,
  data: string,
  force: boolean,
  summary: ApplySummary,
  displayPath?: string,
): void {
  const rel =
    displayPath ??
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
  if (existed) summary.updated.push(rel);
  else summary.created.push(rel);
}

function printSummary(summary: ApplySummary): void {
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

function ask(
  question: string,
  face: Interface | null,
  initialValue?: string,
): Promise<string> {
  if (!face) {
    throw new Error(
      "interactive input is unavailable; pass --yes with options",
    );
  }
  return new Promise<string>((res) => {
    face.question(question, (answer) => {
      const stdout = process.stdout as NodeJS.WriteStream;
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

async function askChoice<T extends string>(
  label: string,
  choices: readonly T[],
  face: Interface | null,
  fallback: T,
): Promise<T> {
  if (!face) {
    return fallback;
  }
  const answer = (
    await ask(
      `${label} [${choices.join("/")}] (${fallback}) -> `,
      face,
      fallback,
    )
  )
    .trim()
    .toLowerCase();
  if (!answer.length) return fallback;
  if (choices.includes(answer as T)) return answer as T;
  throw new Error(`Invalid choice "${answer}" for ${label}`);
}

async function askMenuChoice<T extends string>(
  label: string,
  choices: readonly MenuOption<T>[],
  face: Interface | null,
  fallback: T,
): Promise<T> {
  const fallbackValue = choices.some((choice) => choice.value == fallback)
    ? fallback
    : choices[0]!.value;
  if (!face) return fallbackValue;
  if (!canUseArrowMenu(face)) {
    const values = choices.map((choice) => choice.value) as T[];
    return askChoice(label, values, face, fallbackValue);
  }
  return askMenuChoiceWithArrows(label, choices, face, fallbackValue);
}

async function askMultiToggle<T extends string>(
  label: string,
  choices: readonly ToggleOption<T>[],
  face: Interface | null,
  initial: Record<T, boolean>,
): Promise<Record<T, boolean>> {
  if (!face) return { ...initial };
  if (canUseArrowMenu(face)) {
    return askMultiToggleWithArrows(label, choices, face, initial);
  }
  const result: Record<string, boolean> = { ...initial };
  for (const choice of choices) {
    result[choice.value] = await askYesNo(
      `${label} — enable ${choice.label}?`,
      face,
      initial[choice.value],
    );
  }
  return result as Record<T, boolean>;
}

async function askYesNo(
  label: string,
  face: Interface | null,
  fallback: boolean,
): Promise<boolean> {
  if (!face) return fallback;
  if (canUseArrowMenu(face)) {
    const selected = await askMenuChoice(
      label,
      [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      face,
      fallback ? "yes" : "no",
    );
    return selected == "yes";
  }
  const suffix = fallback ? "[Y/n]" : "[y/N]";
  const defaultValue = fallback ? "yes" : "no";
  const answer = (await ask(`${label} ${suffix} `, face, defaultValue))
    .trim()
    .toLowerCase();
  if (!answer.length) return fallback;
  if (answer == "y" || answer == "yes") return true;
  if (answer == "n" || answer == "no") return false;
  throw new Error(`Invalid answer "${answer}". Expected yes or no.`);
}

function canUseArrowMenu(face: Interface | null): boolean {
  if (!face) return false;
  const stdin = process.stdin as NodeJS.ReadStream;
  const stdout = process.stdout as NodeJS.WriteStream;
  return (
    Boolean(stdin.isTTY) &&
    Boolean(stdout.isTTY) &&
    typeof stdin.setRawMode == "function"
  );
}

async function askMenuChoiceWithArrows<T extends string>(
  label: string,
  choices: readonly MenuOption<T>[],
  face: Interface,
  fallback: T,
): Promise<T> {
  const stdin = process.stdin as NodeJS.ReadStream;
  const stdout = process.stdout as NodeJS.WriteStream;
  const fallbackIndex = choices.findIndex((choice) => choice.value == fallback);
  let selectedIndex = fallbackIndex == -1 ? 0 : fallbackIndex;
  let renderedLineCount = 0;
  const previousRawMode = Boolean((stdin as { isRaw?: boolean }).isRaw);
  const lineWidth = Math.max(20, (stdout.columns ?? 80) - 2);

  const clamp = (value: string, max: number): string => {
    if (value.length <= max) return value;
    if (max <= 1) return value.slice(0, max);
    return `${value.slice(0, max - 1)}…`;
  };

  const titleLine = (): string =>
    chalk.bold.blue(`◆  ${clamp(label, Math.max(8, lineWidth - 3))}`);

  const menuLines = (): string[] => {
    const lines: string[] = [titleLine()];
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i]!;
      const marker = i == selectedIndex ? chalk.blue("●") : chalk.dim("○");
      lines.push(
        `│  ${marker} ${clamp(choice.label, Math.max(8, lineWidth - 6))}`,
      );
    }
    lines.push("│");
    return lines;
  };

  const collapsedLines = (): string[] => {
    const selected = choices[selectedIndex]!;
    return [
      `│  ${chalk.gray(clamp(selected.label, Math.max(8, lineWidth - 4)))}`,
    ];
  };

  const writeLines = (lines: string[], collapse: boolean = false): void => {
    if (renderedLineCount > 0) {
      process.stdout.write(`\x1b[${renderedLineCount}A`);
    }
    const totalLineCount = Math.max(lines.length, renderedLineCount);
    for (let i = 0; i < totalLineCount; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < lines.length) {
        process.stdout.write(lines[i]!);
      }
      process.stdout.write("\n");
    }
    renderedLineCount = lines.length;
    if (collapse) {
      renderedLineCount = 0;
    }
  };

  const collapseInPlace = (): void => {
    const lines = collapsedLines();
    if (renderedLineCount > 0) {
      process.stdout.write(`\x1b[${renderedLineCount}A`);
    }
    const totalLineCount = Math.max(renderedLineCount, lines.length);
    for (let i = 0; i < totalLineCount; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < lines.length) {
        process.stdout.write(lines[i]!);
      }
      process.stdout.write("\n");
    }
    const extraLines = totalLineCount - lines.length;
    if (extraLines > 0) {
      process.stdout.write(`\x1b[${extraLines}A`);
    }
    renderedLineCount = 0;
  };

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(previousRawMode);
      }
      const isClosed = Boolean((face as { closed?: boolean }).closed);
      if (!isClosed) {
        try {
          face.resume();
        } catch {
          // noop: readline may already be closed during shutdown/cancel paths.
        }
      }
    };

    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      collapseInPlace();
      cleanup();
      resolve(value);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string): void => {
      const input = typeof chunk == "string" ? chunk : chunk.toString("utf8");
      if (!input.length) return;

      if (input == "\u0003") {
        fail(new Error(chalk.bold.red("◆  Cancelled")));
        return;
      }
      if (
        input == "\x1b[A" ||
        input == "\x1bOA" ||
        input == "\x1b[D" ||
        input == "\x1bOD"
      ) {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        writeLines(menuLines());
        return;
      }
      if (
        input == "\x1b[B" ||
        input == "\x1bOB" ||
        input == "\x1b[C" ||
        input == "\x1bOC"
      ) {
        selectedIndex = (selectedIndex + 1) % choices.length;
        writeLines(menuLines());
        return;
      }
      if (input == "\r" || input == "\n") {
        finish(choices[selectedIndex]!.value);
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

async function askMultiToggleWithArrows<T extends string>(
  label: string,
  choices: readonly ToggleOption<T>[],
  face: Interface,
  initial: Record<T, boolean>,
): Promise<Record<T, boolean>> {
  const stdin = process.stdin as NodeJS.ReadStream;
  const stdout = process.stdout as NodeJS.WriteStream;
  const selected: Record<string, boolean> = { ...initial };
  let cursorIndex = 0;
  let renderedLineCount = 0;
  const previousRawMode = Boolean((stdin as { isRaw?: boolean }).isRaw);
  const lineWidth = Math.max(20, (stdout.columns ?? 80) - 2);

  const clamp = (value: string, max: number): string => {
    if (value.length <= max) return value;
    if (max <= 1) return value.slice(0, max);
    return `${value.slice(0, max - 1)}…`;
  };

  const titleLine = (): string =>
    chalk.bold.blue(`◆  ${clamp(label, Math.max(8, lineWidth - 3))}`);

  const menuLines = (): string[] => {
    const lines: string[] = [titleLine()];
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i]!;
      const isOn = Boolean(selected[choice.value]);
      const cursor = i == cursorIndex ? chalk.blue("›") : " ";
      const marker = isOn ? chalk.blue("●") : chalk.dim("○");
      const text = clamp(choice.label, Math.max(8, lineWidth - 6));
      const painted = i == cursorIndex ? chalk.bold(text) : text;
      lines.push(`│  ${cursor} ${marker} ${painted}`);
    }
    lines.push("│");
    return lines;
  };

  const collapsedLines = (): string[] => {
    const enabled = choices
      .filter((choice) => selected[choice.value])
      .map((choice) => choice.value);
    const summary = enabled.length ? enabled.join(", ") : "none";
    return [`│  ${chalk.gray(clamp(summary, Math.max(8, lineWidth - 4)))}`];
  };

  const writeLines = (lines: string[]): void => {
    if (renderedLineCount > 0) {
      process.stdout.write(`\x1b[${renderedLineCount}A`);
    }
    const totalLineCount = Math.max(lines.length, renderedLineCount);
    for (let i = 0; i < totalLineCount; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < lines.length) {
        process.stdout.write(lines[i]!);
      }
      process.stdout.write("\n");
    }
    renderedLineCount = lines.length;
  };

  const collapseInPlace = (): void => {
    const lines = collapsedLines();
    if (renderedLineCount > 0) {
      process.stdout.write(`\x1b[${renderedLineCount}A`);
    }
    const totalLineCount = Math.max(renderedLineCount, lines.length);
    for (let i = 0; i < totalLineCount; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < lines.length) {
        process.stdout.write(lines[i]!);
      }
      process.stdout.write("\n");
    }
    const extraLines = totalLineCount - lines.length;
    if (extraLines > 0) {
      process.stdout.write(`\x1b[${extraLines}A`);
    }
    renderedLineCount = 0;
  };

  return new Promise<Record<T, boolean>>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(previousRawMode);
      }
      const isClosed = Boolean((face as { closed?: boolean }).closed);
      if (!isClosed) {
        try {
          face.resume();
        } catch {
          // noop: readline may already be closed during shutdown/cancel paths.
        }
      }
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      collapseInPlace();
      cleanup();
      resolve(selected as Record<T, boolean>);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string): void => {
      const input = typeof chunk == "string" ? chunk : chunk.toString("utf8");
      if (!input.length) return;

      if (input == "\u0003") {
        fail(new Error(chalk.bold.red("◆  Cancelled")));
        return;
      }
      if (input == "\x1b[A" || input == "\x1bOA") {
        cursorIndex = (cursorIndex - 1 + choices.length) % choices.length;
        writeLines(menuLines());
        return;
      }
      if (input == "\x1b[B" || input == "\x1bOB") {
        cursorIndex = (cursorIndex + 1) % choices.length;
        writeLines(menuLines());
        return;
      }
      if (input == " ") {
        const key = choices[cursorIndex]!.value;
        selected[key] = !selected[key];
        writeLines(menuLines());
        return;
      }
      if (input == "\r" || input == "\n") {
        finish();
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

function installDependencies(root: string): void {
  const install = resolveInstallCommand(root);
  console.log(
    "\n" +
      chalk.dim(
        `Installing dependencies with: ${install.command} ${install.args.join(" ")}`,
      ),
  );
  const child = spawnSync(install.command, install.args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform == "win32",
  });
  if (child.error) {
    throw new Error(`failed to run dependency install: ${child.error.message}`);
  }
  if (child.status !== 0) {
    throw new Error(
      `dependency installation failed with exit code ${String(child.status)}`,
    );
  }
}

function resolveInstallCommand(root: string): {
  command: string;
  args: string[];
} {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return { command: "pnpm", args: ["install"] };
  }
  if (existsSync(path.join(root, "yarn.lock"))) {
    return { command: "yarn", args: ["install"] };
  }
  if (
    existsSync(path.join(root, "bun.lockb")) ||
    existsSync(path.join(root, "bun.lock"))
  ) {
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

function buildMinimalExampleSpec(): string {
  return `import { describe, expect, test } from "as-test";

describe("example", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });
});
`;
}

function buildFullExampleSpec(): string {
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

function buildBasicFuzzerExample(): string {
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

function buildWasiRunner(): string {
  return `import { instantiate } from "as-test/lib";

const imports = {};

instantiate(imports)
  .then((instance) => {
    instance.exports.start?.();
    // Add extra startup logic here when needed.
  })
  .catch((error) => {
    throw new Error("Failed to run WASI module: " + String(error));
  });
`;
}

function buildBindingsRunner(): string {
  return `import { instantiate } from "as-test/lib";

const imports = {};

instantiate(imports)
  .then((instance) => {
    instance.exports.start?.();
    // Add extra startup logic here when needed.
  })
  .catch((error) => {
    throw new Error("Failed to run bindings module: " + String(error));
  });
`;
}
