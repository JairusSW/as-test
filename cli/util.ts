import { existsSync, readFileSync } from "fs";
import { BuildOptions, Config, RunOptions, Runtime } from "./types.js";
import chalk from "chalk";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";

export function formatTime(ms: number): string {
  if (ms < 0) {
    throw new Error("Time should be a non-negative number.");
  }

  // Convert milliseconds to microseconds
  const us = ms * 1000;

  const units: {
    name: string;
    divisor: number;
  }[] = [
    { name: "μs", divisor: 1 },
    { name: "ms", divisor: 1000 },
    { name: "s", divisor: 1000 * 1000 },
    { name: "m", divisor: 60 * 1000 * 1000 },
    { name: "h", divisor: 60 * 60 * 1000 * 1000 },
    { name: "d", divisor: 24 * 60 * 60 * 1000 * 1000 },
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i]!;
    if (us >= unit.divisor) {
      const value = Math.round((us / unit.divisor) * 1000) / 1000;
      return `${value}${unit.name}`;
    }
  }

  return `${us}us`;
}

export function loadConfig(CONFIG_PATH: string, warn: boolean = false): Config {
  if (!existsSync(CONFIG_PATH)) {
    if (warn)
      console.log(
        `${chalk.bgMagentaBright(" WARN ")}${chalk.dim(":")} Could not locate config file in the current directory! Continuing with default config.`,
      );
    return new Config();
  } else {
    const raw = JSON.parse(readFileSync(CONFIG_PATH).toString()) as Record<
      string,
      unknown
    >;
    const config = Object.assign(
      new Config(),
      raw,
    ) as Config;
    const runOptionsRaw =
      (raw.runOptions as Record<string, unknown> | undefined) ?? {};
    config.buildOptions = Object.assign(
      new BuildOptions(),
      (raw.buildOptions as Record<string, unknown> | undefined) ?? {},
    );
    config.runOptions = Object.assign(
      new RunOptions(),
      runOptionsRaw,
    );

    const runtimeRaw = runOptionsRaw.runtime as Record<string, unknown> | undefined;
    const runtime = new Runtime();
    const legacyRun =
      typeof runOptionsRaw.run == "string" && runOptionsRaw.run.length
        ? runOptionsRaw.run
        : "";

    const cmd =
      runtimeRaw && typeof runtimeRaw.cmd == "string" && runtimeRaw.cmd.length
        ? runtimeRaw.cmd
        : runtimeRaw &&
            typeof runtimeRaw.run == "string" &&
            runtimeRaw.run.length
          ? runtimeRaw.run
          : legacyRun
            ? legacyRun
          : runtime.cmd;
    runtime.cmd = cmd;
    config.runOptions.runtime = runtime;
    return config;
  }
}

export function getCliVersion(): string {
  const candidates = [
    join(process.cwd(), "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ];
  for (const pkgPath of candidates) {
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    } catch {
      // ignore invalid package metadata and continue to fallback candidate
    }
  }
  return "0.0.0";
}

export function getPkgRunner(): string {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpx";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bunx";
  return "npx";
}

export function getExec(exec: string): string | null {
  const PATH = process.env.PATH.split(delimiter);

  for (const pathDir of PATH) {
    const fullPath = join(
      pathDir,
      exec + (process.platform === "win32" ? ".exe" : ""),
    );
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
