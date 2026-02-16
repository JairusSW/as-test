export class Config {
  $schema: string = "./as-test.config.schema.json";
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./.as-test/build";
  logs: string = "./.as-test/logs";
  coverageDir: string = "./.as-test/coverage";
  snapshotDir: string = "./.as-test/snapshots";
  config: string = "none";
  coverage: boolean | CoverageOptions = true;
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
}

export class CoverageOptions {
  enabled: boolean = true;
  includeSpecs: boolean = false;
}

export class Suite {
  name: string = "";
}

export class BuildOptions {
  args: string[] = [];
  target: string = "wasi";
}

export class RunOptions {
  runtime: Runtime = new Runtime();
  reporter: string = "";
}

export class Runtime {
  cmd: string = "node ./.as-test/runners/default.wasi.js <file>";
}
