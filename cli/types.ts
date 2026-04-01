export class Config {
  $schema: string = "./as-test.config.schema.json";
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./.as-test/build";
  logs: string = "./.as-test/logs";
  coverageDir: string = "./.as-test/coverage";
  snapshotDir: string = "./.as-test/snapshots";
  config: string = "none";
  coverage: boolean | CoverageOptions = false;
  env: Record<string, string> = {};
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
  fuzz: FuzzConfig = new FuzzConfig();
  modes: Record<string, ModeConfig> = {};
}

export class CoverageOptions {
  enabled: boolean = false;
  includeSpecs: boolean = false;
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
  reporter: string | ReporterConfig = "";
  env: Record<string, string> = {};
}

export class Runtime {
  cmd: string = "node ./.as-test/runners/default.wasi.js <file>";
  browser: string = "";
}

export class ModeConfig {
  outDir?: string;
  logs?: string;
  coverageDir?: string;
  snapshotDir?: string;
  config?: string;
  coverage?: boolean | CoverageOptions;
  buildOptions: Partial<BuildOptions> = {};
  runOptions: Partial<RunOptions> = {};
  env: Record<string, string> = {};
}

export class ReporterConfig {
  name: string = "";
  options: string[] = [];
  outDir: string = "";
  outFile: string = "";
}

export class FuzzConfig {
  input: string[] = ["./assembly/__fuzz__/*.fuzz.ts"];
  runs: number = 1000;
  seed: number = 1337;
  maxInputBytes: number = 4096;
  target: string = "bindings";
  corpusDir: string = "./.as-test/fuzz/corpus";
  crashDir: string = "./.as-test/crashes";
}
