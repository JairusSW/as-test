export class Config {
  $schema: string = "./as-test.config.schema.json";
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./.as-test/build";
  logs: string = "./.as-test/logs";
  coverageDir: string = "./.as-test/coverage";
  snapshotDir: string = "./.as-test/snapshots";
  config: string = "none";
  coverage: boolean | CoverageOptions = true;
  env: Record<string, string> = {};
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
  modes: Record<string, ModeConfig> = {};
}

export class CoverageOptions {
  enabled: boolean = true;
  includeSpecs: boolean = false;
}

export class Suite {
  name: string = "";
}

export class BuildOptions {
  cmd: string = "";
  args: string[] = [];
  target: string = "wasi";
}

export class RunOptions {
  runtime: Runtime = new Runtime();
  reporter: string | ReporterConfig = "";
}

export class Runtime {
  cmd: string = "node ./.as-test/runners/default.wasi.js <file>";
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
