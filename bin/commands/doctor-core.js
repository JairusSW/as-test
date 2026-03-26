import chalk from "chalk";
import { existsSync } from "fs";
import { glob } from "glob";
import * as path from "path";
import { applyMode, getExec, loadConfig, tokenizeCommand } from "../util.js";
import { Config } from "../types.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
export async function doctor(
  configPath = DEFAULT_CONFIG_PATH,
  selectedModes = [],
) {
  const checks = [];
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  const configExists = existsSync(resolvedConfigPath);
  const loadedConfig = tryLoadConfig(resolvedConfigPath);
  const config = loadedConfig.config;
  if (!configExists) {
    checks.push({
      status: "warn",
      scope: "config",
      label: "Config file not found",
      details: `No config at ${resolvedConfigPath}; default settings will be used.`,
      fix: `Create a config with "ast init" or add ${path.basename(resolvedConfigPath)}.`,
    });
  } else if (!loadedConfig.loaded) {
    checks.push({
      status: "error",
      scope: "config",
      label: "Config parse failed",
      details: `Could not parse ${resolvedConfigPath}.`,
      fix: "Fix JSON syntax errors, then rerun `ast doctor`.",
    });
  } else {
    checks.push({
      status: "ok",
      scope: "config",
      label: "Config loaded",
      details: resolvedConfigPath,
    });
  }
  checks.push(checkNodeVersion());
  checks.push(checkDependency("assemblyscript", true));
  const selected = selectedModes.length
    ? selectedModes
    : Object.keys(config.modes).length
      ? Object.keys(config.modes)
      : [undefined];
  if (selectedModes.length) {
    for (const modeName of selectedModes) {
      if (!config.modes[modeName]) {
        checks.push({
          status: "error",
          scope: "modes",
          label: `Unknown mode "${modeName}"`,
          details: `Available modes: ${Object.keys(config.modes).join(", ") || "(none)"}`,
          fix: `Use "--mode <name>" with one of the configured modes, or remove "--mode ${modeName}".`,
        });
      }
    }
  }
  for (const modeName of selected) {
    const scope = modeName ?? "default";
    const modeCheck = await checkMode(config, modeName, scope);
    checks.push(...modeCheck);
  }
  renderChecks(checks, resolvedConfigPath, selected);
  const hasErrors = checks.some((check) => check.status == "error");
  if (hasErrors) {
    throw new Error("doctor checks failed");
  }
}
function tryLoadConfig(configPath) {
  try {
    return { loaded: true, config: loadConfig(configPath, false) };
  } catch {
    return { loaded: false, config: new Config() };
  }
}
async function checkMode(config, modeName, scope) {
  const checks = [];
  let applied;
  try {
    applied = applyMode(config, modeName);
  } catch (error) {
    checks.push({
      status: "error",
      scope,
      label: "Mode merge failed",
      details: error instanceof Error ? error.message : String(error),
      fix: `Fix mode "${scope}" in as-test.config.json.`,
    });
    return checks;
  }
  const active = applied.config;
  const runtimeCommand = active.runOptions.runtime.cmd;
  const target = active.buildOptions.target;
  if (target == "wasi") {
    checks.push(checkDependency("@assemblyscript/wasi-shim", true, scope));
  }
  checks.push(
    ...checkRuntimeCommand(runtimeCommand, target, scope),
    ...(await checkInputPatterns(active.input, scope)),
  );
  return checks;
}
function checkRuntimeCommand(runtimeCommand, target, scope) {
  const checks = [];
  if (!runtimeCommand.trim().length) {
    checks.push({
      status: "error",
      scope,
      label: "Runtime command missing",
      details: "runOptions.runtime.cmd is empty.",
      fix: 'Set "runOptions.runtime.cmd" in as-test.config.json (for example: node ./.as-test/runners/default.wasi.js <file>).',
    });
    return checks;
  }
  let tokens;
  try {
    tokens = tokenizeCommand(runtimeCommand);
  } catch (error) {
    checks.push({
      status: "error",
      scope,
      label: "Runtime command parsing failed",
      details: error instanceof Error ? error.message : String(error),
      fix: "Fix quotes/escaping in runOptions.runtime.cmd.",
    });
    return checks;
  }
  if (!tokens.length) {
    checks.push({
      status: "error",
      scope,
      label: "Runtime command empty",
      details: "Command parsed to zero tokens.",
      fix: "Provide a runtime command executable and args.",
    });
    return checks;
  }
  const execToken = tokens[0];
  const execPath = getExec(execToken);
  if (!execPath) {
    checks.push({
      status: "error",
      scope,
      label: `Runtime executable not found: ${execToken}`,
      details: "Executable is not available in PATH.",
      fix: `Install "${execToken}" or update runOptions.runtime.cmd.`,
    });
  } else {
    checks.push({
      status: "ok",
      scope,
      label: "Runtime executable",
      details: `${execToken} -> ${execPath}`,
    });
  }
  if (!tokens.some((token) => token.includes("<file>"))) {
    checks.push({
      status: "error",
      scope,
      label: "Runtime command missing <file> placeholder",
      details: `Runtime command for target "${target}" cannot receive the wasm artifact path.`,
      fix: 'Add "<file>" to runOptions.runtime.cmd.',
    });
  }
  if (isScriptHostRuntime(execToken)) {
    const scriptPath = extractRuntimeScriptPath(tokens.slice(1));
    if (scriptPath) {
      const resolved = path.isAbsolute(scriptPath)
        ? scriptPath
        : path.join(process.cwd(), scriptPath);
      if (!existsSync(resolved)) {
        checks.push({
          status: "warn",
          scope,
          label: "Runtime script path not found",
          details: `${scriptPath} does not exist.`,
          fix: "Create the runner script, or use `ast init` to scaffold default runners.",
        });
      } else {
        checks.push({
          status: "ok",
          scope,
          label: "Runtime script path",
          details: scriptPath,
        });
      }
    }
  }
  return checks;
}
async function checkInputPatterns(input, scope) {
  const patterns = Array.isArray(input) ? input : [input];
  const files = await glob(patterns);
  const specs = files.filter((file) => file.endsWith(".spec.ts"));
  if (!specs.length) {
    return [
      {
        status: "warn",
        scope,
        label: "No spec files matched input patterns",
        details: patterns.join(", "),
        fix: 'Update "input" patterns or add `*.spec.ts` files.',
      },
    ];
  }
  return [
    {
      status: "ok",
      scope,
      label: "Spec file discovery",
      details: `${specs.length} spec file(s) matched input patterns.`,
    },
  ];
}
function checkNodeVersion() {
  const version = process.versions.node;
  const major = Number(version.split(".")[0] ?? "0");
  if (!Number.isFinite(major) || major < 18) {
    return {
      status: "warn",
      scope: "env",
      label: "Node.js version is old",
      details: `Detected v${version}.`,
      fix: "Use Node.js 18+ for the best compatibility.",
    };
  }
  return {
    status: "ok",
    scope: "env",
    label: "Node.js version",
    details: `v${version}`,
  };
}
function checkDependency(pkg, required, scope = "deps") {
  const pkgJson = path.join(process.cwd(), "node_modules", pkg, "package.json");
  if (!existsSync(pkgJson)) {
    return {
      status: required ? "error" : "warn",
      scope,
      label: `Dependency missing: ${pkg}`,
      details: `${pkg} is not installed in node_modules.`,
      fix: `Install with: npm i -D ${pkg}`,
    };
  }
  return {
    status: "ok",
    scope,
    label: `Dependency present: ${pkg}`,
    details: pkgJson,
  };
}
function isScriptHostRuntime(execToken) {
  const token = path.basename(execToken).toLowerCase();
  return (
    token == "node" ||
    token == "node.exe" ||
    token == "node.cmd" ||
    token == "bun" ||
    token == "bun.exe" ||
    token == "bun.cmd" ||
    token == "deno" ||
    token == "deno.exe" ||
    token == "deno.cmd" ||
    token == "tsx" ||
    token == "tsx.cmd" ||
    token == "ts-node" ||
    token == "ts-node.cmd"
  );
}
function extractRuntimeScriptPath(args) {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token == "--") {
      const next = args[i + 1];
      if (next && isLikelyScriptPath(next)) return next;
      return null;
    }
    if (token.startsWith("-")) continue;
    if (isLikelyScriptPath(token)) return token;
    return null;
  }
  return null;
}
function isLikelyScriptPath(token) {
  if (!token.length) return false;
  if (token == "<file>" || token == "<name>") return false;
  if (token.includes("://")) return false;
  if (token.startsWith("-")) return false;
  if (token.startsWith("./")) return true;
  if (token.startsWith("../")) return true;
  if (token.startsWith("/")) return true;
  if (token.startsWith(".\\")) return true;
  if (token.startsWith("..\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(token)) return true;
  return /\.(mjs|cjs|js|ts)$/.test(token);
}
function renderChecks(checks, configPath, selectedModes) {
  const errors = checks.filter((check) => check.status == "error").length;
  const warnings = checks.filter((check) => check.status == "warn").length;
  const oks = checks.filter((check) => check.status == "ok").length;
  process.stdout.write(chalk.bold.blueBright("as-test doctor") + "\n");
  process.stdout.write(chalk.dim(`config: ${configPath}`) + "\n");
  process.stdout.write(
    chalk.dim(
      `modes: ${
        selectedModes.length
          ? selectedModes.map((mode) => mode ?? "default").join(", ")
          : "default"
      }`,
    ) + "\n\n",
  );
  for (const check of checks) {
    const badge =
      check.status == "ok"
        ? chalk.bgGreenBright.black(" OK ")
        : check.status == "warn"
          ? chalk.bgYellow.black(" WARN ")
          : chalk.bgRed.white(" ERROR ");
    process.stdout.write(
      `${badge} ${chalk.bold(`[${check.scope}]`)} ${check.label}\n`,
    );
    process.stdout.write(`      ${check.details}\n`);
    if (check.fix?.length) {
      process.stdout.write(chalk.dim(`      fix: ${check.fix}\n`));
    }
  }
  process.stdout.write("\n");
  process.stdout.write(
    `${chalk.bold("Summary:")} ${chalk.greenBright(`${oks} ok`)}, ${warnings ? chalk.yellowBright(`${warnings} warn`) : chalk.gray("0 warn")}, ${errors ? chalk.redBright(`${errors} error`) : chalk.greenBright("0 error")}\n`,
  );
}
