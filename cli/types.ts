export class Config {
  input: string[] = ["./assembly/__tests__/*.spec.ts"];
  outDir: string = "./build";
  config: string = "./asconfig.json";
  plugins: {}
  buildOptions: BuildOptions = new BuildOptions();
  runOptions: RunOptions = new RunOptions();
}

export class Suite {
  name: string = "";
}

export class BuildOptions {
  args: string[] = [];
  target: string = "wasi"
}

export class RunOptions {
  runtime: Runtime = new Runtime();
}

export class Runtime {
  name: string = "wasmtime";
  run: string = "wasmtime <file>";
}
