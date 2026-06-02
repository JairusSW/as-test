export class Config {
  constructor() {
    this.$schema = "./as-test.config.schema.json";
    this.input = ["./assembly/__tests__/*.spec.ts"];
    this.outDir = "./.as-test/build";
    this.logs = "./.as-test/logs";
    this.coverageDir = "./.as-test/coverage";
    this.snapshotDir = "./.as-test/snapshots";
    this.config = "none";
    // Incremental test cache (opt-in). false = off; "build" = skip recompiling
    // unchanged specs; "full"/true = also replay passing run results. The object
    // form adds `maxTime` (e.g. "1h", "30m", "7d") to expire entries older than
    // that, forcing a rebuild+rerun. ("reachable" is accepted as a deprecated
    // alias for "full" — reachability-based dep pruning was unsound for
    // AssemblyScript's compile-time inlining.) Enable per run with --cache / --no-cache.
    this.cache = false;
    this.coverage = false;
    this.features = [];
    this.env = {};
    this.buildOptions = new BuildOptions();
    this.runOptions = new RunOptions();
    this.fuzz = new FuzzConfig();
    this.modes = {};
  }
}
export class CacheOptions {
  constructor() {
    // Cache tier: "build" (skip rebuilds) or "full" (also replay runs).
    // "reachable" is accepted as a deprecated alias for "full".
    this.type = "full";
    // Optional expiry: a duration string (e.g. "1h", "30m", "90s", "7d"). Entries
    // built longer ago than this are treated as stale and rebuilt+rerun. Empty =
    // no expiry.
    this.maxTime = "";
  }
}
export const INTERNAL_FEATURE_NAMES = new Set(["try-as"]);
export function normalizeFeatureName(value) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed == "try_as" || trimmed == "tryas") return "try-as";
  return trimmed;
}
export class CoverageOptions {
  constructor() {
    this.enabled = false;
    this.mode = "project";
    this.includeSpecs = false;
    this.dependencies = [];
    this.include = [];
    this.exclude = [];
    this.ignore = new CoverageIgnoreOptions();
  }
}
export class CoverageIgnoreOptions {
  constructor() {
    this.labels = [];
    this.names = [];
    this.locations = [];
    this.snippets = [];
  }
}
export class Suite {
  constructor() {
    this.name = "";
  }
}
export class BuildOptions {
  constructor() {
    this.cmd = "";
    this.args = [];
    this.target = "wasi";
    this.env = {};
  }
}
export class RunOptions {
  constructor() {
    this.runtime = new Runtime();
    this.reporter = "";
    this.env = {};
  }
}
export class Runtime {
  constructor() {
    this.cmd = "node ./.as-test/runners/default.wasi.js <file>";
    this.browser = "";
  }
}
export class ModeConfig {
  constructor() {
    this.default = true;
    this.config = new Config();
  }
}
export class ReporterConfig {
  constructor() {
    this.name = "";
    this.options = [];
    this.outDir = "";
    this.outFile = "";
  }
}
export class FuzzConfig {
  constructor() {
    this.input = ["./assembly/__fuzz__/*.fuzz.ts"];
    this.runs = 1000;
    this.seed = -1;
    this.maxInputBytes = 4096;
    this.target = "bindings";
    this.corpusDir = "./.as-test/fuzz/corpus";
    this.crashDir = "./.as-test/crashes";
  }
}
