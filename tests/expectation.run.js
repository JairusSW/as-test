import { readFileSync } from "fs";
import { instantiate } from "../.as-test/build/expectation.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./.as-test/build/expectation.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(module, withNodeIo({}));
