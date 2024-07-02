export class Config {
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./build";
  config: string = "./asconfig.json";
  suites: Suite[] = [];
  coverage: Coverage = new Coverage();
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
}

export class Suite {
  name: string = "";
}

export class Coverage {
  enabled: boolean = false;
  show: boolean = false;
}

export class BuildOptions {
  args: string[] = [];
  wasi: boolean = true;
  parallel: boolean = true;
  verbose: boolean = true;
}

export class RunOptions {
  runtime: Runtime = new Runtime();
}

export class Runtime {
  name: string = "wasmtime";
  run: string = "wasmtime <file>";
}
