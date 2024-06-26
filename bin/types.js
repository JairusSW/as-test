export class Config {
    constructor() {
        this.input = [];
        this.outDir = "./build";
        this.suites = [];
        this.coverage = new Coverage();
        this.buildOptions = new BuildOptions();
        this.runOptions = new RunOptions();
    }
}
export class Suite {
    constructor() {
        this.name = "";
    }
}
export class Coverage {
    constructor() {
        this.enabled = false;
        this.show = true;
    }
}
export class BuildOptions {
    constructor() {
        this.args = [];
        this.wasi = true;
        this.parallel = true;
        this.verbose = true;
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
