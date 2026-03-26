export class Config {
  constructor() {
    this.$schema = "./as-test.config.schema.json";
    this.input = ["./assembly/__tests__/*.spec.ts"];
    this.outDir = "./.as-test/build";
    this.logs = "./.as-test/logs";
    this.coverageDir = "./.as-test/coverage";
    this.snapshotDir = "./.as-test/snapshots";
    this.config = "none";
    this.coverage = false;
    this.env = {};
    this.buildOptions = new BuildOptions();
    this.runOptions = new RunOptions();
    this.fuzz = new FuzzConfig();
    this.modes = {};
  }
}
export class CoverageOptions {
  constructor() {
    this.enabled = false;
    this.includeSpecs = false;
    this.include = [];
    this.exclude = [];
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
    this.buildOptions = {};
    this.runOptions = {};
    this.env = {};
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
    this.seed = 1337;
    this.maxInputBytes = 4096;
    this.target = "bindings";
    this.corpusDir = "./.as-test/fuzz/corpus";
    this.crashDir = "./.as-test/crashes";
  }
}
