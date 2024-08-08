export class Config {
  constructor() {
    this.input = ["./assembly/__tests__/*.spec.ts"];
    this.outDir = "./build";
    this.logs = "./logs";
    this.config = "none";
    this.plugins = {
      coverage: true,
    };
    this.buildOptions = new BuildOptions();
    this.runOptions = new RunOptions();
  }
}
export class Suite {
  constructor() {
    this.name = "";
  }
}
export class BuildOptions {
  constructor() {
    this.args = [];
    this.target = "wasi";
  }
}
export class RunOptions {
  constructor() {
    this.runtime = new Runtime();
  }
}
export class Runtime {
  constructor() {
    this.name = "wasmtime";
    this.run = "wasmtime <file>";
  }
}
