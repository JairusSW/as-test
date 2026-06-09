export class Config {
  $schema: string = "./as-test.config.schema.json";
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./.as-test/build";
  logs: string = "./.as-test/logs";
  coverageDir: string = "./.as-test/coverage";
  snapshotDir: string = "./.as-test/snapshots";
  config: string = "none";
  // Incremental test cache (opt-in). false = off; "build" = skip recompiling
  // unchanged specs; "full"/true = also replay passing run results. The object
  // form adds `maxTime` (e.g. "1h", "30m", "7d") to expire entries older than
  // that, forcing a rebuild+rerun. ("reachable" is accepted as a deprecated
  // alias for "full" — reachability-based dep pruning was unsound for
  // AssemblyScript's compile-time inlining.) Enable per run with --cache / --no-cache.
  cache: boolean | "build" | "full" | "reachable" | CacheOptions = false;
  coverage: boolean | CoverageOptions = false;
  features: string[] = [];
  env: Record<string, string> = {};
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
  fuzz: FuzzConfig = new FuzzConfig();
  modes: Record<string, ModeConfig> = {};
}

export class CacheOptions {
  // Cache tier: "build" (skip rebuilds) or "full" (also replay runs).
  // "reachable" is accepted as a deprecated alias for "full".
  type: "build" | "full" | "reachable" = "full";
  // Optional expiry: a duration string (e.g. "1h", "30m", "90s", "7d"). Entries
  // built longer ago than this are treated as stale and rebuilt+rerun. Empty =
  // no expiry.
  maxTime: string = "";
}

export const INTERNAL_FEATURE_NAMES = new Set(["try-as"]);

export function normalizeFeatureName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed == "try_as" || trimmed == "tryas") return "try-as";
  return trimmed;
}

export class CoverageOptions {
  enabled: boolean = false;
  mode: string = "project";
  includeSpecs: boolean = false;
  dependencies: string[] = [];
  include: string[] = [];
  exclude: string[] = [];
  ignore: CoverageIgnoreOptions = new CoverageIgnoreOptions();
}

export class CoverageIgnoreOptions {
  labels: string[] = [];
  names: string[] = [];
  locations: string[] = [];
  snippets: string[] = [];
}

export class Suite {
  name: string = "";
}

export class BuildOptions {
  cmd: string = "";
  args: string[] = [];
  target: string = "wasi";
  env: Record<string, string> = {};
}

export class RunOptions {
  runtime: Runtime = new Runtime();
  env: Record<string, string> = {};
}

export class Runtime {
  cmd: string = "node ./.as-test/runners/default.wasi.js <file>";
  browser: string = "";
}

export class ModeConfig {
  path?: string;
  default: boolean = true;
  config: Config = new Config();
}

export class FuzzConfig {
  input: string[] = ["./assembly/__fuzz__/*.fuzz.ts"];
  runs: number = 1000;
  seed: number = -1;
  maxInputBytes: number = 4096;
  target: string = "bindings";
  corpusDir: string = "./.as-test/fuzz/corpus";
  crashDir: string = "./.as-test/crashes";
}
