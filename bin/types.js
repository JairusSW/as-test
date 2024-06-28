"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Runtime = exports.RunOptions = exports.BuildOptions = exports.Suite = exports.Config = void 0;
class Config {
    constructor() {
        this.input = [];
        this.outDir = "./build";
        this.suites = [];
        this.buildOptions = new BuildOptions();
        this.runOptions = new RunOptions();
    }
}
exports.Config = Config;
class Suite {
    constructor() {
        this.name = "";
    }
}
exports.Suite = Suite;
class BuildOptions {
    constructor() {
        this.args = [];
        this.wasi = true;
        this.parallel = true;
        this.verbose = true;
    }
}
exports.BuildOptions = BuildOptions;
class RunOptions {
    constructor() {
        this.runtime = new Runtime();
    }
}
exports.RunOptions = RunOptions;
class Runtime {
    constructor() {
        this.name = "wasmtime";
        this.run = "wasmtime <file>";
    }
}
exports.Runtime = Runtime;
