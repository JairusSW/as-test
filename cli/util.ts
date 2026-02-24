import { existsSync, readFileSync } from "fs";
import {
  BuildOptions,
  Config,
  CoverageOptions,
  ModeConfig,
  ReporterConfig,
  RunOptions,
  Runtime,
} from "./types.js";
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
    const reporterRaw = runOptionsRaw.reporter;
    if (typeof reporterRaw == "string") {
      config.runOptions.reporter = reporterRaw;
    } else if (reporterRaw && typeof reporterRaw == "object") {
      const reporterConfig = Object.assign(
        new ReporterConfig(),
        reporterRaw as Record<string, unknown>,
      );
      reporterConfig.name =
        typeof reporterConfig.name == "string" ? reporterConfig.name : "";
      reporterConfig.options = Array.isArray(reporterConfig.options)
        ? reporterConfig.options.filter((value): value is string => typeof value == "string")
        : [];
      reporterConfig.outDir =
        typeof reporterConfig.outDir == "string" ? reporterConfig.outDir : "";
      reporterConfig.outFile =
        typeof reporterConfig.outFile == "string" ? reporterConfig.outFile : "";
      config.runOptions.reporter = reporterConfig;
    } else {
      config.runOptions.reporter = "";
    }

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
    config.modes = parseModes(raw.modes);
    return config;
  }
}

function parseModes(raw: unknown): Record<string, ModeConfig> {
  if (!raw || typeof raw != "object" || Array.isArray(raw)) return {};

  const out: Record<string, ModeConfig> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [name, value] of entries) {
    if (!value || typeof value != "object" || Array.isArray(value)) continue;
    const modeRaw = value as Record<string, unknown>;
    const mode = new ModeConfig();

    if (typeof modeRaw.outDir == "string" && modeRaw.outDir.length) {
      mode.outDir = modeRaw.outDir;
    }
    if (typeof modeRaw.logs == "string" && modeRaw.logs.length) {
      mode.logs = modeRaw.logs;
    }
    if (
      typeof modeRaw.coverageDir == "string" &&
      modeRaw.coverageDir.length
    ) {
      mode.coverageDir = modeRaw.coverageDir;
    }
    if (
      typeof modeRaw.snapshotDir == "string" &&
      modeRaw.snapshotDir.length
    ) {
      mode.snapshotDir = modeRaw.snapshotDir;
    }
    if (typeof modeRaw.config == "string" && modeRaw.config.length) {
      mode.config = modeRaw.config;
    }

    if (typeof modeRaw.coverage == "boolean") {
      mode.coverage = modeRaw.coverage;
    } else if (modeRaw.coverage && typeof modeRaw.coverage == "object") {
      mode.coverage = Object.assign(
        new CoverageOptions(),
        modeRaw.coverage as Record<string, unknown>,
      );
    }

    if (modeRaw.buildOptions && typeof modeRaw.buildOptions == "object") {
      const buildRaw = modeRaw.buildOptions as Record<string, unknown>;
      const build: Partial<BuildOptions> = {};
      if (Array.isArray(buildRaw.args)) {
        build.args = buildRaw.args.filter(
          (item): item is string => typeof item == "string",
        );
      }
      if (typeof buildRaw.target == "string" && buildRaw.target.length) {
        build.target = buildRaw.target;
      }
      mode.buildOptions = build;
    }

    if (modeRaw.runOptions && typeof modeRaw.runOptions == "object") {
      const runRaw = modeRaw.runOptions as Record<string, unknown>;
      const run: Partial<RunOptions> = {};

      if (runRaw.runtime && typeof runRaw.runtime == "object") {
        const runtimeRaw = runRaw.runtime as Record<string, unknown>;
        const runtime = new Runtime();
        if (typeof runtimeRaw.cmd == "string" && runtimeRaw.cmd.length) {
          runtime.cmd = runtimeRaw.cmd;
        } else if (
          typeof runtimeRaw.run == "string" &&
          runtimeRaw.run.length
        ) {
          runtime.cmd = runtimeRaw.run;
        } else {
          runtime.cmd = "";
        }
        run.runtime = runtime;
      }

      if (typeof runRaw.reporter == "string") {
        run.reporter = runRaw.reporter;
      } else if (runRaw.reporter && typeof runRaw.reporter == "object") {
        const reporter = Object.assign(
          new ReporterConfig(),
          runRaw.reporter as Record<string, unknown>,
        );
        reporter.name = typeof reporter.name == "string" ? reporter.name : "";
        reporter.options = Array.isArray(reporter.options)
          ? reporter.options.filter(
              (item): item is string => typeof item == "string",
            )
          : [];
        reporter.outDir =
          typeof reporter.outDir == "string" ? reporter.outDir : "";
        reporter.outFile =
          typeof reporter.outFile == "string" ? reporter.outFile : "";
        run.reporter = reporter;
      }

      mode.runOptions = run;
    }

    if (modeRaw.env && typeof modeRaw.env == "object") {
      const env: Record<string, string> = {};
      for (const [key, val] of Object.entries(
        modeRaw.env as Record<string, unknown>,
      )) {
        if (typeof val == "string") env[key] = val;
      }
      mode.env = env;
    }

    out[name] = mode;
  }

  return out;
}

export function resolveModeNames(rawArgs: string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (arg == "--mode") {
      const next = rawArgs[i + 1];
      if (!next || next.startsWith("-")) continue;
      i++;
      appendModeTokens(names, next);
      continue;
    }
    if (arg.startsWith("--mode=")) {
      appendModeTokens(names, arg.slice("--mode=".length));
    }
  }
  return [...new Set(names)];
}

function appendModeTokens(out: string[], value: string): void {
  for (const token of value.split(",")) {
    const mode = token.trim();
    if (!mode.length) continue;
    out.push(mode);
  }
}

export function applyMode(config: Config, modeName?: string): {
  config: Config;
  env: NodeJS.ProcessEnv;
  modeName?: string;
} {
  if (!modeName) {
    return {
      config,
      env: process.env,
    };
  }

  const mode = config.modes[modeName];
  if (!mode) {
    const known = Object.keys(config.modes);
    const available = known.length ? known.join(", ") : "(none)";
    throw new Error(
      `unknown mode "${modeName}". Available modes: ${available}`,
    );
  }

  const merged = Object.assign(new Config(), config) as Config;
  merged.buildOptions = Object.assign(new BuildOptions(), config.buildOptions);
  merged.runOptions = Object.assign(new RunOptions(), config.runOptions);
  merged.runOptions.runtime = Object.assign(new Runtime(), config.runOptions.runtime);

  if (mode.outDir) merged.outDir = mode.outDir;
  else merged.outDir = appendPathSegment(config.outDir, modeName);

  if (mode.logs) merged.logs = mode.logs;
  else if (config.logs != "none")
    merged.logs = appendPathSegment(config.logs, modeName);

  if (mode.coverageDir) merged.coverageDir = mode.coverageDir;
  else if (config.coverageDir != "none")
    merged.coverageDir = appendPathSegment(config.coverageDir, modeName);

  if (mode.snapshotDir) merged.snapshotDir = mode.snapshotDir;
  if (mode.config) merged.config = mode.config;
  if (mode.coverage != undefined) merged.coverage = mode.coverage;

  if (mode.buildOptions.target) merged.buildOptions.target = mode.buildOptions.target;
  if (mode.buildOptions.args) merged.buildOptions.args = mode.buildOptions.args;

  if (mode.runOptions.runtime?.cmd) {
    merged.runOptions.runtime.cmd = mode.runOptions.runtime.cmd;
  }
  if (mode.runOptions.reporter != undefined) {
    merged.runOptions.reporter = mode.runOptions.reporter;
  }

  return {
    config: merged,
    env: {
      ...process.env,
      ...mode.env,
    },
    modeName,
  };
}

function appendPathSegment(basePath: string, segment: string): string {
  return join(basePath, segment);
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
