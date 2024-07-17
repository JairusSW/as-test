export class Config {
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./build";
  logs: string = "./logs";
  config: string = "none";
  plugins: {};
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
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
}

export class Runtime {
  name: string = "wasmtime";
  run: string = "wasmtime <file>";
}
