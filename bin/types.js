export class Config {
    constructor() {
        this.$schema = "./as-test.config.schema.json";
        this.input = ["./assembly/__tests__/*.spec.ts"];
        this.outDir = "./.as-test/build";
        this.logs = "./.as-test/logs";
        this.snapshotDir = "./.as-test/snapshots";
        this.config = "none";
        this.coverage = true;
        this.buildOptions = new BuildOptions();
        this.runOptions = new RunOptions();
    }
}
export class CoverageOptions {
    constructor() {
        this.enabled = true;
        this.includeSpecs = false;
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
        this.reporter = "";
    }
}
export class Runtime {
    constructor() {
        this.name = "wasmtime";
        this.run = "wasmtime <file>";
    }
}
