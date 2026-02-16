import { existsSync } from "fs";
import { Config } from "./types.js";
import { glob } from "glob";
import chalk from "chalk";
import { execSync } from "child_process";
import * as path from "path";
import { getPkgRunner, loadConfig } from "./util.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
export async function build(
  configPath: string = DEFAULT_CONFIG_PATH,
  selectors: string[] = [],
) {
  const config = loadConfig(configPath, false);

  ensureDeps(config);

  const pkgRunner = getPkgRunner();
  const inputPatterns = resolveInputPatterns(config.input, selectors);
  const inputFiles = await glob(inputPatterns);

  const buildArgs = getBuildArgs(config);
  for (const file of inputFiles) {
    let cmd = `${pkgRunner} asc ${file}${buildArgs}`;
    const outFile = `${config.outDir}/${file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm")}`;
    if (config.outDir) {
      cmd += " -o " + outFile;
    }
    try {
      buildFile(cmd);
    } catch (error) {
      throw new Error(
        `Failed to build ${path.basename(file)} with ${getBuildStderr(error)}`,
      );
    }
  }
}

function resolveInputPatterns(
  configured: string[] | string,
  selectors: string[],
): string[] {
  const configuredInputs = Array.isArray(configured) ? configured : [configured];
  if (!selectors.length) return configuredInputs;

  const patterns = new Set<string>();
  for (const selector of selectors) {
    if (!selector) continue;
    if (isBareSuiteSelector(selector)) {
      const base = stripSuiteSuffix(selector);
      for (const configuredInput of configuredInputs) {
        patterns.add(path.join(path.dirname(configuredInput), `${base}.spec.ts`));
      }
      continue;
    }
    patterns.add(selector);
  }
  return [...patterns];
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

  if (!hasJsonAsTransform()) {
    console.log(
      `${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not find json-as. Install it to compile as-test suites.`,
    );
    process.exit(1);
  }
}

function buildFile(command: string): void {
  execSync(command, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
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

function getBuildArgs(config: Config): string {
  let buildArgs = "";

  buildArgs += " --transform as-test/transform";
  buildArgs += " --transform json-as/transform";
  if (hasTryAsRuntime()) {
    buildArgs += " --transform try-as/transform";
  }

  if (config.config && config.config !== "none") {
    buildArgs += " --config " + config.config;
  }

  if (hasTryAsRuntime()) {
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

  if (
    config.buildOptions.args.length &&
    config.buildOptions.args.find((v) => v.length > 0)
  ) {
    buildArgs += " " + config.buildOptions.args.join(" ");
  }
  return buildArgs;
}

function hasTryAsRuntime(): boolean {
  return (
    existsSync(path.join(process.cwd(), "node_modules/try-as")) ||
    existsSync(path.join(process.cwd(), "node_modules/try-as/package.json"))
  );
}

function hasJsonAsTransform(): boolean {
  return (
    existsSync(path.join(process.cwd(), "node_modules/json-as/transform.js")) ||
    existsSync(path.join(process.cwd(), "node_modules/json-as/transform.ts")) ||
    existsSync(path.join(process.cwd(), "node_modules/json-as/transform"))
  );
}
