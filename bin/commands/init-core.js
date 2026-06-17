import chalk from "chalk";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { getCliVersion, getExec } from "../util.js";
import { buildWebRunnerSource } from "./web-runner-source.js";
const TARGETS = ["wasi", "bindings", "web"];
// Popular runtimes offered by the interactive picker. Availability is probed
// against the machine/project (PATH for native binaries, node_modules for
// Playwright) so unavailable entries can be dimmed rather than hidden.
const RUNTIMES = [
  {
    value: "node:wasi",
    label: "Node.js",
    target: "wasi",
    cmd: "node .as-test/runners/default.wasi.js",
    browser: "",
  },
  {
    value: "node:bindings",
    label: "Node.js",
    target: "bindings",
    cmd: "node .as-test/runners/default.bindings.js",
    browser: "",
  },
  {
    value: "wasmtime",
    label: "Wasmtime",
    target: "wasi",
    cmd: "wasmtime run <file>",
    browser: "",
    bin: "wasmtime",
  },
  {
    value: "wasmer",
    label: "Wasmer",
    target: "wasi",
    cmd: "wasmer run <file>",
    browser: "",
    bin: "wasmer",
  },
  {
    value: "wazero",
    label: "wazero",
    target: "wasi",
    cmd: "wazero run <file>",
    browser: "",
    bin: "wazero",
  },
  {
    value: "chromium",
    label: "Chromium",
    target: "web",
    cmd: "node .as-test/runners/default.web.js",
    browser: "chromium",
    needsPlaywright: true,
  },
  {
    value: "firefox",
    label: "Firefox",
    target: "web",
    cmd: "node .as-test/runners/default.web.js",
    browser: "firefox",
    needsPlaywright: true,
  },
  {
    value: "webkit",
    label: "WebKit",
    target: "web",
    cmd: "node .as-test/runners/default.web.js",
    browser: "webkit",
    needsPlaywright: true,
  },
];
// Probe whether a runtime is usable on this machine/project. Node-based
// runtimes are always available (we are running under Node); native binaries
// must resolve on PATH; browser runtimes require Playwright to be installed.
function probeRuntime(runtime, root) {
  if (runtime.bin) {
    if (getExec(runtime.bin)) return { available: true };
    return { available: false, hint: `${runtime.bin} not on PATH` };
  }
  if (runtime.needsPlaywright) {
    const pkg = path.join(root, "node_modules", "playwright", "package.json");
    if (existsSync(pkg)) return { available: true };
    return { available: false, hint: "playwright not installed" };
  }
  return { available: true };
}
// The default runtime command for a build target, matching the long-standing
// `--target`/`--yes` behaviour (plain Node runner, no browser).
function runtimeForTarget(target) {
  const cmd =
    target == "wasi"
      ? "node .as-test/runners/default.wasi.js"
      : target == "bindings"
        ? "node .as-test/runners/default.bindings.js"
        : "node .as-test/runners/default.web.js";
  return { cmd, browser: "" };
}
function defaultRuntimeLabel(target) {
  if (target == "wasi") return "node:wasi";
  if (target == "bindings") return "node:bindings";
  return "web";
}
// Ensure a mode key is unique against names already in use, suffixing -2, -3…
function uniqueModeName(name, taken) {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
// Prompt for a user-defined runtime: a command (with optional <file>
// placeholder), a mode name, and — for the web target — an optional browser.
// Returns null if no command is entered or interactive input is unavailable.
async function askCustomRuntime(target, face, taken) {
  if (!face) return null;
  const cmd = (
    await ask(
      `${chalk.bold.blue("◇  Custom runtime command")}\n` +
        `${chalk.dim("│  <file> is replaced with the generated .wasm — e.g. wasmtime <file>")}\n│  `,
      face,
      "",
    )
  ).trim();
  if (!cmd.length) return null;
  const rawName = (
    await ask(
      `${chalk.bold.blue("◇  Name for this runtime (used as the mode key, default: custom)")}\n│  `,
      face,
      "",
    )
  ).trim();
  const name = uniqueModeName(rawName.length ? rawName : "custom", taken);
  let browser = "";
  if (target == "web") {
    browser = (
      await ask(
        `${chalk.bold.blue("◇  Browser (optional: chromium / firefox / webkit)")}\n│  `,
        face,
        "",
      )
    ).trim();
  }
  printSelectionLine(`${name}: ${cmd}${browser ? ` (${browser})` : ""}`);
  return { value: name, target, cmd, browser };
}
// Turn the selected runtimes into config `modes` — one named mode per runtime,
// each carrying its build target and runtime command. Every mode runs by
// default (the absent `default` flag defaults to true), so `ast test` executes
// them all.
function buildRuntimeModes(selected) {
  const modes = {};
  for (const rt of selected) {
    modes[rt.value] = {
      buildOptions: { target: rt.target },
      runOptions: {
        runtime: {
          cmd: rt.cmd,
          ...(rt.browser ? { browser: rt.browser } : {}),
        },
      },
    };
  }
  return modes;
}
const EXAMPLE_MODES = ["minimal", "full", "none"];
const FEATURE_KEYS = ["coverage", "tryAs"];
const FEATURE_LABELS = {
  coverage: "coverage (runtime coverage points + report)",
  tryAs:
    "try-as (try/catch/finally + toThrow assertions + throwable rewriting)",
};
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
          runtime: runtimeForTarget(options.target ?? "wasi"),
          modes: {},
          runtimeLabel: defaultRuntimeLabel(options.target ?? "wasi"),
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
      answers.runtimeLabel,
      Object.keys(answers.modes),
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
      answers.runtime,
      answers.modes,
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
function parseInitArgs(rawArgs) {
  const options = {
    features: {},
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
    options.dir = positional.shift();
    options.dirExplicit = true;
  }
  if (!options.target && positional.length > 0 && isTarget(positional[0])) {
    options.target = positional.shift();
  }
  if (
    !options.example &&
    positional.length > 0 &&
    isExampleMode(positional[0])
  ) {
    options.example = positional.shift();
  }
  if (positional.length > 0) {
    throw new Error(
      `Unknown init argument(s): ${positional.join(", ")}. Usage: init [dir] [--target wasi|bindings|web] [--example minimal|full|none] [--fuzz-example|--no-fuzz-example] [--enable coverage|try-as] [--disable coverage|try-as] [--install] [--yes] [--force] [--dir <path>]`,
    );
  }
  return options;
}
function splitInitFeatureList(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
function applyInitFeatureToggle(out, rawFeature, enabled) {
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
function resolveFeatures(overrides, defaults) {
  return {
    coverage: overrides.coverage ?? defaults.coverage,
    tryAs: overrides.tryAs ?? defaults.tryAs,
  };
}
async function runInteractiveOnboarding(options, face) {
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
  // Step 1: pick the build target (mode). The runtime list is then filtered to
  // the runtimes that support this target.
  const target =
    options.target ??
    (onboardingMode == "quick"
      ? "wasi"
      : await askMenuChoice(
          "Build target",
          [
            { value: "wasi", label: "wasi (WebAssembly System Interface)" },
            { value: "bindings", label: "bindings (Node.js host bindings)" },
            { value: "web", label: "web (browser via Playwright)" },
          ],
          face,
          "wasi",
        ));
  if (options.target || onboardingMode == "quick") {
    printPromptAndSelectionLine("Build target", target);
  }
  // Step 2: pick one or more runtimes, scoped to the chosen target. Unavailable
  // runtimes (native binary missing from PATH, or Playwright not installed) are
  // dimmed; "Custom…" lets the user define their own. Each chosen runtime
  // becomes a config mode so `ast test` runs the whole matrix.
  let runtime;
  let runtimeLabel;
  let modes = {};
  const targetRuntimes = RUNTIMES.filter((rt) => rt.target == target);
  if (options.target || onboardingMode == "quick") {
    // Flag/quick runs are non-interactive: keep the historical Node default.
    runtime = runtimeForTarget(target);
    runtimeLabel = defaultRuntimeLabel(target);
    printPromptAndSelectionLine("Runtime", runtimeLabel);
  } else {
    const toggleChoices = targetRuntimes.map((rt) => {
      const status = probeRuntime(rt, resolvedRoot);
      return {
        value: rt.value,
        label: rt.label,
        disabled: !status.available,
        hint: status.hint,
      };
    });
    toggleChoices.push({
      value: "custom",
      label: "Custom…",
      alwaysSelectable: true,
    });
    // Pre-select the first available built-in runtime so confirming immediately
    // yields a sensible single choice.
    const firstAvailable =
      targetRuntimes.find((rt) => probeRuntime(rt, resolvedRoot).available)
        ?.value ?? targetRuntimes[0].value;
    const initial = {};
    for (const choice of toggleChoices) {
      initial[choice.value] = choice.value == firstAvailable;
    }
    const result = await askMultiToggle(
      "Runtimes (↑/↓ move, space toggle, enter confirm — dimmed = not detected)",
      toggleChoices,
      face,
      initial,
    );
    const selected = targetRuntimes.filter((rt) => result[rt.value]);
    if (result["custom"]) {
      const custom = await askCustomRuntime(
        target,
        face,
        selected.map((rt) => rt.value),
      );
      if (custom) selected.push(custom);
    }
    if (!selected.length) {
      // Confirming with nothing selected falls back to the default runtime.
      const fallback =
        targetRuntimes.find((rt) => rt.value == firstAvailable) ??
        targetRuntimes[0];
      selected.push(fallback);
    }
    const primary = selected[0];
    runtime = { cmd: primary.cmd, browser: primary.browser };
    runtimeLabel = selected.map((rt) => rt.value).join(", ");
    // The picker is authoritative: write a mode per chosen runtime so the
    // exact selection (single, matrix, or custom) is what `ast test` runs.
    modes = buildRuntimeModes(selected);
  }
  const featureDefaults = { coverage: false, tryAs: false };
  const explicitFeatures =
    options.features.coverage !== undefined ||
    options.features.tryAs !== undefined;
  const features =
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
  const example =
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
    runtime,
    modes,
    runtimeLabel,
    example,
    fuzzExample,
    features,
    installDependenciesNow,
  };
}
function formatFeatureSelection(features) {
  const labels = [];
  if (features.coverage) labels.push("coverage");
  if (features.tryAs) labels.push("try-as");
  return labels.length ? labels.join(", ") : "none";
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
    throw new Error(
      `Invalid example mode "${value}". Expected minimal|full|none`,
    );
  }
  return value;
}
function isTarget(value) {
  return TARGETS.includes(value);
}
function isExampleMode(value) {
  return EXAMPLE_MODES.includes(value);
}
function printPlan(
  root,
  target,
  runtimeLabel,
  modeNames,
  example,
  fuzzExample,
  features,
  install,
) {
  const displayRoot = () => {
    const rel = path.relative(process.cwd(), root).split(path.sep).join("/");
    if (!rel || rel == ".") return "./";
    if (rel.startsWith("..")) return rel;
    return `./${rel}`;
  };
  const statusColor = (relPath) =>
    existsSync(path.join(root, relPath)) ? chalk.hex("#d29922") : chalk.green;
  const paintNode = (node) =>
    statusColor(node.relPath)(node.isDir ? `${node.name}/` : node.name);
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
  console.log(
    "│" +
      chalk.dim(
        `  - Runtime${runtimeLabel.includes(",") ? "s" : ""}: ${runtimeLabel}`,
      ),
  );
  if (modeNames.length) {
    console.log("│" + chalk.dim(`  - Modes: ${modeNames.join(", ")}`));
  }
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
  root,
  target,
  runtime,
  modes,
  example,
  fuzzExample,
  features,
  force,
) {
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
  writeJson(
    path.join(root, "assembly/tsconfig.json"),
    buildAssemblyTsconfig(),
    summary,
    "assembly/tsconfig.json",
  );
  const featuresArray = [];
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
        cmd: runtime.cmd,
        ...(runtime.browser ? { browser: runtime.browser } : {}),
      },
    },
    // The interactive picker supplies one mode per selected runtime. The
    // non-interactive paths (--yes/--target/quick) leave `modes` empty, so the
    // historical web convenience modes are scaffolded for the web target.
    modes: Object.keys(modes).length
      ? modes
      : target == "web"
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
  let pkg = {};
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `package.json is not valid JSON: ${pkgPath}\n  ${reason}`,
      );
    }
  }
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
  if (features.tryAs && !hasDependency(pkg, "try-as")) {
    devDependencies["try-as"] = "^1.1.0";
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
    if (!value || typeof value != "object" || Array.isArray(value)) continue;
    if (dependency in value) return true;
  }
  return false;
}
function ensureDir(root, rel, summary) {
  const full = path.join(root, rel);
  if (existsSync(full)) return;
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
function buildAssemblyTsconfig() {
  return {
    extends: "assemblyscript/std/assembly.json",
    include: ["./**/*.ts"],
  };
}
function writeJson(fullPath, value, summary, displayPath) {
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
function writeManagedFile(fullPath, data, force, summary, displayPath) {
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
    throw new Error(
      "interactive input is unavailable; pass --yes with options",
    );
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
  if (choices.includes(answer)) return answer;
  throw new Error(`Invalid choice "${answer}" for ${label}`);
}
async function askMenuChoice(label, choices, face, fallback) {
  const enabled = choices.filter((choice) => !choice.disabled);
  const pool = enabled.length ? enabled : choices;
  const fallbackValue = pool.some((choice) => choice.value == fallback)
    ? fallback
    : pool[0].value;
  if (!face) return fallbackValue;
  if (!canUseArrowMenu(face)) {
    const values = pool.map((choice) => choice.value);
    return askChoice(label, values, face, fallbackValue);
  }
  return askMenuChoiceWithArrows(label, choices, face, fallbackValue);
}
async function askMultiToggle(label, choices, face, initial) {
  if (!face) return { ...initial };
  if (canUseArrowMenu(face)) {
    return askMultiToggleWithArrows(label, choices, face, initial);
  }
  const result = { ...initial };
  const anySelectable = choices.some(
    (choice) => !choice.disabled && !choice.alwaysSelectable,
  );
  for (const choice of choices) {
    const selectable =
      Boolean(choice.alwaysSelectable) || !anySelectable || !choice.disabled;
    if (!selectable) {
      result[choice.value] = false;
      continue;
    }
    result[choice.value] = await askYesNo(
      `${label} — enable ${choice.label}?`,
      face,
      initial[choice.value],
    );
  }
  return result;
}
async function askYesNo(label, face, fallback) {
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
function canUseArrowMenu(face) {
  if (!face) return false;
  const stdin = process.stdin;
  const stdout = process.stdout;
  return (
    Boolean(stdin.isTTY) &&
    Boolean(stdout.isTTY) &&
    typeof stdin.setRawMode == "function"
  );
}
async function askMenuChoiceWithArrows(label, choices, face, fallback) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  // When nothing is selectable (e.g. every runtime for a target is dimmed
  // because its tooling isn't installed yet), fall back to letting the user
  // pick anyway — the dimming stays as an informational warning.
  const anySelectable = choices.some((choice) => !choice.disabled);
  const isSelectable = (index) => !anySelectable || !choices[index].disabled;
  const firstSelectable = choices.findIndex((_, i) => isSelectable(i));
  const fallbackIndex = choices.findIndex(
    (choice) => choice.value == fallback && !choice.disabled,
  );
  let selectedIndex =
    fallbackIndex != -1
      ? fallbackIndex
      : firstSelectable != -1
        ? firstSelectable
        : 0;
  // Step from `selectedIndex` in `step` direction (wrapping) to the next
  // selectable option, ignoring disabled entries. Returns the current index
  // unchanged if nothing else is selectable.
  const stepSelection = (step) => {
    for (let i = 1; i <= choices.length; i++) {
      const candidate =
        (selectedIndex + step * i + choices.length * i) % choices.length;
      if (isSelectable(candidate)) return candidate;
    }
    return selectedIndex;
  };
  let renderedLineCount = 0;
  const previousRawMode = Boolean(stdin.isRaw);
  const lineWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const clamp = (value, max) => {
    if (value.length <= max) return value;
    if (max <= 1) return value.slice(0, max);
    return `${value.slice(0, max - 1)}…`;
  };
  const titleLine = () =>
    chalk.bold.blue(`◆  ${clamp(label, Math.max(8, lineWidth - 3))}`);
  const menuLines = () => {
    const lines = [titleLine()];
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      if (choice.disabled) {
        const text = choice.hint
          ? `${choice.label} (${choice.hint})`
          : choice.label;
        lines.push(
          `│  ${chalk.dim("✕")} ${chalk.dim(clamp(text, Math.max(8, lineWidth - 6)))}`,
        );
        continue;
      }
      const marker = i == selectedIndex ? chalk.blue("●") : chalk.dim("○");
      lines.push(
        `│  ${marker} ${clamp(choice.label, Math.max(8, lineWidth - 6))}`,
      );
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
      process.stdout.write("\r\x1b[2K");
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
        } catch {
          // noop: readline may already be closed during shutdown/cancel paths.
        }
      }
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      collapseInPlace();
      cleanup();
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
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
        selectedIndex = stepSelection(-1);
        writeLines(menuLines());
        return;
      }
      if (
        input == "\x1b[B" ||
        input == "\x1bOB" ||
        input == "\x1b[C" ||
        input == "\x1bOC"
      ) {
        selectedIndex = stepSelection(1);
        writeLines(menuLines());
        return;
      }
      if (input == "\r" || input == "\n") {
        if (!isSelectable(selectedIndex)) return;
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
async function askMultiToggleWithArrows(label, choices, face, initial) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const selected = { ...initial };
  // When no "real" option is selectable (e.g. every browser is dimmed because
  // Playwright isn't installed yet — which init can fix), allow toggling the
  // dimmed entries anyway; the dimming stays as an informational warning. The
  // always-selectable Custom… entry is excluded from this decision.
  const anySelectable = choices.some(
    (choice) => !choice.disabled && !choice.alwaysSelectable,
  );
  const isSelectable = (index) => {
    const choice = choices[index];
    return (
      Boolean(choice.alwaysSelectable) || !anySelectable || !choice.disabled
    );
  };
  const stepCursor = (step) => {
    for (let i = 1; i <= choices.length; i++) {
      const candidate =
        (cursorIndex + step * i + choices.length * i) % choices.length;
      if (isSelectable(candidate)) return candidate;
    }
    return cursorIndex;
  };
  let cursorIndex = choices.findIndex((_, i) => isSelectable(i));
  if (cursorIndex == -1) cursorIndex = 0;
  let renderedLineCount = 0;
  const previousRawMode = Boolean(stdin.isRaw);
  const lineWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const clamp = (value, max) => {
    if (value.length <= max) return value;
    if (max <= 1) return value.slice(0, max);
    return `${value.slice(0, max - 1)}…`;
  };
  const titleLine = () =>
    chalk.bold.blue(`◆  ${clamp(label, Math.max(8, lineWidth - 3))}`);
  const menuLines = () => {
    const lines = [titleLine()];
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const isOn = Boolean(selected[choice.value]);
      const cursor = i == cursorIndex ? chalk.blue("›") : " ";
      if (choice.disabled) {
        const text = choice.hint
          ? `${choice.label} (${choice.hint})`
          : choice.label;
        const dimmed = chalk.dim(clamp(text, Math.max(8, lineWidth - 8)));
        // Selectable-but-dimmed (installable) keeps its ●/○; hard-blocked uses ✕.
        const marker = isSelectable(i)
          ? isOn
            ? chalk.blue("●")
            : chalk.dim("○")
          : chalk.dim("✕");
        lines.push(`│  ${cursor} ${marker} ${dimmed}`);
        continue;
      }
      const marker = isOn ? chalk.blue("●") : chalk.dim("○");
      const text = clamp(choice.label, Math.max(8, lineWidth - 6));
      const painted = i == cursorIndex ? chalk.bold(text) : text;
      lines.push(`│  ${cursor} ${marker} ${painted}`);
    }
    lines.push("│");
    return lines;
  };
  const collapsedLines = () => {
    const enabled = choices
      .filter((choice) => selected[choice.value])
      .map((choice) => choice.value);
    const summary = enabled.length ? enabled.join(", ") : "none";
    return [`│  ${chalk.gray(clamp(summary, Math.max(8, lineWidth - 4)))}`];
  };
  const writeLines = (lines) => {
    if (renderedLineCount > 0) {
      process.stdout.write(`\x1b[${renderedLineCount}A`);
    }
    const totalLineCount = Math.max(lines.length, renderedLineCount);
    for (let i = 0; i < totalLineCount; i++) {
      process.stdout.write("\r\x1b[2K");
      if (i < lines.length) {
        process.stdout.write(lines[i]);
      }
      process.stdout.write("\n");
    }
    renderedLineCount = lines.length;
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
        } catch {
          // noop: readline may already be closed during shutdown/cancel paths.
        }
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      collapseInPlace();
      cleanup();
      resolve(selected);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      const input = typeof chunk == "string" ? chunk : chunk.toString("utf8");
      if (!input.length) return;
      if (input == "\u0003") {
        fail(new Error(chalk.bold.red("◆  Cancelled")));
        return;
      }
      if (input == "\x1b[A" || input == "\x1bOA") {
        cursorIndex = stepCursor(-1);
        writeLines(menuLines());
        return;
      }
      if (input == "\x1b[B" || input == "\x1bOB") {
        cursorIndex = stepCursor(1);
        writeLines(menuLines());
        return;
      }
      if (input == " ") {
        if (!isSelectable(cursorIndex)) return;
        const key = choices[cursorIndex].value;
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
function installDependencies(root) {
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
function resolveInstallCommand(root) {
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
function buildBindingsRunner() {
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
