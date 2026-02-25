import { existsSync } from "fs";
import { Config } from "./types.js";
import { glob } from "glob";
import chalk from "chalk";
import { execSync } from "child_process";
import * as path from "path";
import { applyMode, getPkgRunner, loadConfig } from "./util.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");

export type BuildFeatureToggles = {
  tryAs?: boolean;
  coverage?: boolean;
};

export async function build(
  configPath: string = DEFAULT_CONFIG_PATH,
  selectors: string[] = [],
  modeName?: string,
  featureToggles: BuildFeatureToggles = {},
) {
  const loadedConfig = loadConfig(configPath, false);
  const mode = applyMode(loadedConfig, modeName);
  const config = mode.config;

  if (!hasCustomBuildCommand(config)) {
    ensureDeps(config);
  }

  const pkgRunner = getPkgRunner();
  const inputPatterns = resolveInputPatterns(config.input, selectors);
  const inputFiles = (await glob(inputPatterns)).sort((a, b) =>
    a.localeCompare(b),
  );

  const coverageEnabled = resolveCoverageEnabled(
    config.coverage,
    featureToggles.coverage,
  );
  const buildEnv = {
    ...mode.env,
    AS_TEST_COVERAGE_ENABLED: coverageEnabled ? "1" : "0",
  };

  for (const file of inputFiles) {
    const outFile = `${config.outDir}/${resolveArtifactFileName(file, config.buildOptions.target, modeName)}`;
    const cmd = getBuildCommand(
      config,
      pkgRunner,
      file,
      outFile,
      modeName,
      featureToggles,
    );
    try {
      buildFile(cmd, buildEnv);
    } catch (error) {
      const modeLabel = modeName ?? "default";
      throw new Error(
        `Failed to build ${path.basename(file)} in mode ${modeLabel} with ${getBuildStderr(error)}\nBuild command: ${cmd}`,
      );
    }
  }
}

function hasCustomBuildCommand(config: Config): boolean {
  return !!config.buildOptions.cmd.trim().length;
}

function getBuildCommand(
  config: Config,
  pkgRunner: string,
  file: string,
  outFile: string,
  modeName?: string,
  featureToggles: BuildFeatureToggles = {},
): string {
  const userArgs = getUserBuildArgs(config);
  if (hasCustomBuildCommand(config)) {
    return `${expandBuildCommand(config.buildOptions.cmd, file, outFile, config.buildOptions.target, modeName)}${userArgs}`;
  }

  const defaultArgs = getDefaultBuildArgs(config, featureToggles);
  let cmd = `${pkgRunner} asc ${file}${userArgs}${defaultArgs}`;
  if (config.outDir) {
    cmd += " -o " + outFile;
  }
  return cmd;
}

function getUserBuildArgs(config: Config): string {
  const args = config.buildOptions.args.filter((value) => value.length > 0);
  if (args.length) {
    return " " + args.join(" ");
  }
  return "";
}

function expandBuildCommand(
  template: string,
  file: string,
  outFile: string,
  target: string,
  modeName?: string,
): string {
  const name = path
    .basename(file)
    .replace(/\.spec\.ts$/, "")
    .replace(/\.ts$/, "");
  return template
    .replace(/<file>/g, file)
    .replace(/<name>/g, name)
    .replace(/<outFile>/g, outFile)
    .replace(/<target>/g, target)
    .replace(/<mode>/g, modeName ?? "");
}

function resolveArtifactFileName(
  file: string,
  target: string,
  modeName?: string,
): string {
  const base = path
    .basename(file)
    .replace(/\.spec\.ts$/, "")
    .replace(/\.ts$/, "");
  if (!modeName) {
    return `${path.basename(file).replace(".ts", ".wasm")}`;
  }
  return `${base}.${modeName}.${target}.wasm`;
}

function resolveInputPatterns(
  configured: string[] | string,
  selectors: string[],
): string[] {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) return configuredInputs;

  const patterns = new Set<string>();
  for (const selector of expandSelectors(selectors)) {
    if (!selector) continue;
    if (isBareSuiteSelector(selector)) {
      const base = stripSuiteSuffix(selector);
      for (const configuredInput of configuredInputs) {
        patterns.add(
          path.join(path.dirname(configuredInput), `${base}.spec.ts`),
        );
      }
      continue;
    }
    patterns.add(selector);
  }
  return [...patterns];
}

function expandSelectors(selectors: string[]): string[] {
  const expanded: string[] = [];
  for (const selector of selectors) {
    if (!selector) continue;
    if (!shouldSplitSelector(selector)) {
      expanded.push(selector);
      continue;
    }
    for (const token of selector.split(",")) {
      const trimmed = token.trim();
      if (!trimmed.length) continue;
      expanded.push(trimmed);
    }
  }
  return expanded;
}

function shouldSplitSelector(selector: string): boolean {
  return (
    selector.includes(",") &&
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}

function isBareSuiteSelector(selector: string): boolean {
  return (
    !selector.includes("/") &&
    !selector.includes("\\") &&
    !/[*?[\]{}]/.test(selector)
  );
}

function stripSuiteSuffix(selector: string): string {
  return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}

function ensureDeps(config: Config): void {
  if (config.buildOptions.target == "wasi") {
    if (!existsSync("./node_modules/@assemblyscript/wasi-shim/asconfig.json")) {
      console.log(
        `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find @assemblyscript/wasi-shim! Add it to your dependencies to run with WASI!`,
      );
      process.exit(1);
    }
  }
}

function buildFile(command: string, env: NodeJS.ProcessEnv): void {
  execSync(command, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env,
  });
}

function getBuildStderr(error: unknown): string {
  const err = error as { stderr?: unknown; message?: unknown };
  const stderr = err?.stderr;
  if (typeof stderr == "string") {
    const trimmed = stderr.trim();
    if (trimmed.length) return trimmed;
  } else if (stderr instanceof Buffer) {
    const trimmed = stderr.toString("utf8").trim();
    if (trimmed.length) return trimmed;
  }
  const message = typeof err?.message == "string" ? err.message.trim() : "";
  return message || "unknown error";
}

function getDefaultBuildArgs(
  config: Config,
  featureToggles: BuildFeatureToggles,
): string {
  let buildArgs = "";
  const tryAsEnabled = resolveTryAsEnabled(featureToggles.tryAs);

  buildArgs += " --transform as-test/transform";
  if (tryAsEnabled) {
    buildArgs += " --transform try-as/transform";
  }

  if (config.config && config.config !== "none") {
    buildArgs += " --config " + config.config;
  }

  if (tryAsEnabled) {
    buildArgs += " --use AS_TEST_TRY_AS=1";
  }
  // Should also strip any bindings-enabling from asconfig
  if (config.buildOptions.target == "bindings") {
    buildArgs += " --use AS_TEST_BINDINGS=1";
    buildArgs += " --bindings raw --exportRuntime --exportStart _start";
  } else if (config.buildOptions.target == "wasi") {
    buildArgs += " --use AS_TEST_WASI=1";
    buildArgs +=
      " --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json";
  } else {
    console.log(
      `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not determine target in config! Set target to 'bindings' or 'wasi'`,
    );
    process.exit(1);
  }
  return buildArgs;
}

function resolveTryAsEnabled(override?: boolean): boolean {
  const installed = hasTryAsRuntime();
  if (override === false) return false;
  if (override === true && !installed) {
    throw new Error(
      'try-as feature was enabled, but package "try-as" is not installed',
    );
  }
  return installed;
}

function resolveCoverageEnabled(
  rawCoverage: unknown,
  override?: boolean,
): boolean {
  if (override != undefined) return override;
  if (typeof rawCoverage == "boolean") return rawCoverage;
  if (rawCoverage && typeof rawCoverage == "object") {
    const enabled = (rawCoverage as { enabled?: unknown }).enabled;
    if (typeof enabled == "boolean") return enabled;
  }
  return true;
}

function hasTryAsRuntime(): boolean {
  return (
    existsSync(path.join(process.cwd(), "node_modules/try-as")) ||
    existsSync(path.join(process.cwd(), "node_modules/try-as/package.json"))
  );
}
