export class Config {
  input: string[] = [];
  outDir: string = "./build";
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
  show: boolean = true;
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
