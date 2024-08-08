import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { loadConfig } from "./util.js";
const TARGETS = ["wasi", "bindings"];
export async function init(args) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log(chalk.bold("as-test init v0.3.3") + "\n");
  console.log(chalk.dim("[1/3]") + " select a target [wasi/bindings]");
  const target = await ask(chalk.dim(" -> "), rl);
  if (!TARGETS.includes(target)) {
    console.log("Invalid target " + target + ". Exiting.");
    process.exit(0);
  }
  process.stdout.write(`\u001B[1A`);
  process.stdout.write("\x1B[2K");
  process.stdout.write("\x1B[0G");
  console.log(
    "\n" +
      chalk.dim("[2/3]") +
      " attempting to create the following files. Continue? [y/n]\n",
  );
  console.log(
    chalk.dim(`  ├── 📂 assembly/
  │    └── 📂 __tests__/
  │         └── 🧪 example.spec.ts
  ├── 📂 build/
  ├── 📂 logs/
  ├── 📂 tests/
  │    └── 📃 as-test.run.js   
  ├── ⚙️  as-test.config.json
  └── ⚙️  package.json\n`),
  );
  const cont = (await ask(chalk.dim(" -> "), rl)).toLowerCase().trim();
  if (cont == "n" || cont == "no") {
    console.log("Exiting.");
    process.exit(0);
  }
  let config = loadConfig(path.join(process.cwd(), "./as-test.config.json"));
  if (target == "wasi" && config.buildOptions.target != "wasi") {
    config.buildOptions.target = "wasi";
    config.runOptions.runtime.name = "wasmtime";
    config.runOptions.runtime.run = "wasmtime <file>";
  } else if (target == "bindings" && config.buildOptions.target != "bindings") {
    config.buildOptions.target = "bindings";
    config.runOptions.runtime.name = "node";
    config.runOptions.runtime.run = "node ./tests/<name>.run.js";
  }
  writeFile("./as-test.config.json", JSON.stringify(config, null, 2));
  writeFile(
    "./assembly/__tests__/example.spec.ts",
    `import {
    describe,
    expect,
    test,
    beforeAll,
    afterAll,
    mockFn,
    log,
    run,
    it
} from "as-test";

beforeAll(() => {
    log("Setting up test environment...");
});

afterAll(() => {
    log("Tearing down test environment...");
});

// Mock/override the function console.log
mockFn<void>("console.log", (data: string): void => {
    console.log("[MOCKED]: " + data + "\\n");
});

describe("Should sleep", () => {
    test("1ms", () => {
        const start = Date.now();
        sleep(1);
        expect(Date.now() - start).toBeGreaterOrEqualTo(1);
    });
    test("10ms", () => {
        const start = Date.now();
        sleep(10);
        expect(Date.now() - start).toBeGreaterOrEqualTo(10);
    });
    test("1s", () => {
        const start = Date.now();
        sleep(1000);
        expect(Date.now() - start).toBeGreaterOrEqualTo(1000);
    });
    test("5s", () => {
        const start = Date.now();
        log("Sleeping...");
        sleep(5000);
        log("Done!");
        expect(Date.now() - start).toBeGreaterOrEqualTo(5000);
    });
});

describe("Math operations", () => {
    test("Addition", () => {
        expect(1 + 2).toBe(3);
    });

    test("Subtraction", () => {
        expect(1 - 2).toBe(-1);
    });

    test("Comparison", () => {
        expect(5).toBeGreaterThan(3);
        expect(2).toBeLessThan(4);
    });

    test("Type checking", () => {
        expect("hello").toBeString();
        expect(true).toBeBoolean();
        expect(10.5).toBeNumber();
    });
});

let myArray: i32[] = [1, 2, 3];

describe("Array manipulation", () => {
    test("Array length", () => {
        expect(myArray).toHaveLength(3);
    });

    test("Array inclusion", () => {
        expect(myArray).toContain(2);
    });

    it("should be empty", () => { });
});

run();

function sleep(ms: i64): void {
    const target = Date.now() + ms;
    while (target > Date.now()) { }
}`,
  );
  writeDir("./build/");
  writeDir("./logs/");
  if (target == "bindings") {
    writeFile(
      "./tests/example.run.js",
      `import { readFileSync } from "fs";
import { instantiate } from "../build/example.spec.js";

const binary = readFileSync("./build/example.spec.wasm");
const module = new WebAssembly.Module(binary);

const exports = instantiate(module, {});`,
    );
  }
  const PKG_PATH = path.join(process.cwd(), "./package.json");
  if (!hasDep(PKG_PATH, "assemblyscript")) {
    console.log(
      chalk.dim(
        "AssemblyScript is not included in dependencies.\nInstall it with " +
          (process.env.npm_config_user_agent == "yarn"
            ? process.env.npm_config_user_agent + " add assemblyscript"
            : process.env.npm_config_user_agent + " install assemblyscript"),
      ),
    );
  }
  const pkg = JSON.parse(
    existsSync(PKG_PATH) ? readFileSync(PKG_PATH).toString() : "{}",
  );
  if (!pkg["scripts"]) pkg["scripts"] = {};
  if (pkg.scripts["test"]) process.exit(0);
  if (!pkg.scripts["pretest"]) {
    pkg.scripts["pretest"] = "as-test build";
    pkg.scripts["test"] = "as-test run";
  } else {
    pkg.scripts["test"] = "as-test test";
  }
  if (!pkg["devDependencies"]) pkg["devDependencies"] = {};
  if (!pkg["devDependencies"]["as-test"])
    pkg["devDependencies"]["as-test"] = "^0.3.3";
  if (target == "bindings") {
    pkg["type"] = "module";
  }
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2));
  process.exit(0);
}
function ask(question, face) {
  return new Promise((res, _) => {
    face.question(question, (answer) => {
      res(answer);
    });
  });
}
function writeFile(pth, data) {
  const fmtPath = path.join(process.cwd(), pth);
  if (existsSync(fmtPath)) return;
  if (!existsSync(path.dirname(fmtPath)))
    mkdirSync(path.dirname(fmtPath), { recursive: true });
  writeFileSync(fmtPath, data);
}
function writeDir(pth) {
  const fmtPath = path.join(process.cwd(), pth);
  if (existsSync(fmtPath)) return;
  mkdirSync(fmtPath);
}
function hasDep(PKG_PATH, dep) {
  const pkg = JSON.parse(
    existsSync(PKG_PATH) ? readFileSync(PKG_PATH).toString() : "{}",
  );
  if (existsSync(path.join(process.cwd(), "./node_modules/", dep))) return true;
  if (
    pkg.dependencies &&
    !Object.keys(pkg.dependencies).includes(dep) &&
    pkg.devDependencies &&
    !Object.keys(pkg.devDependencies).includes(dep) &&
    pkg.peerDependencies &&
    !Object.keys(pkg.peerDependencies).includes(dep)
  ) {
    return false;
  }
  return true;
}
